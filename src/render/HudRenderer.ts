import { COLORS, PHYSICS } from '../constants';
import { BootLogoRenderer } from './BootLogoRenderer';
import { CampaignMapRenderer } from './CampaignMapRenderer';
import { MobileHudRenderer, type MobileActiveTouchState } from './MobileHudRenderer';
import type {
  BezelState,
  CrewManifestEntry,
  GamePhase,
  LanderState,
  LandingEvaluation,
  LandingPad,
  LastSubmittedRun,
  LeaderboardMode,
  MenuModeSelection,
  SafeAreaInsets,
  SectorConfig,
  SectorScoreBreakdown,
  TouchdownSnapshot,
  ViewportRect,
} from '../types';

export interface CrtInteractiveButton {
  id: string;
  rect: ViewportRect;
  label: string;
}

export interface HudLayoutMetrics {
  hudScale: number;
  centerScale: number;
  marginX: number;
  topHeaderY: number;
  sidePanelW: number;
  sidePanelH: number;
  safeLeftPx: number;
  safeRightPx: number;
  safeWidthPx: number;
  safeTopPx: number;
  safeBottomPx: number;
  safeHeightPx: number;
}

export interface AvionicsWarningItem {
  text: string;
  critical: boolean;
}

export interface HudRenderContext {
  phase: GamePhase;
  width: number;
  height: number;
  timeSec: number;
  sector: SectorConfig;
  lander: LanderState;
  bezel: BezelState;
  cameraZoom: number;
  sectorElapsedSec: number;
  missionScore: number;
  displayedScore: number;
  dropStreak: number;
  lives: number;
  maxLives: number;
  lifeLostFlashTimer: number;
  isPracticeRun: boolean;
  endlessMode: boolean;
  highestSectorCode: string;
  avgAccuracyPercent: number;
  avgAccuracyRating: string;
  selectedMenuMode: MenuModeSelection;
  selectedStartSector: number;
  menuCursor: number;
  mobileMode: boolean;
  isFullscreen: boolean;
  safeAreaInsets: SafeAreaInsets;
  mobileTouchState: MobileActiveTouchState;
  bootPoweredOn: boolean;
  bootElapsedSec: number;
  crtWarmupProgress: number;
  bootProgressChars: number;
  briefingProgressChars: number;
  tallyAnimProgress: number;
  lastBreakdown: SectorScoreBreakdown | null;
  lastFailure: LandingEvaluation | null;
  touchdownSnapshot: TouchdownSnapshot | null;
  emBlackoutActive: boolean;
  activeCalloutText: string | null;
  activeCalloutTimer: number;
  statusBannerText: string | null;
  statusBannerTimer: number;
  callsignDraft: string;
  playerSavedCallsign: string;
  uplinkConnectionStatus: 'LOADING' | 'LIVE' | 'OFFLINE';
  campaignLeader: CrewManifestEntry | null;
  endlessLeader: CrewManifestEntry | null;
  manifestTab: LeaderboardMode;
  manifestEntries: readonly CrewManifestEntry[];
  manifestShowingArchive: boolean;
  lastSubmittedRun: LastSubmittedRun | null;
  uplinkSubmitState: 'IDLE' | 'TRANSMITTING' | 'CONFIRMED' | 'OFFLINE_SAVED';
  uplinkConfirmText: string | null;
  sessionLogs: readonly string[];
  hoveredButtonId: string | null;
}

export const BOOT_LINES = [
  'USCSS NOSTROMO // REG. 180924609 // COMMERCIAL TOWING VEHICLE',
  'MU-TH-UR 6000 MAINFRAME // 2.1 TB CORE AWAKENING SEQUENCE',
  'MOUNTING MAGNETIC TAPE REELS 01-04 ............. LOCKED',
  'DECODING ACOUSTIC BEACON // ZETA II RETICULI ... LV-426',
  'SPECIAL ORDER 937 // PRIORITY ONE: ORBITAL DESCENT SURVEY',
  'CALIBRATING NARCISSUS DROP-SHUTTLE TELEMETRY ... NOMINAL',
  'INTERFACE 2037 READY // AWAITING FLIGHT OFFICER DIRECTIVE.',
];

export class HudRenderer {
  public buttons: CrtInteractiveButton[] = [];
  public touchControls: CrtInteractiveButton[] = [];
  private bootLogoRenderer = new BootLogoRenderer();
  private campaignMapRenderer = new CampaignMapRenderer();
  private mobileHudRenderer = new MobileHudRenderer();

  public static computeLayoutMetrics(crtWidth: number, crtHeight: number): HudLayoutMetrics {
    const baseSideW = 328;
    const baseSideH = 652;
    const marginX = Math.max(10, Math.round(crtWidth * 0.012));
    const topHeaderY = 60;

    const scaleW = (crtWidth * 0.228) / baseSideW;
    const scaleH = (crtHeight - topHeaderY - 18) / baseSideH;
    const hudScale = Math.max(0.58, Math.min(1.28, Math.min(scaleW, scaleH)));

    const sidePanelW = Math.round(baseSideW * hudScale);
    const sidePanelH = Math.round(baseSideH * hudScale);
    const safeLeftPx = marginX + sidePanelW + 14;
    const safeRightPx = crtWidth - marginX - sidePanelW - 14;
    const safeWidthPx = Math.max(180, safeRightPx - safeLeftPx);

    const centerScale = Math.max(0.64, Math.min(1.22, Math.min(safeWidthPx / 628, hudScale * 1.04)));
    const safeTopPx = topHeaderY + Math.round(174 * centerScale);
    const safeBottomPx = crtHeight - Math.round(78 * centerScale);
    const safeHeightPx = Math.max(140, safeBottomPx - safeTopPx);

    return {
      hudScale,
      centerScale,
      marginX,
      topHeaderY,
      sidePanelW,
      sidePanelH,
      safeLeftPx,
      safeRightPx,
      safeWidthPx,
      safeTopPx,
      safeBottomPx,
      safeHeightPx,
    };
  }

  public static computeAvionicsWarnings(
    lander: LanderState,
    emBlackoutActive = false
  ): AvionicsWarningItem[] {
    if (!lander.alive || lander.groundedPad !== null) return [];
    const alerts: AvionicsWarningItem[] = [];

    if (lander.ceilingClearance < 9 && lander.vel.y > 1.2) {
      alerts.push({ text: 'OBSTACLE', critical: true });
    }
    if (lander.agl < 16 && lander.vel.y < -4.4) {
      alerts.push({ text: 'PULL UP', critical: true });
    } else if (
      ((lander.agl < 26 && lander.vel.y < -3.05) || (lander.agl < 14 && lander.vel.y < -2.4)) &&
      lander.throttle < 0.85
    ) {
      alerts.push({ text: 'SINK RATE', critical: true });
    } else if (lander.agl < 42 && lander.vel.y < -2.55 && lander.throttle < 0.78) {
      alerts.push({ text: 'DESCENT RATE', critical: false });
    }

    const absPitchDeg = Math.abs((lander.angle * 180) / Math.PI);
    if ((lander.agl < 52 && absPitchDeg > 20.0) || absPitchDeg > 38.0) {
      alerts.push({
        text: 'BANK ANGLE',
        critical: lander.agl < 32 && absPitchDeg > 33.0,
      });
    }

    if (lander.agl < 28 && Math.abs(lander.vel.x) > 2.15) {
      alerts.push({
        text: 'LATERAL DRIFT',
        critical: lander.agl < 15 && Math.abs(lander.vel.x) > 2.85,
      });
    }

    if (emBlackoutActive) {
      alerts.push({ text: 'EM OPTIC LOSS // PING RADAR', critical: false });
    }
    if (lander.inWindShear) {
      alerts.push({ text: 'WIND SHEAR', critical: false });
    }
    if (lander.inThermalUpdraft) {
      alerts.push({ text: 'THERMAL UPDRAFT', critical: false });
    }

    const fuelRatio = lander.fuelKg / Math.max(1, lander.maxFuelKg);
    if (fuelRatio <= 0.16) {
      alerts.push({ text: 'LOW FUEL', critical: lander.fuelKg <= 12 });
    }

    return alerts;
  }

  public render(ctx: CanvasRenderingContext2D, state: HudRenderContext): void {
    this.buttons = [];
    this.touchControls = [];
    const w = state.width;
    const h = state.height;

    // Entire startup sequence (Dormant -> Distorted Tube Flash -> Procedural Red Logo -> Awakening Protocol)
    // runs 100% edge-to-edge full-screen with zero flight HUD frame or pills!
    if (state.phase === 'BOOT') {
      this.bootLogoRenderer.render(ctx, {
        width: w,
        height: h,
        timeSec: state.timeSec,
        bootPoweredOn: state.bootPoweredOn,
        mobileMode: state.mobileMode,
        bootElapsedSec: state.bootElapsedSec,
        bootProgressChars: state.bootProgressChars,
        bootLines: BOOT_LINES,
        hoveredButtonId: state.hoveredButtonId,
        buttonsOut: this.buttons,
      });
      return;
    }

    // Dedicated Space-Preserving Mobile (Phone) Flight Deck & Touch UI
    if (state.mobileMode) {
      this.mobileHudRenderer.render(
        ctx,
        state,
        state.safeAreaInsets,
        this.campaignMapRenderer.getSectorSummaries(),
        state.mobileTouchState,
        this.buttons,
        this.touchControls
      );
      return;
    }

    if (state.phase === 'TITLE_MENU') {
      const menuBox = this.getTitleMenuBoxRect(w, h);
      this.campaignMapRenderer.render(ctx, {
        width: w,
        height: h,
        topHeaderY: 60,
        menuBox,
        selectedMenuMode: state.selectedMenuMode,
        selectedStartSector: state.selectedStartSector,
        hoveredButtonId: state.hoveredButtonId,
        buttonsOut: this.buttons,
        timeSec: state.timeSec,
      });
      this.drawOuterFrame(ctx, w, h, state);
      this.drawTitleMenu(ctx, w, h, state, menuBox);
    } else {
      this.drawOuterFrame(ctx, w, h, state);

      if (state.phase === 'SECTOR_BRIEFING') {
        this.drawFlightTelemetryHud(ctx, w, h, state, true);
        this.drawSectorBriefingOverlay(ctx, w, h, state);
      } else {
        this.drawFlightTelemetryHud(ctx, w, h, state, false);

        if (state.phase === 'PAUSED') {
          this.drawPauseOverlay(ctx, w, h, state);
        } else if (state.phase === 'SECTOR_TALLY' && state.lastBreakdown) {
          this.drawSectorTallyOverlay(ctx, w, h, state, state.lastBreakdown);
        } else if (state.phase === 'HULL_BREACH') {
          this.drawHullBreachOverlay(ctx, w, h, state);
        } else if (state.phase === 'CALLSIGN_ENTRY') {
          this.drawCallsignOverlay(ctx, w, h, state);
        } else if (state.phase === 'CAMPAIGN_COMPLETE') {
          this.drawCampaignCompleteOverlay(ctx, w, h, state);
        }
      }
    }

    if (state.bezel.osdMenuOpen) {
      this.drawTvOsdModal(ctx, w, h, state);
    } else if (state.bezel.flightLogsOpen) {
      this.drawFlightLogsModal(ctx, w, h, state);
    }
  }

  private drawCornerBrackets(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    len: number,
    color: string,
    lineWidth = 2.2
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x, y + len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);

    ctx.moveTo(x + w - len, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + len);

    ctx.moveTo(x, y + h - len);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + len, y + h);

    ctx.moveTo(x + w - len, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - len);
    ctx.stroke();
  }

  private drawOuterFrame(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    ctx.save();
    const pad = 10;
    this.drawCornerBrackets(ctx, pad, pad, w - pad * 2, h - pad * 2, 24, COLORS.GREEN_DIM, 2.2);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(pad + 18, pad + 46);
    ctx.lineTo(w - pad - 18, pad + 46);
    ctx.stroke();

    ctx.font = 'bold 18.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.textAlign = 'left';
    const brandText = 'INTERFACE 2037 // NOSTROMO';
    ctx.fillText(brandText, pad + 14, pad + 30);
    const brandRightX = pad + 14 + ctx.measureText(brandText).width;

    // Large, High-Legibility Top-Right Control Strip + FULLSCREEN + Unmistakable [TAB] = MENU!
    if (state.bootPoweredOn) {
      const pillScale = Math.max(0.72, Math.min(1.0, (w - 330) / 1020));
      const pills: Array<{
        id: string;
        label: string;
        active: boolean;
        accent: string;
        pw: number;
        isPrimaryMenu?: boolean;
      }> = [
        {
          id: 'hud-sas-toggle',
          label: state.bezel.sasEnabled ? 'SAS: 50%' : 'SAS: OFF',
          active: state.bezel.sasEnabled,
          accent: state.bezel.sasEnabled ? COLORS.GREEN_BRIGHT : COLORS.AMBER_CAUTION,
          pw: Math.round(114 * pillScale),
        },
        {
          id: 'hud-zoom-toggle',
          label: `ZOOM: ${state.bezel.autoZoomEnabled ? 'AUTO' : 'MAN'}`,
          active: state.bezel.autoZoomEnabled,
          accent: state.bezel.autoZoomEnabled ? COLORS.GREEN_BRIGHT : COLORS.AMBER_CAUTION,
          pw: Math.round(132 * pillScale),
        },
        {
          id: 'hud-mute-toggle',
          label: `AUDIO: ${state.bezel.audioMuted ? 'MUTE' : 'ON'}`,
          active: !state.bezel.audioMuted,
          accent: state.bezel.audioMuted ? COLORS.RED_KLAXON : COLORS.GREEN_BRIGHT,
          pw: Math.round(128 * pillScale),
        },
        {
          id: 'hud-fullscreen-toggle',
          label: state.isFullscreen ? 'EXIT FULL' : 'FULLSCREEN',
          active: state.isFullscreen,
          accent: COLORS.AMBER_BRIGHT,
          pw: Math.round(134 * pillScale),
        },
        {
          id: 'hud-osd-toggle',
          label: '[TAB] = MENU',
          active: state.bezel.osdMenuOpen,
          accent: '#FFB000',
          pw: Math.round(156 * pillScale),
          isPrimaryMenu: true,
        },
        {
          id: 'hud-logs-toggle',
          label: 'LOGS',
          active: state.bezel.flightLogsOpen,
          accent: COLORS.GREEN_BRIGHT,
          pw: Math.round(90 * pillScale),
        },
      ];

      const gap = Math.round(8 * pillScale);
      const totalPillsW = pills.reduce((acc, p) => acc + p.pw, 0) + gap * (pills.length - 1);
      const pillsStartX = w - pad - 14 - totalPillsW;

      if (state.phase !== 'BOOT' && state.phase !== 'TITLE_MENU') {
        const sectorLeftX = Math.round(brandRightX + 24);
        const availSectorW = pillsStartX - sectorLeftX - 18;
        if (availSectorW >= 110) {
          ctx.font = 'bold 17px "Share Tech Mono", monospace';
          ctx.fillStyle = COLORS.AMBER_CAUTION;
          ctx.textAlign = 'left';
          let clipped = `${state.sector.code} // ${state.sector.name}`;
          while (clipped.length > 7 && ctx.measureText(clipped).width > availSectorW) {
            clipped = `${clipped.slice(0, -2)}…`;
          }
          ctx.fillText(clipped, sectorLeftX, pad + 30);
        }
      }

      let px = pillsStartX;
      const py = pad + 4;
      const ph = 38;
      const fontPx = Math.max(14, Math.round(16.8 * pillScale));

      for (const p of pills) {
        this.buttons.push({ id: p.id, rect: { x: px, y: py, width: p.pw, height: ph }, label: p.label });
        const hovered = state.hoveredButtonId === p.id;
        ctx.fillStyle = hovered
          ? p.isPrimaryMenu
            ? 'rgba(255, 176, 0, 0.28)'
            : 'rgba(59, 224, 104, 0.28)'
          : p.isPrimaryMenu
            ? 'rgba(36, 22, 4, 0.92)'
            : p.active
              ? 'rgba(18, 48, 28, 0.88)'
              : 'rgba(5, 13, 8, 0.94)';
        ctx.fillRect(px, py, p.pw, ph);

        ctx.strokeStyle = hovered
          ? '#FFFFFF'
          : p.isPrimaryMenu
            ? '#FFB000'
            : p.active
              ? p.accent
              : COLORS.GREEN_MID;
        ctx.lineWidth = hovered || p.isPrimaryMenu ? 2.4 : 1.9;
        ctx.strokeRect(px, py, p.pw, ph);

        ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
        ctx.fillStyle = hovered ? '#FFFFFF' : p.isPrimaryMenu ? '#FFD266' : p.accent;
        ctx.textAlign = 'center';
        ctx.fillText(p.label, px + p.pw * 0.5, py + 25);
        px += p.pw + gap;
      }

      const regSeed = Math.floor(state.timeSec * 6);
      const hexA = ((regSeed * 4919) & 0xffff).toString(16).toUpperCase().padStart(4, '0');
      const hexB = ((regSeed * 7907) & 0xff).toString(16).toUpperCase().padStart(2, '0');
      const pulseBits = regSeed % 2 === 0 ? '[||||..||]' : '[||.||||.]';
      const busStr = `MU-TH-UR 6000 // BUS ${hexA}:${hexB} ${pulseBits}`;
      ctx.textAlign = 'left';
      ctx.font = 'bold 14.5px "JetBrains Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText(busStr, pad + 14, h - pad - 5);
      const busEndX = pad + 14 + ctx.measureText(busStr).width + 18;

      ctx.fillStyle = '#FFB000';
      ctx.fillText('► PRESS [TAB] = MENU (SETTINGS / CRT / PAUSE)', busEndX, h - pad - 5);
    }
    ctx.restore();
  }

  // =========================================================================
  // SCALED-UP CHUNKY NOSTROMO INSTRUMENTATION + SCORE & RADAR CELL RACK
  // =========================================================================

  private drawFlightTelemetryHud(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    dimmed: boolean
  ): void {
    ctx.save();
    if (dimmed) ctx.globalAlpha = 0.42;

    const lander = state.lander;
    const sector = state.sector;
    const layout = HudRenderer.computeLayoutMetrics(w, h);
    const s = layout.hudScale;

    const totalMass = lander.dryMassKg + lander.fuelKg;
    const currentTwr = PHYSICS.MAIN_THRUST_N / (totalMass * sector.gravity);
    const thrustKn = (lander.throttle * PHYSICS.MAIN_THRUST_N) / 1000;
    const pitchDeg = (lander.angle * 180) / Math.PI;
    const rollRateDeg = (lander.angularVel * 180) / Math.PI;
    const windKnots = Math.hypot(lander.currentWindVx, lander.currentWindVy) * 1.94384;

    const targetPadInfo = this.findClosestTargetPad(lander, sector.pads);
    const padDx = targetPadInfo ? (targetPadInfo.pad.x1 + targetPadInfo.pad.x2) * 0.5 - lander.pos.x : 0;
    const padBearingStr = targetPadInfo
      ? `${Math.abs(padDx).toFixed(0)}M ${padDx >= 0 ? 'E' : 'W'} [${targetPadInfo.pad.type === 'DEPOT' ? 'DEP' : `${targetPadInfo.pad.multiplier}X`}]`
      : '---';

    const ttiStr =
      lander.groundedPad !== null
        ? 'CONTACT'
        : lander.vel.y < -0.25
          ? `${Math.min(99.9, lander.agl / Math.abs(lander.vel.y)).toFixed(1)} SEC`
          : 'CLIMB/HVR';

    // ---------------------------------------------------------------------
    // RIGHT INSTRUMENT CLUSTER (WINDOW-SCALED): FLIGHT DATA + DIALS + VERNIER
    // ---------------------------------------------------------------------
    const baseW = 328;
    const baseH = 652;
    const rightScreenX = w - layout.marginX - layout.sidePanelW;
    const rightScreenY = layout.topHeaderY;

    ctx.save();
    ctx.translate(rightScreenX, rightScreenY);
    ctx.scale(s, s);

    ctx.fillStyle = 'rgba(3, 8, 5, 0.88)';
    ctx.fillRect(0, 0, baseW, baseH);
    this.drawCornerBrackets(ctx, 0, 0, baseW, baseH, 16, COLORS.GREEN_DIM, 2.4);

    // 1. Expanded "FLIGHT DATA" Tabular Telemetry Block (7 Avionics Rows)
    ctx.textAlign = 'left';
    ctx.font = 'bold 22px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('FLIGHT DATA', 14, 26);

    ctx.strokeStyle = COLORS.GREEN_PRIMARY;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(14, 33);
    ctx.lineTo(baseW - 14, 33);
    ctx.stroke();

    const vsDangerous =
      lander.vel.y < -10.5 || (lander.agl < 40 && lander.vel.y < -PHYSICS.SURVIVAL_VS_MAX);
    const hsDangerous =
      Math.abs(lander.vel.x) > 6.8 ||
      (lander.agl < 34 && Math.abs(lander.vel.x) > PHYSICS.SURVIVAL_HS_MAX);

    const dataRows: Array<{ label: string; val: string; color: string }> = [
      {
        label: 'MASS / TWR',
        val: `${totalMass.toFixed(0)}K / ${currentTwr.toFixed(2)}`,
        color: COLORS.GREEN_PRIMARY,
      },
      {
        label: 'VERT VEL',
        val: `${lander.vel.y >= 0 ? '+' : ''}${lander.vel.y.toFixed(2)} M/S`,
        color: vsDangerous
          ? COLORS.RED_KLAXON
          : lander.vel.y < -PHYSICS.SAFE_VS_MAX && lander.agl < 70
            ? COLORS.AMBER_CAUTION
            : COLORS.GREEN_PRIMARY,
      },
      {
        label: 'LAT DRIFT',
        val: `${lander.vel.x >= 0 ? '+' : ''}${lander.vel.x.toFixed(2)} M/S`,
        color: hsDangerous
          ? COLORS.RED_KLAXON
          : Math.abs(lander.vel.x) > PHYSICS.SAFE_HS_MAX && lander.agl < 70
            ? COLORS.AMBER_CAUTION
            : COLORS.GREEN_PRIMARY,
      },
      {
        label: 'THR / G-LOAD',
        val: `${thrustKn.toFixed(1)}KN / ${lander.netAccelG.toFixed(2)}G`,
        color: lander.overdrive ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY,
      },
      {
        label: 'ATT / RATE',
        val: `${pitchDeg >= 0 ? '+' : ''}${pitchDeg.toFixed(1)}° / ${rollRateDeg >= 0 ? '+' : ''}${rollRateDeg.toFixed(0)}°/S`,
        color:
          Math.abs(pitchDeg) > PHYSICS.SAFE_ANGLE_DEG
            ? COLORS.AMBER_CAUTION
            : COLORS.GREEN_PRIMARY,
      },
      {
        label: 'PAD BEARING',
        val: padBearingStr,
        color: COLORS.AMBER_BRIGHT,
      },
      {
        label: 'TIME TO IMP',
        val: ttiStr,
        color:
          lander.vel.y < -3.2 && lander.agl < 24 ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY,
      },
    ];

    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    dataRows.forEach((row, idx) => {
      const ty = 53 + idx * 19.5;
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText(row.label, 14, ty);

      ctx.textAlign = 'right';
      ctx.fillStyle = row.color;
      ctx.fillText(row.val, baseW - 14, ty);
    });

    // 2. Chunky Circular Golden-Orange Gauges + Stepped Vertical Green Vernier Scale
    const gaugesTopY = 190;
    const leftColCx = Math.round(baseW * 0.28);
    const rightColCx = Math.round(baseW * 0.74);
    const dialR = 42;
    const rowStep = 132;

    // Gauge A: FUEL Circular Wedge Dial
    const fuelRatio = Math.max(0, Math.min(1, lander.fuelKg / Math.max(1, lander.maxFuelKg)));
    this.drawChunkyFuelWedgeDial(
      ctx,
      leftColCx,
      gaugesTopY + dialR + 4,
      dialR,
      fuelRatio,
      `${lander.fuelKg.toFixed(0)} KG`,
      'FUEL'
    );

    // Gauge B: SPEED Dial (Scaled to 15.0 M/S full-scale; red only on dangerous speed or low-AGL excessive sink)
    const speedMaxScale = 15.0;
    const speedMag = Math.hypot(lander.vel.x, lander.vel.y);
    const speedNorm = Math.min(1, speedMag / speedMaxScale);
    const speedIsRed =
      speedMag > 11.8 || (lander.agl < 36 && lander.vel.y < -PHYSICS.SURVIVAL_VS_MAX);
    const speedWarn = speedIsRed ? COLORS.RED_KLAXON : COLORS.AMBER_CAUTION;
    this.drawChunkyNeedleDial(
      ctx,
      leftColCx,
      gaugesTopY + dialR + 4 + rowStep,
      dialR,
      speedNorm,
      PHYSICS.SAFE_VS_MAX / speedMaxScale,
      'SPEED',
      speedWarn,
      false,
      `${speedMag.toFixed(1)} M/S`
    );

    // Gauge C: DRIFT Dial (Scaled to +/-8.5 M/S full-scale)
    const driftSigned = Math.max(-1, Math.min(1, lander.vel.x / 8.5));
    const driftCol = hsDangerous ? COLORS.RED_KLAXON : COLORS.AMBER_CAUTION;
    this.drawChunkyNeedleDial(
      ctx,
      leftColCx,
      gaugesTopY + dialR + 4 + rowStep * 2,
      dialR,
      driftSigned,
      undefined,
      'DRIFT',
      driftCol,
      true
    );

    // Gauge D: Tall Stepped Vertical Green Vernier Scale (AGL M)
    this.drawSteppedVerticalVernier(
      ctx,
      rightColCx,
      gaugesTopY,
      rowStep * 1.82,
      lander.agl,
      200,
      'AGL M'
    );

    // Gauge E: THRUST Dial directly below vertical scale
    const thrustNorm = Math.min(1, lander.throttle / PHYSICS.OVERDRIVE_MULTIPLIER);
    const thrustCol = lander.overdrive ? COLORS.RED_KLAXON : COLORS.AMBER_CAUTION;
    this.drawChunkyNeedleDial(
      ctx,
      rightColCx,
      gaugesTopY + dialR + 4 + rowStep * 2,
      dialR,
      thrustNorm,
      1.0 / PHYSICS.OVERDRIVE_MULTIPLIER,
      'THRUST',
      thrustCol,
      false
    );

    // Hull & Optic Status Footer
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    const sysBroken = lander.strutDamaged || lander.rcsDamaged;
    ctx.fillStyle = sysBroken ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY;
    const sysTxt = sysBroken
      ? `HULL ${Math.round(lander.hullIntegrity)}% // ${lander.strutDamaged ? 'GEAR-DMG ' : ''}${lander.rcsDamaged ? 'RCS-DMG' : ''}`
      : `HULL ${Math.round(lander.hullIntegrity)}% // ${state.bezel.sasEnabled ? 'SAS 50% ROLL' : '100% ROLL'} // ${state.cameraZoom.toFixed(1)}X`;
    ctx.fillText(sysTxt, baseW * 0.5, baseH - 11);
    ctx.restore();

    // ---------------------------------------------------------------------
    // LEFT TACTICAL STACK (WINDOW-SCALED):
    // 1) GIANT SCORE + 3-SHUTTLE RESERVES + [SPACE] 1X PULSE + 3 RADAR CELLS
    // 2) INERTIAL ATTITUDE GYRO + WIND COMPASS
    // 3) 2D LANDING PAD TOPOGRAPHY & GLIDE-SLOPE MAP
    // ---------------------------------------------------------------------
    ctx.save();
    ctx.translate(layout.marginX, layout.topHeaderY);
    ctx.scale(s, s);

    this.drawScoreAndRadarRack(
      ctx,
      0,
      0,
      baseW,
      state.displayedScore,
      state.dropStreak,
      state.lives,
      state.maxLives,
      state.lifeLostFlashTimer,
      state.isPracticeRun,
      state.sectorElapsedSec,
      lander,
      state.timeSec
    );

    this.drawAttitudeAndWindPod(ctx, 0, 236, baseW, lander, sector, windKnots);

    if (targetPadInfo && lander.alive && (state.phase === 'FLIGHT' || state.phase === 'PAUSED')) {
      this.drawProximityApproachSubWindow(
        ctx,
        0,
        408,
        baseW,
        238,
        sector,
        lander,
        targetPadInfo.pad,
        targetPadInfo.dist
      );
    }
    ctx.restore();

    // ---------------------------------------------------------------------
    // TOP-CENTER GO / NO-GO + CENTERLINE SOFT-KISS ILS HUD
    // Visible during pad approach AND remains locked upon landing/crash!
    // ---------------------------------------------------------------------
    if (
      (state.phase === 'SECTOR_TALLY' || state.phase === 'HULL_BREACH') &&
      state.touchdownSnapshot
    ) {
      this.drawTopGoNoGoHud(
        ctx,
        w,
        layout,
        state.touchdownSnapshot.pad,
        state.touchdownSnapshot.dist,
        state.touchdownSnapshot.vs,
        state.touchdownSnapshot.hs,
        state.touchdownSnapshot.deg,
        state.touchdownSnapshot.offsetM,
        state.touchdownSnapshot.grade,
        state.timeSec
      );
    } else if (
      targetPadInfo &&
      targetPadInfo.dist <= PHYSICS.APPROACH_PROXIMITY_M &&
      lander.alive &&
      (state.phase === 'FLIGHT' || state.phase === 'PAUSED')
    ) {
      const padCenter = (targetPadInfo.pad.x1 + targetPadInfo.pad.x2) * 0.5;
      this.drawTopGoNoGoHud(
        ctx,
        w,
        layout,
        targetPadInfo.pad,
        targetPadInfo.dist,
        Math.abs(Math.min(0, lander.vel.y)),
        Math.abs(lander.vel.x),
        Math.abs((lander.angle * 180) / Math.PI),
        lander.pos.x - padCenter,
        null,
        state.timeSec
      );
    }

    // ---------------------------------------------------------------------
    // LARGE BOTTOM-CENTER AIRBUS AVIONICS WARNING BAR
    // ---------------------------------------------------------------------
    this.drawBottomAirbusWarnings(
      ctx,
      w,
      h,
      layout,
      lander,
      state.emBlackoutActive,
      state.activeCalloutText && state.activeCalloutTimer > 0 ? state.activeCalloutText : null,
      state.timeSec
    );

    if (state.statusBannerText && state.statusBannerTimer > 0) {
      this.drawStatusToast(ctx, w, h, layout, state.statusBannerText);
    }

    ctx.restore();
  }

  /**
   * Dedicated High-Visibility MISSION SCORE Display + 3 DROP-SHUTTLE RESERVES Module
   * + [SPACE] 1X GAME PULSE + 3 RADAR PING CELLS Rack.
   */
  private drawScoreAndRadarRack(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    displayedScore: number,
    dropStreak: number,
    lives: number,
    maxLives: number,
    lifeLostFlashTimer: number,
    isPracticeRun: boolean,
    sectorElapsedSec: number,
    lander: LanderState,
    timeSec: number
  ): void {
    const h = 228;
    ctx.save();
    ctx.fillStyle = 'rgba(3, 8, 5, 0.88)';
    ctx.fillRect(x, y, w, h);
    this.drawCornerBrackets(ctx, x, y, w, h, 14, COLORS.GREEN_DIM, 2.4);

    // Top Row: Giant Prominent MISSION SCORE + STREAK / PRACTICE Badge
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(isPracticeRun ? 'PRACTICE TELEMETRY' : 'MISSION TELEMETRY', x + 14, y + 22);

    const streak = Math.max(1, dropStreak);
    ctx.textAlign = 'right';
    ctx.font = 'bold 15px "Share Tech Mono", monospace';
    ctx.fillStyle = isPracticeRun
      ? COLORS.AMBER_CAUTION
      : streak > 1
        ? COLORS.AMBER_BRIGHT
        : COLORS.GREEN_PRIMARY;
    ctx.fillText(isPracticeRun ? 'UNRANKED' : `STREAK ${streak}X`, x + w - 14, y + 22);

    // Big Bold 34px Nostromo Tabular Score Readout
    ctx.textAlign = 'left';
    ctx.font = 'bold 34px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    const scoreText = Math.round(displayedScore).toString().padStart(7, '0');
    ctx.fillText(scoreText, x + 14, y + 55);

    // Mission Elapsed Time (MET) + Delta-V / Flow
    const mins = Math.floor(sectorElapsedSec / 60);
    const secs = sectorElapsedSec % 60;
    const metStr = `MET ${String(mins).padStart(2, '0')}:${secs.toFixed(1).padStart(4, '0')}`;
    ctx.textAlign = 'right';
    ctx.font = 'bold 14.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(metStr, x + w - 14, y + 52);

    const totalMass = lander.dryMassKg + lander.fuelKg;
    const vExhaust = PHYSICS.MAIN_THRUST_N / PHYSICS.MAIN_BURN_RATE_KG_S;
    const deltaV = vExhaust * Math.log(totalMass / lander.dryMassKg);
    const burnMult = lander.throttle > 1 ? PHYSICS.OVERDRIVE_BURN_PENALTY : 1;
    const flowKgS =
      lander.throttle * PHYSICS.MAIN_BURN_RATE_KG_S * burnMult +
      (lander.retroActive ? PHYSICS.RETRO_BURN_RATE_KG_S : 0) +
      (lander.rcsLeftActive || lander.rcsRightActive ? PHYSICS.RCS_BURN_RATE_KG_S : 0);

    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(`ΔV ${deltaV.toFixed(0)} M/S`, x + 14, y + 74);
    ctx.textAlign = 'right';
    ctx.fillStyle = flowKgS > 9 ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
    ctx.fillText(`FLOW ${flowKgS.toFixed(1)} KG/S`, x + w - 14, y + 74);

    // =====================================================================
    // MIDDLE RACK: SHUTTLE RESERVES // 3 VECTOR DROP-SHUTTLE ICONS
    // =====================================================================
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + 14, y + 81);
    ctx.lineTo(x + w - 14, y + 81);
    ctx.stroke();

    const finalShuttle = lives === 1;
    const noShuttles = lives <= 0;
    ctx.textAlign = 'left';
    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    ctx.fillStyle = noShuttles
      ? '#FF3333'
      : finalShuttle
        ? '#FFB000'
        : '#44FF77';
    ctx.fillText('SHUTTLE RESERVES', x + 14, y + 98);

    ctx.textAlign = 'right';
    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.fillText(
      noShuttles ? '0/3 DEPLETED' : finalShuttle ? '1/3 FINAL HULL' : `${lives}/${maxLives} ACTIVE`,
      x + w - 14,
      y + 98
    );

    const bayGap = 8;
    const bayW = (w - 28 - bayGap * (maxLives - 1)) / maxLives;
    const bayY = y + 104;
    const bayH = 38;

    for (let i = 0; i < maxLives; i++) {
      const bx = x + 14 + i * (bayW + bayGap);
      const isAlive = i < lives;
      const justLostFlash =
        !isAlive && i === lives && lifeLostFlashTimer > 0 && Math.sin(timeSec * 22) > -0.2;

      if (isAlive) {
        const hullCol = finalShuttle ? '#FFB000' : '#44FF77';
        ctx.fillStyle = finalShuttle ? 'rgba(255, 176, 0, 0.14)' : 'rgba(68, 255, 119, 0.11)';
        ctx.fillRect(bx, bayY, bayW, bayH);
        ctx.strokeStyle = hullCol;
        ctx.lineWidth = 2.0;
        ctx.strokeRect(bx, bayY, bayW, bayH);
        this.drawMiniShuttleVector(ctx, bx + bayW * 0.5, bayY + bayH * 0.52, hullCol, false);
      } else {
        const deadStroke = justLostFlash ? '#FF3333' : '#4A2020';
        ctx.fillStyle = justLostFlash ? 'rgba(255, 51, 51, 0.25)' : '#2A1A1A';
        ctx.fillRect(bx, bayY, bayW, bayH);
        ctx.strokeStyle = deadStroke;
        ctx.lineWidth = 1.6;
        ctx.strokeRect(bx, bayY, bayW, bayH);
        this.drawMiniShuttleVector(
          ctx,
          bx + bayW * 0.5,
          bayY + bayH * 0.52,
          justLostFlash ? '#FF3333' : '#5E2A2A',
          true
        );

        // Diagonal Breached Cross-Out Slash
        ctx.strokeStyle = justLostFlash ? '#FF3333' : '#8A2828';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(bx + 6, bayY + 5);
        ctx.lineTo(bx + bayW - 6, bayY + bayH - 5);
        ctx.moveTo(bx + bayW - 6, bayY + 5);
        ctx.lineTo(bx + 6, bayY + bayH - 5);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + 14, y + 150);
    ctx.lineTo(x + w - 14, y + 150);
    ctx.stroke();

    // =====================================================================
    // BOTTOM SPLIT RACK:
    // LEFT: [SPACE] ONE-TIME EMERGENCY THRUST PULSE CARTRIDGE
    // RIGHT: [L-CLICK] 3 TACTICAL RADAR PING CELLS
    // =====================================================================
    const splitX = x + Math.round(w * 0.52);

    // 1. Left Box: [SPACE] 1X GAME PULSE
    const pulseArmed = lander.emergencyPulseAvailable;
    const pulseFiring = lander.emergencyPulseTimer > 0;
    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = pulseFiring
      ? '#FFFFFF'
      : pulseArmed
        ? COLORS.AMBER_BRIGHT
        : COLORS.RED_KLAXON;
    ctx.fillText('[SPACE] 1X PULSE', x + 14, y + 168);

    const pBoxX = x + 14;
    const pBoxY = y + 176;
    const pBoxW = splitX - pBoxX - 10;
    const pBoxH = 38;

    ctx.strokeStyle = pulseArmed || pulseFiring ? COLORS.AMBER_CAUTION : COLORS.RED_DIM;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(pBoxX, pBoxY, pBoxW, pBoxH);

    if (pulseArmed || pulseFiring) {
      const glow = pulseFiring ? 0.9 : 0.25 + 0.12 * Math.sin(timeSec * 5);
      ctx.fillStyle = `rgba(255, 140, 0, ${glow.toFixed(2)})`;
      ctx.fillRect(pBoxX + 3, pBoxY + 3, pBoxW - 6, pBoxH - 6);
    }

    ctx.textAlign = 'center';
    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.fillStyle = pulseFiring
      ? '#FFFFFF'
      : pulseArmed
        ? COLORS.AMBER_BRIGHT
        : COLORS.RED_KLAXON;
    ctx.fillText(
      pulseFiring ? '>> FIRING <<' : pulseArmed ? 'ARMED [1/RUN]' : 'EXPENDED',
      pBoxX + pBoxW * 0.5,
      pBoxY + 24
    );

    // 2. Right Box: [L-CLICK] 3 RADAR PING CELLS
    const maxCells = Math.max(1, lander.maxRadarCharges);
    const remCells = lander.radarCharges;
    const lowCells = remCells <= 1;

    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = remCells === 0 ? COLORS.RED_KLAXON : lowCells ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
    ctx.fillText('RADAR [L-CLK]', splitX + 4, y + 168);

    ctx.textAlign = 'right';
    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.fillText(`${remCells}/${maxCells}`, x + w - 14, y + 168);

    const rackX = splitX + 4;
    const rackW = x + w - 14 - rackX;
    const rackY = y + 176;
    const cellGap = 6;
    const cellW = (rackW - cellGap * (maxCells - 1)) / maxCells;
    const cellH = 38;

    if (remCells > 0) {
      for (let c = 0; c < maxCells; c++) {
        const cx = rackX + c * (cellW + cellGap);
        const charged = c < remCells;

        ctx.fillStyle = charged
          ? lowCells
            ? COLORS.AMBER_BRIGHT
            : COLORS.GREEN_BRIGHT
          : COLORS.GREEN_DIM;
        ctx.fillRect(cx + cellW * 0.25, rackY, cellW * 0.5, 4);

        ctx.strokeStyle = charged
          ? lowCells
            ? COLORS.AMBER_CAUTION
            : COLORS.GREEN_PRIMARY
          : COLORS.GREEN_DIM;
        ctx.lineWidth = 2.0;
        ctx.strokeRect(cx, rackY + 4, cellW, cellH - 4);

        if (charged) {
          ctx.fillStyle = lowCells ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
          ctx.fillRect(cx + 3, rackY + 7, Math.max(2, cellW - 6), cellH - 10);
        }
      }
    } else {
      const blink = Math.sin(timeSec * 10) > 0;
      ctx.strokeStyle = blink ? COLORS.RED_KLAXON : COLORS.AMBER_DIM;
      ctx.lineWidth = 1.8;
      ctx.strokeRect(rackX, rackY + 4, rackW, 34);

      const progW = ((rackW - 4) * lander.sensorCapacitor) / 100;
      ctx.fillStyle = COLORS.AMBER_CAUTION;
      ctx.fillRect(rackX + 2, rackY + 6, progW, 30);

      ctx.textAlign = 'center';
      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_BRIGHT;
      ctx.fillText(`GEN ${Math.round(lander.sensorCapacitor)}%`, rackX + rackW * 0.5, rackY + 26);
    }

    ctx.restore();
  }

  /**
   * Renders a crisp miniature vector Narcissus Drop-Shuttle icon inside each SHUTTLE RESERVES bay.
   */
  private drawMiniShuttleVector(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    color: string,
    breached: boolean
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = color;
    ctx.lineWidth = breached ? 1.4 : 1.9;

    // Octagonal Descent Module Hull
    ctx.beginPath();
    ctx.moveTo(-7, -10);
    ctx.lineTo(7, -10);
    ctx.lineTo(11, -3);
    ctx.lineTo(9, 4);
    ctx.lineTo(-9, 4);
    ctx.lineTo(-11, -3);
    ctx.closePath();
    ctx.stroke();

    // Cockpit Canopy Truss
    ctx.beginPath();
    ctx.moveTo(-5, -5);
    ctx.lineTo(5, -5);
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 4);
    ctx.stroke();

    // Splayed Articulated Landing Struts + Footpads
    ctx.beginPath();
    ctx.moveTo(-8, 3);
    ctx.lineTo(-16, 11);
    ctx.moveTo(-19, 11);
    ctx.lineTo(-12, 11);

    ctx.moveTo(8, 3);
    ctx.lineTo(16, 11);
    ctx.moveTo(12, 11);
    ctx.lineTo(19, 11);

    // Engine Nozzle Bell
    ctx.moveTo(-3.5, 4);
    ctx.lineTo(-5.5, 9);
    ctx.lineTo(5.5, 9);
    ctx.lineTo(3.5, 4);
    ctx.stroke();
    ctx.restore();
  }

  private drawChunkyFuelWedgeDial(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    fuelRatio: number,
    subValue: string,
    label: string
  ): void {
    ctx.save();
    const startAng = (140 * Math.PI) / 180;
    const endAng = (400 * Math.PI) / 180;
    const isCritical = fuelRatio <= 0.18;
    const activeCol = isCritical ? COLORS.RED_KLAXON : COLORS.AMBER_CAUTION;

    ctx.strokeStyle = COLORS.AMBER_DIM;
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, endAng);
    ctx.stroke();

    const activeEnd = startAng + (endAng - startAng) * fuelRatio;
    if (fuelRatio > 0.01) {
      ctx.strokeStyle = activeCol;
      ctx.lineWidth = 5.0;
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAng, activeEnd);
      ctx.stroke();
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 6.5, 0, Math.PI * 2);
    ctx.clip();

    const innerTop = cy - (r - 9);
    const innerBot = cy + (r - 9);
    const fillTop = innerBot - (innerBot - innerTop) * fuelRatio;

    ctx.fillStyle = activeCol;
    ctx.beginPath();
    ctx.moveTo(cx - r + 5, innerBot);
    ctx.lineTo(cx - r + 8, fillTop);
    ctx.lineTo(cx + r - 6 - (1 - fuelRatio) * 5, fillTop);
    ctx.lineTo(cx + r - 10, innerBot);
    ctx.closePath();
    ctx.fill();

    if (fuelRatio > 0.04) {
      ctx.strokeStyle = isCritical ? '#FF9A8A' : COLORS.AMBER_BRIGHT;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx - r + 8, fillTop);
      ctx.lineTo(cx + r - 6, fillTop);
      ctx.stroke();
    }
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    ctx.fillStyle = activeCol;
    ctx.fillText(label, cx, cy + r + 15);

    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText(subValue, cx, cy + r + 30);
    ctx.restore();
  }

  private drawChunkyNeedleDial(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    value: number,
    safeTickRatio: number | undefined,
    label: string,
    activeCol: string,
    centerZero: boolean,
    subValue?: string
  ): void {
    ctx.save();
    const startAng = (150 * Math.PI) / 180;
    const sweep = (240 * Math.PI) / 180;
    const endAng = startAng + sweep;

    ctx.strokeStyle = COLORS.AMBER_DIM;
    ctx.lineWidth = 4.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, endAng);
    ctx.stroke();

    let needleAng = startAng;
    ctx.strokeStyle = activeCol;
    ctx.lineWidth = 5.2;
    ctx.beginPath();
    if (centerZero) {
      const midAng = startAng + sweep * 0.5;
      needleAng = midAng + Math.max(-1, Math.min(1, value)) * (sweep * 0.5);
      if (needleAng >= midAng) {
        ctx.arc(cx, cy, r, midAng, needleAng);
      } else {
        ctx.arc(cx, cy, r, needleAng, midAng);
      }
    } else {
      const clamped = Math.max(0, Math.min(1, value));
      needleAng = startAng + clamped * sweep;
      if (clamped > 0.01) {
        ctx.arc(cx, cy, r, startAng, needleAng);
      }
    }
    ctx.stroke();

    const ticks = 8;
    for (let i = 0; i <= ticks; i++) {
      const frac = i / ticks;
      const a = startAng + frac * sweep;
      const innerLen = i % 2 === 0 ? 8 : 5;
      const lit = centerZero
        ? Math.abs(frac - 0.5) <= Math.abs(value) * 0.5 + 0.02
        : frac <= value + 0.02;
      ctx.strokeStyle = lit ? COLORS.AMBER_BRIGHT : COLORS.AMBER_DIM;
      ctx.lineWidth = i % 2 === 0 ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 2.5), cy + Math.sin(a) * (r - 2.5));
      ctx.lineTo(cx + Math.cos(a) * (r - 2.5 - innerLen), cy + Math.sin(a) * (r - 2.5 - innerLen));
      ctx.stroke();
    }

    if (safeTickRatio !== undefined) {
      const sa = startAng + Math.max(0, Math.min(1, safeTickRatio)) * sweep;
      ctx.strokeStyle = COLORS.GREEN_PRIMARY;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(sa) * (r - 6), cy + Math.sin(sa) * (r - 6));
      ctx.lineTo(cx + Math.cos(sa) * (r + 5), cy + Math.sin(sa) * (r + 5));
      ctx.stroke();
    }

    ctx.strokeStyle = COLORS.AMBER_BRIGHT;
    ctx.lineWidth = 3.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(needleAng) * 5, cy - Math.sin(needleAng) * 5);
    ctx.lineTo(cx + Math.cos(needleAng) * (r - 6), cy + Math.sin(needleAng) * (r - 6));
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.fillStyle = activeCol;
    ctx.beginPath();
    ctx.arc(cx, cy, 4.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    ctx.fillStyle = activeCol;
    ctx.fillText(label, cx, cy + r + 15);
    if (subValue) {
      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      ctx.fillStyle = COLORS.AMBER_BRIGHT;
      ctx.fillText(subValue, cx, cy + r + 30);
    }
    ctx.restore();
  }

  private drawSteppedVerticalVernier(
    ctx: CanvasRenderingContext2D,
    cx: number,
    topY: number,
    totalH: number,
    aglMeters: number,
    maxScaleM: number,
    topLabel: string
  ): void {
    ctx.save();
    const ladderTop = topY + 22;
    const ladderH = totalH - 46;
    const ladderBot = ladderTop + ladderH;
    const colHalfW = 5.5;

    ctx.textAlign = 'center';
    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(topLabel, cx, topY + 14);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 2.2;
    ctx.strokeRect(cx - colHalfW, ladderTop, colHalfW * 2, ladderH);

    const norm = Math.max(0, Math.min(1, aglMeters / maxScaleM));
    const fillH = ladderH * norm;
    if (fillH > 1) {
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      ctx.fillRect(cx - colHalfW + 1.5, ladderBot - fillH, colHalfW * 2 - 3, fillH);
    }

    const rungs = 10;
    for (let i = 0; i <= rungs; i++) {
      const frac = i / rungs;
      const ry = ladderBot - frac * ladderH;
      const isMajor = i % 5 === 0 || i === 4;
      const rungSpan = isMajor ? 18 : 11;
      const lit = frac <= norm + 0.02;

      ctx.strokeStyle = lit ? COLORS.GREEN_PRIMARY : COLORS.GREEN_MID;
      ctx.lineWidth = isMajor ? 2.5 : 1.6;
      ctx.beginPath();
      ctx.moveTo(cx - colHalfW - rungSpan, ry);
      ctx.lineTo(cx - colHalfW - 1, ry);
      ctx.moveTo(cx + colHalfW + 1, ry);
      ctx.lineTo(cx + colHalfW + rungSpan, ry);
      ctx.stroke();

      if (i === 4) {
        ctx.font = 'bold 13px "JetBrains Mono", monospace';
        ctx.fillStyle = COLORS.GREEN_BRIGHT;
        ctx.textAlign = 'right';
        ctx.fillText('80', cx - colHalfW - rungSpan - 4, ry + 5);
        ctx.textAlign = 'left';
        ctx.fillText('80', cx + colHalfW + rungSpan + 4, ry + 5);
      }
    }

    const bugY = ladderBot - fillH;
    ctx.strokeStyle = COLORS.GREEN_BRIGHT;
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(cx - 17, bugY);
    ctx.lineTo(cx + 17, bugY);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    ctx.fillStyle = aglMeters < 25 ? COLORS.AMBER_BRIGHT : COLORS.GREEN_BRIGHT;
    ctx.fillText(`${aglMeters.toFixed(1)}M`, cx, topY + totalH - 3);
    ctx.restore();
  }

  private drawAttitudeAndWindPod(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    lander: LanderState,
    sector: SectorConfig,
    windKnots: number
  ): void {
    const h = 166;
    ctx.save();
    ctx.fillStyle = 'rgba(3, 8, 5, 0.86)';
    ctx.fillRect(x, y, w, h);
    this.drawCornerBrackets(ctx, x, y, w, h, 14, COLORS.GREEN_DIM, 2.4);

    const gyroCx = x + w * 0.27;
    const gyroCy = y + 62;
    const gyroR = 42;
    const pitchDeg = (lander.angle * 180) / Math.PI;
    const attSafe = Math.abs(pitchDeg) <= PHYSICS.SAFE_ANGLE_DEG;

    ctx.strokeStyle = attSafe ? COLORS.GREEN_PRIMARY : COLORS.AMBER_CAUTION;
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.arc(gyroCx, gyroCy, gyroR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(gyroCx - gyroR - 4, gyroCy);
    ctx.lineTo(gyroCx - gyroR + 6, gyroCy);
    ctx.moveTo(gyroCx + gyroR - 6, gyroCy);
    ctx.lineTo(gyroCx + gyroR + 4, gyroCy);
    ctx.stroke();

    ctx.save();
    ctx.translate(gyroCx, gyroCy);
    ctx.rotate(lander.angle);
    ctx.strokeStyle = attSafe ? COLORS.GREEN_BRIGHT : COLORS.RED_KLAXON;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(-gyroR + 8, 0);
    ctx.lineTo(-8, 0);
    ctx.lineTo(0, -9);
    ctx.lineTo(8, 0);
    ctx.lineTo(gyroR - 8, 0);
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    ctx.fillStyle = attSafe ? COLORS.GREEN_PRIMARY : COLORS.AMBER_CAUTION;
    ctx.fillText(`ATT ${pitchDeg >= 0 ? '+' : ''}${pitchDeg.toFixed(1)}°`, gyroCx, gyroCy + gyroR + 18);

    const windCx = x + w * 0.73;
    const windCy = y + 62;
    const windR = 42;
    const windCol = lander.inWindShear
      ? COLORS.RED_KLAXON
      : windKnots > 9
        ? COLORS.AMBER_CAUTION
        : COLORS.GREEN_PRIMARY;

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.arc(windCx, windCy, windR, 0, Math.PI * 2);
    ctx.stroke();

    if (windKnots > 0.4) {
      const wAng = Math.atan2(-lander.currentWindVy, lander.currentWindVx);
      const tipX = windCx + Math.cos(wAng) * (windR - 7);
      const tipY = windCy + Math.sin(wAng) * (windR - 7);
      const tailX = windCx - Math.cos(wAng) * (windR - 11);
      const tailY = windCy - Math.sin(wAng) * (windR - 11);

      ctx.strokeStyle = windCol;
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(wAng - 0.5) * 9, tipY - Math.sin(wAng - 0.5) * 9);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(wAng + 0.5) * 9, tipY - Math.sin(wAng + 0.5) * 9);
      ctx.stroke();
    } else {
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
      ctx.fillText('VACUUM', windCx, windCy + 5);
    }

    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    ctx.fillStyle = windCol;
    ctx.fillText(`WIND ${windKnots.toFixed(0)}KT`, windCx, windCy + windR + 18);

    // Extra Inertial & Terrain Slope Telemetry Footer
    const slopeAbs = Math.abs(lander.surfaceSlopeDeg);
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(`GRAV ${sector.gravity.toFixed(2)}`, x + 12, y + h - 9);
    ctx.textAlign = 'right';
    ctx.fillStyle = slopeAbs > 8 ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
    ctx.fillText(`SLOPE ${slopeAbs.toFixed(1)}°`, x + w - 12, y + h - 9);
    ctx.restore();
  }

  private findClosestTargetPad(
    lander: LanderState,
    pads: LandingPad[]
  ): { pad: LandingPad; dist: number } | null {
    let best: LandingPad | null = null;
    let bestDist = Infinity;
    for (const p of pads) {
      const cx = (p.x1 + p.x2) * 0.5;
      const dist = Math.hypot(lander.pos.x - cx, lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y - p.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    return best ? { pad: best, dist: bestDist } : null;
  }

  /**
   * Expanded Always-On Landing Pad Topography & Glide-Slope Mapping Window:
   * Renders local terrain cross-section around the target pad, safe glide-slope corridor,
   * live shuttle X/Y approach pip, and 4-channel GO/NO-GO avionics check!
   */
  private drawProximityApproachSubWindow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    boxH: number,
    sector: SectorConfig,
    lander: LanderState,
    pad: LandingPad,
    distM: number
  ): void {
    const inApproachGate = distM <= PHYSICS.APPROACH_PROXIMITY_M;
    ctx.save();
    ctx.fillStyle = 'rgba(3, 8, 5, 0.88)';
    ctx.fillRect(x, y, w, boxH);
    this.drawCornerBrackets(
      ctx,
      x,
      y,
      w,
      boxH,
      12,
      inApproachGate ? COLORS.AMBER_CAUTION : COLORS.GREEN_DIM,
      2.2
    );

    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    ctx.fillStyle = inApproachGate ? COLORS.AMBER_BRIGHT : COLORS.GREEN_PRIMARY;
    ctx.textAlign = 'left';
    const badge = pad.type === 'DEPOT' ? '+FUEL' : `${pad.multiplier}X`;
    ctx.fillText(`${inApproachGate ? 'PAD LOCK' : 'PAD MAP'} // ${pad.label} [${badge}]`, x + 10, y + 20);

    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.textAlign = 'right';
    ctx.fillText(`${distM.toFixed(0)}M`, x + w - 10, y + 20);

    const vs = Math.abs(Math.min(0, lander.vel.y));
    const hs = Math.abs(lander.vel.x);
    const padCenter = (pad.x1 + pad.x2) * 0.5;
    const padHalfW = (pad.x2 - pad.x1) * 0.5;
    const aligned = Math.abs(lander.pos.x - padCenter) + PHYSICS.STRUT_SPAN_HALF_X <= padHalfW + 0.85;
    const vsGo = vs <= PHYSICS.SAFE_VS_MAX;
    const hsGo = hs <= PHYSICS.SAFE_HS_MAX;

    const offsetM = lander.pos.x - padCenter;
    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText('PAD ALIGN:', x + 10, y + 40);
    ctx.fillStyle = aligned ? COLORS.GREEN_BRIGHT : COLORS.AMBER_CAUTION;
    ctx.fillText(
      `${offsetM >= 0 ? '+' : ''}${offsetM.toFixed(1)}M [${aligned ? 'LOCK' : 'OFFSET'}]`,
      x + 98,
      y + 40
    );

    // Live 2D Topographic Approach & Glide-Slope Map Window
    const mapX = x + 10;
    const mapY = y + 50;
    const mapW = w - 20;
    const mapH = Math.max(80, boxH - 60);

    ctx.fillStyle = 'rgba(2, 6, 3, 0.92)';
    ctx.fillRect(mapX, mapY, mapW, mapH);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(mapX, mapY, mapW, mapH);

    // Dynamic zoom inside Pad Map: wide +/-95m at long range, zooming to +/-32m inside 80m!
    const viewHalfX = inApproachGate ? 34 : 95;
    const viewMaxY = inApproachGate ? 85 : 185;

    const toMapX = (wx: number) =>
      mapX + mapW * Math.max(0.02, Math.min(0.98, 0.5 + (wx - padCenter) / (viewHalfX * 2)));
    const toMapY = (wy: number) =>
      mapY + mapH - 10 - (mapH - 16) * Math.max(-0.08, Math.min(0.96, (wy - pad.y) / viewMaxY));

    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX + 1, mapY + 1, mapW - 2, mapH - 2);
    ctx.clip();

    // Safe Glide-Slope Funnel V-Corridor rising from pad edges
    const pLeftX = toMapX(pad.x1);
    const pRightX = toMapX(pad.x2);
    const pBaseY = toMapY(pad.y);
    ctx.strokeStyle = 'rgba(59, 224, 104, 0.24)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(pLeftX, pBaseY);
    ctx.lineTo(toMapX(padCenter - viewHalfX * 0.65), mapY + 4);
    ctx.moveTo(pRightX, pBaseY);
    ctx.lineTo(toMapX(padCenter + viewHalfX * 0.65), mapY + 4);
    ctx.moveTo(toMapX(padCenter), pBaseY);
    ctx.lineTo(toMapX(padCenter), mapY + 4);
    ctx.stroke();
    ctx.setLineDash([]);

    // Local Terrain Cross-Section Silhouette around Pad
    ctx.strokeStyle = COLORS.GREEN_MID;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let started = false;
    for (const pt of sector.terrain) {
      if (pt.x < padCenter - viewHalfX * 1.15 || pt.x > padCenter + viewHalfX * 1.15) continue;
      const mx = toMapX(pt.x);
      const my = toMapY(pt.y);
      if (!started) {
        ctx.moveTo(mx, my);
        started = true;
      } else {
        ctx.lineTo(mx, my);
      }
    }
    ctx.stroke();

    // Glowing Pad Platform Bar on Map
    ctx.strokeStyle = COLORS.AMBER_BRIGHT;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(pLeftX, pBaseY);
    ctx.lineTo(pRightX, pBaseY);
    ctx.stroke();

    // Live Shuttle Pip + Velocity Vector inside Landing Map!
    const shipX = toMapX(lander.pos.x);
    const shipY = toMapY(lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y);
    const spanPx = Math.max(4, (PHYSICS.STRUT_SPAN_HALF_X / (viewHalfX * 2)) * mapW);

    // Velocity vector tail/nose inside mini-map
    const velEndX = toMapX(lander.pos.x + lander.vel.x * 2.5);
    const velEndY = toMapY(lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y + lander.vel.y * 2.5);
    ctx.strokeStyle = vsGo && hsGo ? COLORS.GREEN_PRIMARY : COLORS.AMBER_CAUTION;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(shipX, shipY);
    ctx.lineTo(velEndX, velEndY);
    ctx.stroke();

    ctx.strokeStyle = aligned && vsGo && hsGo ? COLORS.GREEN_BRIGHT : COLORS.AMBER_BRIGHT;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(shipX - spanPx, shipY);
    ctx.lineTo(shipX + spanPx, shipY);
    ctx.moveTo(shipX, shipY - 6);
    ctx.lineTo(shipX, shipY + 2);
    ctx.stroke();

    ctx.restore();
    ctx.restore();
  }

  /**
   * LARGE TOP-CENTER GO / NO-GO LANDING ENVELOPE HUD + CENTERLINE SOFT-KISS ILS BAR
   * Engages inside pad proximity (<= 90m) and remains visible upon landing/crash so
   * the pilot can review exact GO/KISS/NO-GO telemetry and Soft-Kiss centerline offset.
   */
  private drawTopGoNoGoHud(
    ctx: CanvasRenderingContext2D,
    w: number,
    layout: HudLayoutMetrics,
    pad: LandingPad,
    distM: number,
    vs: number,
    hs: number,
    deg: number,
    offsetM: number,
    lockedGrade: TouchdownSnapshot['grade'] | null,
    timeSec: number
  ): void {
    const cs = layout.centerScale;
    const basePanelW = 620;
    const basePanelH = 164;
    const cx = w * 0.5;
    const topY = layout.topHeaderY;

    const padHalfW = Math.max(1, (pad.x2 - pad.x1) * 0.5);
    const safeBoundM = Math.max(1.0, padHalfW - PHYSICS.STRUT_SPAN_HALF_X + 0.85);
    const kissBoundM = Math.min(padHalfW * 0.48, safeBoundM);

    const vsGo = vs <= PHYSICS.SAFE_VS_MAX;
    const vsKiss = vs < PHYSICS.KISS_VS_MAX;
    const vsFatal = vs > PHYSICS.SURVIVAL_VS_MAX;

    const hsGo = hs <= PHYSICS.SAFE_HS_MAX;
    const hsKiss = hs < PHYSICS.KISS_HS_MAX;
    const hsFatal = hs > PHYSICS.SURVIVAL_HS_MAX;

    const attGo = deg <= PHYSICS.SAFE_ANGLE_DEG;
    const attFatal = deg > PHYSICS.SURVIVAL_ANGLE_DEG;

    const inSafeAlign = Math.abs(offsetM) <= safeBoundM;
    const inKissAlign = Math.abs(offsetM) <= kissBoundM;

    const allGo = vsGo && hsGo && attGo && inSafeAlign;
    const allKiss = vsKiss && hsKiss && attGo && inKissAlign;
    const anyFatal = vsFatal || hsFatal || attFatal || (!inSafeAlign && lockedGrade === 'CATASTROPHIC');

    ctx.save();
    ctx.translate(cx - (basePanelW * cs) * 0.5, topY);
    ctx.scale(cs, cs);

    ctx.fillStyle = 'rgba(3, 9, 5, 0.94)';
    ctx.fillRect(0, 0, basePanelW, basePanelH);

    const frameCol =
      lockedGrade === 'CATASTROPHIC'
        ? COLORS.RED_KLAXON
        : lockedGrade === 'HARD_SURVIVAL'
          ? COLORS.AMBER_CAUTION
          : allGo
            ? COLORS.GREEN_PRIMARY
            : anyFatal
              ? COLORS.RED_KLAXON
              : COLORS.AMBER_CAUTION;
    this.drawCornerBrackets(ctx, 0, 0, basePanelW, basePanelH, 14, frameCol, 2.6);

    // Header Bar: Pad Lock + Master GO / NO-GO Status (Live or Locked Touchdown Review)
    const padTag = pad.type === 'DEPOT' ? '+FUEL DEPOT' : `${pad.multiplier}X`;
    ctx.textAlign = 'left';
    ctx.font = 'bold 15.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    const headerLeft = lockedGrade
      ? `TOUCHDOWN REPORT // ${pad.label} [${padTag}]`
      : `LANDING GATE // ${pad.label} [${padTag}] // ${distM.toFixed(0)}M`;
    ctx.fillText(headerLeft, 14, 21);

    ctx.textAlign = 'right';
    ctx.font = 'bold 16px "Share Tech Mono", monospace';
    const blink = lockedGrade ? 1.0 : 0.8 + 0.2 * Math.sin(timeSec * 12);
    ctx.globalAlpha = allGo ? 1 : blink;

    let rightStatus = '';
    if (lockedGrade === 'SOFT_KISS') {
      ctx.fillStyle = COLORS.GREEN_BRIGHT;
      rightStatus = '★ SOFT KISS ACHIEVED ★';
    } else if (lockedGrade === 'NOMINAL_SAFE') {
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      rightStatus = '● SAFE GO (OUTSIDE KISS) ●';
    } else if (lockedGrade === 'HARD_SURVIVAL') {
      ctx.fillStyle = COLORS.AMBER_CAUTION;
      rightStatus = '▲ HARD LANDING (CAUTION) ▲';
    } else if (lockedGrade === 'CATASTROPHIC') {
      ctx.fillStyle = COLORS.RED_KLAXON;
      rightStatus = '✖ HULL BREACH (NO-GO) ✖';
    } else {
      ctx.fillStyle = allGo
        ? COLORS.GREEN_BRIGHT
        : anyFatal
          ? COLORS.RED_KLAXON
          : COLORS.AMBER_BRIGHT;
      rightStatus = allKiss
        ? '★ SOFT KISS: GO ★'
        : allGo
          ? '● TOUCHDOWN: GO ●'
          : anyFatal
            ? '✖ TOUCHDOWN: NO-GO ✖'
            : '▲ TOUCHDOWN: CAUTION ▲';
    }
    ctx.fillText(rightStatus, basePanelW - 14, 21);
    ctx.globalAlpha = 1;

    // 3 Large Side-by-Side GO / CAUTION / NO-GO Criteria Modules
    const criteria = [
      {
        title: 'DESCENT V/S',
        valueStr: `${vs.toFixed(1)} M/S`,
        limitStr: `GO≤${PHYSICS.SAFE_VS_MAX.toFixed(1)} MAX≤${PHYSICS.SURVIVAL_VS_MAX.toFixed(1)}`,
        go: vsGo,
        kiss: vsKiss,
        fatal: vsFatal,
      },
      {
        title: 'DRIFT H/S',
        valueStr: `${hs.toFixed(1)} M/S`,
        limitStr: `GO≤${PHYSICS.SAFE_HS_MAX.toFixed(1)} MAX≤${PHYSICS.SURVIVAL_HS_MAX.toFixed(1)}`,
        go: hsGo,
        kiss: hsKiss,
        fatal: hsFatal,
      },
      {
        title: 'ATTITUDE',
        valueStr: `${deg.toFixed(1)}°`,
        limitStr: `GO≤${PHYSICS.SAFE_ANGLE_DEG.toFixed(0)}° MAX≤${PHYSICS.SURVIVAL_ANGLE_DEG.toFixed(1)}°`,
        go: attGo,
        kiss: attGo && deg <= 3.0,
        fatal: attFatal,
      },
    ];

    const gap = 10;
    const cardW = (basePanelW - 24 - gap * 2) / 3;
    const cardY = 29;
    const cardH = 62;

    criteria.forEach((c, idx) => {
      const cardX = 12 + idx * (cardW + gap);
      const col = c.go
        ? COLORS.GREEN_PRIMARY
        : c.fatal
          ? COLORS.RED_KLAXON
          : COLORS.AMBER_CAUTION;
      const brightCol = c.go
        ? COLORS.GREEN_BRIGHT
        : c.fatal
          ? '#FF7A66'
          : COLORS.AMBER_BRIGHT;

      ctx.fillStyle = c.go
        ? 'rgba(59, 224, 104, 0.12)'
        : c.fatal
          ? 'rgba(255, 51, 24, 0.17)'
          : 'rgba(255, 140, 0, 0.14)';
      ctx.fillRect(cardX, cardY, cardW, cardH);

      ctx.strokeStyle = col;
      ctx.lineWidth = 2.2;
      ctx.strokeRect(cardX, cardY, cardW, cardH);

      ctx.textAlign = 'left';
      ctx.font = 'bold 13px "Share Tech Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      ctx.fillText(c.title, cardX + 7, cardY + 17);

      ctx.textAlign = 'right';
      ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
      ctx.fillStyle = col;
      ctx.fillText(c.limitStr, cardX + cardW - 6, cardY + 17);

      ctx.textAlign = 'left';
      ctx.font = 'bold 20px "JetBrains Mono", monospace';
      ctx.fillStyle = brightCol;
      ctx.fillText(c.valueStr, cardX + 7, cardY + 49);

      const statusText = c.kiss ? 'KISS' : c.go ? 'GO' : c.fatal ? 'NO-GO' : 'CAUTION';
      const pillW = c.go ? 56 : c.fatal ? 68 : 82;
      const pillH = 25;
      const pillX = cardX + cardW - pillW - 6;
      const pillY = cardY + 29;

      ctx.fillStyle = col;
      ctx.fillRect(pillX, pillY, pillW, pillH);

      ctx.textAlign = 'center';
      ctx.font = c.go || c.fatal ? 'bold 16px "Share Tech Mono", monospace' : 'bold 15px "Share Tech Mono", monospace';
      ctx.fillStyle = '#030805';
      ctx.fillText(statusText, pillX + pillW * 0.5, pillY + 18);
    });

    // =====================================================================
    // HORIZONTAL ILS CENTERLINE INDICATOR (SHOWS EXACT "SOFT KISS" BOUNDARIES)
    // =====================================================================
    const ilsX = 12;
    const ilsW = basePanelW - 24;
    const ilsCaptionY = 109;
    const barY = 117;
    const barH = 34;
    const midBarX = ilsX + ilsW * 0.5;

    const maxRangeM = Math.max(15, padHalfW * 1.85);
    const toIlsX = (m: number) =>
      ilsX + ilsW * (0.5 + Math.max(-0.485, Math.min(0.485, m / (maxRangeM * 2))));

    // Top Caption for ILS Localizer
    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(`ILS CENTERLINE // SOFT KISS ZONE (±${kissBoundM.toFixed(1)}M)`, ilsX + 2, ilsCaptionY);

    ctx.textAlign = 'right';
    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    if (inKissAlign) {
      ctx.fillStyle = COLORS.GREEN_BRIGHT;
      ctx.fillText(
        `OFFSET ${offsetM >= 0 ? '+' : ''}${offsetM.toFixed(1)}M [ ★ SOFT KISS ALIGNED ★ ]`,
        ilsX + ilsW - 2,
        ilsCaptionY
      );
    } else if (inSafeAlign) {
      ctx.fillStyle = COLORS.AMBER_BRIGHT;
      ctx.fillText(
        `OFFSET ${offsetM >= 0 ? '+' : ''}${offsetM.toFixed(1)}M [ SAFE PAD — STEER ${offsetM > 0 ? '◄' : '►'} FOR KISS ]`,
        ilsX + ilsW - 2,
        ilsCaptionY
      );
    } else {
      ctx.fillStyle = COLORS.RED_KLAXON;
      ctx.fillText(
        `OFFSET ${offsetM >= 0 ? '+' : ''}${offsetM.toFixed(1)}M [ ▲ OFF PAD — STEER ${offsetM > 0 ? '◄◄' : '►►'} ▲ ]`,
        ilsX + ilsW - 2,
        ilsCaptionY
      );
    }

    // ILS Track Frame
    ctx.fillStyle = 'rgba(2, 6, 4, 0.96)';
    ctx.fillRect(ilsX, barY, ilsW, barH);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(ilsX, barY, ilsW, barH);

    // Outer Safe Strut Touchdown Zone (Safe GO Pad Span)
    const safeLeftX = toIlsX(-safeBoundM);
    const safeRightX = toIlsX(safeBoundM);
    ctx.fillStyle = 'rgba(255, 140, 0, 0.08)';
    ctx.fillRect(safeLeftX, barY + 2, safeRightX - safeLeftX, barH - 4);
    ctx.strokeStyle = COLORS.AMBER_DIM;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(safeLeftX, barY + 2);
    ctx.lineTo(safeLeftX, barY + barH - 2);
    ctx.moveTo(safeRightX, barY + 2);
    ctx.lineTo(safeRightX, barY + barH - 2);
    ctx.stroke();

    // Inner Highlighted "SOFT KISS" Centerline Window!
    const kissLeftX = toIlsX(-kissBoundM);
    const kissRightX = toIlsX(kissBoundM);
    ctx.fillStyle = inKissAlign ? 'rgba(59, 224, 104, 0.24)' : 'rgba(59, 224, 104, 0.14)';
    ctx.fillRect(kissLeftX, barY + 2, kissRightX - kissLeftX, barH - 4);

    // Bold Soft Kiss Gate Brackets [   KISS   ]
    ctx.strokeStyle = COLORS.GREEN_BRIGHT;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(kissLeftX + 6, barY + 3);
    ctx.lineTo(kissLeftX, barY + 3);
    ctx.lineTo(kissLeftX, barY + barH - 3);
    ctx.lineTo(kissLeftX + 6, barY + barH - 3);

    ctx.moveTo(kissRightX - 6, barY + 3);
    ctx.lineTo(kissRightX, barY + 3);
    ctx.lineTo(kissRightX, barY + barH - 3);
    ctx.lineTo(kissRightX - 6, barY + barH - 3);
    ctx.stroke();

    // Centerline 0.0M Bullseye Crosshair & Scale Ticks
    ctx.strokeStyle = COLORS.GREEN_PRIMARY;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(midBarX, barY + 2);
    ctx.lineTo(midBarX, barY + barH - 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.textAlign = 'right';
    ctx.fillText('PAD L', safeLeftX - 5, barY + 22);
    ctx.textAlign = 'left';
    ctx.fillText('PAD R', safeRightX + 5, barY + 22);

    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.textAlign = 'center';
    ctx.fillText('KISS', (kissLeftX + midBarX) * 0.5, barY + 13);
    ctx.fillText('KISS', (kissRightX + midBarX) * 0.5, barY + 13);

    // Live / Frozen Shuttle ILS Localizer Diamond Needle
    const bugX = toIlsX(offsetM);
    const bugY = barY + barH * 0.5 + 2;
    const bugCol = inKissAlign
      ? COLORS.GREEN_BRIGHT
      : inSafeAlign
        ? COLORS.AMBER_BRIGHT
        : COLORS.RED_KLAXON;

    ctx.fillStyle = bugCol;
    ctx.strokeStyle = '#030805';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bugX, bugY - 9);
    ctx.lineTo(bugX + 8, bugY);
    ctx.lineTo(bugX, bugY + 9);
    ctx.lineTo(bugX - 8, bugY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  /**
   * LARGE BOTTOM-CENTER AIRBUS AVIONICS WARNING BAR
   * Renders terse Airbus-style warnings ("SINK RATE", "PULL UP", "BANK ANGLE", "WIND SHEAR", etc.)
   * in large, unmistakable cockpit annunciator modules along the bottom of the visor.
   */
  private drawBottomAirbusWarnings(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    layout: HudLayoutMetrics,
    lander: LanderState,
    emBlackoutActive: boolean,
    activeVoiceText: string | null,
    timeSec: number
  ): void {
    const warnings = HudRenderer.computeAvionicsWarnings(lander, emBlackoutActive);
    if (warnings.length === 0 && !activeVoiceText) return;

    const cs = layout.centerScale;
    const cx = w * 0.5;
    const pulseAlpha = 0.78 + 0.22 * Math.sin(timeSec * 13);

    // Combine up to 2 primary Airbus warnings (or active GPWS voice callout if no visual warning)
    const displayItems: AvionicsWarningItem[] =
      warnings.length > 0
        ? warnings.slice(0, 2)
        : [{ text: activeVoiceText!.replace(/\.$/, ''), critical: true }];

    ctx.save();
    ctx.translate(cx, h - 24);
    ctx.scale(cs, cs);

    const pillGap = 14;
    const boxH = 46;
    ctx.font = 'bold 24px "Share Tech Mono", monospace';

    const widths = displayItems.map((it) => {
      const label = it.critical ? `▲ ${it.text} ▲` : `◆ ${it.text} ◆`;
      return Math.max(196, ctx.measureText(label).width + 40);
    });
    const totalW = widths.reduce((a, b) => a + b, 0) + pillGap * (displayItems.length - 1);

    let curX = -totalW * 0.5;
    const boxY = -boxH - 6;

    displayItems.forEach((it, idx) => {
      const bw = widths[idx];
      const col = it.critical ? COLORS.RED_KLAXON : COLORS.AMBER_CAUTION;
      const textCol = it.critical ? '#FF6B54' : COLORS.AMBER_BRIGHT;
      const label = it.critical ? `▲ ${it.text} ▲` : `◆ ${it.text} ◆`;

      ctx.globalAlpha = it.critical ? pulseAlpha : 0.94;
      ctx.fillStyle = it.critical ? 'rgba(28, 5, 4, 0.94)' : 'rgba(18, 12, 3, 0.94)';
      ctx.fillRect(curX, boxY, bw, boxH);

      ctx.strokeStyle = col;
      ctx.lineWidth = 3.0;
      ctx.strokeRect(curX, boxY, bw, boxH);

      ctx.strokeStyle = it.critical ? 'rgba(255, 51, 24, 0.45)' : 'rgba(255, 140, 0, 0.4)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(curX + 4, boxY + 4, bw - 8, boxH - 8);

      ctx.textAlign = 'center';
      ctx.fillStyle = textCol;
      ctx.fillText(label, curX + bw * 0.5, boxY + 30);

      curX += bw + pillGap;
    });

    ctx.restore();
  }

  private drawStatusToast(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    layout: HudLayoutMetrics,
    text: string
  ): void {
    const cs = layout.centerScale;
    ctx.save();
    ctx.translate(w * 0.5, h - Math.round(88 * cs));
    ctx.scale(cs, cs);

    ctx.font = 'bold 17px "Share Tech Mono", monospace';
    const tw = ctx.measureText(text).width + 40;
    const bx = -tw * 0.5;
    const by = -32;

    ctx.fillStyle = 'rgba(8, 19, 12, 0.94)';
    ctx.fillRect(bx, by, tw, 32);
    ctx.strokeStyle = COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(bx, by, tw, 32);
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.textAlign = 'center';
    ctx.fillText(text, 0, by + 22);
    ctx.restore();
  }

  private addButton(
    ctx: CanvasRenderingContext2D,
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    selected: boolean,
    hoveredId: string | null,
    accent: string = COLORS.GREEN_PRIMARY
  ): void {
    this.buttons.push({ id, rect: { x, y, width: w, height: h }, label });
    const active = selected || hoveredId === id;

    ctx.fillStyle = active ? 'rgba(54, 201, 94, 0.20)' : 'rgba(8, 19, 12, 0.90)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? accent : COLORS.GREEN_DIM;
    ctx.lineWidth = active ? 2.6 : 1.8;
    ctx.strokeRect(x, y, w, h);

    const rendered = active ? `> ${label} <` : label;
    let fontPx = 16.5;
    ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
    while (fontPx > 12.5 && ctx.measureText(rendered).width > w - 14) {
      fontPx -= 0.5;
      ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
    }
    ctx.fillStyle = active ? COLORS.GREEN_BRIGHT : accent;
    ctx.textAlign = 'center';
    ctx.fillText(rendered, x + w * 0.5, y + h * 0.5 + Math.round(fontPx * 0.34));
  }

  // =========================================================================
  // TERMINAL SCREENS: MENU, BRIEFING, TALLY, BREACH, CALLSIGN, LOGS
  // =========================================================================

  private formatMainMenuLeader(
    leader: CrewManifestEntry | null,
    status: 'LOADING' | 'LIVE' | 'OFFLINE'
  ): string {
    if (status === 'LOADING') return 'AWAITING UPLINK...';
    if (!leader) return status === 'OFFLINE' ? 'OFFLINE // UNCLAIMED' : 'UNCLAIMED';
    return `${leader.callsign} — ${leader.score.toLocaleString()} PTS (${leader.highestSector})`;
  }

  private getTitleMenuBoxRect(w: number, h: number): ViewportRect {
    const boxW = Math.min(768, Math.max(556, Math.floor(w * 0.485)));
    const boxH = Math.min(652, Math.max(556, h - 94));
    const bx = Math.round((w - boxW) * 0.5);
    const by = Math.round(Math.max(64, (h - boxH) * 0.5 + 8));
    return { x: bx, y: by, width: boxW, height: boxH };
  }

  private drawTitleMenu(
    ctx: CanvasRenderingContext2D,
    w: number,
    _h: number,
    state: HudRenderContext,
    menuBox: ViewportRect
  ): void {
    ctx.save();
    const { x: bx, y: by, width: boxW, height: boxH } = menuBox;
    const isRanked = state.selectedMenuMode === 'RANKED_CAMPAIGN';
    const isPractice = state.selectedMenuMode === 'PRACTICE';
    const isEndless = state.selectedMenuMode === 'ENDLESS';

    ctx.fillStyle = 'rgba(6, 16, 10, 0.95)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(
      ctx,
      bx,
      by,
      boxW,
      boxH,
      20,
      isRanked ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY,
      2.6
    );

    ctx.textAlign = 'center';
    ctx.font = 'bold 15px "Share Tech Mono", monospace';
    ctx.fillStyle = isRanked ? COLORS.AMBER_BRIGHT : COLORS.AMBER_CAUTION;
    ctx.fillText(
      isRanked
        ? '★ RANKED CAMPAIGN ARMED // ALL 6 SECTORS LOCKED // 3 SHUTTLES ★'
        : isPractice
          ? `PRACTICE MODE ARMED // SINGLE MAP: SEC-0${state.selectedStartSector} OF 06 (UNRANKED)`
          : 'ENDLESS DEEP-SURVEY ARMED // GLOBAL RANKED LEADERBOARD',
      w * 0.5,
      by + 26
    );

    // Header Title turns RED when Ranked Campaign is chosen!
    ctx.font = 'bold 34px "Share Tech Mono", monospace';
    ctx.fillStyle = isRanked ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY;
    ctx.fillText('ORBITAL DESCENT TELEMETRY', w * 0.5, by + 58);

    // =====================================================================
    // PROMINENT MU-TH-UR LIVE GLOBAL #01 REIGNING CHAMPIONS STRIP (#FFB000)
    // =====================================================================
    const stripX = bx + 20;
    const stripW = boxW - 40;
    const stripY = by + 70;
    const stripH = 58;

    ctx.fillStyle = 'rgba(22, 14, 3, 0.78)';
    ctx.fillRect(stripX, stripY, stripW, stripH);
    ctx.strokeStyle = '#FFB000';
    ctx.lineWidth = 2.0;
    ctx.strokeRect(stripX, stripY, stripW, stripH);

    ctx.font = 'bold 14.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText('CAMPAIGN LEADER:', stripX + 14, stripY + 23);
    ctx.fillText('ENDLESS LEADER:', stripX + 14, stripY + 46);

    ctx.fillStyle = '#FFB000';
    ctx.fillText(
      this.formatMainMenuLeader(state.campaignLeader, state.uplinkConnectionStatus),
      stripX + 182,
      stripY + 23
    );
    ctx.fillText(
      this.formatMainMenuLeader(state.endlessLeader, state.uplinkConnectionStatus),
      stripX + 182,
      stripY + 46
    );

    const btnW = boxW - 40;
    const btnX = w * 0.5 - btnW * 0.5;
    let curY = stripY + stripH + 10;

    // 1. Top Dedicated RANKED CAMPAIGN Button (turns all 6 maps orange & header red!)
    const rankedHov = state.hoveredButtonId === 'menu-select-ranked';
    this.buttons.push({
      id: 'menu-select-ranked',
      rect: { x: btnX, y: curY, width: btnW, height: 38 },
      label: 'RANKED CAMPAIGN (ALL 6 SECTORS)',
    });
    ctx.fillStyle = isRanked
      ? 'rgba(255, 108, 0, 0.28)'
      : rankedHov
        ? 'rgba(255, 140, 0, 0.16)'
        : 'rgba(8, 19, 12, 0.90)';
    ctx.fillRect(btnX, curY, btnW, 38);
    ctx.strokeStyle = isRanked ? COLORS.AMBER_BRIGHT : rankedHov ? COLORS.AMBER_CAUTION : COLORS.GREEN_DIM;
    ctx.lineWidth = isRanked ? 2.8 : 1.8;
    ctx.strokeRect(btnX, curY, btnW, 38);
    ctx.font = 'bold 16.5px "Share Tech Mono", monospace';
    ctx.fillStyle = isRanked ? COLORS.AMBER_BRIGHT : COLORS.AMBER_CAUTION;
    ctx.textAlign = 'center';
    ctx.fillText(
      isRanked
        ? '★ RANKED CAMPAIGN SELECTED (ALL 6 SECTORS // GLOBAL RANKED) ★'
        : 'RANKED CAMPAIGN (ALL 6 SECTORS // GLOBAL RANKED)',
      btnX + btnW * 0.5,
      curY + 25
    );
    curY += 44;

    // 2. PRACTICE MODE Button + 6-Map Sub-Selector Strip (SEC-01 .. SEC-06, including Map 1!)
    this.addButton(
      ctx,
      'menu-select-practice',
      btnX,
      curY,
      btnW,
      36,
      isPractice
        ? `PRACTICE MODE ACTIVE — SINGLE MAP: SEC-0${state.selectedStartSector} (UNRANKED)`
        : 'PRACTICE MODE — SUB-SELECT ANY SINGLE SECTOR (01–06)',
      isPractice,
      state.hoveredButtonId,
      COLORS.GREEN_BRIGHT
    );
    curY += 41;

    const subGap = 6;
    const subW = (btnW - subGap * 5) / 6;
    for (let sNum = 1; sNum <= 6; sNum++) {
      const sx = btnX + (sNum - 1) * (subW + subGap);
      const subId = `menu-map-sec-${sNum}`;
      const subSelected = isPractice && state.selectedStartSector === sNum;
      const subHov = state.hoveredButtonId === subId;
      this.buttons.push({
        id: subId,
        rect: { x: sx, y: curY, width: subW, height: 31 },
        label: `SEC-0${sNum}`,
      });

      ctx.fillStyle = subSelected
        ? 'rgba(59, 224, 104, 0.28)'
        : subHov
          ? 'rgba(59, 224, 104, 0.14)'
          : 'rgba(6, 15, 9, 0.88)';
      ctx.fillRect(sx, curY, subW, 31);
      ctx.strokeStyle = subSelected
        ? COLORS.GREEN_BRIGHT
        : subHov
          ? COLORS.GREEN_PRIMARY
          : COLORS.GREEN_DIM;
      ctx.lineWidth = subSelected ? 2.2 : 1.5;
      ctx.strokeRect(sx, curY, subW, 31);

      ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
      ctx.fillStyle = subSelected ? '#FFFFFF' : isPractice ? COLORS.GREEN_PRIMARY : COLORS.GREEN_MID;
      ctx.textAlign = 'center';
      ctx.fillText(`SEC-0${sNum}`, sx + subW * 0.5, curY + 21);
    }
    curY += 38;

    // 3. ENDLESS DEEP-SURVEY + GLOBAL LEADERBOARDS Row
    const endW = Math.floor(btnW * 0.62);
    const logW = btnW - endW - 8;
    this.addButton(
      ctx,
      'menu-select-endless',
      btnX,
      curY,
      endW,
      36,
      'ENDLESS DEEP-SURVEY (RANKED)',
      isEndless,
      state.hoveredButtonId,
      COLORS.GREEN_PRIMARY
    );
    this.addButton(
      ctx,
      'menu-logs',
      btnX + endW + 8,
      curY,
      logW,
      36,
      'LEADERBOARDS',
      false,
      state.hoveredButtonId,
      '#FFB000'
    );
    curY += 43;

    // 4. Prominent Orange [ COMMIT ] Button at Bottom to Confirm Selection!
    const commitHov = state.hoveredButtonId === 'menu-commit' || state.menuCursor === 3;
    const commitLabel = isRanked
      ? '[ COMMIT ] — LAUNCH RANKED 6-SECTOR CAMPAIGN'
      : isPractice
        ? `[ COMMIT ] — PRACTICE SEC-0${state.selectedStartSector} (RETURNS TO MENU)`
        : '[ COMMIT ] — LAUNCH ENDLESS DEEP-SURVEY';
    this.buttons.push({
      id: 'menu-commit',
      rect: { x: btnX, y: curY, width: btnW, height: 44 },
      label: commitLabel,
    });

    ctx.fillStyle = commitHov ? COLORS.AMBER_BRIGHT : COLORS.AMBER_CAUTION;
    ctx.fillRect(btnX, curY, btnW, 44);
    ctx.strokeStyle = '#FFF3CC';
    ctx.lineWidth = 2.6;
    ctx.strokeRect(btnX, curY, btnW, 44);

    let commitFont = 18;
    ctx.font = `bold ${commitFont}px "Share Tech Mono", monospace`;
    const fullCommit = `► ${commitLabel} ◄`;
    while (commitFont > 13.5 && ctx.measureText(fullCommit).width > btnW - 18) {
      commitFont -= 0.5;
      ctx.font = `bold ${commitFont}px "Share Tech Mono", monospace`;
    }
    ctx.fillStyle = '#040905';
    ctx.textAlign = 'center';
    ctx.fillText(fullCommit, btnX + btnW * 0.5, curY + 28);
    curY += 51;

    // =====================================================================
    // HIGH-LEGIBILITY FLIGHT DECK CONTROLS + SMART SAS EXPLANATION PANEL
    // =====================================================================
    const legY = curY;
    const legH = Math.max(150, boxH - (legY - by) - 12);
    const legX = bx + 20;
    const legW = boxW - 40;

    ctx.fillStyle = 'rgba(3, 10, 6, 0.88)';
    ctx.fillRect(legX, legY, legW, legH);
    ctx.strokeStyle = COLORS.GREEN_PRIMARY;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(legX, legY, legW, legH);

    ctx.font = 'bold 16px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.textAlign = 'left';
    ctx.fillText('FLIGHT DECK CONTROLS // PRESS [TAB] ANYTIME FOR SYSTEM MENU', legX + 12, legY + 21);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(legX + 12, legY + 28);
    ctx.lineTo(legX + legW - 12, legY + 28);
    ctx.stroke();

    const ctrlFontPx = legW < 590 ? 13.5 : 15.5;
    ctx.font = `bold ${ctrlFontPx}px "Share Tech Mono", monospace`;

    const leftControls: Array<[string, string]> = [
      ['[W / UP]', 'THRUST (+SHIFT: OVR)'],
      ['[A / D]', 'RCS ROLL THRUSTERS'],
      ['[S / DN]', 'RETRO-BRAKE ASSIST'],
      ['[SPACE]', '1X EMERGENCY PULSE'],
    ];
    const rightControls: Array<[string, string]> = [
      ['[MOUSE]', 'AIM SPOTLIGHT & RADAR'],
      ['[L-CLICK]', 'PING RADAR (3 CELLS)'],
      ['[SCROLL]', 'CAMERA ZOOM (1.0X–3.5X)'],
      ['[TAB]', '= MENU (CRT / PAUSE)'],
    ];

    const sasStripH = 34;
    const rowsAvailH = Math.max(84, legH - 36 - sasStripH - 10);
    const lineStep = Math.min(31, Math.max(21, Math.floor(rowsAvailH / 4)));
    const keyOffset = legW < 590 ? 78 : 90;
    const rightColX = legX + Math.floor(legW * 0.53);

    leftControls.forEach(([key, desc], i) => {
      const ry = legY + 49 + i * lineStep;
      ctx.fillStyle = '#FFB000';
      ctx.fillText(key, legX + 12, ry);
      ctx.fillStyle = '#44FF77';
      ctx.fillText(desc, legX + 12 + keyOffset, ry);
    });

    rightControls.forEach(([key, desc], i) => {
      const ry = legY + 49 + i * lineStep;
      ctx.fillStyle = '#FFB000';
      ctx.fillText(key, rightColX, ry);
      ctx.fillStyle = i === 3 ? '#FFD266' : '#44FF77';
      ctx.fillText(desc, rightColX + keyOffset, ry);
    });

    // Smart SAS Mode Explanation Strip right inside the Flight Controls Box!
    const sasY = legY + legH - sasStripH - 7;
    const sasOn = state.bezel.sasEnabled;
    ctx.fillStyle = sasOn ? 'rgba(22, 62, 34, 0.85)' : 'rgba(26, 18, 5, 0.85)';
    ctx.fillRect(legX + 10, sasY, legW - 20, sasStripH);
    ctx.strokeStyle = sasOn ? COLORS.GREEN_BRIGHT : COLORS.AMBER_CAUTION;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(legX + 10, sasY, legW - 20, sasStripH);

    const sasInfo = sasOn
      ? 'SAS [CURRENTLY ON]: 50% GENTLE ROLL INPUTS — HALF [A/D] AUTHORITY • NO AUTO-LEVEL'
      : 'SAS [OFF BY DEFAULT]: TOGGLE TOP-RIGHT FOR 50% GENTLE ROLL (LESS AUTHORITY • NO AUTO-LEVEL)';
    let sasFont = 14;
    ctx.font = `bold ${sasFont}px "Share Tech Mono", monospace`;
    while (sasFont > 11.5 && ctx.measureText(sasInfo).width > legW - 34) {
      sasFont -= 0.5;
      ctx.font = `bold ${sasFont}px "Share Tech Mono", monospace`;
    }
    ctx.fillStyle = sasOn ? '#66FF92' : '#FFD066';
    ctx.textAlign = 'center';
    ctx.fillText(sasInfo, legX + legW * 0.5, sasY + 22);

    ctx.restore();
  }

  private drawSectorBriefingOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    ctx.save();
    const boxW = Math.min(760, w - 64);
    const boxH = 336;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(8, 19, 12, 0.94)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.AMBER_CAUTION, 2.4);

    ctx.textAlign = 'left';
    ctx.font = 'bold 21.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText(
      `MU-TH-UR 6000 // ${state.sector.code}: ${state.sector.name}`,
      bx + 24,
      by + 36
    );

    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(state.sector.subtitle, bx + 24, by + 58);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(bx + 24, by + 70);
    ctx.lineTo(bx + boxW - 24, by + 70);
    ctx.stroke();

    ctx.font = 'bold 15.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    let rem = state.briefingProgressChars;
    state.sector.briefingLines.forEach((line, i) => {
      if (rem <= 0) return;
      const shown = line.slice(0, rem);
      rem -= line.length;
      ctx.fillText(`> ${shown}`, bx + 24, by + 104 + i * 32);
    });

    this.addButton(
      ctx,
      'briefing-launch',
      w * 0.5 - 195,
      by + boxH - 58,
      390,
      42,
      '[SPACE / ENTER] ENGAGE LATCH & DROP',
      true,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION
    );
    ctx.restore();
  }

  private drawSectorTallyOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    bd: SectorScoreBreakdown
  ): void {
    ctx.save();
    const layout = HudRenderer.computeLayoutMetrics(w, h);
    const minModalTop = layout.safeTopPx + 6;
    const boxW = Math.min(690, w - 64);
    const boxH = Math.min(404, Math.max(344, h - minModalTop - 16));
    const bx = (w - boxW) * 0.5;
    const by = Math.max(minModalTop, minModalTop + (h - minModalTop - boxH) * 0.5 - 4);

    ctx.fillStyle = 'rgba(8, 19, 12, 0.95)';
    ctx.fillRect(bx, by, boxW, boxH);
    const gradeColor =
      bd.grade === 'SOFT_KISS'
        ? COLORS.GREEN_BRIGHT
        : bd.grade === 'HARD_SURVIVAL'
          ? COLORS.AMBER_CAUTION
          : COLORS.GREEN_PRIMARY;
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, gradeColor, 2.4);

    ctx.textAlign = 'left';
    ctx.font = 'bold 21px "Share Tech Mono", monospace';
    ctx.fillStyle = gradeColor;
    const gradeBanner =
      bd.grade === 'SOFT_KISS'
        ? 'TOUCHDOWN CONFIRMED // PRECISION KISS LANDING'
        : bd.grade === 'HARD_SURVIVAL'
          ? 'SURVIVAL TOUCHDOWN // HULL & GEAR DAMAGED'
          : 'TOUCHDOWN CONFIRMED // EXTRACTION NOMINAL';
    ctx.fillText(gradeBanner, bx + 24, by + 36);

    ctx.font = 'bold 14.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(
      `V/S: ${bd.touchdownVs.toFixed(2)} M/S  |  H/S: ${bd.touchdownHs.toFixed(2)} M/S  |  ATT: ${bd.touchdownDeg.toFixed(1)}°  |  RATING: ${bd.accuracyRating} (${bd.accuracyPercent}%)`,
      bx + 24,
      by + 59
    );

    const anim = Math.max(0, Math.min(1, state.tallyAnimProgress));
    const rows: Array<[string, string, string]> = [
      [
        `EXTRACTION PAD [${bd.padLabel}]`,
        `${bd.basePadValue} × ${bd.padMultiplier}X`,
        `+${Math.round(bd.padScore * anim).toLocaleString()}`,
      ],
      [
        'REMAINING PROPELLANT RESERVE',
        `${bd.remainingFuelKg.toFixed(0)} KG × 15`,
        `+${Math.round(bd.fuelBonus * anim).toLocaleString()}`,
      ],
      [
        'PRECISION KISS-LANDING BONUS',
        bd.precisionKissBonus > 0 ? 'CENTERED / SOFT' : 'NONE',
        `+${Math.round(bd.precisionKissBonus * anim).toLocaleString()}`,
      ],
      [
        'NO-DAMAGE INTEGRITY BONUS',
        bd.noDamageBonus > 0 ? '100% HULL INTACT' : 'DAMAGE PENALTY',
        `+${Math.round(bd.noDamageBonus * anim).toLocaleString()}`,
      ],
      [
        'CONSECUTIVE SAFE DROP STREAK',
        `SUBTOTAL × ${bd.streakMultiplier}X`,
        `${bd.streakMultiplier}X`,
      ],
    ];

    rows.forEach(([title, formula, pts], i) => {
      const ry = by + 94 + i * 31;
      ctx.font = 'bold 15px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      ctx.fillText(title, bx + 24, ry);

      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText(formula, bx + boxW * 0.63, ry);

      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.AMBER_CAUTION;
      ctx.fillText(pts, bx + boxW - 24, ry);
    });

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(bx + 24, by + 254);
    ctx.lineTo(bx + boxW - 24, by + 254);
    ctx.stroke();

    ctx.font = 'bold 21px "Share Tech Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('SECTOR TELEMETRY SCORE', bx + 24, by + 284);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText(`+${Math.round(bd.sectorTotal * anim).toLocaleString()} PTS`, bx + boxW - 24, by + 284);

    ctx.font = 'bold 15.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      state.isPracticeRun
        ? 'PRACTICE TARGET EXTRACTED // RETURNING TO MAIN MENU'
        : `CUMULATIVE MISSION TOTAL: ${Math.round(state.missionScore).toLocaleString()} PTS`,
      bx + boxW - 24,
      by + 312
    );

    const isFinalCampaignSector =
      !state.sector.endlessMode && state.sector.index >= 6;
    this.addButton(
      ctx,
      'tally-next',
      w * 0.5 - 210,
      by + boxH - 56,
      420,
      42,
      state.isPracticeRun
        ? '[SPACE / ENTER] PRACTICE COMPLETE — MAIN MENU'
        : isFinalCampaignSector
          ? '[SPACE / ENTER] COMPLETE CAMPAIGN LOG'
          : '[SPACE / ENTER] PROCEED TO NEXT SECTOR',
      true,
      state.hoveredButtonId,
      state.isPracticeRun ? COLORS.AMBER_BRIGHT : COLORS.GREEN_PRIMARY
    );
    ctx.restore();
  }

  private drawHullBreachOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    ctx.save();
    const layout = HudRenderer.computeLayoutMetrics(w, h);
    const minModalTop = layout.safeTopPx + 8;
    const boxW = Math.min(690, w - 56);
    const boxH = 272;
    const bx = (w - boxW) * 0.5;
    const by = Math.max(minModalTop, minModalTop + (h - minModalTop - boxH) * 0.5 - 4);
    const isGameOver = state.lives <= 0;

    ctx.fillStyle = 'rgba(14, 7, 7, 0.94)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.RED_KLAXON, 2.6);

    ctx.textAlign = 'center';
    ctx.font = 'bold 24px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.RED_KLAXON;
    ctx.fillText(
      isGameOver
        ? 'GAME OVER // ALL 3 DROP-SHUTTLES LOST'
        : `HULL BREACH // SHUTTLE LOST — ${state.lives} REMAINING`,
      w * 0.5,
      by + 40
    );

    ctx.font = 'bold 15.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText(state.lastFailure?.reason ?? 'CATASTROPHIC STRUCTURAL IMPACT', w * 0.5, by + 74);

    if (state.lastFailure) {
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      ctx.fillText(
        `IMPACT — V/S: ${state.lastFailure.impactVs.toFixed(1)} M/S | H/S: ${state.lastFailure.impactHs.toFixed(1)} M/S | ATT: ${state.lastFailure.impactDeg.toFixed(1)}°`,
        w * 0.5,
        by + 104
      );
    }

    ctx.font = 'bold 14.5px "JetBrains Mono", monospace';
    ctx.fillStyle = isGameOver ? '#FFB000' : COLORS.GREEN_MID;
    ctx.fillText(
      isGameOver
        ? state.isPracticeRun
          ? `PRACTICE RUN ENDED ON ${state.sector.code} // RETURNING TO MAIN MENU`
          : `FINAL RUN SCORE: ${Math.round(state.missionScore).toLocaleString()} PTS // HIGHEST: ${state.highestSectorCode} // ACC: ${state.avgAccuracyRating} (${state.avgAccuracyPercent}%)`
        : `RUN SCORE PRESERVED: ${Math.round(state.missionScore).toLocaleString()} PTS // DROP STREAK RESET TO 1X`,
      w * 0.5,
      by + 136
    );

    if (isGameOver) {
      const canUplink = state.missionScore > 0 && !state.isPracticeRun;
      this.addButton(
        ctx,
        'breach-end',
        w * 0.5 - 235,
        by + boxH - 64,
        470,
        44,
        canUplink
          ? '[SPACE / ENTER] TRANSMIT SCORE TO GLOBAL MANIFEST'
          : '[SPACE / ENTER] RETURN TO MAIN MENU',
        true,
        state.hoveredButtonId,
        canUplink ? '#FFB000' : COLORS.GREEN_PRIMARY
      );
    } else {
      this.addButton(
        ctx,
        'breach-retry',
        bx + 24,
        by + boxH - 64,
        310,
        42,
        `[SPACE / R] REDEPLOY (${state.lives} LEFT)`,
        true,
        state.hoveredButtonId,
        COLORS.AMBER_CAUTION
      );
      this.addButton(
        ctx,
        'breach-end',
        bx + boxW - 308,
        by + boxH - 64,
        284,
        42,
        state.isPracticeRun ? '[Q] RETURN TO MENU' : '[Q] END RUN & UPLINK',
        false,
        state.hoveredButtonId,
        COLORS.GREEN_PRIMARY
      );
    }
    ctx.restore();
  }

  private drawPauseOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    ctx.save();
    const boxW = 520;
    const boxH = 336;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(8, 19, 12, 0.95)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 16, COLORS.GREEN_PRIMARY, 2.2);

    ctx.textAlign = 'center';
    ctx.font = 'bold 21.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText('MU-TH-UR 6000 // COMMAND INTERRUPT', w * 0.5, by + 38);

    this.addButton(
      ctx,
      'pause-resume',
      bx + 36,
      by + 68,
      448,
      42,
      '[ESC] RESUME DESCENT',
      state.menuCursor === 0,
      state.hoveredButtonId
    );
    this.addButton(
      ctx,
      'pause-osd',
      bx + 36,
      by + 122,
      448,
      42,
      '[TAB] TV SCREEN & AVIONICS OSD',
      state.menuCursor === 1,
      state.hoveredButtonId,
      COLORS.AMBER_BRIGHT
    );
    this.addButton(
      ctx,
      'pause-retry',
      bx + 36,
      by + 176,
      448,
      42,
      state.lives > 1
        ? '[R] JETTISON & REDEPLOY (-1 SHUTTLE)'
        : '[R] JETTISON LOCKED (FINAL SHUTTLE)',
      state.menuCursor === 2,
      state.hoveredButtonId,
      state.lives > 1 ? COLORS.AMBER_CAUTION : COLORS.RED_DIM
    );
    this.addButton(
      ctx,
      'pause-abort',
      bx + 36,
      by + 230,
      448,
      42,
      state.isPracticeRun ? '[Q] END PRACTICE & RETURN TO MENU' : '[Q] END RUN & TRANSMIT SCORE',
      state.menuCursor === 3,
      state.hoveredButtonId,
      COLORS.RED_KLAXON
    );

    ctx.restore();
  }

  /**
   * IN-GAME ON-SCREEN "TV SCREEN & AVIONICS ADJUSTMENTS" OSD MODAL
   *Rendered directly inside the CRT shader pipeline so every switch, raster bar,
   *and phosphor label receives authentic scanlines, grille, trails, and glass curvature.
   */
  private drawTvOsdModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    ctx.save();
    const inRun =
      state.phase === 'FLIGHT' ||
      state.phase === 'PAUSED' ||
      state.phase === 'SECTOR_BRIEFING';
    const extraRunH = inRun ? 58 : 0;

    const boxW = Math.min(700, w - 48);
    const boxH = Math.min(468 + extraRunH, h - 40);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(4, 11, 7, 0.97)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.AMBER_CAUTION, 2.6);

    ctx.textAlign = 'left';
    ctx.font = 'bold 21.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText('MU-TH-UR 6000 // SYSTEM & COMMAND MENU [TAB]', bx + 22, by + 34);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(bx + 22, by + 42);
    ctx.lineTo(bx + boxW - 22, by + 42);
    ctx.stroke();

    let contentTopY = by + 54;

    // Mission Command Actions when [TAB] = MENU is opened mid-flight!
    if (inRun) {
      const cmdGap = 10;
      const cmdW = (boxW - 44 - cmdGap * 2) / 3;
      this.addButton(
        ctx,
        'osd-resume',
        bx + 22,
        contentTopY,
        cmdW,
        36,
        '[TAB] RESUME FLIGHT',
        true,
        state.hoveredButtonId,
        COLORS.GREEN_BRIGHT
      );
      this.addButton(
        ctx,
        'osd-retry',
        bx + 22 + cmdW + cmdGap,
        contentTopY,
        cmdW,
        36,
        state.lives > 1 ? '[R] REDEPLOY (-1)' : 'JETTISON LOCKED',
        false,
        state.hoveredButtonId,
        state.lives > 1 ? COLORS.AMBER_CAUTION : COLORS.RED_DIM
      );
      this.addButton(
        ctx,
        'osd-abort',
        bx + 22 + (cmdW + cmdGap) * 2,
        contentTopY,
        cmdW,
        36,
        '[Q] END RUN / MENU',
        false,
        state.hoveredButtonId,
        COLORS.RED_KLAXON
      );

      contentTopY += 54;
    }

    // 1. TV Screen Curvature & Halation Bloom Adjustment (Stepped Retro TV OSD Bar + Presets)
    const crtPct = Math.round(state.bezel.crtIntensity * 100);
    ctx.font = 'bold 16px "Share Tech Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText('CRT TUBE CURVATURE & PHOSPHOR BLOOM', bx + 22, contentTopY + 14);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText(`INTENSITY: ${crtPct}%`, bx + boxW - 22, contentTopY + 14);

    // 10-Block TV OSD Raster Bar + [-10%] / [+10%] Buttons
    const barY = contentTopY + 22;
    this.addButton(
      ctx,
      'osd-crt-dec',
      bx + 22,
      barY,
      58,
      32,
      '-10%',
      false,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION
    );

    const barX = bx + 90;
    const barW = boxW - 180;
    const barH = 32;
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(barX, barY, barW, barH);

    const segs = 10;
    const segGap = 4;
    const segW = (barW - 12 - segGap * (segs - 1)) / segs;
    const litSegs = Math.round(state.bezel.crtIntensity * segs);
    for (let i = 0; i < segs; i++) {
      const sx = barX + 6 + i * (segW + segGap);
      const lit = i < litSegs;
      ctx.fillStyle = lit ? COLORS.AMBER_CAUTION : 'rgba(16, 61, 31, 0.45)';
      ctx.fillRect(sx, barY + 5, segW, barH - 10);
    }

    this.addButton(
      ctx,
      'osd-crt-inc',
      bx + boxW - 80,
      barY,
      58,
      32,
      '+10%',
      false,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION
    );

    // Quick TV Presets Row (0%, 25%, 50%, 75%, 100%)
    const presets = [
      { id: 'osd-crt-0', label: '0% FLAT', val: 0 },
      { id: 'osd-crt-25', label: '25%', val: 25 },
      { id: 'osd-crt-50', label: '50%', val: 50 },
      { id: 'osd-crt-75', label: '75%', val: 75 },
      { id: 'osd-crt-100', label: '100% TUBE', val: 100 },
    ];
    const presetGap = 8;
    const presetW = (boxW - 44 - presetGap * 4) / 5;
    const presetY = barY + 40;
    presets.forEach((pr, i) => {
      this.addButton(
        ctx,
        pr.id,
        bx + 22 + i * (presetW + presetGap),
        presetY,
        presetW,
        28,
        pr.label,
        Math.abs(crtPct - pr.val) <= 5,
        state.hoveredButtonId,
        COLORS.AMBER_BRIGHT
      );
    });

    // 2. Avionics & Audio Bus Hardware-Style On-Screen Toggles
    const rowStartY = presetY + 46;
    const rowStep = 50;
    const switches = [
      {
        id: 'osd-sas-toggle',
        name: 'SAS 50% GENTLE ROLL (NO AUTO-LEVEL)',
        status: state.bezel.sasEnabled ? '● ON [50% FORCE]' : '○ OFF [100% FORCE]',
        active: state.bezel.sasEnabled,
        accent: state.bezel.sasEnabled ? COLORS.GREEN_BRIGHT : COLORS.AMBER_CAUTION,
      },
      {
        id: 'osd-zoom-toggle',
        name: 'AUTO-ZOOM APPROACH (≤95M)',
        status: state.bezel.autoZoomEnabled ? '● ENGAGED [AUTO]' : '○ MANUAL SCROLL',
        active: state.bezel.autoZoomEnabled,
        accent: state.bezel.autoZoomEnabled ? COLORS.GREEN_BRIGHT : COLORS.AMBER_CAUTION,
      },
      {
        id: 'osd-mute-toggle',
        name: 'INTERCOM & AUDIO BUS',
        status: state.bezel.audioMuted ? '▲ BUS MUTED [OFF]' : '● BUS ACTIVE [ON]',
        active: !state.bezel.audioMuted,
        accent: state.bezel.audioMuted ? COLORS.RED_KLAXON : COLORS.GREEN_BRIGHT,
      },
      {
        id: 'osd-open-logs',
        name: 'MU-TH-UR CREW MANIFEST',
        status: 'VIEW GLOBAL LEADERBOARD',
        active: false,
        accent: COLORS.GREEN_PRIMARY,
      },
    ];

    switches.forEach((sw, idx) => {
      const sy = rowStartY + idx * rowStep;
      ctx.fillStyle = 'rgba(8, 22, 13, 0.72)';
      ctx.fillRect(bx + 22, sy, boxW - 44, 42);
      ctx.strokeStyle = COLORS.GREEN_DIM;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(bx + 22, sy, boxW - 44, 42);

      ctx.textAlign = 'left';
      ctx.font = 'bold 16px "Share Tech Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      ctx.fillText(sw.name, bx + 34, sy + 27);

      this.addButton(
        ctx,
        sw.id,
        bx + boxW - 268,
        sy + 4,
        234,
        34,
        sw.status,
        sw.active,
        state.hoveredButtonId,
        sw.accent
      );
    });

    this.addButton(
      ctx,
      'osd-close',
      w * 0.5 - 170,
      by + boxH - 48,
      340,
      38,
      '[TAB / ESC] CLOSE SYSTEM MENU',
      true,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION
    );

    ctx.restore();
  }

  private drawCampaignCompleteOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    ctx.save();
    const boxW = Math.min(690, w - 56);
    const boxH = 300;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(8, 19, 12, 0.96)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.GREEN_BRIGHT, 2.4);

    ctx.textAlign = 'center';
    ctx.font = 'bold 24px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('CAMPAIGN COMPLETE // ALL 6 SECTORS EXTRACTED', w * 0.5, by + 44);

    ctx.font = 'bold 17px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(
      `FINAL TELEMETRY SCORE: ${Math.round(state.missionScore).toLocaleString()} PTS // AVG ACC: ${state.avgAccuracyRating} (${state.avgAccuracyPercent}%)`,
      w * 0.5,
      by + 86
    );

    ctx.font = 'bold 14.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      state.isPracticeRun
        ? 'UNRANKED PRACTICE COMPLETION // RETURNING TO MAIN MENU'
        : 'USCSS NOSTROMO ORBITAL DOCKING COMPLETE // READY FOR GLOBAL MANIFEST UPLINK',
      w * 0.5,
      by + 122
    );

    this.addButton(
      ctx,
      'complete-manifest',
      bx + 28,
      by + boxH - 68,
      316,
      42,
      state.isPracticeRun ? '[ENTER] RETURN TO MAIN MENU' : '[ENTER] UPLINK GLOBAL SCORE',
      true,
      state.hoveredButtonId,
      '#FFB000'
    );
    this.addButton(
      ctx,
      'complete-endless',
      bx + boxW - 300,
      by + boxH - 68,
      272,
      42,
      'NEW ENDLESS RUN',
      false,
      state.hoveredButtonId,
      COLORS.GREEN_PRIMARY
    );
    ctx.restore();
  }

  private drawCallsignOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    ctx.save();
    const boxW = Math.min(680, w - 56);
    const boxH = 318;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;
    const modeLabel = state.endlessMode ? 'ENDLESS' : 'CAMPAIGN';
    const isDone =
      state.uplinkSubmitState === 'CONFIRMED' || state.uplinkSubmitState === 'OFFLINE_SAVED';
    const isSending = state.uplinkSubmitState === 'TRANSMITTING';

    ctx.fillStyle = 'rgba(6, 15, 9, 0.97)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, '#FFB000', 2.6);

    ctx.textAlign = 'center';
    ctx.font = 'bold 22px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(`MU-TH-UR 6000 // ${modeLabel} GLOBAL LEADERBOARD UPLINK`, w * 0.5, by + 38);

    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      `SCORE: ${Math.round(state.missionScore).toLocaleString()} PTS  |  SECTOR: ${state.highestSectorCode}  |  ACCURACY: ${state.avgAccuracyRating} (${state.avgAccuracyPercent}%)`,
      w * 0.5,
      by + 70
    );

    const inW = Math.min(440, boxW - 80);
    const inX = w * 0.5 - inW * 0.5;
    const inY = by + 96;
    ctx.fillStyle = 'rgba(2, 7, 4, 0.95)';
    ctx.fillRect(inX, inY, inW, 54);
    ctx.strokeStyle = isDone ? '#44FF77' : '#FFB000';
    ctx.lineWidth = 2.4;
    ctx.strokeRect(inX, inY, inW, 54);

    const blink = !isDone && !isSending && Math.sin(state.timeSec * 10) > 0 ? '_' : '';
    ctx.font = 'bold 26px "JetBrains Mono", monospace';
    ctx.fillStyle = isDone ? '#44FF77' : COLORS.AMBER_BRIGHT;
    ctx.fillText(`${state.callsignDraft}${blink}`, w * 0.5, inY + 36);

    ctx.font = 'bold 14.5px "JetBrains Mono", monospace';
    if (isDone && state.uplinkConfirmText) {
      ctx.fillStyle = '#44FF77';
      ctx.fillText(state.uplinkConfirmText, w * 0.5, by + 182);
    } else if (isSending) {
      ctx.fillStyle = '#FFB000';
      ctx.fillText('TRANSMITTING TELEMETRY PACKET TO MU-TH-UR RELAY...', w * 0.5, by + 182);
    } else {
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText('ENTER CALLSIGN (1–16 CHARS) & PRESS [ENTER] TO TRANSMIT', w * 0.5, by + 182);
    }

    if (isDone) {
      this.addButton(
        ctx,
        'callsign-finish',
        w * 0.5 - 190,
        by + boxH - 62,
        380,
        42,
        '[ENTER / SPACE] VIEW GLOBAL MANIFEST',
        true,
        state.hoveredButtonId,
        '#44FF77'
      );
    } else {
      this.addButton(
        ctx,
        'callsign-submit',
        bx + 44,
        by + boxH - 62,
        350,
        42,
        isSending ? 'UPLINKING...' : '[ENTER] TRANSMIT TO MU-TH-UR',
        true,
        state.hoveredButtonId,
        '#FFB000'
      );
      this.addButton(
        ctx,
        'callsign-skip',
        bx + boxW - 224,
        by + boxH - 62,
        180,
        42,
        '[ESC] SKIP',
        false,
        state.hoveredButtonId,
        COLORS.GREEN_MID
      );
    }
    ctx.restore();
  }

  private drawFlightLogsModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    ctx.save();
    const boxW = Math.min(840, w - 40);
    const boxH = Math.min(600, h - 36);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(5, 13, 8, 0.98)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.GREEN_PRIMARY, 2.4);

    ctx.textAlign = 'left';
    ctx.font = 'bold 21px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText('MU-TH-UR 6000 // PERSISTENT CREW MANIFEST', bx + 22, by + 33);

    // Live Firestore Uplink vs Local Archive Status Badge
    ctx.textAlign = 'right';
    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    if (state.uplinkConnectionStatus === 'LOADING') {
      ctx.fillStyle = '#FFB000';
      ctx.fillText('◌ SYNCING ORBITAL RELAY...', bx + boxW - 22, by + 33);
    } else if (state.manifestShowingArchive) {
      ctx.fillStyle = '#FFB000';
      ctx.fillText('[LOCAL / ARCHIVE FALLBACK]', bx + boxW - 22, by + 33);
    } else {
      ctx.fillStyle = '#44FF77';
      ctx.fillText('● LIVE GLOBAL TELEMETRY (TOP 15)', bx + boxW - 22, by + 33);
    }

    // Dual-Mode Switcher Tabs: [ CAMPAIGN MANIFEST ] vs [ ENDLESS DEEP-SURVEY MANIFEST ]
    const tabY = by + 46;
    const tabGap = 12;
    const tabW = (boxW - 44 - tabGap) * 0.5;
    this.addButton(
      ctx,
      'logs-tab-campaign',
      bx + 22,
      tabY,
      tabW,
      36,
      'CAMPAIGN MANIFEST',
      state.manifestTab === 'CAMPAIGN',
      state.hoveredButtonId,
      state.manifestTab === 'CAMPAIGN' ? '#FFB000' : COLORS.GREEN_PRIMARY
    );
    this.addButton(
      ctx,
      'logs-tab-endless',
      bx + 22 + tabW + tabGap,
      tabY,
      tabW,
      36,
      'ENDLESS DEEP-SURVEY MANIFEST',
      state.manifestTab === 'ENDLESS',
      state.hoveredButtonId,
      state.manifestTab === 'ENDLESS' ? '#FFB000' : COLORS.GREEN_PRIMARY
    );

    const headY = by + 102;
    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.textAlign = 'left';
    ctx.fillText('RNK', bx + 22, headY);
    ctx.fillText('CALLSIGN', bx + 84, headY);
    ctx.fillText('SECTOR', bx + 324, headY);
    ctx.fillText('ACCURACY', bx + 428, headY);
    ctx.fillText('DATE', bx + 558, headY);
    ctx.textAlign = 'right';
    ctx.fillText('SCORE', bx + boxW - 22, headY);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx + 22, headY + 8);
    ctx.lineTo(bx + boxW - 22, headY + 8);
    ctx.stroke();

    const availRowsH = boxH - 210;
    const maxRows = Math.min(15, Math.max(8, Math.floor(availRowsH / 24)));
    const rowStep = Math.min(25, Math.floor(availRowsH / maxRows));
    const playerTag = state.playerSavedCallsign.trim().toUpperCase();
    const recentRun =
      state.lastSubmittedRun && state.lastSubmittedRun.mode === state.manifestTab
        ? state.lastSubmittedRun
        : null;

    let matchedJustSubmittedIdx = -1;
    const visibleEntries = state.manifestEntries.slice(0, maxRows);
    if (recentRun) {
      if (recentRun.docId) {
        matchedJustSubmittedIdx = visibleEntries.findIndex((e) => e.id === recentRun.docId);
      }
      if (matchedJustSubmittedIdx === -1) {
        matchedJustSubmittedIdx = visibleEntries.findIndex(
          (e) =>
            e.callsign.toUpperCase() === recentRun.callsign.toUpperCase() &&
            e.score === recentRun.score &&
            e.sector === recentRun.sector
        );
      }
    }

    const pulseNew = 0.5 + 0.5 * Math.sin(state.timeSec * 8.5);

    visibleEntries.forEach((entry, idx) => {
      const ry = headY + 27 + idx * rowStep;
      const isJustSubmitted = idx === matchedJustSubmittedIdx;
      const isPlayer = playerTag.length > 0 && entry.callsign.toUpperCase() === playerTag;
      const isRank1 = idx === 0 && !entry.isArchiveFallback;

      if (isJustSubmitted) {
        // Unmistakable high-contrast pulsing Emerald/White row highlight for the JUST-SUBMITTED run!
        ctx.fillStyle = `rgba(68, 255, 119, ${(0.18 + pulseNew * 0.14).toFixed(3)})`;
        ctx.fillRect(bx + 16, ry - 17, boxW - 32, rowStep);
        ctx.strokeStyle = '#44FF77';
        ctx.lineWidth = 2.2;
        ctx.strokeRect(bx + 16, ry - 17, boxW - 32, rowStep);
      } else if (isPlayer) {
        ctx.fillStyle = 'rgba(255, 176, 0, 0.06)';
        ctx.fillRect(bx + 18, ry - 16, boxW - 36, rowStep - 2);
      }

      ctx.font = 'bold 15px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = isJustSubmitted
        ? '#FFFFFF'
        : isPlayer || isRank1
          ? '#FFB000'
          : COLORS.GREEN_PRIMARY;
      ctx.fillText(
        isJustSubmitted ? `►#${String(idx + 1).padStart(2, '0')}` : `#${String(idx + 1).padStart(2, '0')}`,
        isJustSubmitted ? bx + 18 : bx + 22,
        ry
      );
      ctx.fillText(entry.callsign, bx + 84, ry);

      // High-contrast "★ JUST ADDED" badge right next to the newly submitted callsign!
      if (isJustSubmitted) {
        const callW = ctx.measureText(entry.callsign).width;
        const badgeX = Math.min(bx + 216, bx + 92 + callW);
        const badgeW = 98;
        ctx.fillStyle = 'rgba(10, 44, 22, 0.96)';
        ctx.fillRect(badgeX, ry - 14, badgeW, 18);
        ctx.strokeStyle = '#44FF77';
        ctx.lineWidth = 1.6;
        ctx.strokeRect(badgeX, ry - 14, badgeW, 18);
        ctx.font = 'bold 12px "Share Tech Mono", monospace';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText('★ JUST ADDED', badgeX + badgeW * 0.5, ry - 1);
        ctx.font = 'bold 15px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#FFFFFF';
      }

      ctx.fillText(entry.highestSector, bx + 324, ry);
      ctx.fillText(`${entry.accuracyRating} (${entry.accuracyPercent}%)`, bx + 428, ry);
      ctx.fillStyle = isJustSubmitted
        ? '#7BFF9E'
        : isPlayer
          ? COLORS.AMBER_BRIGHT
          : COLORS.GREEN_MID;
      ctx.fillText(entry.isArchiveFallback ? 'ARCHIVE' : entry.date, bx + 558, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = isJustSubmitted
        ? '#FFFFFF'
        : isPlayer || isRank1
          ? '#FFB000'
          : COLORS.GREEN_BRIGHT;
      ctx.fillText(entry.score.toLocaleString(), bx + boxW - 22, ry);
    });

    const logY = by + boxH - 88;
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.beginPath();
    ctx.moveTo(bx + 22, logY);
    ctx.lineTo(bx + boxW - 22, logY);
    ctx.stroke();

    if (recentRun) {
      const dispRank =
        matchedJustSubmittedIdx >= 0 ? matchedJustSubmittedIdx + 1 : recentRun.rank;
      const rankTag = `#${String(dispRank).padStart(2, '0')}`;
      ctx.fillStyle = 'rgba(26, 78, 42, 0.55)';
      ctx.fillRect(bx + 22, logY + 6, boxW - 44, 26);
      ctx.strokeStyle = '#44FF77';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(bx + 22, logY + 6, boxW - 44, 26);

      ctx.textAlign = 'center';
      ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
      ctx.fillStyle = '#7BFF9E';
      ctx.fillText(
        `★ YOUR JUST-COMPLETED RUN: RANK ${rankTag} — ${recentRun.callsign} // ${recentRun.score.toLocaleString()} PTS (${recentRun.highestSector}) ★`,
        w * 0.5,
        logY + 24
      );
    } else {
      ctx.textAlign = 'left';
      ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_MID;
      const recent = state.sessionLogs[state.sessionLogs.length - 1] ?? 'ORBITAL TELEMETRY READY';
      ctx.fillText(`LOG> ${recent}`, bx + 22, logY + 23);
    }

    this.addButton(
      ctx,
      'logs-close',
      w * 0.5 - 165,
      by + boxH - 46,
      330,
      34,
      '[ESC / CLICK] CLOSE MANIFEST',
      true,
      state.hoveredButtonId
    );
    ctx.restore();
  }
}
