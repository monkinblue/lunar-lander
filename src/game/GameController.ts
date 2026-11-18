import { AudioEngine } from '../audio/AudioEngine';
import { PHYSICS, VOICE_TRANSCRIPTS } from '../constants';
import { SectorGenerator } from '../levels/SectorGenerator';
import { PhysicsEngine } from '../physics/PhysicsEngine';
import { BezelUI, type BezelControlId } from '../render/BezelUI';
import { BOOT_LINES, HudRenderer } from '../render/HudRenderer';
import { WebGLCRT } from '../render/WebGLCRT';
import { WorldRenderer, type CameraView } from '../render/WorldRenderer';
import { CrewManifestStore } from '../storage/CrewManifest';
import type {
  BezelState,
  GamePhase,
  LanderState,
  LandingEvaluation,
  SectorConfig,
  SectorScoreBreakdown,
  Vec2,
  ViewportRect,
  VoiceCalloutId,
} from '../types';

export class GameController {
  private webglCanvas: HTMLCanvasElement;
  private bezelCanvas: HTMLCanvasElement;
  private bezelCtx: CanvasRenderingContext2D;
  private offscreenCrtCanvas: HTMLCanvasElement;
  private offscreenCrtCtx: CanvasRenderingContext2D;
  private srLiveRegion: HTMLElement | null;

  private audio = new AudioEngine();
  private manifest = new CrewManifestStore();
  private physics = new PhysicsEngine();
  private webglCrt: WebGLCRT;
  private worldRenderer = new WorldRenderer();
  private hudRenderer = new HudRenderer();
  private bezelUi = new BezelUI();

  private dpr = 1;
  private viewportWidth = 1280;
  private viewportHeight = 800;
  private crtRect: ViewportRect = { x: 18, y: 16, width: 1080, height: 700 };

  private phase: GamePhase = 'BOOT';
  private sector: SectorConfig;
  private lander: LanderState;

  private bezelState: BezelState = {
    sasEnabled: true,
    autoZoomEnabled: true,
    crtIntensity: 0.50,
    audioMuted: false,
    flightLogsOpen: false,
  };

  // Campaign / Deep-Survey Progression & Scoring
  private endlessMode = false;
  private endlessDepth = 1;
  private endlessSeed = 203779;
  private selectedStartSector = 1;
  private missionScore = 0;
  private displayedScore = 0;
  private dropStreak = 0;
  private highestSectorCode = 'SEC-01';
  private accuracySamples: number[] = [];

  private lastBreakdown: SectorScoreBreakdown | null = null;
  private lastFailure: LandingEvaluation | null = null;
  private tallyAnimProgress = 0;
  private callsignDraft = 'RIPLEY';
  private sessionLogs: string[] = [
    'INTERFACE 2037 INITIALIZED // ORBITAL BUS ONLINE',
    'AWAITING PILOT DROP TELEMETRY DIRECTIVE',
  ];

  // Typewriter & 1979 Alien Awakening State
  private bootPoweredOn = false;
  private crtWarmupProgress = 0;
  private bootProgressChars = 0;
  private bootVoicePlayed = false;
  private briefingProgressChars = 0;
  private ambientChirpTimer = 26.0;
  private activeCalloutText: string | null = null;
  private activeCalloutTimer = 0;
  private statusBannerText: string | null = null;
  private statusBannerTimer = 0;
  private menuCursor = 0;

  // Per-sector callout latches, motion tracker & thruster ignition edge
  private sectorElapsedSec = 0;
  private warnedFuelLow = false;
  private warnedWind = false;
  private warnedInterference = false;
  private calledMinimums = false;
  private proximityVoiceCooldown = 0;
  private bankAngleVoiceCooldown = 0;
  private driftVoiceCooldown = 0;
  private windShearVoiceCooldown = 0;
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
    bezelCanvas: HTMLCanvasElement,
    srLiveRegion: HTMLElement | null
  ) {
    this.webglCanvas = webglCanvas;
    this.bezelCanvas = bezelCanvas;
    const bCtx = bezelCanvas.getContext('2d');
    if (!bCtx) throw new Error('Failed to initialize 2D context for bezel UI');
    this.bezelCtx = bCtx;

    this.offscreenCrtCanvas = document.createElement('canvas');
    const oCtx = this.offscreenCrtCanvas.getContext('2d', { alpha: false });
    if (!oCtx) throw new Error('Failed to initialize offscreen 2D CRT canvas');
    this.offscreenCrtCtx = oCtx;

    this.srLiveRegion = srLiveRegion;
    this.webglCrt = new WebGLCRT(this.webglCanvas);

    this.sector = SectorGenerator.createCampaignSector(1);
    this.lander = this.physics.createInitialLander(this.sector);
    this.cameraPos = { ...this.lander.pos };

    this.bindInputListeners();
    this.bindAccessibilityButtons();
    this.resize(window.innerWidth, window.innerHeight);
  }

  public resize(widthCss: number, heightCss: number): void {
    this.viewportWidth = Math.max(640, widthCss);
    this.viewportHeight = Math.max(440, heightCss);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    this.webglCanvas.width = Math.round(this.viewportWidth * this.dpr);
    this.webglCanvas.height = Math.round(this.viewportHeight * this.dpr);

    this.bezelCanvas.width = Math.round(this.viewportWidth * this.dpr);
    this.bezelCanvas.height = Math.round(this.viewportHeight * this.dpr);

    this.crtRect = this.bezelUi.computeCrtViewport(this.viewportWidth, this.viewportHeight);
    this.offscreenCrtCanvas.width = Math.round(this.crtRect.width * this.dpr);
    this.offscreenCrtCanvas.height = Math.round(this.crtRect.height * this.dpr);
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
      this.activateBezelControl('sas');
    });
    document.getElementById('a11y-zoom-toggle')?.addEventListener('click', () => {
      this.activateBezelControl('autoZoom');
    });
    document.getElementById('a11y-crt-step')?.addEventListener('click', () => {
      this.activateBezelControl('crtDial');
    });
    document.getElementById('a11y-mute-toggle')?.addEventListener('click', () => {
      this.activateBezelControl('audioMute');
    });
    document.getElementById('a11y-logs-toggle')?.addEventListener('click', () => {
      this.activateBezelControl('flightLogs');
    });
  }

  private awakenMotherIfDormant(): boolean {
    if (this.bootPoweredOn) {
      void this.audio.unlock();
      return false;
    }
    this.bootPoweredOn = true;
    this.crtWarmupProgress = 0.04;
    this.bootProgressChars = 0;
    this.glitchIntensity = 0.45;
    void this.audio.unlock().then(() => {
      this.audio.playAlienBootAwakening();
    });
    return true;
  }

  private bindInputListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)
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
      this.bezelUi.draggingDial = false;
    });

    window.addEventListener('pointermove', (e) => {
      this.pointerClient.x = e.clientX;
      this.pointerClient.y = e.clientY;

      if (this.bezelUi.draggingDial) {
        const val = this.bezelUi.dialValueFromPointer(e.clientX, e.clientY);
        if (val !== null) {
          this.bezelState.crtIntensity = val;
        }
        return;
      }

      const bezelHit = this.bezelUi.hitTest(e.clientX, e.clientY);
      this.bezelUi.hoveredId = bezelHit;

      const mapped = this.webglCrt.mapClientToCrtUv(
        e.clientX,
        e.clientY,
        this.crtRect,
        this.bezelState.crtIntensity
      );
      this.pointerInsideCrt = mapped.inside && bezelHit === null;
      this.cursorCrtPx.x = mapped.u * this.crtRect.width;
      this.cursorCrtPx.y = mapped.v * this.crtRect.height;

      this.hoveredHudButtonId = this.hitTestHudButtons(this.cursorCrtPx.x, this.cursorCrtPx.y);

      if (bezelHit === 'crtDial') {
        document.body.style.cursor = 'grab';
      } else if (bezelHit !== null || this.hoveredHudButtonId !== null) {
        document.body.style.cursor = 'pointer';
      } else if (this.pointerInsideCrt && this.phase === 'FLIGHT' && !this.bezelState.flightLogsOpen) {
        document.body.style.cursor = 'crosshair';
      } else {
        document.body.style.cursor = 'default';
      }
    });

    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (this.phase === 'BOOT' && !this.bootPoweredOn) {
        this.awakenMotherIfDormant();
        return;
      }
      void this.audio.unlock();

      // 1. Hardware Bezel Controls outside curved glass
      const bezelHit = this.bezelUi.hitTest(e.clientX, e.clientY);
      if (bezelHit !== null) {
        if (bezelHit === 'crtDial') {
          this.bezelUi.draggingDial = true;
          const val = this.bezelUi.dialValueFromPointer(e.clientX, e.clientY);
          if (val !== null) this.bezelState.crtIntensity = val;
          this.audio.playButtonLatchLock(1.06, 0.85);
        } else {
          this.activateBezelControl(bezelHit);
        }
        return;
      }

      // 2. CRT Terminal Buttons inside curved glass
      const mapped = this.webglCrt.mapClientToCrtUv(
        e.clientX,
        e.clientY,
        this.crtRect,
        this.bezelState.crtIntensity
      );
      if (!mapped.inside) return;

      const cx = mapped.u * this.crtRect.width;
      const cy = mapped.v * this.crtRect.height;
      const hudBtn = this.hitTestHudButtons(cx, cy);
      if (hudBtn) {
        this.audio.playButtonLatchLock(0.96, 0.96);
        this.handleHudButtonClick(hudBtn);
        return;
      }

      // 3. Left-Click during Flight: Focused Directional LIDAR Ping toward cursor (costs 1 cell)!
      if (this.phase === 'FLIGHT' && !this.bezelState.flightLogsOpen && this.lander.alive) {
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

    window.addEventListener('pointerup', () => {
      this.bezelUi.draggingDial = false;
    });

    window.addEventListener(
      'wheel',
      (e) => {
        const bezelHit = this.bezelUi.hitTest(e.clientX, e.clientY);
        if (bezelHit === 'crtDial') {
          e.preventDefault();
          const step = e.deltaY < 0 ? 0.06 : -0.06;
          this.bezelState.crtIntensity = Math.max(
            0,
            Math.min(1, this.bezelState.crtIntensity + step)
          );
          return;
        }

        if (this.pointerInsideCrt && !this.bezelState.flightLogsOpen) {
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

  private activateBezelControl(id: BezelControlId): void {
    this.audio.playButtonLatchLock(0.92, 0.98);
    switch (id) {
      case 'sas':
        this.bezelState.sasEnabled = !this.bezelState.sasEnabled;
        this.showStatusToast(
          `SAS ATTITUDE DAMPENER: ${this.bezelState.sasEnabled ? 'ENGAGED' : 'BYPASSED'}`
        );
        break;
      case 'autoZoom':
        this.bezelState.autoZoomEnabled = !this.bezelState.autoZoomEnabled;
        this.showStatusToast(
          `AUTO-ZOOM APPROACH: ${this.bezelState.autoZoomEnabled ? 'ENGAGED' : 'MANUAL ONLY'}`
        );
        break;
      case 'crtDial': {
        const next = this.bezelState.crtIntensity + 0.25;
        this.bezelState.crtIntensity = next > 1.05 ? 0.0 : Math.min(1.0, next);
        this.showStatusToast(
          `CRT GLASS & BLOOM: ${Math.round(this.bezelState.crtIntensity * 100)}%`
        );
        break;
      }
      case 'audioMute':
        this.bezelState.audioMuted = !this.bezelState.audioMuted;
        this.audio.setMuted(this.bezelState.audioMuted);
        break;
      case 'flightLogs':
        this.bezelState.flightLogsOpen = !this.bezelState.flightLogsOpen;
        break;
    }
  }

  private handleHudButtonClick(id: string): void {
    switch (id) {
      case 'logs-close':
        this.bezelState.flightLogsOpen = false;
        break;
      case 'boot-awaken':
        this.awakenMotherIfDormant();
        break;
      case 'boot-continue':
        this.advanceFromBoot();
        break;
      case 'menu-campaign':
        this.startCampaign(this.selectedStartSector);
        break;
      case 'menu-endless':
        this.startEndlessDeepSurvey();
        break;
      case 'menu-sector-cycle':
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
        this.retryCurrentSector();
        break;
      case 'breach-end':
        this.concludeMissionToManifest();
        break;
      case 'pause-resume':
        this.phase = 'FLIGHT';
        break;
      case 'pause-retry':
        this.retryCurrentSector();
        break;
      case 'pause-abort':
        this.concludeMissionToManifest();
        break;
      case 'complete-endless':
        this.endlessMode = true;
        this.endlessDepth = 1;
        this.endlessSeed = (Date.now() & 0xffffffff) >>> 0;
        this.loadSector(SectorGenerator.createEndlessSector(this.endlessDepth, this.endlessSeed));
        break;
      case 'complete-manifest':
        this.concludeMissionToManifest();
        break;
      case 'callsign-submit':
        this.submitCallsign();
        break;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.bezelState.flightLogsOpen) {
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
        this.audio.playButtonLatchLock(0.95, 0.9);
        this.bezelState.flightLogsOpen = false;
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
        this.audio.playSfx('ui_keyclick');
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        this.menuCursor = (this.menuCursor + 1) % 4;
        this.audio.playSfx('ui_keyclick');
      } else if (e.code === 'Digit1') {
        this.audio.playButtonLatchLock();
        this.startCampaign(this.selectedStartSector);
      } else if (e.code === 'Digit2') {
        this.audio.playButtonLatchLock();
        this.startEndlessDeepSurvey();
      } else if (e.code === 'Digit3' || e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        this.audio.playButtonLatchLock(1.04, 0.85);
        const delta = e.code === 'ArrowLeft' ? -1 : 1;
        this.selectedStartSector =
          ((this.selectedStartSector - 1 + delta + 6) % 6) + 1;
      } else if (e.code === 'Digit4') {
        this.audio.playButtonLatchLock();
        this.bezelState.flightLogsOpen = true;
      } else if (e.code === 'Enter' || e.code === 'Space') {
        this.audio.playButtonLatchLock();
        const ids = ['menu-campaign', 'menu-endless', 'menu-sector-cycle', 'menu-logs'];
        this.handleHudButtonClick(ids[this.menuCursor]);
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
        if (this.physics.triggerOmniLidar(this.lander)) {
          this.audio.playButtonLatchLock(1.02, 0.6);
          this.audio.playSfx('lidar_ping', { pitch: 0.86, volume: 1.0 });
        } else {
          this.audio.playButtonLatchLock(0.72, 0.65);
          this.showStatusToast('NO RADAR CELLS — RESERVE GEN CHARGING', 1.3);
        }
      } else if (e.code === 'KeyR' && !e.repeat) {
        this.audio.playButtonLatchLock();
        this.retryCurrentSector();
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
      } else if (e.code === 'KeyR') {
        this.audio.playButtonLatchLock();
        this.retryCurrentSector();
      } else if (e.code === 'KeyQ') {
        this.audio.playButtonLatchLock();
        this.concludeMissionToManifest();
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        this.menuCursor = (this.menuCursor + 2) % 3;
        this.audio.playSfx('ui_keyclick');
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        this.menuCursor = (this.menuCursor + 1) % 3;
        this.audio.playSfx('ui_keyclick');
      } else if (e.code === 'Enter' || e.code === 'Space') {
        this.audio.playButtonLatchLock();
        const acts = ['pause-resume', 'pause-retry', 'pause-abort'];
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
      if (e.code === 'KeyR' || e.code === 'Space' || e.code === 'Enter') {
        this.audio.playButtonLatchLock();
        this.retryCurrentSector();
      } else if (e.code === 'KeyM' || e.code === 'Escape') {
        this.audio.playButtonLatchLock();
        this.concludeMissionToManifest();
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

    if (this.phase === 'CALLSIGN_ENTRY') {
      if (e.code === 'Backspace') {
        this.callsignDraft = this.callsignDraft.slice(0, -1);
        this.audio.playSfx('ui_keyclick', { pitch: 0.9 });
      } else if (e.code === 'Enter') {
        this.audio.playButtonLatchLock();
        this.submitCallsign();
      } else if (e.key.length === 1 && /^[a-zA-Z0-9_-]$/.test(e.key)) {
        if (this.callsignDraft.length < 10) {
          this.callsignDraft += e.key.toUpperCase();
          this.audio.playSfx('ui_keyclick', { pitch: 1.08 });
        }
      }
    }
  }

  private advanceFromBoot(): void {
    const totalBootChars = BOOT_LINES.reduce((acc, s) => acc + s.length, 0);
    if (this.bootProgressChars < totalBootChars) {
      this.bootProgressChars = totalBootChars;
      if (!this.bootVoicePlayed) {
        this.bootVoicePlayed = true;
        this.triggerVoice('voice_boot', true);
      }
      return;
    }
    if (!this.bootVoicePlayed) {
      this.bootVoicePlayed = true;
      this.triggerVoice('voice_boot', true);
    }
    this.audio.playAlienComputerActivity(0.5);
    this.menuCursor = 0;
    this.phase = 'TITLE_MENU';
  }

  private startCampaign(startSector: number): void {
    this.endlessMode = false;
    this.missionScore = 0;
    this.displayedScore = 0;
    this.dropStreak = 0;
    this.accuracySamples = [];
    this.loadSector(SectorGenerator.createCampaignSector(startSector));
  }

  private startEndlessDeepSurvey(): void {
    this.endlessMode = true;
    this.endlessDepth = 1;
    this.endlessSeed = (Date.now() & 0xffffffff) >>> 0;
    this.missionScore = 0;
    this.displayedScore = 0;
    this.dropStreak = 0;
    this.accuracySamples = [];
    this.loadSector(SectorGenerator.createEndlessSector(this.endlessDepth, this.endlessSeed));
  }

  private loadSector(sec: SectorConfig): void {
    this.sector = sec;
    this.highestSectorCode = sec.code;
    this.lander = this.physics.createInitialLander(sec);
    this.cameraPos = { ...this.lander.pos };
    this.manualZoom = 1.12;
    this.currentZoom = 1.12;
    this.sectorElapsedSec = 0;
    this.briefingProgressChars = 0;
    this.warnedFuelLow = false;
    this.warnedWind = false;
    this.warnedInterference = false;
    this.calledMinimums = false;
    this.motionPingTimer = 0;
    this.lastBreakdown = null;
    this.lastFailure = null;
    this.phase = 'SECTOR_BRIEFING';
    this.audio.playAlienComputerActivity(0.52);
    this.logEvent(`LOADED ${sec.code}: ${sec.name}`);
  }

  private beginSectorFlight(): void {
    this.phase = 'FLIGHT';

    // Sector-entry environmental voice advisories
    if (this.sector.emInterference >= 0.4 && !this.warnedInterference) {
      this.warnedInterference = true;
      this.triggerVoice('voice_interference');
    } else if (this.sector.windBands.length > 0 && !this.warnedWind) {
      this.warnedWind = true;
      this.triggerVoice('voice_wind');
    }
  }

  private retryCurrentSector(): void {
    this.dropStreak = 0;
    const fresh = this.sector.endlessMode
      ? SectorGenerator.createEndlessSector(this.endlessDepth, this.endlessSeed)
      : SectorGenerator.createCampaignSector(this.sector.index);
    this.sector = fresh;
    this.lander = this.physics.createInitialLander(fresh);
    this.cameraPos = { ...this.lander.pos };
    this.sectorElapsedSec = 0;
    this.warnedFuelLow = false;
    this.calledMinimums = false;
    this.motionPingTimer = 0;
    this.lastFailure = null;
    this.glitchIntensity = 0.25;
    this.phase = 'FLIGHT';
    this.showStatusToast(`${fresh.code} // ORBITAL RE-INSERTION`, 1.8);
    this.logEvent(`QUICK-RETRY EXECUTED ON ${fresh.code}`);
  }

  private handleTouchdown(evalResult: LandingEvaluation): void {
    const pad = evalResult.pad!;
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
    if (evalResult.grade !== 'HARD_SURVIVAL') {
      this.audio.playSfx('landing_soft_mech', { pitch: 0.96, volume: 0.95 });
    }
    this.triggerVoice('voice_touchdown', true);
    this.logEvent(
      `${this.sector.code} EXTRACTED [${pad.label} ${padMultiplier}X] // +${sectorTotal.toLocaleString()} PTS`
    );
  }

  private advanceAfterTally(): void {
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

  private concludeMissionToManifest(): void {
    if (this.missionScore > 0 && this.manifest.qualifiesForManifest(this.missionScore)) {
      this.phase = 'CALLSIGN_ENTRY';
    } else {
      this.phase = 'TITLE_MENU';
    }
  }

  private submitCallsign(): void {
    const avgAcc =
      this.accuracySamples.length > 0
        ? Math.round(
            this.accuracySamples.reduce((a, b) => a + b, 0) / this.accuracySamples.length
          )
        : 75;
    const rating = avgAcc >= 93 ? 'S+' : avgAcc >= 84 ? 'A' : avgAcc >= 72 ? 'B' : 'C';

    this.manifest.recordFlight({
      callsign: this.callsignDraft || 'PILOT-01',
      score: this.missionScore,
      highestSector: this.highestSectorCode,
      accuracyRating: rating,
      accuracyPercent: avgAcc,
      mode: this.endlessMode ? 'DEEP-SURVEY' : 'CAMPAIGN',
    });

    this.logEvent(`MANIFEST LOGGED: ${this.callsignDraft || 'PILOT-01'} (${Math.round(this.missionScore)} PTS)`);
    this.phase = 'TITLE_MENU';
    this.bezelState.flightLogsOpen = true;
  }

  private computeEffectiveEmInterference(): number {
    let em = this.sector.emInterference;
    if (this.sector.emBlackoutPulse) {
      // Sector 06 periodic EM sensor blackout surges every ~9 seconds
      const wave = Math.sin(this.totalTimeSec * 0.72);
      if (wave > 0.45) {
        em = Math.min(0.95, em + ((wave - 0.45) / 0.55) * 0.52);
      }
    }
    return em;
  }

  private buildCameraView(): CameraView {
    const basePxPerM = Math.min(
      this.crtRect.width / 365,
      this.crtRect.height / 235
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
    if (this.windShearVoiceCooldown > 0) this.windShearVoiceCooldown = Math.max(0, this.windShearVoiceCooldown - dt);
    if (this.glitchIntensity > 0) this.glitchIntensity = Math.max(0, this.glitchIntensity - dt * 1.45);

    if (this.phase === 'FLIGHT' && this.lander.alive && !this.bezelState.flightLogsOpen) {
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

    // Typewriter progressions & 1979 Alien computer / ASMR muted clacking
    if (this.bootPoweredOn && this.crtWarmupProgress < 1) {
      this.crtWarmupProgress = Math.min(1, this.crtWarmupProgress + dt * 2.2);
    }

    if (this.bootPoweredOn && this.phase !== 'BOOT') {
      this.ambientChirpTimer -= dt;
      if (this.ambientChirpTimer <= 0) {
        this.ambientChirpTimer = 25 + Math.random() * 14;
        this.audio.playAlienComputerActivity(0.22);
      }
    }

    if (this.phase === 'BOOT' && this.bootPoweredOn && this.crtWarmupProgress > 0.45) {
      const totalBoot = BOOT_LINES.reduce((acc, s) => acc + s.length, 0);
      if (this.bootProgressChars < totalBoot) {
        const prev = this.bootProgressChars;
        this.bootProgressChars = Math.min(totalBoot, this.bootProgressChars + dt * 48);
        if (Math.floor(this.bootProgressChars / 2.6) > Math.floor(prev / 2.6)) {
          this.audio.playAsmrScrollClack(0.86);
        }
        if (Math.floor(this.bootProgressChars / 155) > Math.floor(prev / 155)) {
          this.audio.playAlienComputerActivity(0.32);
        }
        if (this.bootProgressChars >= totalBoot && !this.bootVoicePlayed) {
          this.bootVoicePlayed = true;
          this.triggerVoice('voice_boot', true);
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
    const simActive =
      (this.phase === 'FLIGHT' || this.phase === 'HULL_BREACH' || this.phase === 'SECTOR_TALLY') &&
      !this.bezelState.flightLogsOpen;

    let interpAlpha = 1;
    if (simActive) {
      this.simAccumulator += dt;
      const throttleUp =
        this.phase === 'FLIGHT' && (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp'));
      if (throttleUp && !this.wasMainEngineLit && this.lander.alive && this.lander.fuelKg > 0.5 && this.lander.throttle < 0.12) {
        this.audio.playSfx('thruster_ignite', { pitch: 0.9, volume: 0.68 });
      }
      this.wasMainEngineLit = throttleUp;
      const overdrive =
        throttleUp && (this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight'));
      const rotateLeft =
        this.phase === 'FLIGHT' && (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft'));
      const rotateRight =
        this.phase === 'FLIGHT' && (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight'));
      const retroStabilizer =
        this.phase === 'FLIGHT' && (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown'));

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
              this.audio.playSfx('landing_hard_thud', { pitch: 0.96, volume: 1.0 });
              this.showStatusToast(reason, 2.8);
            },
            onStrutContactThud: (intensity) => {
              this.audio.playSfx('landing_soft_mech', { pitch: 1.0, volume: Math.max(0.65, intensity) });
            },
            onCatastrophicBreach: (ev) => {
              this.lastFailure = ev;
              this.dropStreak = 0;
              this.glitchIntensity = 1.0;
              this.phase = 'HULL_BREACH';
              this.audio.playSfx('hull_explosion', { pitch: 0.96, volume: 1.0 });
              this.triggerVoice('voice_hull_breach', true);
              this.logEvent(`HULL BREACH ON ${this.sector.code}: ${ev.reason}`);
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

        // 2. Propellant 25% Advisory
        const fuelRatio = this.lander.fuelKg / Math.max(1, this.lander.maxFuelKg);
        if (fuelRatio <= 0.25 && !this.warnedFuelLow) {
          this.warnedFuelLow = true;
          this.triggerVoice('voice_fuel_low');
        } else if (fuelRatio > 0.4) {
          this.warnedFuelLow = false;
        }

        // 3. Decision Height "Minimums" Callout (passing through 24m AGL near a pad)
        if (!this.calledMinimums && this.lander.agl <= 24 && this.lander.agl >= 12 && this.lander.vel.y < -0.2) {
          const overAnyPad = this.sector.pads.some(
            (p) => Math.abs(this.lander.pos.x - (p.x1 + p.x2) * 0.5) < 42
          );
          if (overAnyPad) {
            this.calledMinimums = true;
            this.triggerVoice('voice_minimums');
          }
        } else if (this.lander.agl > 48) {
          this.calledMinimums = false;
        }

        // 4. Calibrated Less-Sensitive Airbus GPWS Envelope Callouts
        const criticalPullUp = this.lander.agl < 16 && this.lander.vel.y < -4.1;
        const ceilingObstacle = this.lander.ceilingClearance < 11 && this.lander.vel.y > 0.6;
        const sinkRateWarn =
          ((this.lander.agl < 26 && this.lander.vel.y < -3.05) ||
            (this.lander.agl < 13 && this.lander.vel.y < -2.45)) &&
          this.lander.throttle < 0.85;
        const lateralDriftWarn =
          this.lander.agl < 26 && Math.abs(this.lander.vel.x) > 1.75;
        const absPitchDeg = Math.abs((this.lander.angle * 180) / Math.PI);
        const bankAngleWarn =
          (this.lander.agl < 75 && absPitchDeg > 19.0) || absPitchDeg > 34.0;

        if (criticalPullUp) {
          this.audio.playSfx('proximity_klaxon', { pitch: 0.95, volume: 0.65 });
          if (this.proximityVoiceCooldown <= 0) {
            this.proximityVoiceCooldown = 4.2;
            this.triggerVoice('voice_pull_up', true);
          }
        } else if (ceilingObstacle) {
          this.audio.playSfx('proximity_klaxon', { pitch: 1.05, volume: 0.6 });
          if (this.proximityVoiceCooldown <= 0) {
            this.proximityVoiceCooldown = 4.5;
            this.triggerVoice('voice_obstacle', true);
          }
        } else if (sinkRateWarn) {
          if (this.proximityVoiceCooldown <= 0) {
            this.proximityVoiceCooldown = 6.5;
            this.triggerVoice('voice_proximity');
          }
        } else if (lateralDriftWarn && this.driftVoiceCooldown <= 0) {
          this.driftVoiceCooldown = 6.5;
          this.triggerVoice('voice_lateral_drift');
        } else if (bankAngleWarn && this.bankAngleVoiceCooldown <= 0) {
          this.bankAngleVoiceCooldown = 6.5;
          this.triggerVoice('voice_bank_angle');
        } else if (this.lander.inWindShear && this.windShearVoiceCooldown <= 0) {
          this.windShearVoiceCooldown = 15.0;
          this.triggerVoice('voice_wind_shear_short');
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
          ? 0.75
          : 0;
    const windSpd = Math.hypot(this.lander.currentWindVx, this.lander.currentWindVy);
    this.audio.updateFlightDsp(
      this.lander.throttle,
      rcsDir,
      rcsInt,
      windSpd,
      this.phase === 'FLIGHT' && this.lander.alive && !this.bezelState.flightLogsOpen,
      this.sector.darknessLevel
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
    const effectiveEm = this.computeEffectiveEmInterference();

    if (this.phase !== 'BOOT') {
      this.worldRenderer.render(
        oCtx,
        cam,
        this.sector,
        this.lander,
        this.physics,
        interpAlpha,
        this.totalTimeSec,
        effectiveEm,
        this.phase === 'FLIGHT' && !this.bezelState.flightLogsOpen && this.pointerInsideCrt
          ? this.cursorWorld
          : null
      );
    }

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
      selectedStartSector: this.selectedStartSector,
      menuCursor: this.menuCursor,
      bootPoweredOn: this.bootPoweredOn,
      crtWarmupProgress: this.crtWarmupProgress,
      bootProgressChars: this.bootProgressChars,
      briefingProgressChars: this.briefingProgressChars,
      tallyAnimProgress: this.tallyAnimProgress,
      lastBreakdown: this.lastBreakdown,
      lastFailure: this.lastFailure,
      activeCalloutText: this.activeCalloutText,
      activeCalloutTimer: this.activeCalloutTimer,
      statusBannerText: this.statusBannerText,
      statusBannerTimer: this.statusBannerTimer,
      callsignDraft: this.callsignDraft,
      manifestEntries: this.manifest.getEntries(),
      sessionLogs: this.sessionLogs,
      hoveredButtonId: this.hoveredHudButtonId,
    });

    oCtx.restore();

    // =====================================================================
    // STAGE 2: WEBGL CURVED CRT GLASS POST-PROCESSING SHADER
    // =====================================================================
    const overdriveAmt =
      this.phase === 'FLIGHT' && this.lander.alive
        ? this.lander.overdrive
          ? Math.max(0.35, (this.lander.throttle - 0.85) * 1.9)
          : Math.max(0, (this.lander.throttle - 0.82) * 0.85)
        : 0;
    const shaderInterference =
      this.phase === 'FLIGHT' || this.phase === 'SECTOR_BRIEFING' ? effectiveEm : 0.03;

    this.webglCrt.render(
      this.offscreenCrtCanvas,
      this.crtRect,
      this.dpr,
      this.totalTimeSec,
      this.bezelState.crtIntensity,
      shaderInterference,
      this.glitchIntensity,
      overdriveAmt
    );

    // =====================================================================
    // HARDWARE BEZEL VECTOR OVERLAY (Outside Curved CRT Glass)
    // =====================================================================
    this.bezelCtx.save();
    this.bezelCtx.scale(this.dpr, this.dpr);
    this.bezelUi.render(
      this.bezelCtx,
      this.viewportWidth,
      this.viewportHeight,
      this.crtRect,
      this.bezelState,
      this.audio.getBusActivityLevel(),
      this.totalTimeSec
    );
    this.bezelCtx.restore();
  }

  private updateCamera(dt: number): void {
    let targetZoom = this.manualZoom;

    if (this.bezelState.autoZoomEnabled && this.phase === 'FLIGHT' && this.lander.alive) {
      // Smoothly zoom in when within 80m of any pad
      let minPadDist = Infinity;
      for (const pad of this.sector.pads) {
        const cx = (pad.x1 + pad.x2) * 0.5;
        const d = Math.hypot(
          this.lander.pos.x - cx,
          this.lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y - pad.y
        );
        if (d < minPadDist) minPadDist = d;
      }
      if (minPadDist < PHYSICS.APPROACH_PROXIMITY_M) {
        const approachFactor = 1 - minPadDist / PHYSICS.APPROACH_PROXIMITY_M;
        const autoTarget = 1.15 + approachFactor * 1.35; // Up to ~2.5x automatic precision view
        targetZoom = Math.max(this.manualZoom, autoTarget);
      }
    } else if (this.phase === 'TITLE_MENU') {
      targetZoom = 1.05;
    }

    this.currentZoom += (targetZoom - this.currentZoom) * Math.min(1, dt * 3.8);

    // Camera look-ahead based on shuttle velocity, clamped cleanly to sector bounds
    const cam = this.buildCameraView();
    const halfViewW = cam.widthPx / (2 * cam.pxPerMeter);
    const halfViewH = cam.heightPx / (2 * cam.pxPerMeter);

    let desiredX = this.lander.pos.x + this.lander.vel.x * 1.4;
    let desiredY = this.lander.pos.y + this.lander.vel.y * 0.9 - 8;

    if (this.phase === 'TITLE_MENU') {
      desiredX = this.sector.worldWidth * 0.5 + Math.sin(this.totalTimeSec * 0.18) * 55;
      desiredY = 125;
    }

    const minX = Math.min(this.sector.worldWidth * 0.5, halfViewW - 12);
    const maxX = Math.max(this.sector.worldWidth * 0.5, this.sector.worldWidth - halfViewW + 12);
    const minY = Math.max(15, halfViewH - 22);
    const maxY = Math.max(minY + 10, this.sector.worldHeight - halfViewH + 34);

    desiredX = Math.max(minX, Math.min(maxX, desiredX));
    desiredY = Math.max(minY, Math.min(maxY, desiredY));

    this.cameraPos.x += (desiredX - this.cameraPos.x) * Math.min(1, dt * 5.2);
    this.cameraPos.y += (desiredY - this.cameraPos.y) * Math.min(1, dt * 5.2);
  }
}
