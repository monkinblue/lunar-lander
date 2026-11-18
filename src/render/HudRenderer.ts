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

export interface HudRenderContext {
  phase: GamePhase;
  width: number;
  height: number;
  timeSec: number;
  sector: SectorConfig;
  lander: LanderState;
  bezel: BezelState;
  cameraZoom: number;
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

    // ---------------------------------------------------------------------
    // RIGHT INSTRUMENT CLUSTER (SCALED UP): FLIGHT DATA + CHUNKY ORANGE DIALS + GREEN VERNIER
    // ---------------------------------------------------------------------
    const clusterW = Math.min(256, Math.max(222, Math.round(w * 0.235)));
    const rx = w - clusterW - 20;
    const ry = 48;
    const clusterH = Math.min(526, h - 66);

    ctx.fillStyle = 'rgba(8, 19, 12, 0.84)';
    ctx.fillRect(rx, ry, clusterW, clusterH);
    this.drawCornerBrackets(ctx, rx, ry, clusterW, clusterH, 14, COLORS.GREEN_DIM, 2.2);

    // 1. "FLIGHT DATA" Tabular Telemetry Block
    ctx.textAlign = 'left';
    ctx.font = 'bold 16px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('FLIGHT DATA', rx + 12, ry + 22);

    ctx.strokeStyle = COLORS.GREEN_PRIMARY;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(rx + 12, ry + 28);
    ctx.lineTo(rx + clusterW - 12, ry + 28);
    ctx.stroke();

    const totalMass = lander.dryMassKg + lander.fuelKg;
    const currentTwr = PHYSICS.MAIN_THRUST_N / (totalMass * sector.gravity);
    const thrustKn = (lander.throttle * PHYSICS.MAIN_THRUST_N) / 1000;
    const pitchDeg = (lander.angle * 180) / Math.PI;
    const windKnots = Math.hypot(lander.currentWindVx, lander.currentWindVy) * 1.94384;

    const dataRows: Array<{ label: string; val: string; color: string }> = [
      {
        label: 'MASS / TWR',
        val: `${totalMass.toFixed(0)}K / ${currentTwr.toFixed(2)}`,
        color: COLORS.GREEN_PRIMARY,
      },
      {
        label: 'VERT VEL',
        val: `${lander.vel.y >= 0 ? '+' : ''}${lander.vel.y.toFixed(2)} M/S`,
        color:
          lander.vel.y < -PHYSICS.SURVIVAL_VS_MAX
            ? COLORS.RED_KLAXON
            : lander.vel.y < -PHYSICS.SAFE_VS_MAX
              ? COLORS.AMBER_CAUTION
              : COLORS.GREEN_PRIMARY,
      },
      {
        label: 'H-DRIFT',
        val: `${lander.vel.x >= 0 ? '+' : ''}${lander.vel.x.toFixed(2)} M/S`,
        color:
          Math.abs(lander.vel.x) > PHYSICS.SAFE_HS_MAX
            ? COLORS.AMBER_CAUTION
            : COLORS.GREEN_PRIMARY,
      },
      {
        label: 'THRUST',
        val: `${thrustKn.toFixed(2)} KN`,
        color: lander.overdrive ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY,
      },
      {
        label: 'ATTITUDE',
        val: `${pitchDeg >= 0 ? '+' : ''}${pitchDeg.toFixed(1)} DEG`,
        color:
          Math.abs(pitchDeg) > PHYSICS.SAFE_ANGLE_DEG
            ? COLORS.AMBER_CAUTION
            : COLORS.GREEN_PRIMARY,
      },
    ];

    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    dataRows.forEach((row, idx) => {
      const ty = ry + 47 + idx * 18.5;
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText(row.label, rx + 12, ty);

      ctx.textAlign = 'right';
      ctx.fillStyle = row.color;
      ctx.fillText(row.val, rx + clusterW - 12, ty);
    });

    // 2. Scaled-Up Chunky Circular Orange Gauges + Stepped Vertical Green Vernier Scale
    const gaugesTopY = ry + 144;
    const leftColCx = rx + Math.round(clusterW * 0.28);
    const rightColCx = rx + Math.round(clusterW * 0.74);
    const dialR = Math.min(37, Math.max(31, Math.round((clusterH - 175) / 8.8)));
    const rowStep = dialR * 2 + 34;

    // Gauge A: FUEL Circular Wedge Dial
    const fuelRatio = Math.max(0, Math.min(1, lander.fuelKg / Math.max(1, lander.maxFuelKg)));
    this.drawChunkyFuelWedgeDial(
      ctx,
      leftColCx,
      gaugesTopY + dialR + 6,
      dialR,
      fuelRatio,
      `${lander.fuelKg.toFixed(0)} KG`,
      'FUEL'
    );

    // Gauge B: SPEED Dial
    const speedMag = Math.hypot(lander.vel.x, lander.vel.y);
    const speedNorm = Math.min(1, speedMag / 6.0);
    const speedWarn =
      Math.abs(Math.min(0, lander.vel.y)) > PHYSICS.SURVIVAL_VS_MAX
        ? COLORS.RED_KLAXON
        : COLORS.AMBER_CAUTION;
    this.drawChunkyNeedleDial(
      ctx,
      leftColCx,
      gaugesTopY + dialR + 6 + rowStep,
      dialR,
      speedNorm,
      PHYSICS.SAFE_VS_MAX / 6.0,
      'SPEED',
      speedWarn,
      false
    );

    // Gauge C: DRIFT Dial
    const driftSigned = Math.max(-1, Math.min(1, lander.vel.x / 3.5));
    const driftCol =
      Math.abs(lander.vel.x) > PHYSICS.SURVIVAL_HS_MAX ? COLORS.RED_KLAXON : COLORS.AMBER_CAUTION;
    this.drawChunkyNeedleDial(
      ctx,
      leftColCx,
      gaugesTopY + dialR + 6 + rowStep * 2,
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
      gaugesTopY + dialR + 6 + rowStep * 2,
      dialR,
      thrustNorm,
      1.0 / PHYSICS.OVERDRIVE_MULTIPLIER,
      'THRUST',
      thrustCol,
      false
    );

    // Hull & Optic Status Footer
    if (clusterH >= 485) {
      ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      const sysBroken = lander.strutDamaged || lander.rcsDamaged;
      ctx.fillStyle = sysBroken ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY;
      const sysTxt = sysBroken
        ? `HULL ${Math.round(lander.hullIntegrity)}% // ${lander.strutDamaged ? 'GEAR-DMG ' : ''}${lander.rcsDamaged ? 'RCS-DMG' : ''}`
        : `HULL ${Math.round(lander.hullIntegrity)}% // ${state.bezel.sasEnabled ? 'SAS ON' : 'MANUAL'} // ${state.cameraZoom.toFixed(1)}X`;
      ctx.fillText(sysTxt, rx + clusterW * 0.5, ry + clusterH - 11);
    }

    // ---------------------------------------------------------------------
    // LEFT TACTICAL STACK (SCALED UP):
    // 1) LARGE MISSION SCORE + SONAR SURVEY CELLS RACK
    // 2) ATTITUDE HORIZON GYRO + WIND COMPASS
    // 3) <80M PROXIMITY APPROACH GO/NO-GO WINDOW
    // ---------------------------------------------------------------------
    const lx = 20;
    const ly = 48;
    const leftW = Math.min(228, Math.max(198, Math.round(w * 0.205)));

    this.drawScoreAndRadarRack(
      ctx,
      lx,
      ly,
      leftW,
      state.displayedScore,
      state.dropStreak,
      lander,
      state.timeSec
    );

    const gyroY = ly + 132;
    this.drawAttitudeAndWindPod(ctx, lx, gyroY, leftW, lander, sector, windKnots);

    const nearestPad = this.findNearestPadWithin(lander, sector.pads, PHYSICS.APPROACH_PROXIMITY_M);
    if (nearestPad && lander.alive && state.phase === 'FLIGHT') {
      this.drawProximityApproachSubWindow(
        ctx,
        lx,
        gyroY + 158,
        leftW,
        lander,
        nearestPad.pad,
        nearestPad.dist
      );
    }

    this.drawHazardAlerts(ctx, w, lander, sector, state.timeSec);

    if (state.activeCalloutText && state.activeCalloutTimer > 0) {
      this.drawIntercomBanner(ctx, w, h, state.activeCalloutText, state.timeSec);
    } else if (state.statusBannerText && state.statusBannerTimer > 0) {
      this.drawStatusToast(ctx, w, state.statusBannerText);
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
    lander: LanderState,
    timeSec: number
  ): void {
    const h = 122;
    ctx.save();
    ctx.fillStyle = 'rgba(8, 19, 12, 0.84)';
    ctx.fillRect(x, y, w, h);
    this.drawCornerBrackets(ctx, x, y, w, h, 12, COLORS.GREEN_DIM, 2.2);

    // Top Half: Large Prominent MISSION SCORE + STREAK Badge
    ctx.textAlign = 'left';
    ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText('MISSION TELEMETRY SCORE', x + 12, y + 19);

    const streak = Math.max(1, dropStreak);
    ctx.textAlign = 'right';
    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = streak > 1 ? COLORS.AMBER_BRIGHT : COLORS.GREEN_PRIMARY;
    ctx.fillText(`STREAK ${streak}X`, x + w - 12, y + 19);

    // Big Bold 25px Nostromo Tabular Score Readout
    ctx.textAlign = 'left';
    ctx.font = 'bold 25px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    const scoreText = Math.round(displayedScore).toString().padStart(7, '0');
    ctx.fillText(scoreText, x + 12, y + 48);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 12, y + 58);
    ctx.lineTo(x + w - 12, y + 58);
    ctx.stroke();

    // Bottom Half: Discrete On-Theme SONAR SURVEY CELLS Cartridge Rack
    const maxCells = Math.max(1, lander.maxRadarCharges);
    const remCells = lander.radarCharges;
    const lowCells = remCells <= 2;

    ctx.textAlign = 'left';
    ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
    ctx.fillStyle = remCells === 0 ? COLORS.RED_KLAXON : lowCells ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
    ctx.fillText('RADAR PING CELLS', x + 12, y + 75);

    ctx.textAlign = 'right';
    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillText(
      `${String(remCells).padStart(2, '0')}/${String(maxCells).padStart(2, '0')}`,
      x + w - 12,
      y + 75
    );

    const rackX = x + 12;
    const rackW = w - 24;
    const rackY = y + 83;
    const cellGap = 4;
    const cellW = (rackW - cellGap * (maxCells - 1)) / maxCells;
    const cellH = 24;

    if (remCells > 0) {
      for (let c = 0; c < maxCells; c++) {
        const cx = rackX + c * (cellW + cellGap);
        const charged = c < remCells;

        // Cartridge contact cap
        ctx.fillStyle = charged
          ? lowCells
            ? COLORS.AMBER_BRIGHT
            : COLORS.GREEN_BRIGHT
          : COLORS.GREEN_DIM;
        ctx.fillRect(cx + cellW * 0.25, rackY, cellW * 0.5, 3);

        // Cartridge body
        ctx.strokeStyle = charged
          ? lowCells
            ? COLORS.AMBER_CAUTION
            : COLORS.GREEN_PRIMARY
          : COLORS.GREEN_DIM;
        ctx.lineWidth = 1.6;
        ctx.strokeRect(cx, rackY + 3, cellW, cellH - 3);

        if (charged) {
          ctx.fillStyle = lowCells ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
          ctx.fillRect(cx + 2, rackY + 5, Math.max(2, cellW - 4), cellH - 7);
        }
      }
    } else {
      // 0 Cells Remaining: Show Emergency Backup Reserve Generator Progress Bar
      const blink = Math.sin(timeSec * 10) > 0;
      ctx.strokeStyle = blink ? COLORS.RED_KLAXON : COLORS.AMBER_DIM;
      ctx.lineWidth = 1.8;
      ctx.strokeRect(rackX, rackY + 2, rackW, 20);

      const progW = ((rackW - 4) * lander.sensorCapacitor) / 100;
      ctx.fillStyle = COLORS.AMBER_CAUTION;
      ctx.fillRect(rackX + 2, rackY + 4, progW, 16);

      ctx.textAlign = 'center';
      ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_BRIGHT;
      ctx.fillText(
        `RESERVE CELL GEN ${Math.round(lander.sensorCapacitor)}%`,
        x + w * 0.5,
        rackY + 16
      );
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
    centerZero: boolean
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
    ctx.fillText(label, cx, cy + r + 15);
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
    const h = 148;
    ctx.save();
    ctx.fillStyle = 'rgba(8, 19, 12, 0.82)';
    ctx.fillRect(x, y, w, h);
    this.drawCornerBrackets(ctx, x, y, w, h, 12, COLORS.GREEN_DIM, 2.2);

    const gyroCx = x + w * 0.27;
    const gyroCy = y + 60;
    const gyroR = 35;
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
    ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
    ctx.fillStyle = attSafe ? COLORS.GREEN_PRIMARY : COLORS.AMBER_CAUTION;
    ctx.fillText(`ATT ${pitchDeg >= 0 ? '+' : ''}${pitchDeg.toFixed(1)}°`, gyroCx, gyroCy + gyroR + 16);

    const windCx = x + w * 0.73;
    const windCy = y + 60;
    const windR = 35;
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

    ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
    ctx.fillStyle = windCol;
    ctx.fillText(`WIND ${windKnots.toFixed(0)}KT`, windCx, windCy + windR + 16);

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(`GRAVITY ${sector.gravity.toFixed(2)} M/S²`, x + w * 0.5, y + h - 10);
    ctx.restore();
  }

  private findNearestPadWithin(
    lander: LanderState,
    pads: LandingPad[],
    maxDistM: number
  ): { pad: LandingPad; dist: number } | null {
    let best: LandingPad | null = null;
    let bestDist = maxDistM;
    for (const p of pads) {
      const cx = (p.x1 + p.x2) * 0.5;
      const dist = Math.hypot(lander.pos.x - cx, lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y - p.y);
      if (dist <= bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    return best ? { pad: best, dist: bestDist } : null;
  }

  private drawProximityApproachSubWindow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    lander: LanderState,
    pad: LandingPad,
    distM: number
  ): void {
    const boxH = 144;
    ctx.save();
    ctx.fillStyle = 'rgba(8, 19, 12, 0.9)';
    ctx.fillRect(x, y, w, boxH);
    this.drawCornerBrackets(ctx, x, y, w, boxH, 12, COLORS.AMBER_CAUTION, 2.2);

    ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.textAlign = 'left';
    ctx.fillText(`PAD LOCK // ${pad.label}`, x + 10, y + 19);

    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.textAlign = 'right';
    ctx.fillText(`${distM.toFixed(0)}M`, x + w - 10, y + 19);

    const vs = Math.abs(Math.min(0, lander.vel.y));
    const hs = Math.abs(lander.vel.x);
    const deg = Math.abs((lander.angle * 180) / Math.PI);

    const vsGo = vs < PHYSICS.SAFE_VS_MAX;
    const vsKiss = vs < PHYSICS.KISS_VS_MAX;
    const hsGo = hs < PHYSICS.SAFE_HS_MAX;
    const hsKiss = hs < PHYSICS.KISS_HS_MAX;
    const attGo = deg <= PHYSICS.SAFE_ANGLE_DEG;

    const rows: Array<{ label: string; val: string; status: string; ok: boolean }> = [
      {
        label: 'V/S',
        val: `${vs.toFixed(2)}`,
        status: vsKiss ? '[GO:KISS]' : vsGo ? '[GO]' : '[NO-GO]',
        ok: vsGo,
      },
      {
        label: 'H/S',
        val: `${hs.toFixed(2)}`,
        status: hsKiss ? '[GO:KISS]' : hsGo ? '[GO]' : '[NO-GO]',
        ok: hsGo,
      },
      {
        label: 'ATT',
        val: `${deg.toFixed(1)}°`,
        status: attGo ? '[GO]' : '[NO-GO]',
        ok: attGo,
      },
    ];

    rows.forEach((r, idx) => {
      const ry = y + 41 + idx * 21;
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText(r.label, x + 10, ry);

      ctx.textAlign = 'center';
      ctx.fillStyle = r.ok ? COLORS.GREEN_PRIMARY : COLORS.RED_KLAXON;
      ctx.fillText(r.val, x + w * 0.45, ry);

      ctx.textAlign = 'right';
      ctx.fillText(r.status, x + w - 10, ry);
    });

    const alignY = y + 110;
    const alignW = w - 20;
    const alignX = x + 10;
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(alignX, alignY, alignW, 22);

    const padCenter = (pad.x1 + pad.x2) * 0.5;
    const padHalfW = (pad.x2 - pad.x1) * 0.5;
    const viewHalfM = Math.max(22, padHalfW * 2.4);

    const padLeftPx = alignX + alignW * (0.5 - padHalfW / (viewHalfM * 2));
    const padRightPx = alignX + alignW * (0.5 + padHalfW / (viewHalfM * 2));
    ctx.fillStyle = 'rgba(255, 102, 0, 0.30)';
    ctx.fillRect(padLeftPx, alignY + 13, padRightPx - padLeftPx, 7);
    ctx.strokeStyle = COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(padLeftPx, alignY + 13);
    ctx.lineTo(padRightPx, alignY + 13);
    ctx.stroke();

    const offsetM = Math.max(-viewHalfM, Math.min(viewHalfM, lander.pos.x - padCenter));
    const shuttlePx = alignX + alignW * (0.5 + offsetM / (viewHalfM * 2));
    const spanHalfPx = (PHYSICS.STRUT_SPAN_HALF_X / (viewHalfM * 2)) * alignW;
    const aligned = Math.abs(lander.pos.x - padCenter) + PHYSICS.STRUT_SPAN_HALF_X <= padHalfW + 0.85;

    ctx.strokeStyle = aligned ? COLORS.GREEN_BRIGHT : COLORS.RED_KLAXON;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(shuttlePx - spanHalfPx, alignY + 9);
    ctx.lineTo(shuttlePx + spanHalfPx, alignY + 9);
    ctx.moveTo(shuttlePx, alignY + 3);
    ctx.lineTo(shuttlePx, alignY + 12);
    ctx.stroke();

    ctx.restore();
  }

  private drawHazardAlerts(
    ctx: CanvasRenderingContext2D,
    w: number,
    lander: LanderState,
    sector: SectorConfig,
    timeSec: number
  ): void {
    if (!lander.alive) return;
    const pulse = Math.sin(timeSec * 14) > -0.2;
    const alerts: Array<{ text: string; color: string }> = [];

    if (lander.ceilingClearance < 16) {
      alerts.push({ text: 'PULL UP // OBSTACLE', color: COLORS.RED_KLAXON });
    }
    if (lander.agl < 42 && lander.vel.y < -PHYSICS.SAFE_VS_MAX) {
      alerts.push({
        text: lander.agl < 22 && lander.vel.y < -3.3 ? 'PULL UP' : 'DESCENT RATE',
        color: COLORS.RED_KLAXON,
      });
    }
    if (lander.agl < 95 && Math.abs((lander.angle * 180) / Math.PI) > 14.5) {
      alerts.push({ text: 'BANK ANGLE', color: COLORS.AMBER_CAUTION });
    }
    if (lander.inWindShear) {
      alerts.push({ text: 'WIND SHEAR', color: COLORS.AMBER_CAUTION });
    }
    if (lander.inThermalUpdraft) {
      alerts.push({ text: 'THERMAL UPDRAFT', color: COLORS.AMBER_CAUTION });
    }
    if ((sector.darknessLevel > 0.7 || sector.emInterference > 0.45) && lander.radarCharges > 0) {
      alerts.push({
        text: `[SPACE / L-CLICK] PING RADAR (${lander.radarCharges} LEFT)`,
        color: COLORS.GREEN_PRIMARY,
      });
    }

    if (alerts.length === 0) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    const centerSlotX = w * 0.48;
    alerts.slice(0, 2).forEach((al, idx) => {
      if (al.color === COLORS.RED_KLAXON && !pulse) return;
      const ay = 62 + idx * 28;
      const tw = ctx.measureText(al.text).width + 28;
      ctx.fillStyle = 'rgba(8, 19, 12, 0.9)';
      ctx.fillRect(centerSlotX - tw * 0.5, ay - 15, tw, 23);
      ctx.strokeStyle = al.color;
      ctx.lineWidth = 2.0;
      ctx.strokeRect(centerSlotX - tw * 0.5, ay - 15, tw, 23);
      ctx.fillStyle = al.color;
      ctx.fillText(al.text, centerSlotX, ay + 1);
    });
    ctx.restore();
  }

  private drawIntercomBanner(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    text: string,
    timeSec: number
  ): void {
    ctx.save();
    const bw = Math.min(540, w - 300);
    const bh = 38;
    const bx = Math.max(24, w * 0.47 - bw * 0.5);
    const by = h - 58;

    ctx.fillStyle = 'rgba(8, 19, 12, 0.94)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(bx, by, bw, bh);

    for (let i = 0; i < 5; i++) {
      const amp = 5 + Math.abs(Math.sin(timeSec * 16 + i * 1.4)) * 16;
      ctx.fillStyle = COLORS.AMBER_BRIGHT;
      ctx.fillRect(bx + 12 + i * 6, by + bh * 0.5 - amp * 0.5, 4, amp);
    }

    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.textAlign = 'left';
    ctx.fillText(`GPWS // ${text}`, bx + 48, by + 24);
    ctx.restore();
  }

  private drawStatusToast(ctx: CanvasRenderingContext2D, w: number, text: string): void {
    ctx.save();
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    const tw = ctx.measureText(text).width + 32;
    const cx = w * 0.48;
    const bx = cx - tw * 0.5;
    const by = 118;
    ctx.fillStyle = 'rgba(8, 19, 12, 0.92)';
    ctx.fillRect(bx, by, tw, 26);
    ctx.strokeStyle = COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(bx, by, tw, 26);
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, by + 18);
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
      '[A / D]        RCS ATTITUDE ROTATION THRUSTERS',
      '[S / DOWN]     RETRO-STABILIZER ASSIST (DAMP DRIFT)',
      '[SPACEBAR]     RADIAL SONAR SWEEP (COSTS 1 CELL)',
    ];
    const rightControls = [
      '[MOUSE AIM]    STEER NOSE HEADLIGHT',
      '[LEFT-CLICK]   FOCUSED BEAM PING (COSTS 1 CELL)',
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
