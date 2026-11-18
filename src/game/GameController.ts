import { AudioEngine } from '../audio/AudioEngine';
import { PHYSICS, VOICE_TRANSCRIPTS } from '../constants';
import { SectorGenerator } from '../levels/SectorGenerator';
import { PhysicsEngine } from '../physics/PhysicsEngine';
import { BOOT_TIMING } from '../render/BootLogoRenderer';
import { BOOT_LINES, HudRenderer } from '../render/HudRenderer';
import { MobileHudRenderer, type MobileActiveTouchState } from '../render/MobileHudRenderer';
import { WebGLCRT } from '../render/WebGLCRT';
import { WorldRenderer, type CameraView } from '../render/WorldRenderer';
import {
  GlobalLeaderboardService,
  accuracyToGrade,
  formatSectorCode,
} from '../services/leaderboard';
import type {
  BezelState,
  GamePhase,
  LanderState,
  LandingEvaluation,
  LandingGrade,
  LandingPad,
  LastSubmittedRun,
  LeaderboardMode,
  MenuModeSelection,
  SafeAreaInsets,
  SectorConfig,
  SectorScoreBreakdown,
  TouchdownSnapshot,
  Vec2,
  ViewportRect,
  VoiceCalloutId,
} from '../types';

export class GameController {
  private webglCanvas: HTMLCanvasElement;
  private offscreenCrtCanvas: HTMLCanvasElement;
  private offscreenCrtCtx: CanvasRenderingContext2D;
  private srLiveRegion: HTMLElement | null;

  private audio = new AudioEngine();
  private leaderboard = new GlobalLeaderboardService();
  private physics = new PhysicsEngine();
  private webglCrt: WebGLCRT;
  private worldRenderer = new WorldRenderer();
  private hudRenderer = new HudRenderer();

  private dpr = 1;
  private viewportWidth = 1280;
  private viewportHeight = 800;
  private crtRect: ViewportRect = { x: 0, y: 0, width: 1280, height: 800 };

  private phase: GamePhase = 'BOOT';
  private sector: SectorConfig;
  private lander: LanderState;

  private bezelState: BezelState = {
    sasEnabled: false,
    autoZoomEnabled: true,
    crtIntensity: 0.0,
    audioMuted: false,
    flightLogsOpen: false,
    osdMenuOpen: false,
  };

  // Campaign / Deep-Survey 3-Lives Progression & Global Leaderboard State
  private readonly maxLives = 3;
  private lives = 3;
  private lifeLostFlashTimer = 0;
  private isPracticeRun = false;
  private endlessMode = false;
  private endlessDepth = 1;
  private endlessSeed = 203779;
  private selectedMenuMode: MenuModeSelection = 'RANKED_CAMPAIGN';
  private selectedStartSector = 1;
  private mobileMode = false;
  private isFullscreen = false;
  private canvasOffsetX = 0;
  private canvasOffsetY = 0;
  private safeAreaInsets: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private activeTouchPointers = new Map<number, string>();
  private gameEmergencyPulseAvailable = true;
  private missionScore = 0;
  private displayedScore = 0;
  private dropStreak = 0;
  private highestSectorNum = 1;
  private highestSectorCode = 'SEC-01';
  private accuracySamples: number[] = [];

  private lastBreakdown: SectorScoreBreakdown | null = null;
  private lastFailure: LandingEvaluation | null = null;
  private touchdownSnapshot: TouchdownSnapshot | null = null;
  private tallyAnimProgress = 0;
  private callsignDraft = 'PILOT-01';
  private manifestTab: LeaderboardMode = 'CAMPAIGN';
  private scoreSubmittedForRun = false;
  private lastSubmittedRun: LastSubmittedRun | null = null;
  private uplinkSubmitState: 'IDLE' | 'TRANSMITTING' | 'CONFIRMED' | 'OFFLINE_SAVED' = 'IDLE';
  private uplinkConfirmText: string | null = null;
  private sessionLogs: string[] = [
    'INTERFACE 2037 INITIALIZED // ORBITAL BUS ONLINE',
    'AWAITING PILOT DROP TELEMETRY DIRECTIVE',
  ];

  // Typewriter & 1979 Alien Awakening State
  private bootPoweredOn = false;
  private bootElapsedSec = 0;
  private bootModeSwitchPlayed = false;
  private crtWarmupProgress = 0;
  private bootProgressChars = 0;
  private bootTransitionPlayed = false;
  private briefingProgressChars = 0;
  private ambientChirpTimer = 26.0;
  private activeCalloutText: string | null = null;
  private activeCalloutTimer = 0;
  private statusBannerText: string | null = null;
  private statusBannerTimer = 0;
  private menuCursor = 0;

  // Per-sector extreme Airbus GPWS cooldowns, motion tracker, muted warning indicator & ignition edge
  private sectorElapsedSec = 0;
  private proximityVoiceCooldown = 0;
  private bankAngleVoiceCooldown = 0;
  private driftVoiceCooldown = 0;
  private avionicsBeepTimer = 0;
  private hadActiveAvionicsWarning = false;
  private motionPingTimer = 0;
  private wasMainEngineLit = false;

  // Camera & CRT Glitch FX
  private manualZoom = 1.15;
  private currentZoom = 1.15;
  private cameraPos: Vec2 = { x: 210, y: 130 };
  private glitchIntensity = 0;

  // Input Tracking
  private keysDown = new Set<string>();
  private pointerClient: Vec2 = { x: 540, y: 360 };
  private pointerInsideCrt = true;
  private cursorCrtPx: Vec2 = { x: 540, y: 360 };
  private cursorWorld: Vec2 = { x: 210, y: 130 };
  private hoveredHudButtonId: string | null = null;

  private simAccumulator = 0;
  private totalTimeSec = 0;

  constructor(
    webglCanvas: HTMLCanvasElement,
    srLiveRegion: HTMLElement | null
  ) {
    this.webglCanvas = webglCanvas;

    this.offscreenCrtCanvas = document.createElement('canvas');
    const oCtx = this.offscreenCrtCanvas.getContext('2d', { alpha: false });
    if (!oCtx) throw new Error('Failed to initialize offscreen 2D CRT canvas');
    this.offscreenCrtCtx = oCtx;

    this.srLiveRegion = srLiveRegion;
    this.webglCrt = new WebGLCRT(this.webglCanvas);

    this.sector = SectorGenerator.createCampaignSector(1);
    this.lander = this.physics.createInitialLander(this.sector);
    this.cameraPos = { ...this.lander.pos };
    const savedSign = this.leaderboard.getSavedCallsign();
    if (savedSign) {
      this.callsignDraft = savedSign;
    }

    this.bindInputListeners();
    this.bindAccessibilityButtons();
    this.bindMobileCallsignAndFullscreen();
    this.resize(window.innerWidth, window.innerHeight);
  }

  public resize(widthCss: number, heightCss: number, offsetX = 0, offsetY = 0): void {
    this.viewportWidth = Math.max(320, widthCss);
    this.viewportHeight = Math.max(240, heightCss);
    this.canvasOffsetX = offsetX;
    this.canvasOffsetY = offsetY;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    this.webglCanvas.width = Math.round(this.viewportWidth * this.dpr);
    this.webglCanvas.height = Math.round(this.viewportHeight * this.dpr);

    this.crtRect = { x: 0, y: 0, width: this.viewportWidth, height: this.viewportHeight };
    this.offscreenCrtCanvas.width = Math.round(this.crtRect.width * this.dpr);
    this.offscreenCrtCanvas.height = Math.round(this.crtRect.height * this.dpr);
    this.readSafeAreaInsets();
  }

  private readSafeAreaInsets(): void {
    const probe = document.getElementById('safe-area-probe');
    if (!probe) return;
    const cs = window.getComputedStyle(probe);
    this.safeAreaInsets = {
      top: Number.parseFloat(cs.top) || 0,
      right: Number.parseFloat(cs.right) || 0,
      bottom: Number.parseFloat(cs.bottom) || 0,
      left: Number.parseFloat(cs.left) || 0,
    };
  }

  private bindMobileCallsignAndFullscreen(): void {
    const syncFs = () => {
      const docAny = document as Document & { webkitFullscreenElement?: Element | null };
      this.isFullscreen = Boolean(document.fullscreenElement || docAny.webkitFullscreenElement);
      this.readSafeAreaInsets();
    };
    document.addEventListener('fullscreenchange', syncFs);
    document.addEventListener('webkitfullscreenchange', syncFs);

    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (mobileInput) {
      mobileInput.addEventListener('input', () => {
        if (this.phase === 'CALLSIGN_ENTRY') {
          this.callsignDraft = mobileInput.value.toUpperCase().slice(0, 16);
          mobileInput.value = this.callsignDraft;
        }
      });
      mobileInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && this.phase === 'CALLSIGN_ENTRY') {
          ev.preventDefault();
          mobileInput.blur();
          this.audio.playButtonLatchLock();
          void this.submitCallsign();
        }
      });
    }
  }

  private focusMobileCallsignInput(): void {
    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (!mobileInput) return;
    mobileInput.value = this.callsignDraft;
    try {
      mobileInput.focus({ preventScroll: true });
    } catch {
      mobileInput.focus();
    }
  }

  private toggleFullscreen(): void {
    const docAny = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const targetEl = (document.getElementById('console-shell') ||
      document.documentElement) as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };

    if (document.fullscreenElement || docAny.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {});
      } else if (docAny.webkitExitFullscreen) {
        void docAny.webkitExitFullscreen();
      }
      return;
    }

    if (targetEl.requestFullscreen) {
      void targetEl
        .requestFullscreen({ navigationUI: 'hide' })
        .catch(() => targetEl.requestFullscreen())
        .catch(() => {
          this.showStatusToast('FULLSCREEN BLOCKED — USE SHARE → ADD TO HOME SCREEN ON IOS', 2.6);
        });
    } else if (targetEl.webkitRequestFullscreen) {
      void targetEl.webkitRequestFullscreen();
    } else {
      this.showStatusToast('TIP: USE SHARE → ADD TO HOME SCREEN FOR FULLSCREEN', 2.6);
    }
  }

  private getMobileTouchState(): MobileActiveTouchState {
    let thrust = false;
    let overdrive = false;
    let rollLeft = false;
    let rollRight = false;
    let retro = false;
    for (const ctrlId of this.activeTouchPointers.values()) {
      if (ctrlId === 'touch-thrust') thrust = true;
      else if (ctrlId === 'touch-overdrive') {
        thrust = true;
        overdrive = true;
      } else if (ctrlId === 'touch-roll-left') rollLeft = true;
      else if (ctrlId === 'touch-roll-right') rollRight = true;
      else if (ctrlId === 'touch-retro') retro = true;
    }
    return { thrust, overdrive, rollLeft, rollRight, retro };
  }

  private hitTestTouchControls(cx: number, cy: number): string | null {
    for (let i = this.hudRenderer.touchControls.length - 1; i >= 0; i--) {
      const b = this.hudRenderer.touchControls[i];
      if (
        cx >= b.rect.x &&
        cx <= b.rect.x + b.rect.width &&
        cy >= b.rect.y &&
        cy <= b.rect.y + b.rect.height
      ) {
        return b.id;
      }
    }
    return null;
  }

  public setBackgroundPaused(paused: boolean): void {
    this.audio.suspendForBackground(paused);
    if (paused) {
      this.keysDown.clear();
    }
  }

  private announceSr(message: string): void {
    if (this.srLiveRegion) {
      this.srLiveRegion.textContent = message;
    }
  }

  private logEvent(entry: string): void {
    this.sessionLogs.push(entry);
    if (this.sessionLogs.length > 20) {
      this.sessionLogs.shift();
    }
  }

  private triggerVoice(id: VoiceCalloutId, force = false): void {
    this.audio.playVoiceCallout(id, force);
    this.activeCalloutText = VOICE_TRANSCRIPTS[id] ?? id;
    this.activeCalloutTimer = 4.2;
    this.announceSr(this.activeCalloutText);
  }

  private showStatusToast(text: string, duration = 2.0): void {
    this.statusBannerText = text;
    this.statusBannerTimer = duration;
  }

  private bindAccessibilityButtons(): void {
    document.getElementById('a11y-sas-toggle')?.addEventListener('click', () => {
      this.audio.playButtonLatchLock(0.92, 0.98);
      this.handleHudButtonClick('hud-sas-toggle');
    });
    document.getElementById('a11y-zoom-toggle')?.addEventListener('click', () => {
      this.audio.playButtonLatchLock(0.92, 0.98);
      this.handleHudButtonClick('hud-zoom-toggle');
    });
    document.getElementById('a11y-crt-step')?.addEventListener('click', () => {
      this.audio.playButtonLatchLock(0.92, 0.98);
      this.handleHudButtonClick('osd-crt-inc');
    });
    document.getElementById('a11y-mute-toggle')?.addEventListener('click', () => {
      this.audio.playButtonLatchLock(0.92, 0.98);
      this.handleHudButtonClick('hud-mute-toggle');
    });
    document.getElementById('a11y-logs-toggle')?.addEventListener('click', () => {
      this.audio.playButtonLatchLock(0.92, 0.98);
      this.handleHudButtonClick('hud-logs-toggle');
    });
  }

  private awakenMotherIfDormant(asMobile = false): boolean {
    if (this.bootPoweredOn) {
      void this.audio.unlock();
      return false;
    }
    this.mobileMode = asMobile;
    this.bezelState.sasEnabled = false;
    if (asMobile) {
      this.manualZoom = 2.15;
      this.currentZoom = 2.15;
    }
    this.bootPoweredOn = true;
    this.bootElapsedSec = 0;
    this.bootModeSwitchPlayed = false;
    this.crtWarmupProgress = 0.04;
    this.bootProgressChars = 0;
    this.bootTransitionPlayed = false;
    this.glitchIntensity = 0.88;
    void this.audio.unlock().then(() => {
      this.audio.playAlienBootAwakening();
    });
    return true;
  }

  private bindInputListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)
      ) {
        e.preventDefault();
      }

      if (this.phase === 'BOOT' && !this.bootPoweredOn) {
        this.awakenMotherIfDormant();
        return;
      }
      void this.audio.unlock();

      this.keysDown.add(e.code);
      this.handleKeyDown(e);
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keysDown.clear();
      this.activeTouchPointers.clear();
    });

    const releaseTouchPointer = (ev: PointerEvent) => {
      this.activeTouchPointers.delete(ev.pointerId);
    };
    window.addEventListener('pointerup', releaseTouchPointer);
    window.addEventListener('pointercancel', releaseTouchPointer);

    window.addEventListener('pointermove', (e) => {
      this.pointerClient.x = e.clientX;
      this.pointerClient.y = e.clientY;

      const mapped = this.webglCrt.mapClientToCrtUv(
        e.clientX - this.canvasOffsetX,
        e.clientY - this.canvasOffsetY,
        this.crtRect,
        this.bezelState.crtIntensity
      );
      this.pointerInsideCrt = mapped.inside;
      const cx = mapped.u * this.crtRect.width;
      const cy = mapped.v * this.crtRect.height;

      // Allow sliding a held thumb smoothly between Roll L / Brake / Roll R or Thrust / Overdrive!
      if (this.activeTouchPointers.has(e.pointerId)) {
        const slidCtrl = this.hitTestTouchControls(cx, cy);
        if (slidCtrl) {
          this.activeTouchPointers.set(e.pointerId, slidCtrl);
        } else {
          this.activeTouchPointers.delete(e.pointerId);
        }
        return;
      }

      if (!this.mobileMode) {
        this.cursorCrtPx.x = cx;
        this.cursorCrtPx.y = cy;
        this.hoveredHudButtonId = this.hitTestHudButtons(cx, cy);
      }

      if (this.hoveredHudButtonId !== null) {
        document.body.style.cursor = 'pointer';
      } else if (
        !this.mobileMode &&
        this.pointerInsideCrt &&
        this.phase === 'FLIGHT' &&
        !this.bezelState.flightLogsOpen &&
        !this.bezelState.osdMenuOpen
      ) {
        document.body.style.cursor = 'crosshair';
      } else {
        document.body.style.cursor = 'default';
      }
    });

    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      const mapped = this.webglCrt.mapClientToCrtUv(
        e.clientX - this.canvasOffsetX,
        e.clientY - this.canvasOffsetY,
        this.crtRect,
        this.bezelState.crtIntensity
      );
      const cx = mapped.u * this.crtRect.width;
      const cy = mapped.v * this.crtRect.height;

      if (this.phase === 'BOOT' && !this.bootPoweredOn) {
        const dormantBtn = mapped.inside ? this.hitTestHudButtons(cx, cy) : null;
        this.awakenMotherIfDormant(dormantBtn === 'boot-awaken-mobile');
        return;
      }
      void this.audio.unlock();
      if (!mapped.inside) return;

      // 1. Mobile Multi-Touch Hold Flight Pads (Roll L/R, Brake, Thrust, Overdrive)
      if (
        this.mobileMode &&
        this.phase === 'FLIGHT' &&
        !this.bezelState.flightLogsOpen &&
        !this.bezelState.osdMenuOpen
      ) {
        const touchHold = this.hitTestTouchControls(cx, cy);
        if (touchHold) {
          this.activeTouchPointers.set(e.pointerId, touchHold);
          return;
        }
      }

      // 2. CRT Terminal, Menu & On-Screen Buttons
      const hudBtn = this.hitTestHudButtons(cx, cy);
      if (hudBtn) {
        this.audio.playButtonLatchLock(0.96, 0.96);
        this.handleHudButtonClick(hudBtn);
        return;
      }

      if (this.phase === 'BOOT' && this.bootPoweredOn && this.bootElapsedSec >= 0.75) {
        this.audio.playButtonLatchLock(0.94, 0.95);
        this.advanceFromBoot();
        return;
      }

      // 3. Tap / Left-Click during Flight: Aim Nose Spotlight & Fire Directional Radar Ping!
      if (
        this.phase === 'FLIGHT' &&
        !this.bezelState.flightLogsOpen &&
        !this.bezelState.osdMenuOpen &&
        this.lander.alive
      ) {
        if (this.mobileMode) {
          const corridor = MobileHudRenderer.getSafeCorridor(
            this.crtRect.width,
            this.crtRect.height,
            this.safeAreaInsets,
            this.isFullscreen
          );
          if (cy > corridor.bottomPx) return;
        }
        this.cursorCrtPx.x = cx;
        this.cursorCrtPx.y = cy;
        const cam = this.buildCameraView();
        this.cursorWorld = this.worldRenderer.screenToWorld(cam, cx, cy);
        this.lander.spotlightAngle = Math.atan2(
          this.cursorWorld.y - this.lander.pos.y,
          this.cursorWorld.x - this.lander.pos.x
        );

        if (this.physics.triggerDirectionalLidar(this.lander)) {
          const pan = (mapped.u - 0.5) * 0.8;
          this.audio.playButtonLatchLock(1.12, 0.55);
          this.audio.playSfx('lidar_ping', { pitch: 1.18, pan, volume: 0.92 });
        } else {
          this.audio.playButtonLatchLock(0.72, 0.65);
          this.showStatusToast('NO RADAR CELLS — RESERVE GEN CHARGING', 1.3);
        }
      }
    });

    window.addEventListener(
      'wheel',
      (e) => {
        if (
          this.pointerInsideCrt &&
          !this.bezelState.flightLogsOpen &&
          !this.bezelState.osdMenuOpen
        ) {
          e.preventDefault();
          const zoomDelta = e.deltaY < 0 ? 0.22 : -0.22;
          this.manualZoom = Math.max(1.0, Math.min(3.5, this.manualZoom + zoomDelta));
        }
      },
      { passive: false }
    );
  }

  private hitTestHudButtons(cx: number, cy: number): string | null {
    for (let i = this.hudRenderer.buttons.length - 1; i >= 0; i--) {
      const b = this.hudRenderer.buttons[i];
      if (
        cx >= b.rect.x &&
        cx <= b.rect.x + b.rect.width &&
        cy >= b.rect.y &&
        cy <= b.rect.y + b.rect.height
      ) {
        return b.id;
      }
    }
    return null;
  }

  private handleHudButtonClick(id: string): void {
    if (id.startsWith('menu-map-sec-')) {
      const n = Number.parseInt(id.replace('menu-map-sec-', ''), 10);
      if (n >= 1 && n <= SectorGenerator.CAMPAIGN_SECTOR_COUNT) {
        this.selectedMenuMode = 'PRACTICE';
        this.selectedStartSector = n;
      }
      return;
    }

    switch (id) {
      case 'hud-fullscreen-toggle':
        this.toggleFullscreen();
        break;
      case 'touch-pulse':
        if (this.phase === 'FLIGHT' && this.lander.alive) {
          if (this.physics.triggerEmergencyThrustPulse(this.lander)) {
            this.gameEmergencyPulseAvailable = false;
            this.audio.playEmergencyThrustPulse();
            this.glitchIntensity = Math.max(this.glitchIntensity, 0.55);
            this.showStatusToast('!! 1X GAME EMERGENCY PULSE FIRED !!', 2.2);
            this.logEvent(`1X GAME EMERGENCY PULSE FIRED ON ${this.sector.code}`);
          } else {
            this.showStatusToast('1X GAME PULSE ALREADY EXPENDED', 1.4);
          }
        }
        break;
      case 'callsign-focus-input':
        this.focusMobileCallsignInput();
        break;
      case 'callsign-backspace':
        this.callsignDraft = this.callsignDraft.slice(0, -1);
        break;
      case 'hud-sas-toggle':
      case 'osd-sas-toggle':
        this.bezelState.sasEnabled = !this.bezelState.sasEnabled;
        this.showStatusToast(
          this.bezelState.sasEnabled
            ? 'SAS ON: 50% GENTLE ROLL AUTHORITY (NO AUTO-LEVEL)'
            : 'SAS OFF: 100% FULL ROLL AUTHORITY'
        );
        break;
      case 'hud-zoom-toggle':
      case 'osd-zoom-toggle':
        this.bezelState.autoZoomEnabled = !this.bezelState.autoZoomEnabled;
        this.showStatusToast(
          `AUTO-ZOOM APPROACH: ${this.bezelState.autoZoomEnabled ? 'ENGAGED' : 'MANUAL ONLY'}`
        );
        break;
      case 'hud-mute-toggle':
      case 'osd-mute-toggle':
        this.bezelState.audioMuted = !this.bezelState.audioMuted;
        this.audio.setMuted(this.bezelState.audioMuted);
        break;
      case 'hud-osd-toggle':
      case 'pause-osd':
        this.bezelState.osdMenuOpen = !this.bezelState.osdMenuOpen;
        if (this.bezelState.osdMenuOpen) {
          this.bezelState.flightLogsOpen = false;
        }
        break;
      case 'osd-close':
      case 'osd-resume':
        this.bezelState.osdMenuOpen = false;
        if (this.phase === 'PAUSED') {
          this.phase = 'FLIGHT';
        }
        break;
      case 'osd-retry':
        this.bezelState.osdMenuOpen = false;
        this.manualJettisonAndRedeploy();
        break;
      case 'osd-abort':
        this.bezelState.osdMenuOpen = false;
        this.concludeMissionToManifest();
        break;
      case 'osd-crt-dec':
        this.bezelState.crtIntensity = Math.max(0, Math.round((this.bezelState.crtIntensity - 0.1) * 100) / 100);
        break;
      case 'osd-crt-inc':
        this.bezelState.crtIntensity = Math.min(1, Math.round((this.bezelState.crtIntensity + 0.1) * 100) / 100);
        break;
      case 'osd-crt-0':
        this.bezelState.crtIntensity = 0.0;
        break;
      case 'osd-crt-25':
        this.bezelState.crtIntensity = 0.25;
        break;
      case 'osd-crt-50':
        this.bezelState.crtIntensity = 0.5;
        break;
      case 'osd-crt-75':
        this.bezelState.crtIntensity = 0.75;
        break;
      case 'osd-crt-100':
        this.bezelState.crtIntensity = 1.0;
        break;
      case 'hud-logs-toggle':
      case 'osd-open-logs':
        this.bezelState.osdMenuOpen = false;
        this.bezelState.flightLogsOpen = !this.bezelState.flightLogsOpen;
        break;
      case 'logs-tab-campaign':
        this.manifestTab = 'CAMPAIGN';
        break;
      case 'logs-tab-endless':
        this.manifestTab = 'ENDLESS';
        break;
      case 'logs-close':
        this.bezelState.flightLogsOpen = false;
        break;
      case 'boot-awaken':
        this.awakenMotherIfDormant(false);
        break;
      case 'boot-awaken-mobile':
        this.awakenMotherIfDormant(true);
        break;
      case 'boot-continue':
        this.advanceFromBoot();
        break;
      case 'menu-select-ranked':
        this.selectedMenuMode = 'RANKED_CAMPAIGN';
        break;
      case 'menu-select-practice':
        this.selectedMenuMode = 'PRACTICE';
        break;
      case 'menu-select-endless':
        this.selectedMenuMode = 'ENDLESS';
        break;
      case 'menu-commit':
        if (this.selectedMenuMode === 'RANKED_CAMPAIGN') {
          this.startCampaign(1, false);
        } else if (this.selectedMenuMode === 'PRACTICE') {
          this.startCampaign(this.selectedStartSector, true);
        } else {
          this.startEndlessDeepSurvey();
        }
        break;
      case 'menu-campaign':
        this.startCampaign(1, false);
        break;
      case 'menu-endless':
        this.startEndlessDeepSurvey();
        break;
      case 'menu-sector-cycle':
        this.selectedMenuMode = 'PRACTICE';
        this.selectedStartSector =
          (this.selectedStartSector % SectorGenerator.CAMPAIGN_SECTOR_COUNT) + 1;
        break;
      case 'menu-logs':
        this.bezelState.flightLogsOpen = true;
        break;
      case 'briefing-launch':
        this.beginSectorFlight();
        break;
      case 'tally-next':
        this.advanceAfterTally();
        break;
      case 'breach-retry':
        if (this.lives > 0) {
          this.redeployAfterCrash();
        }
        break;
      case 'breach-end':
        this.concludeMissionToManifest();
        break;
      case 'pause-resume':
        this.phase = 'FLIGHT';
        break;
      case 'pause-retry':
        this.manualJettisonAndRedeploy();
        break;
      case 'pause-abort':
        this.concludeMissionToManifest();
        break;
      case 'complete-endless':
        this.startEndlessDeepSurvey();
        break;
      case 'complete-manifest':
        this.concludeMissionToManifest();
        break;
      case 'callsign-submit':
        void this.submitCallsign();
        break;
      case 'callsign-skip':
        this.phase = 'TITLE_MENU';
        break;
      case 'callsign-finish':
        this.finishCallsignUplink();
        break;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // 1. Block ALL game hotkeys while typing in CALLSIGN_ENTRY (when modals aren't covering it)
    if (
      this.phase === 'CALLSIGN_ENTRY' &&
      !this.bezelState.osdMenuOpen &&
      !this.bezelState.flightLogsOpen
    ) {
      if (
        this.uplinkSubmitState === 'CONFIRMED' ||
        this.uplinkSubmitState === 'OFFLINE_SAVED'
      ) {
        if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') {
          this.audio.playButtonLatchLock();
          this.finishCallsignUplink();
        }
        return;
      }
      if (this.uplinkSubmitState === 'TRANSMITTING') {
        return;
      }

      if (e.code === 'Backspace') {
        this.callsignDraft = this.callsignDraft.slice(0, -1);
        this.audio.playSfx('ui_keyclick', { pitch: 0.9 });
      } else if (e.code === 'Enter') {
        this.audio.playButtonLatchLock();
        void this.submitCallsign();
      } else if (e.code === 'Escape') {
        this.audio.playButtonLatchLock(0.9, 0.85);
        this.phase = 'TITLE_MENU';
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (this.callsignDraft.length < 16) {
          this.callsignDraft += e.key.toUpperCase();
          this.audio.playSfx('ui_keyclick', { pitch: 1.06 });
        }
      }
      return;
    }

    if (this.phase !== 'BOOT' && e.code === 'Tab' && !e.repeat) {
      this.audio.playButtonLatchLock(0.95, 0.9);
      if (this.bezelState.flightLogsOpen) {
        this.manifestTab = this.manifestTab === 'CAMPAIGN' ? 'ENDLESS' : 'CAMPAIGN';
      } else {
        this.bezelState.osdMenuOpen = !this.bezelState.osdMenuOpen;
        if (this.bezelState.osdMenuOpen) {
          this.bezelState.flightLogsOpen = false;
        }
      }
      return;
    }

    if (this.bezelState.osdMenuOpen) {
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
        this.audio.playButtonLatchLock(0.95, 0.9);
        this.bezelState.osdMenuOpen = false;
        if (this.phase === 'PAUSED') {
          this.phase = 'FLIGHT';
        }
      } else if (e.code === 'ArrowLeft') {
        this.audio.playSfx('ui_keyclick');
        this.handleHudButtonClick('osd-crt-dec');
      } else if (e.code === 'ArrowRight') {
        this.audio.playSfx('ui_keyclick');
        this.handleHudButtonClick('osd-crt-inc');
      } else if (
        (this.phase === 'FLIGHT' || this.phase === 'PAUSED') &&
        e.code === 'KeyR' &&
        !e.repeat
      ) {
        this.audio.playButtonLatchLock();
        this.handleHudButtonClick('osd-retry');
      } else if (
        (this.phase === 'FLIGHT' || this.phase === 'PAUSED' || this.phase === 'SECTOR_BRIEFING') &&
        e.code === 'KeyQ' &&
        !e.repeat
      ) {
        this.audio.playButtonLatchLock();
        this.handleHudButtonClick('osd-abort');
      }
      return;
    }

    if (this.bezelState.flightLogsOpen) {
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
        this.audio.playButtonLatchLock(0.95, 0.9);
        this.bezelState.flightLogsOpen = false;
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        this.audio.playSfx('ui_keyclick');
        this.manifestTab = this.manifestTab === 'CAMPAIGN' ? 'ENDLESS' : 'CAMPAIGN';
      }
      return;
    }

    if (this.phase === 'BOOT') {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
        this.audio.playButtonLatchLock(0.94, 0.95);
        this.advanceFromBoot();
      }
      return;
    }

    if (this.phase === 'TITLE_MENU') {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        this.menuCursor = (this.menuCursor + 3) % 4;
        const modes: MenuModeSelection[] = ['RANKED_CAMPAIGN', 'PRACTICE', 'ENDLESS', this.selectedMenuMode];
        this.selectedMenuMode = modes[this.menuCursor];
        this.audio.playSfx('ui_keyclick');
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        this.menuCursor = (this.menuCursor + 1) % 4;
        const modes: MenuModeSelection[] = ['RANKED_CAMPAIGN', 'PRACTICE', 'ENDLESS', this.selectedMenuMode];
        this.selectedMenuMode = modes[this.menuCursor];
        this.audio.playSfx('ui_keyclick');
      } else if (e.code === 'Digit1') {
        this.audio.playButtonLatchLock();
        this.selectedMenuMode = 'RANKED_CAMPAIGN';
      } else if (e.code === 'Digit2') {
        this.audio.playButtonLatchLock();
        this.selectedMenuMode = 'PRACTICE';
      } else if (e.code === 'Digit3') {
        this.audio.playButtonLatchLock();
        this.selectedMenuMode = 'ENDLESS';
      } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        this.audio.playButtonLatchLock(1.04, 0.85);
        this.selectedMenuMode = 'PRACTICE';
        const delta = e.code === 'ArrowLeft' ? -1 : 1;
        this.selectedStartSector =
          ((this.selectedStartSector - 1 + delta + 6) % 6) + 1;
      } else if (e.code === 'Digit4') {
        this.audio.playButtonLatchLock();
        this.bezelState.flightLogsOpen = true;
      } else if (e.code === 'Enter' || e.code === 'Space') {
        this.audio.playButtonLatchLock();
        this.handleHudButtonClick('menu-commit');
      }
      return;
    }

    if (this.phase === 'SECTOR_BRIEFING') {
      if (e.code === 'Space' || e.code === 'Enter') {
        this.audio.playButtonLatchLock();
        const totalBriefChars = this.sector.briefingLines.reduce((acc, s) => acc + s.length, 0);
        if (this.briefingProgressChars < totalBriefChars) {
          this.briefingProgressChars = totalBriefChars;
        } else {
          this.beginSectorFlight();
        }
      } else if (e.code === 'Escape') {
        this.audio.playButtonLatchLock(0.9, 0.85);
        this.phase = 'TITLE_MENU';
      }
      return;
    }

    if (this.phase === 'FLIGHT') {
      if (e.code === 'Space' && !e.repeat) {
        if (this.physics.triggerEmergencyThrustPulse(this.lander)) {
          this.gameEmergencyPulseAvailable = false;
          this.audio.playButtonLatchLock(1.06, 0.72);
          this.audio.playEmergencyThrustPulse();
          this.glitchIntensity = Math.max(this.glitchIntensity, 0.55);
          this.showStatusToast('!! 1X GAME EMERGENCY PULSE FIRED !!', 2.2);
          this.logEvent(`1X GAME EMERGENCY PULSE FIRED ON ${this.sector.code}`);
        } else {
          this.audio.playButtonLatchLock(0.72, 0.65);
          this.showStatusToast('1X GAME PULSE ALREADY EXPENDED', 1.4);
        }
      } else if (e.code === 'KeyR' && !e.repeat) {
        this.audio.playButtonLatchLock();
        this.manualJettisonAndRedeploy();
      } else if (e.code === 'Escape' && !e.repeat) {
        this.audio.playButtonLatchLock(0.92, 0.85);
        this.menuCursor = 0;
        this.phase = 'PAUSED';
      }
      return;
    }

    if (this.phase === 'PAUSED') {
      if (e.code === 'Escape') {
        this.audio.playButtonLatchLock();
        this.phase = 'FLIGHT';
      } else if (e.code === 'KeyR' && !e.repeat) {
        this.audio.playButtonLatchLock();
        this.manualJettisonAndRedeploy();
      } else if (e.code === 'KeyQ') {
        this.audio.playButtonLatchLock();
        this.concludeMissionToManifest();
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        this.menuCursor = (this.menuCursor + 3) % 4;
        this.audio.playSfx('ui_keyclick');
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        this.menuCursor = (this.menuCursor + 1) % 4;
        this.audio.playSfx('ui_keyclick');
      } else if (e.code === 'Enter' || e.code === 'Space') {
        this.audio.playButtonLatchLock();
        const acts = ['pause-resume', 'pause-osd', 'pause-retry', 'pause-abort'];
        this.handleHudButtonClick(acts[this.menuCursor]);
      }
      return;
    }

    if (this.phase === 'SECTOR_TALLY') {
      if (e.code === 'Space' || e.code === 'Enter') {
        this.audio.playButtonLatchLock();
        if (this.tallyAnimProgress < 1) {
          this.tallyAnimProgress = 1;
        } else {
          this.advanceAfterTally();
        }
      }
      return;
    }

    if (this.phase === 'HULL_BREACH') {
      if (this.lives <= 0) {
        // 3rd death = GAME OVER (no free [R] retries!)
        if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
          this.audio.playButtonLatchLock();
          this.concludeMissionToManifest();
        }
      } else {
        if (e.code === 'KeyR' || e.code === 'Space' || e.code === 'Enter') {
          this.audio.playButtonLatchLock();
          this.redeployAfterCrash();
        } else if (e.code === 'KeyQ' || e.code === 'KeyM' || e.code === 'Escape') {
          this.audio.playButtonLatchLock();
          this.concludeMissionToManifest();
        }
      }
      return;
    }

    if (this.phase === 'CAMPAIGN_COMPLETE') {
      if (e.code === 'Enter' || e.code === 'Space') {
        this.audio.playButtonLatchLock();
        this.concludeMissionToManifest();
      }
      return;
    }
  }

  private advanceFromBoot(): void {
    if (this.bootElapsedSec < 0.65) {
      return;
    }

    // If clicked/Space during the Red Logo draw, transition cleanly into the Interface Awakening Protocol
    if (this.bootElapsedSec < BOOT_TIMING.PROTOCOL_START_SEC) {
      this.bootElapsedSec = BOOT_TIMING.PROTOCOL_START_SEC;
      this.bootModeSwitchPlayed = true;
      this.glitchIntensity = Math.max(this.glitchIntensity, 0.32);
      return;
    }

    // In Interface Awakening Protocol: clicking or pressing Space brings the player directly to the Main Menu!
    this.bootTransitionPlayed = true;
    this.glitchIntensity = Math.max(this.glitchIntensity, 0.24);
    this.audio.playScaryComputerTransition('dark', 0, 0.42);
    this.menuCursor = 0;
    this.phase = 'TITLE_MENU';
  }

  private startCampaign(startSector: number, practiceMode = startSector > 1): void {
    this.endlessMode = false;
    this.isPracticeRun = practiceMode;
    this.manifestTab = 'CAMPAIGN';
    this.lives = this.maxLives;
    this.lifeLostFlashTimer = 0;
    this.gameEmergencyPulseAvailable = true;
    this.missionScore = 0;
    this.displayedScore = 0;
    this.dropStreak = 0;
    this.highestSectorNum = startSector;
    this.accuracySamples = [];
    this.scoreSubmittedForRun = false;
    this.lastSubmittedRun = null;
    this.uplinkSubmitState = 'IDLE';
    this.uplinkConfirmText = null;
    this.loadSector(SectorGenerator.createCampaignSector(startSector));
  }

  private startEndlessDeepSurvey(): void {
    this.endlessMode = true;
    this.isPracticeRun = false;
    this.manifestTab = 'ENDLESS';
    this.lives = this.maxLives;
    this.lifeLostFlashTimer = 0;
    this.gameEmergencyPulseAvailable = true;
    this.endlessDepth = 1;
    this.endlessSeed = (Date.now() & 0xffffffff) >>> 0;
    this.missionScore = 0;
    this.displayedScore = 0;
    this.dropStreak = 0;
    this.highestSectorNum = 1;
    this.accuracySamples = [];
    this.scoreSubmittedForRun = false;
    this.lastSubmittedRun = null;
    this.uplinkSubmitState = 'IDLE';
    this.uplinkConfirmText = null;
    this.loadSector(SectorGenerator.createEndlessSector(this.endlessDepth, this.endlessSeed));
  }

  private loadSector(sec: SectorConfig): void {
    this.sector = sec;
    const secNumber = sec.endlessMode ? this.endlessDepth : sec.index;
    this.highestSectorNum = Math.max(this.highestSectorNum, secNumber);
    this.highestSectorCode = sec.code;
    this.lander = this.physics.createInitialLander(sec);
    this.lander.emergencyPulseAvailable = this.gameEmergencyPulseAvailable;
    this.cameraPos = { ...this.lander.pos };
    this.manualZoom = this.mobileMode ? 2.15 : 1.08;
    this.currentZoom = this.manualZoom;
    this.activeTouchPointers.clear();
    this.sectorElapsedSec = 0;
    this.briefingProgressChars = 0;
    this.avionicsBeepTimer = 0;
    this.hadActiveAvionicsWarning = false;
    this.motionPingTimer = 0;
    this.lastBreakdown = null;
    this.lastFailure = null;
    this.touchdownSnapshot = null;
    this.phase = 'SECTOR_BRIEFING';
    this.audio.playScaryComputerTransition('dark');
    this.audio.playAlienComputerActivity(0.52);
    this.logEvent(`LOADED ${sec.code}: ${sec.name}`);
  }

  private beginSectorFlight(): void {
    this.audio.fadeOutBootStartupAudio(1.1);
    this.phase = 'FLIGHT';
    this.audio.playScaryComputerTransition('engage');
  }

  /**
   * Redeploys the next reserve shuttle after a crash (crash already decremented `this.lives`).
   * Preserves cumulative run score and progress.
   */
  private redeployAfterCrash(): void {
    if (this.lives <= 0) {
      this.concludeMissionToManifest();
      return;
    }
    this.spawnFreshShuttleOnCurrentSector(
      `${this.sector.code} // RESERVE SHUTTLE DEPLOYED (${this.lives} LEFT)`
    );
  }

  /**
   * Manual mid-flight `[R]` restart strictly costs 1 shuttle life (and is locked on final shuttle)
   * so `[R]` can never grant infinite free retries.
   */
  private manualJettisonAndRedeploy(): void {
    if (this.lives <= 1) {
      this.audio.playButtonLatchLock(0.7, 0.7);
      this.showStatusToast('FINAL SHUTTLE ACTIVE — MANUAL JETTISON LOCKED', 2.0);
      return;
    }
    this.lives -= 1;
    this.lifeLostFlashTimer = 1.8;
    this.dropStreak = 0;
    this.logEvent(`MANUAL JETTISON ON ${this.sector.code} // ${this.lives} SHUTTLES REMAINING`);
    this.spawnFreshShuttleOnCurrentSector(
      `SHUTTLE JETTISONED (-1 HULL) // ${this.lives} REMAINING`
    );
  }

  private spawnFreshShuttleOnCurrentSector(toastMsg: string): void {
    const fresh = this.sector.endlessMode
      ? SectorGenerator.createEndlessSector(this.endlessDepth, this.endlessSeed)
      : SectorGenerator.createCampaignSector(this.sector.index);
    this.sector = fresh;
    this.lander = this.physics.createInitialLander(fresh);
    this.lander.emergencyPulseAvailable = this.gameEmergencyPulseAvailable;
    this.cameraPos = { ...this.lander.pos };
    this.currentZoom = this.manualZoom;
    this.activeTouchPointers.clear();
    this.sectorElapsedSec = 0;
    this.avionicsBeepTimer = 0;
    this.hadActiveAvionicsWarning = false;
    this.motionPingTimer = 0;
    this.lastFailure = null;
    this.touchdownSnapshot = null;
    this.glitchIntensity = 0.25;
    this.phase = 'FLIGHT';
    this.audio.playScaryComputerTransition('engage');
    this.showStatusToast(toastMsg, 2.0);
  }

  private captureTouchdownSnapshot(
    explicitPad: LandingPad | null,
    vs: number,
    hs: number,
    deg: number,
    grade: LandingGrade
  ): void {
    let pad = explicitPad;
    let dist = 0;
    if (!pad) {
      let bestDist = Infinity;
      for (const p of this.sector.pads) {
        const cx = (p.x1 + p.x2) * 0.5;
        const d = Math.hypot(
          this.lander.pos.x - cx,
          this.lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y - p.y
        );
        if (d < bestDist) {
          bestDist = d;
          pad = p;
        }
      }
      dist = bestDist;
    }
    if (!pad) return;
    const padCenter = (pad.x1 + pad.x2) * 0.5;
    this.touchdownSnapshot = {
      pad,
      dist,
      vs,
      hs,
      deg,
      offsetM: this.lander.pos.x - padCenter,
      grade,
    };
  }

  private handleTouchdown(evalResult: LandingEvaluation): void {
    const pad = evalResult.pad!;
    this.captureTouchdownSnapshot(
      pad,
      evalResult.impactVs,
      evalResult.impactHs,
      evalResult.impactDeg,
      evalResult.grade
    );
    this.dropStreak += 1;

    // Scoring Formula per Sector:
    // (Base Pad Value * Pad Multiplier) + (Remaining Fuel * 15) + Precision Kiss Bonus (up to +1,500) + No-Damage Integrity Bonus (+1,000), multiplied by Consecutive Safe Drop Streak.
    const basePadValue = PHYSICS.BASE_PAD_VALUE;
    const padMultiplier = pad.multiplier;
    const padScore = basePadValue * padMultiplier;
    const remainingFuelKg = this.lander.fuelKg;
    const fuelBonus = Math.round(remainingFuelKg * PHYSICS.FUEL_SCORE_MULTIPLIER);

    let precisionKissBonus = 0;
    if (evalResult.grade === 'SOFT_KISS') {
      const vsFactor = 1 - Math.min(1, evalResult.impactVs / PHYSICS.KISS_VS_MAX);
      const centerFactor = 1 - Math.min(1, evalResult.centerOffsetRatio);
      precisionKissBonus = Math.round(
        750 + 750 * (vsFactor * 0.55 + centerFactor * 0.45)
      );
      precisionKissBonus = Math.min(PHYSICS.MAX_KISS_BONUS, precisionKissBonus);
    }

    const noDamageBonus =
      !this.lander.tookSectorDamage && evalResult.grade !== 'HARD_SURVIVAL'
        ? PHYSICS.NO_DAMAGE_BONUS
        : 0;

    const subtotal = padScore + fuelBonus + precisionKissBonus + noDamageBonus;
    const streakMultiplier = this.dropStreak;
    const sectorTotal = subtotal * streakMultiplier;

    // Compute Accuracy Percentage & Rating
    const vsScore = Math.max(0, 1 - evalResult.impactVs / PHYSICS.SURVIVAL_VS_MAX) * 40;
    const hsScore = Math.max(0, 1 - evalResult.impactHs / PHYSICS.SURVIVAL_HS_MAX) * 25;
    const centerScore = Math.max(0, 1 - evalResult.centerOffsetRatio) * 25;
    const integrityScore = (this.lander.hullIntegrity / 100) * 10;
    const accuracyPercent = Math.max(
      40,
      Math.min(100, Math.round(vsScore + hsScore + centerScore + integrityScore))
    );
    this.accuracySamples.push(accuracyPercent);

    const accuracyRating =
      accuracyPercent >= 93
        ? 'S+'
        : accuracyPercent >= 84
          ? 'A'
          : accuracyPercent >= 72
            ? 'B'
            : 'C';

    this.missionScore += sectorTotal;
    this.lastBreakdown = {
      sectorCode: this.sector.code,
      sectorName: this.sector.name,
      grade: evalResult.grade,
      padLabel: pad.label,
      basePadValue,
      padMultiplier,
      padScore,
      remainingFuelKg,
      fuelBonus,
      touchdownVs: evalResult.impactVs,
      touchdownHs: evalResult.impactHs,
      touchdownDeg: evalResult.impactDeg,
      padCenterOffsetRatio: evalResult.centerOffsetRatio,
      precisionKissBonus,
      noDamageBonus,
      subtotal,
      streakMultiplier,
      sectorTotal,
      accuracyRating,
      accuracyPercent,
    };

    this.tallyAnimProgress = 0;
    this.phase = 'SECTOR_TALLY';
    this.audio.playIndustrialTouchdownThud(
      evalResult.impactVs,
      evalResult.grade === 'HARD_SURVIVAL'
    );
    this.audio.playScaryComputerTransition('confirm', 0.48, 0.48);
    this.logEvent(
      `${this.sector.code} EXTRACTED [${pad.label} ${padMultiplier}X] // +${sectorTotal.toLocaleString()} PTS`
    );
  }

  private advanceAfterTally(): void {
    // Practice Mode plays ONLY the selected map and returns directly to the Main Menu upon completion!
    if (this.isPracticeRun) {
      this.phase = 'TITLE_MENU';
      return;
    }

    if (this.endlessMode) {
      this.endlessDepth += 1;
      this.loadSector(SectorGenerator.createEndlessSector(this.endlessDepth, this.endlessSeed));
      return;
    }

    if (this.sector.index < SectorGenerator.CAMPAIGN_SECTOR_COUNT) {
      this.loadSector(SectorGenerator.createCampaignSector(this.sector.index + 1));
    } else {
      this.phase = 'CAMPAIGN_COMPLETE';
    }
  }

  private getAverageAccuracy(): { percent: number; rating: string } {
    const percent =
      this.accuracySamples.length > 0
        ? Math.round(
            this.accuracySamples.reduce((a, b) => a + b, 0) / this.accuracySamples.length
          )
        : 0;
    return { percent, rating: accuracyToGrade(percent) };
  }

  private concludeMissionToManifest(): void {
    this.manifestTab = this.endlessMode ? 'ENDLESS' : 'CAMPAIGN';
    if (this.missionScore > 0 && !this.isPracticeRun && !this.scoreSubmittedForRun) {
      const saved = this.leaderboard.getSavedCallsign();
      if (saved) {
        this.callsignDraft = saved;
      } else if (!this.callsignDraft.trim()) {
        this.callsignDraft = 'PILOT-01';
      }
      this.uplinkSubmitState = 'IDLE';
      this.uplinkConfirmText = null;
      this.phase = 'CALLSIGN_ENTRY';
    } else {
      this.phase = 'TITLE_MENU';
    }
  }

  private async submitCallsign(): Promise<void> {
    if (this.scoreSubmittedForRun || this.uplinkSubmitState === 'TRANSMITTING') {
      return;
    }
    const trimmed = this.callsignDraft.trim().slice(0, 16).toUpperCase() || 'PILOT-01';
    this.callsignDraft = trimmed;
    this.uplinkSubmitState = 'TRANSMITTING';
    this.scoreSubmittedForRun = true;

    const avg = this.getAverageAccuracy();
    const mode: LeaderboardMode = this.endlessMode ? 'ENDLESS' : 'CAMPAIGN';
    const result = await this.leaderboard.submitScore({
      callsign: trimmed,
      score: this.missionScore,
      sector: this.highestSectorNum,
      mode,
      accuracy: avg.percent,
    });

    const rankStr = `#${String(result.rank).padStart(2, '0')}`;
    this.lastSubmittedRun = {
      docId: result.docId,
      callsign: trimmed,
      score: Math.round(this.missionScore),
      sector: this.highestSectorNum,
      highestSector: formatSectorCode(this.highestSectorNum, mode),
      accuracyRating: avg.rating,
      accuracyPercent: avg.percent,
      mode,
      rank: result.rank,
    };

    if (result.ok) {
      this.uplinkSubmitState = 'CONFIRMED';
      this.uplinkConfirmText = `UPLINK CONFIRMED // ${mode} RANK ${rankStr}`;
      this.audio.playScaryComputerTransition('confirm', 0, 0.55);
      this.logEvent(`GLOBAL UPLINK CONFIRMED: ${trimmed} [${mode} ${rankStr}]`);
    } else {
      this.uplinkSubmitState = 'OFFLINE_SAVED';
      this.uplinkConfirmText = `RELAY OFFLINE // LOGGED TO LOCAL ARCHIVE (${rankStr})`;
      this.logEvent(`LOCAL ARCHIVE LOGGED: ${trimmed} (${Math.round(this.missionScore)} PTS)`);
    }
  }

  private finishCallsignUplink(): void {
    this.manifestTab = this.endlessMode ? 'ENDLESS' : 'CAMPAIGN';
    this.phase = 'TITLE_MENU';
    this.bezelState.flightLogsOpen = true;
  }

  /**
   * Intermittent, non-fatiguing Electromagnetic Ion Blackout Surges:
   * Keeps the CRT screen calm ~90% of the time (only a brief 0.85s analog sync ripple on surge onset),
   * while plunging passive terrain optics into clean darkness during 8s blackout windows so the
   * pilot must rely on [Left-Click] Radar Sweeps!
   */
  private computeEmStormState(): {
    worldInterference: number;
    shaderInterference: number;
    blackoutActive: boolean;
  } {
    if (this.sector.emInterference < 0.3 && !this.sector.emBlackoutPulse) {
      return {
        worldInterference: this.sector.emInterference,
        shaderInterference: 0.012,
        blackoutActive: false,
      };
    }

    if (this.phase !== 'FLIGHT' && this.phase !== 'PAUSED') {
      return {
        worldInterference: 0.25,
        shaderInterference: 0.02,
        blackoutActive: false,
      };
    }

    // Give 4.5s of initial visual orientation on drop, then 8.0s blackout / 6.5s clear cycle
    if (this.sectorElapsedSec < 4.5) {
      return {
        worldInterference: 0.18,
        shaderInterference: 0.015,
        blackoutActive: false,
      };
    }

    const cycleT = (this.sectorElapsedSec - 4.5) % 14.5;
    const blackoutDuration = 8.0;
    if (cycleT < blackoutDuration) {
      // Brief subtle CRT ripple only on the 0.85s entry & 0.55s exit edges; calm screen in between!
      let ripple = 0.024;
      if (cycleT < 0.85) {
        ripple = 0.024 + Math.sin((cycleT / 0.85) * Math.PI) * 0.23;
      } else if (cycleT > blackoutDuration - 0.55) {
        ripple = 0.024 + Math.sin(((blackoutDuration - cycleT) / 0.55) * Math.PI) * 0.15;
      }
      return {
        worldInterference: 1.0,
        shaderInterference: ripple,
        blackoutActive: true,
      };
    }

    return {
      worldInterference: 0.12,
      shaderInterference: 0.012,
      blackoutActive: false,
    };
  }

  private buildCameraView(): CameraView {
    if (this.mobileMode) {
      const corridor = MobileHudRenderer.getSafeCorridor(
        this.crtRect.width,
        this.crtRect.height,
        this.safeAreaInsets,
        this.isFullscreen
      );
      const availW = Math.max(260, this.crtRect.width - 16);
      const availH = Math.max(180, corridor.bottomPx - corridor.topPx);
      const fitPxPerM = Math.min(
        availW / Math.max(380, this.sector.worldWidth + 10),
        availH / Math.max(210, this.sector.worldHeight + 12)
      );
      // Punchier world scale on narrow phone screens while panning cleanly with the shuttle
      const basePxPerM = Math.max(1.58, fitPxPerM);
      const pxPerMeter = basePxPerM * this.currentZoom;
      return {
        x: this.cameraPos.x,
        y: this.cameraPos.y,
        zoom: this.currentZoom,
        pxPerMeter,
        widthPx: this.crtRect.width,
        heightPx: this.crtRect.height,
      };
    }

    const layout = HudRenderer.computeLayoutMetrics(this.crtRect.width, this.crtRect.height);
    // Fit the full sector width cleanly inside the central safe corridor between Left & Right HUDs at 1.0x zoom!
    const basePxPerM = Math.min(
      layout.safeWidthPx / Math.max(380, this.sector.worldWidth + 16),
      (this.crtRect.height - layout.topHeaderY - 56) / Math.max(210, this.sector.worldHeight + 18)
    );
    const pxPerMeter = basePxPerM * this.currentZoom;

    return {
      x: this.cameraPos.x,
      y: this.cameraPos.y,
      zoom: this.currentZoom,
      pxPerMeter,
      widthPx: this.crtRect.width,
      heightPx: this.crtRect.height,
    };
  }

  public updateAndRender(frameDt: number): void {
    const dt = Math.min(PHYSICS.MAX_FRAME_DT, Math.max(0, frameDt));
    this.totalTimeSec += dt;

    if (this.activeCalloutTimer > 0) this.activeCalloutTimer = Math.max(0, this.activeCalloutTimer - dt);
    if (this.statusBannerTimer > 0) this.statusBannerTimer = Math.max(0, this.statusBannerTimer - dt);
    if (this.proximityVoiceCooldown > 0) this.proximityVoiceCooldown = Math.max(0, this.proximityVoiceCooldown - dt);
    if (this.bankAngleVoiceCooldown > 0) this.bankAngleVoiceCooldown = Math.max(0, this.bankAngleVoiceCooldown - dt);
    if (this.driftVoiceCooldown > 0) this.driftVoiceCooldown = Math.max(0, this.driftVoiceCooldown - dt);
    if (this.lifeLostFlashTimer > 0) this.lifeLostFlashTimer = Math.max(0, this.lifeLostFlashTimer - dt);
    if (this.glitchIntensity > 0) this.glitchIntensity = Math.max(0, this.glitchIntensity - dt * 1.45);

    const modalPaused = this.bezelState.flightLogsOpen || this.bezelState.osdMenuOpen;
    if (this.phase === 'FLIGHT' && this.lander.alive && !modalPaused) {
      this.sectorElapsedSec += dt;
    }

    if (this.displayedScore < this.missionScore) {
      const diff = this.missionScore - this.displayedScore;
      this.displayedScore = Math.min(
        this.missionScore,
        this.displayedScore + Math.max(40, diff * 5.5) * dt
      );
    } else {
      this.displayedScore = this.missionScore;
    }

    // Typewriter progressions & 1979 Alien computer startup sequence choreography
    if (this.bootPoweredOn) {
      this.bootElapsedSec += dt;
      if (this.crtWarmupProgress < 1) {
        this.crtWarmupProgress = Math.min(1, this.crtWarmupProgress + dt * 2.2);
      }
    }

    if (this.bootPoweredOn && this.phase !== 'BOOT') {
      this.ambientChirpTimer -= dt;
      if (this.ambientChirpTimer <= 0) {
        this.ambientChirpTimer = 25 + Math.random() * 14;
        this.audio.playAlienComputerActivity(0.22);
      }
    }

    if (this.phase === 'BOOT' && this.bootPoweredOn) {
      if (
        this.bootElapsedSec >= BOOT_TIMING.LOGO_HOLD_END_SEC &&
        !this.bootModeSwitchPlayed
      ) {
        this.bootModeSwitchPlayed = true;
        this.glitchIntensity = Math.max(this.glitchIntensity, 0.36);
      }

      if (this.bootElapsedSec >= BOOT_TIMING.PROTOCOL_START_SEC) {
        const totalBoot = BOOT_LINES.reduce((acc, s) => acc + s.length, 0);
        if (this.bootProgressChars < totalBoot) {
          const prev = this.bootProgressChars;
          this.bootProgressChars = Math.min(totalBoot, this.bootProgressChars + dt * 52);
          if (Math.floor(this.bootProgressChars / 2.8) > Math.floor(prev / 2.8)) {
            this.audio.playAsmrScrollClack(0.72);
          }
          if (this.bootProgressChars >= totalBoot && !this.bootTransitionPlayed) {
            this.bootTransitionPlayed = true;
          }
        }
      }
    } else if (this.phase === 'SECTOR_BRIEFING') {
      const totalBrief = this.sector.briefingLines.reduce((acc, s) => acc + s.length, 0);
      if (this.briefingProgressChars < totalBrief) {
        const prev = this.briefingProgressChars;
        this.briefingProgressChars = Math.min(totalBrief, this.briefingProgressChars + dt * 52);
        if (Math.floor(this.briefingProgressChars / 2.6) > Math.floor(prev / 2.6)) {
          this.audio.playAsmrScrollClack(0.84);
        }
      }
    } else if (this.phase === 'SECTOR_TALLY' && this.tallyAnimProgress < 1) {
      const prev = Math.floor(this.tallyAnimProgress * 18);
      this.tallyAnimProgress = Math.min(1, this.tallyAnimProgress + dt * 0.95);
      if (Math.floor(this.tallyAnimProgress * 18) > prev) {
        this.audio.playAsmrScrollClack(0.75);
      }
    }

    // Update Cursor World Coordinates for Spotlight & Scanner
    const preCam = this.buildCameraView();
    if (this.pointerInsideCrt) {
      this.cursorWorld = this.worldRenderer.screenToWorld(
        preCam,
        this.cursorCrtPx.x,
        this.cursorCrtPx.y
      );
    }

    // Fixed-Timestep 60Hz Physics Simulation during active flight or breakup aftermath
    const emStorm = this.computeEmStormState();
    const simActive =
      (this.phase === 'FLIGHT' || this.phase === 'HULL_BREACH' || this.phase === 'SECTOR_TALLY') &&
      !modalPaused;

    let interpAlpha = 1;
    const mobileTouch = this.getMobileTouchState();
    if (simActive) {
      this.simAccumulator += dt;
      const throttleUp =
        this.phase === 'FLIGHT' &&
        (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp') || mobileTouch.thrust);
      if (throttleUp && !this.wasMainEngineLit && this.lander.alive && this.lander.fuelKg > 0.5 && this.lander.throttle < 0.12) {
        this.audio.playSfx('thruster_ignite', { pitch: 0.9, volume: 0.68 });
      }
      this.wasMainEngineLit = throttleUp;
      const overdrive =
        throttleUp &&
        (this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight') || mobileTouch.overdrive);
      const rotateLeft =
        this.phase === 'FLIGHT' &&
        (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft') || mobileTouch.rollLeft);
      const rotateRight =
        this.phase === 'FLIGHT' &&
        (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight') || mobileTouch.rollRight);
      const retroStabilizer =
        this.phase === 'FLIGHT' &&
        (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown') || mobileTouch.retro);

      while (this.simAccumulator >= PHYSICS.FIXED_DT) {
        this.simAccumulator -= PHYSICS.FIXED_DT;
        this.physics.step(
          PHYSICS.FIXED_DT,
          this.lander,
          this.sector,
          {
            throttleUp,
            overdrive,
            rotateLeft,
            rotateRight,
            retroStabilizer,
            sasEnabled: this.bezelState.sasEnabled,
            aimWorldPos: this.cursorWorld,
          },
          {
            onTouchdownConfirmed: (ev) => this.handleTouchdown(ev),
            onHardImpactGlitch: (intensity, reason) => {
              this.glitchIntensity = Math.max(this.glitchIntensity, intensity);
              this.audio.playIndustrialTouchdownThud(3.0, true);
              this.showStatusToast(reason, 2.8);
            },
            onStrutContactThud: (intensity) => {
              this.audio.playIndustrialTouchdownThud(intensity * 2.0, false);
            },
            onCatastrophicBreach: (ev) => {
              this.lastFailure = ev;
              this.captureTouchdownSnapshot(
                ev.pad,
                ev.impactVs,
                ev.impactHs,
                ev.impactDeg,
                'CATASTROPHIC'
              );
              this.lives = Math.max(0, this.lives - 1);
              this.lifeLostFlashTimer = 2.4;
              this.dropStreak = 0;
              this.glitchIntensity = 1.0;
              this.phase = 'HULL_BREACH';
              this.audio.playSfx('hull_explosion', { pitch: 0.96, volume: 1.0 });
              this.audio.playScaryComputerTransition('dark');
              this.logEvent(
                this.lives > 0
                  ? `HULL BREACH ON ${this.sector.code} // ${this.lives} SHUTTLE(S) REMAINING`
                  : `GAME OVER ON ${this.sector.code} // ALL 3 SHUTTLES LOST`
              );
            },
          }
        );
      }
      interpAlpha = this.simAccumulator / PHYSICS.FIXED_DT;

      // 1979 Alien Motion Tracker Ground Proximity Ping + Refined Avionics Warnings
      if (this.phase === 'FLIGHT' && this.lander.alive) {
        // 1. Classic 1979 Alien Motion Tracker Ping during landing approach (< 66m AGL)
        if (this.lander.agl < 66 && this.lander.groundedPad === null) {
          const closeness = 1 - Math.max(0, Math.min(1, this.lander.agl / 66));
          const interval = 0.17 + Math.pow(1 - closeness, 1.45) * 1.22;
          this.motionPingTimer -= dt;
          if (this.motionPingTimer <= 0) {
            this.motionPingTimer = interval;
            this.audio.playAlienMotionTrackerPing(closeness);
          }
        } else {
          this.motionPingTimer = 0.25;
        }

        // 2. Muted Flight-Deck Indicator Beep whenever Bottom Airbus Warnings are Indicating
        const activeAvionicsWarnings = HudRenderer.computeAvionicsWarnings(
          this.lander,
          emStorm.blackoutActive
        );
        if (this.avionicsBeepTimer > 0) {
          this.avionicsBeepTimer = Math.max(0, this.avionicsBeepTimer - dt);
        }
        if (activeAvionicsWarnings.length > 0 && !modalPaused) {
          const hasCritical = activeAvionicsWarnings.some((w) => w.critical);
          if (!this.hadActiveAvionicsWarning && this.avionicsBeepTimer <= 0) {
            this.audio.playMutedAvionicsIndicatorBeep(hasCritical);
            this.avionicsBeepTimer = hasCritical ? 0.85 : 1.4;
          } else if (this.avionicsBeepTimer <= 0) {
            this.audio.playMutedAvionicsIndicatorBeep(hasCritical);
            this.avionicsBeepTimer = hasCritical ? 0.85 : 1.4;
          }
          this.hadActiveAvionicsWarning = true;
        } else {
          this.hadActiveAvionicsWarning = false;
          this.avionicsBeepTimer = Math.min(this.avionicsBeepTimer, 0.35);
        }

        // 3. Extreme-Only Airbus GPWS Envelope Callouts (woman voice reserved strictly for severe emergencies)
        const criticalPullUp = this.lander.agl < 14 && this.lander.vel.y < -4.6;
        const ceilingObstacle = this.lander.ceilingClearance < 8 && this.lander.vel.y > 1.5;
        const sinkRateWarn =
          this.lander.agl < 17 && this.lander.vel.y < -3.75 && this.lander.throttle < 0.75;
        const lateralDriftWarn =
          this.lander.agl < 15 && Math.abs(this.lander.vel.x) > 3.15;
        const absPitchDeg = Math.abs((this.lander.angle * 180) / Math.PI);
        const bankAngleWarn =
          (this.lander.agl < 34 && absPitchDeg > 33.0) || absPitchDeg > 58.0;

        if (criticalPullUp) {
          this.audio.playSfx('proximity_klaxon', { pitch: 0.95, volume: 0.65 });
          if (this.proximityVoiceCooldown <= 0) {
            this.proximityVoiceCooldown = 6.5;
            this.triggerVoice('voice_pull_up', true);
          }
        } else if (ceilingObstacle) {
          this.audio.playSfx('proximity_klaxon', { pitch: 1.05, volume: 0.6 });
          if (this.proximityVoiceCooldown <= 0) {
            this.proximityVoiceCooldown = 6.5;
            this.triggerVoice('voice_obstacle', true);
          }
        } else if (sinkRateWarn) {
          if (this.proximityVoiceCooldown <= 0) {
            this.proximityVoiceCooldown = 10.0;
            this.triggerVoice('voice_proximity');
          }
        } else if (lateralDriftWarn && this.driftVoiceCooldown <= 0) {
          this.driftVoiceCooldown = 10.0;
          this.triggerVoice('voice_lateral_drift');
        } else if (bankAngleWarn && this.bankAngleVoiceCooldown <= 0) {
          this.bankAngleVoiceCooldown = 10.0;
          this.triggerVoice('voice_bank_angle');
        }
      }
    }

    // Update Real-Time Web Audio DSP Loops
    const rcsDir =
      this.lander.rcsRightActive && !this.lander.rcsLeftActive
        ? 1
        : this.lander.rcsLeftActive && !this.lander.rcsRightActive
          ? -1
          : 0;
    const rcsInt =
      this.lander.retroActive
        ? 0.95
        : this.lander.rcsLeftActive || this.lander.rcsRightActive
          ? this.bezelState.sasEnabled
            ? 0.42
            : 0.75
          : 0;
    const windSpd = Math.hypot(this.lander.currentWindVx, this.lander.currentWindVy);
    this.audio.updateFlightDsp(
      this.lander.throttle,
      rcsDir,
      rcsInt,
      windSpd,
      this.phase === 'FLIGHT' && this.lander.alive && !modalPaused,
      this.sector.darknessLevel,
      dt
    );

    // Smooth Tactical Camera Tracking + Auto-Zoom Approach Interpolation
    this.updateCamera(dt);

    // =====================================================================
    // STAGE 1: HIGH-DPI OFFSCREEN 2D VECTOR CANVAS RENDER
    // =====================================================================
    const oCtx = this.offscreenCrtCtx;
    oCtx.save();
    oCtx.scale(this.dpr, this.dpr);

    const cam = this.buildCameraView();

    if (this.phase !== 'BOOT' && this.phase !== 'TITLE_MENU') {
      this.worldRenderer.render(
        oCtx,
        cam,
        this.sector,
        this.lander,
        this.physics,
        interpAlpha,
        this.totalTimeSec,
        emStorm.worldInterference,
        this.phase === 'FLIGHT' && !modalPaused && this.pointerInsideCrt
          ? this.cursorWorld
          : null
      );
    }

    const avgAcc = this.getAverageAccuracy();
    const manifestView = this.leaderboard.getManifestEntries(this.manifestTab);

    this.hudRenderer.render(oCtx, {
      phase: this.phase,
      width: this.crtRect.width,
      height: this.crtRect.height,
      timeSec: this.totalTimeSec,
      sector: this.sector,
      lander: this.lander,
      bezel: this.bezelState,
      cameraZoom: this.currentZoom,
      sectorElapsedSec: this.sectorElapsedSec,
      missionScore: this.missionScore,
      displayedScore: this.displayedScore,
      dropStreak: this.dropStreak,
      lives: this.lives,
      maxLives: this.maxLives,
      lifeLostFlashTimer: this.lifeLostFlashTimer,
      isPracticeRun: this.isPracticeRun,
      endlessMode: this.endlessMode,
      highestSectorCode: this.highestSectorCode,
      avgAccuracyPercent: avgAcc.percent,
      avgAccuracyRating: avgAcc.rating,
      selectedMenuMode: this.selectedMenuMode,
      selectedStartSector: this.selectedStartSector,
      menuCursor: this.menuCursor,
      mobileMode: this.mobileMode,
      isFullscreen: this.isFullscreen,
      safeAreaInsets: this.safeAreaInsets,
      mobileTouchState: mobileTouch,
      bootPoweredOn: this.bootPoweredOn,
      bootElapsedSec: this.bootElapsedSec,
      crtWarmupProgress: this.crtWarmupProgress,
      bootProgressChars: this.bootProgressChars,
      briefingProgressChars: this.briefingProgressChars,
      tallyAnimProgress: this.tallyAnimProgress,
      lastBreakdown: this.lastBreakdown,
      lastFailure: this.lastFailure,
      touchdownSnapshot: this.touchdownSnapshot,
      emBlackoutActive: emStorm.blackoutActive,
      activeCalloutText: this.activeCalloutText,
      activeCalloutTimer: this.activeCalloutTimer,
      statusBannerText: this.statusBannerText,
      statusBannerTimer: this.statusBannerTimer,
      callsignDraft: this.callsignDraft,
      playerSavedCallsign: this.leaderboard.getSavedCallsign(),
      uplinkConnectionStatus: this.leaderboard.getStatus(),
      campaignLeader: this.leaderboard.getReigningChampion('CAMPAIGN'),
      endlessLeader: this.leaderboard.getReigningChampion('ENDLESS'),
      manifestTab: this.manifestTab,
      manifestEntries: manifestView.entries,
      manifestShowingArchive: manifestView.showingArchiveFallback,
      lastSubmittedRun: this.lastSubmittedRun,
      uplinkSubmitState: this.uplinkSubmitState,
      uplinkConfirmText: this.uplinkConfirmText,
      sessionLogs: this.sessionLogs,
      hoveredButtonId: this.hoveredHudButtonId,
    });

    oCtx.restore();

    // =====================================================================
    // STAGE 2: FULL-SCREEN WEBGL CURVED CRT GLASS POST-PROCESSING SHADER
    // =====================================================================
    const overdriveAmt =
      this.phase === 'FLIGHT' && this.lander.alive
        ? this.lander.emergencyPulseTimer > 0
          ? 0.95
          : this.lander.overdrive
            ? Math.max(0.35, (this.lander.throttle - 0.85) * 1.9)
            : Math.max(0, (this.lander.throttle - 0.82) * 0.85)
        : 0;

    const tubeTurnOn =
      this.phase === 'BOOT' && this.bootPoweredOn && this.bootElapsedSec < 1.05
        ? Math.pow(1 - this.bootElapsedSec / 1.05, 1.35)
        : 0;

    this.webglCrt.render(
      this.offscreenCrtCanvas,
      this.crtRect,
      this.dpr,
      this.totalTimeSec,
      this.bezelState.crtIntensity,
      emStorm.shaderInterference,
      this.glitchIntensity,
      overdriveAmt,
      tubeTurnOn
    );
  }

  private updateCamera(dt: number): void {
    let targetZoom = this.manualZoom;
    let minPadDist = Infinity;
    let closestPad: LandingPad | null = null;
    for (const pad of this.sector.pads) {
      const cx = (pad.x1 + pad.x2) * 0.5;
      const d = Math.hypot(
        this.lander.pos.x - cx,
        this.lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y - pad.y
      );
      if (d < minPadDist) {
        minPadDist = d;
        closestPad = pad;
      }
    }

    if (this.bezelState.autoZoomEnabled && this.phase === 'FLIGHT' && this.lander.alive) {
      if (this.mobileMode) {
        // Aggressive mobile zoom: 2.15x base flight -> smooth ramp starting at 130m up to ~3.95x close-up on pad
        const mobileGateM = 130;
        if (minPadDist < mobileGateM) {
          const approachFactor = 1 - minPadDist / mobileGateM;
          const autoTarget = 2.15 + Math.pow(approachFactor, 0.78) * 1.80;
          targetZoom = Math.max(this.manualZoom, autoTarget);
        }
      } else if (minPadDist < PHYSICS.APPROACH_PROXIMITY_M) {
        // Smoothly zoom in when within approach gate of any pad
        const approachFactor = 1 - minPadDist / PHYSICS.APPROACH_PROXIMITY_M;
        const autoTarget = 1.15 + approachFactor * 1.35; // Up to ~2.5x automatic precision view
        targetZoom = Math.max(this.manualZoom, autoTarget);
      }
    } else if (this.phase === 'TITLE_MENU') {
      targetZoom = 1.05;
    }

    const zoomLerpRate = this.mobileMode ? 4.8 : 3.8;
    this.currentZoom += (targetZoom - this.currentZoom) * Math.min(1, dt * zoomLerpRate);

    // Camera tracking bounded to the Safe Central Flight Corridor between Left/Right/Top/Bottom HUDs
    // so the craft NEVER slips behind any HUD panel even when zoomed out or near sector walls!
    const cam = this.buildCameraView();
    if (this.mobileMode) {
      const corridor = MobileHudRenderer.getSafeCorridor(
        this.crtRect.width,
        this.crtRect.height,
        this.safeAreaInsets,
        this.isFullscreen
      );
      const effTopPx =
        minPadDist <= PHYSICS.APPROACH_PROXIMITY_M ? corridor.topPx + 60 : corridor.topPx;
      const effBotPx = Math.max(effTopPx + 90, corridor.bottomPx - 20);
      const visCenterScreenY = (effTopPx + effBotPx) * 0.5;
      const yScreenBiasM = (cam.heightPx * 0.5 - visCenterScreenY) / cam.pxPerMeter;

      let focusWorldY = this.lander.pos.y + this.lander.vel.y * 0.55 - 7;
      if (closestPad && minPadDist < 85 && this.lander.pos.y >= closestPad.y - 4) {
        const padBlend = (1 - minPadDist / 85) * 0.36;
        focusWorldY =
          (this.lander.pos.y + this.lander.vel.y * 0.35) * (1 - padBlend) +
          (closestPad.y - 3) * padBlend;
      }

      let mX = Math.max(
        20,
        Math.min(this.sector.worldWidth - 20, this.lander.pos.x + this.lander.vel.x * 0.75)
      );
      let mY = Math.max(
        14,
        Math.min(this.sector.worldHeight - 8, focusWorldY - yScreenBiasM)
      );

      if (this.lander.alive) {
        const halfW = Math.max(8, (this.crtRect.width * 0.5 - 20) / cam.pxPerMeter);
        mX = Math.max(this.lander.pos.x - halfW, Math.min(this.lander.pos.x + halfW, mX));

        const minCamY =
          this.lander.pos.y - (cam.heightPx * 0.5 - effTopPx - 28) / cam.pxPerMeter;
        const maxCamY =
          this.lander.pos.y + (effBotPx - 32 - cam.heightPx * 0.5) / cam.pxPerMeter;
        if (minCamY <= maxCamY) {
          mY = Math.max(minCamY, Math.min(maxCamY, mY));
        }
      }

      this.cameraPos.x += (mX - this.cameraPos.x) * Math.min(1, dt * 7.0);
      this.cameraPos.y += (mY - this.cameraPos.y) * Math.min(1, dt * 7.0);
      return;
    }

    const layout = HudRenderer.computeLayoutMetrics(this.crtRect.width, this.crtRect.height);
    const halfSafeW = layout.safeWidthPx / (2 * cam.pxPerMeter);
    const halfFullH = (cam.heightPx - layout.topHeaderY - 56) / (2 * cam.pxPerMeter);

    let desiredX = this.lander.pos.x + this.lander.vel.x * 1.2;
    let desiredY = this.lander.pos.y + this.lander.vel.y * 0.8 - 6;

    if (this.phase === 'TITLE_MENU') {
      desiredX = this.sector.worldWidth * 0.5 + Math.sin(this.totalTimeSec * 0.18) * 45;
      desiredY = 120;
    } else {
      const minX = Math.min(this.sector.worldWidth * 0.5, halfSafeW - 8);
      const maxX = Math.max(this.sector.worldWidth * 0.5, this.sector.worldWidth - halfSafeW + 8);
      const minY = Math.max(12, halfFullH - 18);
      const maxY = Math.max(minY + 10, this.sector.worldHeight - halfFullH + 26);

      desiredX = Math.max(minX, Math.min(maxX, desiredX));
      desiredY = Math.max(minY, Math.min(maxY, desiredY));

      // Strict HUD Clearance Tether: keep shuttle strictly inside the central corridor between all HUDs
      if (this.lander.alive) {
        const maxCraftDx = Math.max(6, halfSafeW - 10);
        desiredX = Math.max(
          this.lander.pos.x - maxCraftDx,
          Math.min(this.lander.pos.x + maxCraftDx, desiredX)
        );

        const topHudBottomPx =
          minPadDist <= PHYSICS.APPROACH_PROXIMITY_M ? layout.safeTopPx : layout.topHeaderY + 16;
        const botHudTopPx = layout.safeBottomPx;
        const topClearM = Math.max(6, (cam.heightPx * 0.5 - topHudBottomPx - 14) / cam.pxPerMeter);
        const botClearM = Math.max(6, (botHudTopPx - 14 - cam.heightPx * 0.5) / cam.pxPerMeter);

        desiredY = Math.max(
          this.lander.pos.y - topClearM,
          Math.min(this.lander.pos.y + botClearM, desiredY)
        );
      }
    }

    this.cameraPos.x += (desiredX - this.cameraPos.x) * Math.min(1, dt * 6.0);
    this.cameraPos.y += (desiredY - this.cameraPos.y) * Math.min(1, dt * 6.0);
  }
}
