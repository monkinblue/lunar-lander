import { COLORS, PHYSICS } from '../constants';
import type {
  BezelState,
  CrewManifestEntry,
  GamePhase,
  LanderState,
  LandingEvaluation,
  LandingPad,
  SectorConfig,
  SectorScoreBreakdown,
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
  selectedStartSector: number;
  menuCursor: number;
  bootPoweredOn: boolean;
  crtWarmupProgress: number;
  bootProgressChars: number;
  briefingProgressChars: number;
  tallyAnimProgress: number;
  lastBreakdown: SectorScoreBreakdown | null;
  lastFailure: LandingEvaluation | null;
  activeCalloutText: string | null;
  activeCalloutTimer: number;
  statusBannerText: string | null;
  statusBannerTimer: number;
  callsignDraft: string;
  manifestEntries: readonly CrewManifestEntry[];
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

  public static computeLayoutMetrics(crtWidth: number, crtHeight: number): HudLayoutMetrics {
    const baseSideW = 308;
    const baseSideH = 584;
    const marginX = Math.max(10, Math.round(crtWidth * 0.012));
    const topHeaderY = 44;

    const scaleW = (crtWidth * 0.215) / baseSideW;
    const scaleH = (crtHeight - topHeaderY - 18) / baseSideH;
    const hudScale = Math.max(0.56, Math.min(1.26, Math.min(scaleW, scaleH)));

    const sidePanelW = Math.round(baseSideW * hudScale);
    const sidePanelH = Math.round(baseSideH * hudScale);
    const safeLeftPx = marginX + sidePanelW + 14;
    const safeRightPx = crtWidth - marginX - sidePanelW - 14;
    const safeWidthPx = Math.max(180, safeRightPx - safeLeftPx);

    const centerScale = Math.max(0.66, Math.min(1.24, Math.min(safeWidthPx / 565, hudScale * 1.05)));
    const safeTopPx = topHeaderY + Math.round(108 * centerScale);
    const safeBottomPx = crtHeight - Math.round(74 * centerScale);
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

  public static computeAvionicsWarnings(lander: LanderState): AvionicsWarningItem[] {
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

    if (lander.agl < 28 && Math.abs(lander.vel.x) > 1.65) {
      alerts.push({
        text: 'LATERAL DRIFT',
        critical: lander.agl < 15 && Math.abs(lander.vel.x) > 2.4,
      });
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
    const w = state.width;
    const h = state.height;

    this.drawOuterFrame(ctx, w, h, state);

    if (state.phase === 'BOOT') {
      this.drawBootScreen(ctx, w, h, state);
    } else if (state.phase === 'TITLE_MENU') {
      this.drawTitleMenu(ctx, w, h, state);
    } else if (state.phase === 'SECTOR_BRIEFING') {
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

    if (state.bezel.flightLogsOpen) {
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
    const pad = 12;
    this.drawCornerBrackets(ctx, pad, pad, w - pad * 2, h - pad * 2, 22, COLORS.GREEN_DIM, 2.2);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(pad + 24, pad + 30);
    ctx.lineTo(w - pad - 24, pad + 30);
    ctx.stroke();

    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.textAlign = 'left';
    ctx.fillText('INTERFACE 2037 // NOSTROMO TELEMETRY', pad + 12, pad + 21);

    ctx.textAlign = 'center';
    if (state.phase !== 'BOOT' && state.phase !== 'TITLE_MENU') {
      ctx.fillStyle = COLORS.AMBER_CAUTION;
      ctx.fillText(`${state.sector.code} // ${state.sector.name}`, w * 0.46, pad + 21);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText(
      `SCORE ${Math.round(state.displayedScore).toLocaleString()} [${Math.max(1, state.dropStreak)}X]`,
      w - pad - 12,
      pad + 21
    );

    if (state.bootPoweredOn) {
      const regSeed = Math.floor(state.timeSec * 6);
      const hexA = ((regSeed * 4919) & 0xffff).toString(16).toUpperCase().padStart(4, '0');
      const hexB = ((regSeed * 7907) & 0xff).toString(16).toUpperCase().padStart(2, '0');
      const pulseBits = regSeed % 2 === 0 ? '[||||..||]' : '[||.||||.]';
      ctx.textAlign = 'left';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_DIM;
      ctx.fillText(`MU-TH-UR 6000 // BUS ${hexA}:${hexB} ${pulseBits} // ORD-937`, pad + 12, h - pad - 6);
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
    const baseW = 308;
    const baseH = 584;
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
    ctx.font = 'bold 18px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('FLIGHT DATA', 14, 24);

    ctx.strokeStyle = COLORS.GREEN_PRIMARY;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(14, 31);
    ctx.lineTo(baseW - 14, 31);
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

    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    dataRows.forEach((row, idx) => {
      const ty = 50 + idx * 19;
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText(row.label, 14, ty);

      ctx.textAlign = 'right';
      ctx.fillStyle = row.color;
      ctx.fillText(row.val, baseW - 14, ty);
    });

    // 2. Chunky Circular Golden-Orange Gauges + Stepped Vertical Green Vernier Scale
    const gaugesTopY = 182;
    const leftColCx = Math.round(baseW * 0.28);
    const rightColCx = Math.round(baseW * 0.74);
    const dialR = 40;
    const rowStep = 116;

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
    ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    const sysBroken = lander.strutDamaged || lander.rcsDamaged;
    ctx.fillStyle = sysBroken ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY;
    const sysTxt = sysBroken
      ? `HULL ${Math.round(lander.hullIntegrity)}% // ${lander.strutDamaged ? 'GEAR-DMG ' : ''}${lander.rcsDamaged ? 'RCS-DMG' : ''}`
      : `HULL ${Math.round(lander.hullIntegrity)}% // ${state.bezel.sasEnabled ? 'SAS ON' : 'MANUAL'} // ${state.cameraZoom.toFixed(1)}X`;
    ctx.fillText(sysTxt, baseW * 0.5, baseH - 12);
    ctx.restore();

    // ---------------------------------------------------------------------
    // LEFT TACTICAL STACK (WINDOW-SCALED):
    // 1) GIANT MISSION SCORE + [SPACE] 1X GAME PULSE + 3 RADAR PING CELLS
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
      state.sectorElapsedSec,
      lander,
      state.timeSec
    );

    this.drawAttitudeAndWindPod(ctx, 0, 172, baseW, lander, sector, windKnots);

    if (targetPadInfo && lander.alive && (state.phase === 'FLIGHT' || state.phase === 'PAUSED')) {
      this.drawProximityApproachSubWindow(
        ctx,
        0,
        346,
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
    // NEW LARGE TOP-CENTER GO / NO-GO APPROACH HUD (WHEN IN PAD PROXIMITY)
    // ---------------------------------------------------------------------
    if (
      targetPadInfo &&
      targetPadInfo.dist <= PHYSICS.APPROACH_PROXIMITY_M &&
      lander.alive &&
      (state.phase === 'FLIGHT' || state.phase === 'PAUSED')
    ) {
      this.drawTopGoNoGoHud(
        ctx,
        w,
        layout,
        lander,
        targetPadInfo.pad,
        targetPadInfo.dist,
        state.timeSec
      );
    }

    // ---------------------------------------------------------------------
    // NEW LARGE BOTTOM-CENTER AIRBUS AVIONICS WARNING BAR
    // ---------------------------------------------------------------------
    this.drawBottomAirbusWarnings(
      ctx,
      w,
      h,
      layout,
      lander,
      state.activeCalloutText && state.activeCalloutTimer > 0 ? state.activeCalloutText : null,
      state.timeSec
    );

    if (state.statusBannerText && state.statusBannerTimer > 0) {
      this.drawStatusToast(ctx, w, h, layout, state.statusBannerText);
    }

    ctx.restore();
  }

  /**
   * Dedicated High-Visibility MISSION SCORE Display & Tactile Cassette-Futurism
   * SONAR SURVEY CELLS Cartridge Rack (tracks discrete radar sweeps clearly!).
   */
  private drawScoreAndRadarRack(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    displayedScore: number,
    dropStreak: number,
    sectorElapsedSec: number,
    lander: LanderState,
    timeSec: number
  ): void {
    const h = 164;
    ctx.save();
    ctx.fillStyle = 'rgba(3, 8, 5, 0.88)';
    ctx.fillRect(x, y, w, h);
    this.drawCornerBrackets(ctx, x, y, w, h, 14, COLORS.GREEN_DIM, 2.4);

    // Top Row: Giant Prominent MISSION SCORE + STREAK Badge
    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText('MISSION TELEMETRY SCORE', x + 14, y + 22);

    const streak = Math.max(1, dropStreak);
    ctx.textAlign = 'right';
    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    ctx.fillStyle = streak > 1 ? COLORS.AMBER_BRIGHT : COLORS.GREEN_PRIMARY;
    ctx.fillText(`STREAK ${streak}X`, x + w - 14, y + 22);

    // Big Bold 32px Nostromo Tabular Score Readout
    ctx.textAlign = 'left';
    ctx.font = 'bold 32px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    const scoreText = Math.round(displayedScore).toString().padStart(7, '0');
    ctx.fillText(scoreText, x + 14, y + 56);

    // Mission Elapsed Time (MET) + Delta-V / Flow
    const mins = Math.floor(sectorElapsedSec / 60);
    const secs = sectorElapsedSec % 60;
    const metStr = `MET ${String(mins).padStart(2, '0')}:${secs.toFixed(1).padStart(4, '0')}`;
    ctx.textAlign = 'right';
    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(metStr, x + w - 14, y + 53);

    const totalMass = lander.dryMassKg + lander.fuelKg;
    const vExhaust = PHYSICS.MAIN_THRUST_N / PHYSICS.MAIN_BURN_RATE_KG_S;
    const deltaV = vExhaust * Math.log(totalMass / lander.dryMassKg);
    const burnMult = lander.throttle > 1 ? PHYSICS.OVERDRIVE_BURN_PENALTY : 1;
    const flowKgS =
      lander.throttle * PHYSICS.MAIN_BURN_RATE_KG_S * burnMult +
      (lander.retroActive ? PHYSICS.RETRO_BURN_RATE_KG_S : 0) +
      (lander.rcsLeftActive || lander.rcsRightActive ? PHYSICS.RCS_BURN_RATE_KG_S : 0);

    ctx.textAlign = 'left';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(`ΔV ${deltaV.toFixed(0)} M/S`, x + 14, y + 77);
    ctx.textAlign = 'right';
    ctx.fillStyle = flowKgS > 9 ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
    ctx.fillText(`FLOW ${flowKgS.toFixed(1)} KG/S`, x + w - 14, y + 77);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x + 14, y + 86);
    ctx.lineTo(x + w - 14, y + 86);
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
    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = pulseFiring
      ? '#FFFFFF'
      : pulseArmed
        ? COLORS.AMBER_BRIGHT
        : COLORS.RED_KLAXON;
    ctx.fillText('[SPACE] 1X GAME PULSE', x + 14, y + 104);

    const pBoxX = x + 14;
    const pBoxY = y + 112;
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
    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillStyle = pulseFiring
      ? '#FFFFFF'
      : pulseArmed
        ? COLORS.AMBER_BRIGHT
        : COLORS.RED_KLAXON;
    ctx.fillText(
      pulseFiring ? '>> FIRING <<' : pulseArmed ? 'ARMED [1/GAME]' : 'EXPENDED',
      pBoxX + pBoxW * 0.5,
      pBoxY + 24
    );

    // 2. Right Box: [L-CLICK] 3 RADAR PING CELLS
    const maxCells = Math.max(1, lander.maxRadarCharges);
    const remCells = lander.radarCharges;
    const lowCells = remCells <= 1;

    ctx.textAlign = 'left';
    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = remCells === 0 ? COLORS.RED_KLAXON : lowCells ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
    ctx.fillText('RADAR [L-CLK]', splitX + 4, y + 104);

    ctx.textAlign = 'right';
    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillText(`${remCells}/${maxCells}`, x + w - 14, y + 104);

    const rackX = splitX + 4;
    const rackW = x + w - 14 - rackX;
    const rackY = y + 112;
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
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_BRIGHT;
      ctx.fillText(`GEN ${Math.round(lander.sensorCapacitor)}%`, rackX + rackW * 0.5, rackY + 25);
    }

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
    ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
    ctx.fillStyle = activeCol;
    ctx.fillText(label, cx, cy + r + 13);

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText(subValue, cx, cy + r + 26);
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
    ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
    ctx.fillStyle = activeCol;
    ctx.fillText(label, cx, cy + r + 14);
    if (subValue) {
      ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
      ctx.fillStyle = COLORS.AMBER_BRIGHT;
      ctx.fillText(subValue, cx, cy + r + 26);
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
    const ladderTop = topY + 20;
    const ladderH = totalH - 42;
    const ladderBot = ladderTop + ladderH;
    const colHalfW = 5.5;

    ctx.textAlign = 'center';
    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(topLabel, cx, topY + 12);

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
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.fillStyle = COLORS.GREEN_BRIGHT;
        ctx.textAlign = 'right';
        ctx.fillText('80', cx - colHalfW - rungSpan - 4, ry + 4);
        ctx.textAlign = 'left';
        ctx.fillText('80', cx + colHalfW + rungSpan + 4, ry + 4);
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
    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillStyle = aglMeters < 25 ? COLORS.AMBER_BRIGHT : COLORS.GREEN_BRIGHT;
    ctx.fillText(`${aglMeters.toFixed(1)}M`, cx, topY + totalH - 4);
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
    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = attSafe ? COLORS.GREEN_PRIMARY : COLORS.AMBER_CAUTION;
    ctx.fillText(`ATT ${pitchDeg >= 0 ? '+' : ''}${pitchDeg.toFixed(1)}°`, gyroCx, gyroCy + gyroR + 16);

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
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.fillText('VACUUM', windCx, windCy + 4);
    }

    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = windCol;
    ctx.fillText(`WIND ${windKnots.toFixed(0)}KT`, windCx, windCy + windR + 16);

    // Extra Inertial & Terrain Slope Telemetry Footer
    const slopeAbs = Math.abs(lander.surfaceSlopeDeg);
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(`GRAV ${sector.gravity.toFixed(2)}`, x + 12, y + h - 10);
    ctx.textAlign = 'right';
    ctx.fillStyle = slopeAbs > 8 ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
    ctx.fillText(`SLOPE ${slopeAbs.toFixed(1)}°`, x + w - 12, y + h - 10);
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

    ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
    ctx.fillStyle = inApproachGate ? COLORS.AMBER_BRIGHT : COLORS.GREEN_PRIMARY;
    ctx.textAlign = 'left';
    const badge = pad.type === 'DEPOT' ? '+FUEL' : `${pad.multiplier}X`;
    ctx.fillText(`${inApproachGate ? 'PAD LOCK' : 'PAD MAP'} // ${pad.label} [${badge}]`, x + 10, y + 19);

    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.textAlign = 'right';
    ctx.fillText(`${distM.toFixed(0)}M`, x + w - 10, y + 19);

    const vs = Math.abs(Math.min(0, lander.vel.y));
    const hs = Math.abs(lander.vel.x);
    const padCenter = (pad.x1 + pad.x2) * 0.5;
    const padHalfW = (pad.x2 - pad.x1) * 0.5;
    const aligned = Math.abs(lander.pos.x - padCenter) + PHYSICS.STRUT_SPAN_HALF_X <= padHalfW + 0.85;
    const vsGo = vs <= PHYSICS.SAFE_VS_MAX;
    const hsGo = hs <= PHYSICS.SAFE_HS_MAX;

    const offsetM = lander.pos.x - padCenter;
    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText('PAD ALIGN:', x + 10, y + 38);
    ctx.fillStyle = aligned ? COLORS.GREEN_BRIGHT : COLORS.AMBER_CAUTION;
    ctx.fillText(
      `${offsetM >= 0 ? '+' : ''}${offsetM.toFixed(1)}M [${aligned ? 'LOCK' : 'OFFSET'}]`,
      x + 86,
      y + 38
    );

    // Live 2D Topographic Approach & Glide-Slope Map Window
    const mapX = x + 10;
    const mapY = y + 48;
    const mapW = w - 20;
    const mapH = Math.max(80, boxH - 58);

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
   * NEW LARGE TOP-CENTER GO / NO-GO LANDING ENVELOPE HUD
   * Automatically engages when within pad proximity (<= 90m) and displays the 3 core
   * touchdown GO / NO-GO criteria (DESCENT V/S, DRIFT H/S, ATTITUDE) in bold illuminated cards.
   */
  private drawTopGoNoGoHud(
    ctx: CanvasRenderingContext2D,
    w: number,
    layout: HudLayoutMetrics,
    lander: LanderState,
    pad: LandingPad,
    distM: number,
    timeSec: number
  ): void {
    const cs = layout.centerScale;
    const basePanelW = 548;
    const basePanelH = 98;
    const cx = w * 0.5;
    const topY = layout.topHeaderY;

    const vs = Math.abs(Math.min(0, lander.vel.y));
    const hs = Math.abs(lander.vel.x);
    const deg = Math.abs((lander.angle * 180) / Math.PI);

    const vsGo = vs <= PHYSICS.SAFE_VS_MAX;
    const vsKiss = vs < PHYSICS.KISS_VS_MAX;
    const vsFatal = vs > PHYSICS.SURVIVAL_VS_MAX;

    const hsGo = hs <= PHYSICS.SAFE_HS_MAX;
    const hsKiss = hs < PHYSICS.KISS_HS_MAX;
    const hsFatal = hs > PHYSICS.SURVIVAL_HS_MAX;

    const attGo = deg <= PHYSICS.SAFE_ANGLE_DEG;
    const attFatal = deg > PHYSICS.SURVIVAL_ANGLE_DEG;

    const allGo = vsGo && hsGo && attGo;
    const allKiss = vsKiss && hsKiss && attGo;
    const anyFatal = vsFatal || hsFatal || attFatal;

    ctx.save();
    ctx.translate(cx - (basePanelW * cs) * 0.5, topY);
    ctx.scale(cs, cs);

    ctx.fillStyle = 'rgba(3, 9, 5, 0.92)';
    ctx.fillRect(0, 0, basePanelW, basePanelH);

    const frameCol = allGo
      ? COLORS.GREEN_PRIMARY
      : anyFatal
        ? COLORS.RED_KLAXON
        : COLORS.AMBER_CAUTION;
    this.drawCornerBrackets(ctx, 0, 0, basePanelW, basePanelH, 14, frameCol, 2.6);

    // Header Bar: Pad Lock + Master GO / NO-GO Status
    const padTag = pad.type === 'DEPOT' ? '+FUEL DEPOT' : `${pad.multiplier}X`;
    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText(`LANDING GATE // ${pad.label} [${padTag}] // ${distM.toFixed(0)}M`, 14, 20);

    ctx.textAlign = 'right';
    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    const blink = 0.8 + 0.2 * Math.sin(timeSec * 12);
    ctx.globalAlpha = allGo ? 1 : blink;
    ctx.fillStyle = allGo
      ? COLORS.GREEN_BRIGHT
      : anyFatal
        ? COLORS.RED_KLAXON
        : COLORS.AMBER_BRIGHT;
    ctx.fillText(
      allKiss
        ? '★ SOFT KISS: GO ★'
        : allGo
          ? '● TOUCHDOWN: GO ●'
          : '▲ TOUCHDOWN: NO-GO ▲',
      basePanelW - 14,
      20
    );
    ctx.globalAlpha = 1;

    // 3 Large Side-by-Side GO / NO-GO Criteria Modules
    const criteria = [
      {
        title: 'DESCENT V/S',
        valueStr: `${vs.toFixed(1)} M/S`,
        limitStr: `MAX ${PHYSICS.SAFE_VS_MAX.toFixed(1)}`,
        go: vsGo,
        kiss: vsKiss,
        fatal: vsFatal,
      },
      {
        title: 'DRIFT H/S',
        valueStr: `${hs.toFixed(1)} M/S`,
        limitStr: `MAX ${PHYSICS.SAFE_HS_MAX.toFixed(1)}`,
        go: hsGo,
        kiss: hsKiss,
        fatal: hsFatal,
      },
      {
        title: 'ATTITUDE',
        valueStr: `${deg.toFixed(1)}°`,
        limitStr: `MAX ${PHYSICS.SAFE_ANGLE_DEG.toFixed(0)}°`,
        go: attGo,
        kiss: false,
        fatal: attFatal,
      },
    ];

    const gap = 10;
    const cardW = (basePanelW - 24 - gap * 2) / 3;
    const cardY = 28;
    const cardH = 60;

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
          ? 'rgba(255, 51, 24, 0.16)'
          : 'rgba(255, 140, 0, 0.14)';
      ctx.fillRect(cardX, cardY, cardW, cardH);

      ctx.strokeStyle = col;
      ctx.lineWidth = 2.2;
      ctx.strokeRect(cardX, cardY, cardW, cardH);

      // Criterion Title & Limit on Top Row
      ctx.textAlign = 'left';
      ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText(c.title, cardX + 8, cardY + 16);

      ctx.textAlign = 'right';
      ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
      ctx.fillStyle = col;
      ctx.fillText(c.limitStr, cardX + cardW - 8, cardY + 16);

      // Large Live Numeric Value on Bottom-Left
      ctx.textAlign = 'left';
      ctx.font = 'bold 18px "JetBrains Mono", monospace';
      ctx.fillStyle = brightCol;
      ctx.fillText(c.valueStr, cardX + 8, cardY + 46);

      // Large Bold GO / NO-GO Pill on Bottom-Right
      const statusText = c.kiss ? 'KISS' : c.go ? 'GO' : 'NO-GO';
      const pillW = c.go ? 52 : 64;
      const pillH = 24;
      const pillX = cardX + cardW - pillW - 7;
      const pillY = cardY + 28;

      ctx.fillStyle = col;
      ctx.fillRect(pillX, pillY, pillW, pillH);

      ctx.textAlign = 'center';
      ctx.font = 'bold 15px "Share Tech Mono", monospace';
      ctx.fillStyle = '#030805';
      ctx.fillText(statusText, pillX + pillW * 0.5, pillY + 17.5);
    });

    ctx.restore();
  }

  /**
   * NEW LARGE BOTTOM-CENTER AIRBUS AVIONICS WARNING BAR
   * Renders terse Airbus-style warnings ("SINK RATE", "PULL UP", "BANK ANGLE", "WIND SHEAR", etc.)
   * in large, unmistakable cockpit annunciator modules along the bottom of the visor.
   */
  private drawBottomAirbusWarnings(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    layout: HudLayoutMetrics,
    lander: LanderState,
    activeVoiceText: string | null,
    timeSec: number
  ): void {
    const warnings = HudRenderer.computeAvionicsWarnings(lander);
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
    const boxH = 44;
    ctx.font = 'bold 22px "Share Tech Mono", monospace';

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

    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    const tw = ctx.measureText(text).width + 36;
    const bx = -tw * 0.5;
    const by = -28;

    ctx.fillStyle = 'rgba(8, 19, 12, 0.92)';
    ctx.fillRect(bx, by, tw, 28);
    ctx.strokeStyle = COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(bx, by, tw, 28);
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.textAlign = 'center';
    ctx.fillText(text, 0, by + 19);
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

    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    ctx.fillStyle = active ? COLORS.GREEN_BRIGHT : accent;
    ctx.textAlign = 'center';
    ctx.fillText(active ? `> ${label} <` : label, x + w * 0.5, y + h * 0.5 + 5);
  }

  // =========================================================================
  // TERMINAL SCREENS: BOOT, MENU, BRIEFING, TALLY, BREACH, CALLSIGN, LOGS
  // =========================================================================

  private drawBootScreen(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    ctx.save();
    ctx.fillStyle = COLORS.BG_DEEP;
    ctx.fillRect(16, 42, w - 32, h - 58);

    if (!state.bootPoweredOn) {
      const cy = h * 0.5;
      const pulse = 0.55 + 0.45 * Math.sin(state.timeSec * 3.2);

      ctx.strokeStyle = `rgba(255, 102, 0, ${(0.28 + pulse * 0.36).toFixed(2)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(w * 0.18, cy - 44);
      ctx.lineTo(w * 0.82, cy - 44);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText(
        'WEYLAND-YUTANI CORP // USCSS NOSTROMO BRIDGE TERMINAL 2037',
        w * 0.5,
        cy - 68
      );

      this.addButton(
        ctx,
        'boot-awaken',
        w * 0.5 - 225,
        cy - 20,
        450,
        46,
        '[ CLICK OR PRESS SPACE ] AWAKEN MU-TH-UR 6000',
        true,
        state.hoveredButtonId,
        COLORS.AMBER_CAUTION
      );

      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_DIM;
      ctx.fillText('STANDBY RELAY BUS ARMED // ACOUSTIC TELEMETRY READY', w * 0.5, cy + 54);
      ctx.restore();
      return;
    }

    if (state.crtWarmupProgress < 1) {
      const p = state.crtWarmupProgress;
      const openH = Math.max(3, (h - 80) * (p * p));
      ctx.beginPath();
      ctx.rect(16, h * 0.5 - openH * 0.5, w - 32, openH);
      ctx.clip();

      if (p < 0.45) {
        ctx.fillStyle = 'rgba(255, 140, 36, 0.35)';
        ctx.fillRect(30, h * 0.5 - 3, w - 60, 6);
      }
    }

    const totalW = Math.min(810, w - 60);
    const boxH = Math.min(405, h - 105);
    const bx = (w - totalW) * 0.5;
    const by = (h - boxH) * 0.5 + 4;

    const mainW = Math.floor(totalW * 0.72);
    const auxX = bx + mainW + 14;
    const auxW = totalW - mainW - 14;

    this.drawCornerBrackets(ctx, bx, by, mainW, boxH, 18, COLORS.GREEN_PRIMARY, 2.4);

    ctx.font = 'bold 17.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.textAlign = 'left';
    ctx.fillText('INTERFACE 2037 // MU-TH-UR 6000 AWAKENING', bx + 20, by + 34);

    ctx.strokeStyle = COLORS.AMBER_DIM;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(bx + 20, by + 44);
    ctx.lineTo(bx + mainW - 20, by + 44);
    ctx.stroke();

    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    let remaining = Math.floor(state.bootProgressChars);
    let cursorDrawn = false;
    BOOT_LINES.forEach((line, idx) => {
      const ly = by + 74 + idx * 33;
      if (remaining <= 0) return;
      const slice = line.slice(0, remaining);
      remaining -= line.length;
      ctx.fillStyle = idx === 4 ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
      ctx.fillText(slice, bx + 20, ly);
      if (remaining <= 0 && !cursorDrawn) {
        cursorDrawn = true;
        if (Math.sin(state.timeSec * 12) > 0) {
          const cw = ctx.measureText(slice).width;
          ctx.fillStyle = COLORS.AMBER_BRIGHT;
          ctx.fillRect(bx + 23 + cw, ly - 12, 10, 15);
        }
      }
    });

    this.drawCornerBrackets(ctx, auxX, by, auxW, boxH, 14, COLORS.AMBER_CAUTION, 2.2);
    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText('CORE REGISTERS', auxX + 12, by + 28);

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    const stepTick = Math.floor(state.timeSec * 8);
    for (let r = 0; r < 8; r++) {
      const activeRow = state.bootProgressChars > r * 35;
      ctx.fillStyle = activeRow ? COLORS.GREEN_MID : COLORS.GREEN_DIM;
      const addr = (0x2030 + r * 16).toString(16).toUpperCase();
      const v1 = activeRow ? (((stepTick + r * 73) * 269) & 0xff).toString(16).toUpperCase().padStart(2, '0') : '00';
      const v2 = activeRow ? (((stepTick + r * 31) * 613) & 0xff).toString(16).toUpperCase().padStart(2, '0') : '00';
      const v3 = activeRow ? (((stepTick + r * 19) * 977) & 0xff).toString(16).toUpperCase().padStart(2, '0') : '00';
      ctx.fillText(`${addr}: ${v1} ${v2} ${v3}`, auxX + 12, by + 52 + r * 17.5);
    }

    const sysLabels = ['LIFE SUPP', 'CRYO BAY', 'NAV RADAR', 'DROP POD'];
    sysLabels.forEach((lbl, sIdx) => {
      const lit = state.bootProgressChars > (sIdx + 1) * 68;
      const sy = by + 206 + sIdx * 33;
      ctx.fillStyle = lit
        ? sIdx === 3
          ? 'rgba(255, 102, 0, 0.25)'
          : 'rgba(54, 201, 94, 0.18)'
        : 'rgba(18, 58, 31, 0.18)';
      ctx.fillRect(auxX + 12, sy, auxW - 24, 24);
      ctx.strokeStyle = lit
        ? sIdx === 3
          ? COLORS.AMBER_CAUTION
          : COLORS.GREEN_PRIMARY
        : COLORS.GREEN_DIM;
      ctx.lineWidth = 1.8;
      ctx.strokeRect(auxX + 12, sy, auxW - 24, 24);

      ctx.font = 'bold 11px "Share Tech Mono", monospace';
      ctx.fillStyle = lit
        ? sIdx === 3
          ? COLORS.AMBER_BRIGHT
          : COLORS.GREEN_BRIGHT
        : COLORS.GREEN_DIM;
      ctx.textAlign = 'center';
      ctx.fillText(lit ? `${lbl}: ON` : `${lbl}: --`, auxX + auxW * 0.5, sy + 16);
    });

    const totalBootChars = BOOT_LINES.reduce((a, b) => a + b.length, 0);
    const done = state.bootProgressChars >= totalBootChars;
    this.addButton(
      ctx,
      'boot-continue',
      bx + mainW * 0.5 - 175,
      by + boxH - 50,
      350,
      38,
      done ? '[SPACE / CLICK] ENTER COMMAND TERMINAL' : '[SPACE / CLICK] BYPASS DIAGNOSTICS',
      true,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION
    );
    ctx.restore();
  }

  private drawTitleMenu(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    ctx.save();
    const boxW = Math.min(750, w - 64);
    const boxH = Math.min(485, h - 86);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5 + 10;

    ctx.fillStyle = 'rgba(8, 19, 12, 0.92)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 20, COLORS.GREEN_PRIMARY, 2.4);

    ctx.textAlign = 'center';
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText('WEYLAND-YUTANI CORP // USCSS NOSTROMO DROP-SHUTTLE', w * 0.5, by + 32);

    ctx.font = 'bold 31px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText('ORBITAL DESCENT TELEMETRY', w * 0.5, by + 66);

    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText('LV-426 / THEDUS VECTOR NAVIGATION & SONAR CELL SYSTEM', w * 0.5, by + 88);

    const btnW = Math.min(490, boxW - 60);
    const btnX = w * 0.5 - btnW * 0.5;
    const startY = by + 112;
    const items = [
      {
        id: 'menu-campaign',
        label: `INITIATE CAMPAIGN DESCENT (START SEC-0${state.selectedStartSector})`,
      },
      {
        id: 'menu-endless',
        label: 'ENDLESS DEEP-SURVEY MODE (PROCEDURAL)',
      },
      {
        id: 'menu-sector-cycle',
        label: `CALIBRATE DEPLOYMENT SECTOR: [ SEC-0${state.selectedStartSector} ]`,
      },
      {
        id: 'menu-logs',
        label: 'MU-TH-UR CREW MANIFEST & HIGH SCORES',
      },
    ];

    items.forEach((it, idx) => {
      this.addButton(
        ctx,
        it.id,
        btnX,
        startY + idx * 46,
        btnW,
        38,
        it.label,
        state.menuCursor === idx,
        state.hoveredButtonId
      );
    });

    const legY = startY + 204;
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(bx + 24, legY, boxW - 48, boxH - (legY - by) - 18);

    ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.textAlign = 'left';
    ctx.fillText('FLIGHT DECK CONTROLS // DESKTOP INTERFACE', bx + 36, legY + 20);

    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    const leftControls = [
      '[W / UP]       MAIN ENGINE (+SHIFT: MAX OVERDRIVE)',
      '[A / D]        FAST RCS ATTITUDE THRUSTERS',
      '[S / DOWN]     RETRO-STABILIZER ASSIST (DAMP DRIFT)',
      '[SPACEBAR]     1X PER GAME EMERGENCY THRUST PULSE',
    ];
    const rightControls = [
      '[MOUSE AIM]    STEER NOSE HEADLIGHT & RADAR CONE',
      '[LEFT-CLICK]   DIRECTIONAL RADAR SWEEP (3 CELLS)',
      '[SCROLL WHEEL] TACTICAL CAMERA ZOOM (1.0X–3.5X)',
      '[R / ESC]      QUICK-RETRY SECTOR // COMMAND MENU',
    ];

    leftControls.forEach((txt, i) => {
      ctx.fillText(txt, bx + 36, legY + 43 + i * 20);
    });
    rightControls.forEach((txt, i) => {
      ctx.fillText(txt, bx + boxW * 0.52, legY + 43 + i * 20);
    });

    ctx.restore();
  }

  private drawSectorBriefingOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    ctx.save();
    const boxW = Math.min(680, w - 80);
    const boxH = 305;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(8, 19, 12, 0.94)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.AMBER_CAUTION, 2.4);

    ctx.textAlign = 'left';
    ctx.font = 'bold 18px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText(
      `MU-TH-UR 6000 // ${state.sector.code}: ${state.sector.name}`,
      bx + 22,
      by + 34
    );

    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(state.sector.subtitle, bx + 22, by + 54);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(bx + 22, by + 65);
    ctx.lineTo(bx + boxW - 22, by + 65);
    ctx.stroke();

    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    let rem = state.briefingProgressChars;
    state.sector.briefingLines.forEach((line, i) => {
      if (rem <= 0) return;
      const shown = line.slice(0, rem);
      rem -= line.length;
      ctx.fillText(`> ${shown}`, bx + 22, by + 95 + i * 28);
    });

    this.addButton(
      ctx,
      'briefing-launch',
      w * 0.5 - 165,
      by + boxH - 54,
      330,
      38,
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
    const boxW = Math.min(640, w - 80);
    const boxH = 395;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

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
    ctx.font = 'bold 18px "Share Tech Mono", monospace';
    ctx.fillStyle = gradeColor;
    const gradeBanner =
      bd.grade === 'SOFT_KISS'
        ? 'TOUCHDOWN CONFIRMED // PRECISION KISS LANDING'
        : bd.grade === 'HARD_SURVIVAL'
          ? 'SURVIVAL TOUCHDOWN // HULL & GEAR DAMAGED'
          : 'TOUCHDOWN CONFIRMED // EXTRACTION NOMINAL';
    ctx.fillText(gradeBanner, bx + 22, by + 34);

    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(
      `V/S: ${bd.touchdownVs.toFixed(2)} M/S  |  H/S: ${bd.touchdownHs.toFixed(2)} M/S  |  ATT: ${bd.touchdownDeg.toFixed(1)}°  |  RATING: ${bd.accuracyRating} (${bd.accuracyPercent}%)`,
      bx + 22,
      by + 55
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
      const ry = by + 90 + i * 29;
      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      ctx.fillText(title, bx + 22, ry);

      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText(formula, bx + boxW * 0.62, ry);

      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.AMBER_CAUTION;
      ctx.fillText(pts, bx + boxW - 22, ry);
    });

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(bx + 22, by + 242);
    ctx.lineTo(bx + boxW - 22, by + 242);
    ctx.stroke();

    ctx.font = 'bold 18px "Share Tech Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('SECTOR TELEMETRY SCORE', bx + 22, by + 270);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText(`+${Math.round(bd.sectorTotal * anim).toLocaleString()} PTS`, bx + boxW - 22, by + 270);

    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(`CUMULATIVE MISSION TOTAL: ${Math.round(state.missionScore).toLocaleString()} PTS`, bx + boxW - 22, by + 296);

    const isFinalCampaignSector =
      !state.sector.endlessMode && state.sector.index >= 6;
    this.addButton(
      ctx,
      'tally-next',
      w * 0.5 - 170,
      by + boxH - 54,
      340,
      38,
      isFinalCampaignSector
        ? '[SPACE / ENTER] COMPLETE CAMPAIGN LOG'
        : '[SPACE / ENTER] PROCEED TO NEXT SECTOR',
      true,
      state.hoveredButtonId,
      COLORS.GREEN_PRIMARY
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
    const boxW = Math.min(580, w - 80);
    const boxH = 250;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(14, 8, 7, 0.92)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.RED_KLAXON, 2.6);

    ctx.textAlign = 'center';
    ctx.font = 'bold 22px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.RED_KLAXON;
    ctx.fillText('SIGNAL TERMINATED // HULL BREACH', w * 0.5, by + 42);

    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText(state.lastFailure?.reason ?? 'CATASTROPHIC STRUCTURAL IMPACT', w * 0.5, by + 72);

    if (state.lastFailure) {
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      ctx.fillText(
        `IMPACT TELEMETRY — V/S: ${state.lastFailure.impactVs.toFixed(1)} M/S | H/S: ${state.lastFailure.impactHs.toFixed(1)} M/S | ATT: ${state.lastFailure.impactDeg.toFixed(1)}°`,
        w * 0.5,
        by + 100
      );
    }

    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText('CONSECUTIVE DROP STREAK RESET TO 1X', w * 0.5, by + 128);

    this.addButton(
      ctx,
      'breach-retry',
      bx + 32,
      by + boxH - 60,
      245,
      38,
      '[R] RETRY SECTOR',
      true,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION
    );
    this.addButton(
      ctx,
      'breach-end',
      bx + boxW - 277,
      by + boxH - 60,
      245,
      38,
      '[M] FINALIZE MANIFEST',
      false,
      state.hoveredButtonId,
      COLORS.GREEN_PRIMARY
    );
    ctx.restore();
  }

  private drawPauseOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    ctx.save();
    const boxW = 440;
    const boxH = 268;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(8, 19, 12, 0.95)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 16, COLORS.GREEN_PRIMARY, 2.2);

    ctx.textAlign = 'center';
    ctx.font = 'bold 18px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText('MU-TH-UR 6000 // COMMAND INTERRUPT', w * 0.5, by + 36);

    this.addButton(
      ctx,
      'pause-resume',
      bx + 45,
      by + 68,
      350,
      38,
      '[ESC] RESUME DESCENT',
      state.menuCursor === 0,
      state.hoveredButtonId
    );
    this.addButton(
      ctx,
      'pause-retry',
      bx + 45,
      by + 118,
      350,
      38,
      '[R] QUICK-RETRY SECTOR',
      state.menuCursor === 1,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION
    );
    this.addButton(
      ctx,
      'pause-abort',
      bx + 45,
      by + 168,
      350,
      38,
      '[Q] ABORT TO MAIN TERMINAL',
      state.menuCursor === 2,
      state.hoveredButtonId,
      COLORS.RED_KLAXON
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
    const boxW = Math.min(620, w - 80);
    const boxH = 280;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(8, 19, 12, 0.96)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.GREEN_BRIGHT, 2.4);

    ctx.textAlign = 'center';
    ctx.font = 'bold 21px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('ALL 6 LV-426 CAMPAIGN SECTORS EXTRACTED', w * 0.5, by + 44);

    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText(
      `FINAL TELEMETRY SCORE: ${Math.round(state.missionScore).toLocaleString()} PTS`,
      w * 0.5,
      by + 84
    );

    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      'USCSS NOSTROMO / NARCISSUS ORBITAL DOCKING SEQUENCE COMPLETE.',
      w * 0.5,
      by + 116
    );

    this.addButton(
      ctx,
      'complete-endless',
      bx + 35,
      by + boxH - 66,
      265,
      40,
      'CONTINUE DEEP-SURVEY',
      true,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION
    );
    this.addButton(
      ctx,
      'complete-manifest',
      bx + boxW - 300,
      by + boxH - 66,
      265,
      40,
      'LOG CREW MANIFEST',
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
    const boxW = Math.min(560, w - 80);
    const boxH = 268;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(8, 19, 12, 0.96)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.AMBER_CAUTION, 2.4);

    ctx.textAlign = 'center';
    ctx.font = 'bold 19px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText('TOP-10 CREW MANIFEST QUALIFICATION', w * 0.5, by + 38);

    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      `MISSION SCORE: ${Math.round(state.missionScore).toLocaleString()} PTS // ENTER OFFICER CALLSIGN`,
      w * 0.5,
      by + 68
    );

    const inW = 290;
    const inX = w * 0.5 - inW * 0.5;
    const inY = by + 96;
    ctx.strokeStyle = COLORS.GREEN_BRIGHT;
    ctx.lineWidth = 2.2;
    ctx.strokeRect(inX, inY, inW, 46);

    const blink = Math.sin(state.timeSec * 10) > 0 ? '_' : ' ';
    ctx.font = 'bold 23px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText(`${state.callsignDraft}${blink}`, w * 0.5, inY + 31);

    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText('TYPE CALLSIGN (A–Z, 0–9) AND PRESS [ENTER]', w * 0.5, by + 168);

    this.addButton(
      ctx,
      'callsign-submit',
      w * 0.5 - 135,
      by + boxH - 56,
      270,
      38,
      '[ENTER] COMMIT TO MU-TH-UR',
      true,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION
    );
    ctx.restore();
  }

  private drawFlightLogsModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    ctx.save();
    const boxW = Math.min(720, w - 60);
    const boxH = Math.min(465, h - 70);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(8, 19, 12, 0.97)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.GREEN_PRIMARY, 2.4);

    ctx.textAlign = 'left';
    ctx.font = 'bold 18px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText('MU-TH-UR 6000 // PERSISTENT CREW MANIFEST (TOP 10)', bx + 22, by + 34);

    const headY = by + 62;
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText('RNK', bx + 22, headY);
    ctx.fillText('CALLSIGN', bx + 76, headY);
    ctx.fillText('SECTOR', bx + 215, headY);
    ctx.fillText('ACCURACY', bx + 315, headY);
    ctx.fillText('DATE', bx + 435, headY);
    ctx.textAlign = 'right';
    ctx.fillText('SCORE', bx + boxW - 22, headY);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(bx + 22, headY + 8);
    ctx.lineTo(bx + boxW - 22, headY + 8);
    ctx.stroke();

    state.manifestEntries.slice(0, 10).forEach((entry, idx) => {
      const ry = headY + 28 + idx * 24;
      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = idx === 0 ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
      ctx.fillText(`#${String(idx + 1).padStart(2, '0')}`, bx + 22, ry);
      ctx.fillText(entry.callsign, bx + 76, ry);
      ctx.fillText(entry.highestSector, bx + 215, ry);
      ctx.fillText(`${entry.accuracyRating} (${entry.accuracyPercent}%)`, bx + 315, ry);
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText(entry.date, bx + 435, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = idx === 0 ? COLORS.AMBER_BRIGHT : COLORS.GREEN_BRIGHT;
      ctx.fillText(entry.score.toLocaleString(), bx + boxW - 22, ry);
    });

    const logY = by + boxH - 88;
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.beginPath();
    ctx.moveTo(bx + 22, logY);
    ctx.lineTo(bx + boxW - 22, logY);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    const recent = state.sessionLogs.slice(-2);
    recent.forEach((line, i) => {
      ctx.fillText(`LOG> ${line}`, bx + 22, logY + 18 + i * 16);
    });

    this.addButton(
      ctx,
      'logs-close',
      w * 0.5 - 130,
      by + boxH - 44,
      260,
      32,
      '[ESC / CLICK] CLOSE LOGS',
      true,
      state.hoveredButtonId
    );
    ctx.restore();
  }
}
