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
  dropStreak: number;
  selectedStartSector: number;
  menuCursor: number;
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
  'MU-TH-UR 6000 // MAINFRAME KERNEL REV 2037.09',
  'COPYRIGHT (C) WEYLAND-YUTANI CORP // COMMERCIAL TOWING & SURVEY',
  'CHECKING MEMORY BANKS 0000H-FFFFH .............. NOMINAL',
  'COUPLING USCSS NOSTROMO ORBITAL TELEMETRY BUS ... LOCKED',
  'CALIBRATING P39 VECTOR CATHODE DEFLECTION ....... READY',
  'LOADING LV-426 / THEDUS TOPOGRAPHIC RADAR ....... ONLINE',
  'INTERFACE 2037 // WEYLAND-YUTANI DESCENT TELEMETRY READY.',
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
    lineWidth = 2.0
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
    const pad = 14;
    this.drawCornerBrackets(ctx, pad, pad, w - pad * 2, h - pad * 2, 20, COLORS.GREEN_DIM, 2.0);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pad + 24, pad + 26);
    ctx.lineTo(w - pad - 24, pad + 26);
    ctx.stroke();

    ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.textAlign = 'left';
    ctx.fillText('INTERFACE 2037 // NOSTROMO DESCENT TELEMETRY', pad + 10, pad + 18);

    ctx.textAlign = 'center';
    if (state.phase !== 'BOOT' && state.phase !== 'TITLE_MENU') {
      ctx.fillStyle = COLORS.AMBER_CAUTION;
      ctx.fillText(`${state.sector.code} : ${state.sector.name}`, w * 0.45, pad + 18);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    const scoreStr = String(Math.round(state.missionScore)).padStart(7, '0');
    ctx.fillText(`SCORE ${scoreStr} // ${Math.max(1, state.dropStreak)}X`, w - pad - 10, pad + 18);
    ctx.restore();
  }

  // =========================================================================
  // CHUNKY NOSTROMO CRT FLIGHT INSTRUMENTATION (MATCHING REFERENCE MONITOR)
  // =========================================================================

  private drawFlightTelemetryHud(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    dimmed: boolean
  ): void {
    ctx.save();
    if (dimmed) ctx.globalAlpha = 0.4;

    const lander = state.lander;
    const sector = state.sector;

    // ---------------------------------------------------------------------
    // RIGHT INSTRUMENT CLUSTER: FLIGHT DATA TABLE + CHUNKY AMBER DIALS + GREEN VERNIER SCALE
    // ---------------------------------------------------------------------
    const clusterW = 204;
    const rx = w - clusterW - 22;
    const ry = 46;
    const clusterH = Math.min(448, h - 66);

    ctx.fillStyle = 'rgba(2, 8, 4, 0.76)';
    ctx.fillRect(rx, ry, clusterW, clusterH);
    this.drawCornerBrackets(ctx, rx, ry, clusterW, clusterH, 12, COLORS.GREEN_DIM, 1.8);

    // 1. "FLIGHT DATA" Tabular Telemetry Block (Top of Right Column, exact reference style)
    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('FLIGHT DATA', rx + 10, ry + 18);

    ctx.strokeStyle = COLORS.GREEN_PRIMARY;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(rx + 10, ry + 23);
    ctx.lineTo(rx + clusterW - 10, ry + 23);
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
        label: 'VELOCITY',
        val: `${lander.vel.y >= 0 ? '+' : ''}${lander.vel.y.toFixed(2)}M/S`,
        color:
          lander.vel.y < -PHYSICS.SURVIVAL_VS_MAX
            ? COLORS.RED_KLAXON
            : lander.vel.y < -PHYSICS.SAFE_VS_MAX
              ? COLORS.AMBER_CAUTION
              : COLORS.GREEN_PRIMARY,
      },
      {
        label: 'H-DRIFT',
        val: `${lander.vel.x >= 0 ? '+' : ''}${lander.vel.x.toFixed(2)}M/S`,
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
      {
        label: 'LIDAR CAP',
        val: `${Math.round(lander.sensorCapacitor).toString().padStart(3, ' ')} %`,
        color:
          lander.sensorCapacitor < PHYSICS.DIR_LIDAR_COST
            ? COLORS.AMBER_CAUTION
            : COLORS.GREEN_PRIMARY,
      },
    ];

    ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
    dataRows.forEach((row, idx) => {
      const ty = ry + 38 + idx * 14.5;
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText(row.label, rx + 10, ty);

      ctx.textAlign = 'right';
      ctx.fillStyle = row.color;
      ctx.fillText(row.val, rx + clusterW - 10, ty);
    });

    // 2. Chunky Circular/Semi-Circular Amber Gauges + Stepped Vertical Green Vernier Scale
    const gaugesTopY = ry + 132;
    const leftColCx = rx + 54;
    const rightColCx = rx + 150;
    const dialR = 30;

    // Gauge A (Upper-Left): FUEL Circular Tank Wedge Gauge (exact match to top FUEL dial in photo!)
    const fuelRatio = Math.max(0, Math.min(1, lander.fuelKg / Math.max(1, lander.maxFuelKg)));
    this.drawChunkyFuelWedgeDial(
      ctx,
      leftColCx,
      gaugesTopY + 34,
      dialR,
      fuelRatio,
      `${lander.fuelKg.toFixed(0)}KG`,
      'FUEL'
    );

    // Gauge B (Middle-Left): SPEED Dial Gauge (Total/Vertical Speed with needle & glowing amber arc)
    const speedMag = Math.hypot(lander.vel.x, lander.vel.y);
    const speedNorm = Math.min(1, speedMag / 6.0);
    const speedWarn =
      Math.abs(Math.min(0, lander.vel.y)) > PHYSICS.SURVIVAL_VS_MAX
        ? COLORS.RED_KLAXON
        : COLORS.AMBER_CAUTION;
    this.drawChunkyNeedleDial(
      ctx,
      leftColCx,
      gaugesTopY + 122,
      dialR,
      speedNorm,
      PHYSICS.SAFE_VS_MAX / 6.0,
      'SPEED',
      speedWarn,
      false
    );

    // Gauge C (Bottom-Left): DRIFT Center-Zero Needle Dial (H/S lateral drift)
    const driftSigned = Math.max(-1, Math.min(1, lander.vel.x / 3.5));
    const driftCol =
      Math.abs(lander.vel.x) > PHYSICS.SURVIVAL_HS_MAX ? COLORS.RED_KLAXON : COLORS.AMBER_CAUTION;
    this.drawChunkyNeedleDial(
      ctx,
      leftColCx,
      gaugesTopY + 210,
      dialR,
      driftSigned,
      undefined,
      'DRIFT',
      driftCol,
      true
    );

    // Gauge D (Upper/Mid-Right): Stepped Vertical Green Vernier Scale (AGL Altitude, matching reference ladder!)
    this.drawSteppedVerticalVernier(
      ctx,
      rightColCx,
      gaugesTopY + 6,
      146,
      lander.agl,
      200,
      'AGL M'
    );

    // Gauge E (Bottom-Right): THRUST Dial Gauge (directly under vertical scale, matching reference!)
    const thrustNorm = Math.min(1, lander.throttle / PHYSICS.OVERDRIVE_MULTIPLIER);
    const thrustCol = lander.overdrive ? COLORS.RED_KLAXON : COLORS.AMBER_CAUTION;
    this.drawChunkyNeedleDial(
      ctx,
      rightColCx,
      gaugesTopY + 210,
      dialR,
      thrustNorm,
      1.0 / PHYSICS.OVERDRIVE_MULTIPLIER,
      'THRUST',
      thrustCol,
      false
    );

    // Subsystem Integrity Footer inside Right Cluster
    if (clusterH >= 415) {
      ctx.font = 'bold 10px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      const sysBroken = lander.strutDamaged || lander.rcsDamaged;
      ctx.fillStyle = sysBroken ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY;
      const sysTxt = sysBroken
        ? `HULL ${Math.round(lander.hullIntegrity)}% // ${lander.strutDamaged ? 'GEAR-DMG ' : ''}${lander.rcsDamaged ? 'RCS-DMG' : ''}`
        : `HULL ${Math.round(lander.hullIntegrity)}% // ${state.bezel.sasEnabled ? 'SAS LOCK' : 'MANUAL'} // ${state.cameraZoom.toFixed(1)}X`;
      ctx.fillText(sysTxt, rx + clusterW * 0.5, ry + clusterH - 10);
    }

    // ---------------------------------------------------------------------
    // LEFT TACTICAL POD: ATTITUDE HORIZON GYRO + WIND COMPASS + <80M APPROACH WINDOW
    // ---------------------------------------------------------------------
    const lx = 22;
    const ly = 46;
    const leftW = 176;
    this.drawAttitudeAndWindPod(ctx, lx, ly, leftW, lander, sector, windKnots);

    const nearestPad = this.findNearestPadWithin(lander, sector.pads, PHYSICS.APPROACH_PROXIMITY_M);
    if (nearestPad && lander.alive && state.phase === 'FLIGHT') {
      this.drawProximityApproachSubWindow(
        ctx,
        lx,
        ly + 148,
        leftW,
        lander,
        nearestPad.pad,
        nearestPad.dist
      );
    }

    // Environmental Klaxons & MU-TH-UR Intercom Strip
    this.drawHazardAlerts(ctx, w, lander, sector, state.timeSec);

    if (state.activeCalloutText && state.activeCalloutTimer > 0) {
      this.drawIntercomBanner(ctx, w, h, state.activeCalloutText, state.timeSec);
    } else if (state.statusBannerText && state.statusBannerTimer > 0) {
      this.drawStatusToast(ctx, w, state.statusBannerText);
    }

    ctx.restore();
  }

  /**
   * Bold circular amber FUEL gauge with glowing slanted propellant wedge fill inside the dial
   * (modeled directly on the top circular FUEL gauge in the attached CRT monitor photo).
   */
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

    // Dim full horseshoe scale track
    ctx.strokeStyle = COLORS.AMBER_DIM;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, endAng);
    ctx.stroke();

    // Glowing active rim arc proportional to fuel
    const activeEnd = startAng + (endAng - startAng) * fuelRatio;
    if (fuelRatio > 0.01) {
      ctx.strokeStyle = activeCol;
      ctx.lineWidth = 4.0;
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAng, activeEnd);
      ctx.stroke();
    }

    // Clipped interior glowing slanted amber wedge block (matching reference photo!)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 5.5, 0, Math.PI * 2);
    ctx.clip();

    const innerTop = cy - (r - 8);
    const innerBot = cy + (r - 8);
    const fillTop = innerBot - (innerBot - innerTop) * fuelRatio;

    // Slanted cassette-futurism trapezoid propellant block
    ctx.fillStyle = activeCol;
    ctx.beginPath();
    ctx.moveTo(cx - r + 4, innerBot);
    ctx.lineTo(cx - r + 7, fillTop);
    ctx.lineTo(cx + r - 5 - (1 - fuelRatio) * 4, fillTop);
    ctx.lineTo(cx + r - 9, innerBot);
    ctx.closePath();
    ctx.fill();

    // Bright hot core highlight on top meniscus of wedge
    if (fuelRatio > 0.04) {
      ctx.strokeStyle = isCritical ? '#FF9A8A' : COLORS.AMBER_BRIGHT;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(cx - r + 7, fillTop);
      ctx.lineTo(cx + r - 5, fillTop);
      ctx.stroke();
    }
    ctx.restore();

    // Label & compact kg readout underneath
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px "Share Tech Mono", monospace';
    ctx.fillStyle = activeCol;
    ctx.fillText(label, cx, cy + r + 11);

    ctx.font = '9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText(subValue, cx, cy + r + 22);
    ctx.restore();
  }

  /**
   * Chunky 240-degree circular/semi-circular vector dial gauge with radial tick marks,
   * glowing amber arc sweep, and thick mechanical pointer needle.
   */
  private drawChunkyNeedleDial(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    value: number, // 0..1 (or -1..+1 if centerZero)
    safeTickRatio: number | undefined,
    label: string,
    activeCol: string,
    centerZero: boolean
  ): void {
    ctx.save();
    const startAng = (150 * Math.PI) / 180;
    const sweep = (240 * Math.PI) / 180;
    const endAng = startAng + sweep;

    // Background dim horseshoe arc
    ctx.strokeStyle = COLORS.AMBER_DIM;
    ctx.lineWidth = 3.6;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, endAng);
    ctx.stroke();

    // Active glowing amber arc fill
    let needleAng = startAng;
    ctx.strokeStyle = activeCol;
    ctx.lineWidth = 4.4;
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

    // Radial Tick Marks around inner perimeter
    const ticks = 8;
    for (let i = 0; i <= ticks; i++) {
      const frac = i / ticks;
      const a = startAng + frac * sweep;
      const innerLen = i % 2 === 0 ? 6.5 : 4.0;
      const lit = centerZero
        ? Math.abs(frac - 0.5) <= Math.abs(value) * 0.5 + 0.02
        : frac <= value + 0.02;
      ctx.strokeStyle = lit ? COLORS.AMBER_BRIGHT : COLORS.AMBER_DIM;
      ctx.lineWidth = i % 2 === 0 ? 1.8 : 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
      ctx.lineTo(cx + Math.cos(a) * (r - 2 - innerLen), cy + Math.sin(a) * (r - 2 - innerLen));
      ctx.stroke();
    }

    // Optional safe limit notch on rim
    if (safeTickRatio !== undefined) {
      const sa = startAng + Math.max(0, Math.min(1, safeTickRatio)) * sweep;
      ctx.strokeStyle = COLORS.GREEN_PRIMARY;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(sa) * (r - 5), cy + Math.sin(sa) * (r - 5));
      ctx.lineTo(cx + Math.cos(sa) * (r + 4), cy + Math.sin(sa) * (r + 4));
      ctx.stroke();
    }

    // Thick Mechanical Pointer Needle + Glowing Center Hub
    ctx.strokeStyle = COLORS.AMBER_BRIGHT;
    ctx.lineWidth = 3.0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(needleAng) * 4, cy - Math.sin(needleAng) * 4);
    ctx.lineTo(cx + Math.cos(needleAng) * (r - 5), cy + Math.sin(needleAng) * (r - 5));
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.fillStyle = activeCol;
    ctx.beginPath();
    ctx.arc(cx, cy, 3.6, 0, Math.PI * 2);
    ctx.fill();

    // Label underneath dial
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px "Share Tech Mono", monospace';
    ctx.fillStyle = activeCol;
    ctx.fillText(label, cx, cy + r + 12);
    ctx.restore();
  }

  /**
   * Stepped Vertical Green Vernier Scale (modeled directly on the tall glowing green
   * ladder instrument on the right side of the attached reference CRT monitor).
   */
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
    const ladderTop = topY + 16;
    const ladderH = totalH - 34;
    const ladderBot = ladderTop + ladderH;
    const colHalfW = 4.5;

    // Top Label
    ctx.textAlign = 'center';
    ctx.font = 'bold 10.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(topLabel, cx, topY + 10);

    // Dim vertical spine frame
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(cx - colHalfW, ladderTop, colHalfW * 2, ladderH);

    // Glowing green vertical bar fill proportional to altitude
    const norm = Math.max(0, Math.min(1, aglMeters / maxScaleM));
    const fillH = ladderH * norm;
    if (fillH > 1) {
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      ctx.fillRect(cx - colHalfW + 1.5, ladderBot - fillH, colHalfW * 2 - 3, fillH);
    }

    // Stepped horizontal vernier rungs left & right
    const rungs = 10;
    for (let i = 0; i <= rungs; i++) {
      const frac = i / rungs;
      const ry = ladderBot - frac * ladderH;
      const isMajor = i % 5 === 0 || i === 4; // i=4 is 80m approach gate!
      const rungSpan = isMajor ? 15 : 10;
      const lit = frac <= norm + 0.02;

      ctx.strokeStyle = lit ? COLORS.GREEN_PRIMARY : COLORS.GREEN_MID;
      ctx.lineWidth = isMajor ? 2.2 : 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - colHalfW - rungSpan, ry);
      ctx.lineTo(cx - colHalfW - 1, ry);
      ctx.moveTo(cx + colHalfW + 1, ry);
      ctx.lineTo(cx + colHalfW + rungSpan, ry);
      ctx.stroke();

      // Reference-style mid-ladder numeric callout ("80 -- 80") at 80m approach threshold
      if (i === 4) {
        ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
        ctx.fillStyle = COLORS.GREEN_BRIGHT;
        ctx.textAlign = 'right';
        ctx.fillText('80', cx - colHalfW - rungSpan - 3, ry + 3);
        ctx.textAlign = 'left';
        ctx.fillText('80', cx + colHalfW + rungSpan + 3, ry + 3);
      }
    }

    // Bright Horizontal Cursor Bug at live altitude
    const bugY = ladderBot - fillH;
    ctx.strokeStyle = COLORS.GREEN_BRIGHT;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(cx - 14, bugY);
    ctx.lineTo(cx + 14, bugY);
    ctx.stroke();

    // Bottom numeric AGL readout
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = aglMeters < 25 ? COLORS.AMBER_BRIGHT : COLORS.GREEN_BRIGHT;
    ctx.fillText(`${aglMeters.toFixed(1)}M`, cx, topY + totalH - 3);
    ctx.restore();
  }

  /**
   * Compact Left-Side Attitude Artificial Horizon Gyro + Wind Vector Compass Pod
   */
  private drawAttitudeAndWindPod(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    lander: LanderState,
    sector: SectorConfig,
    windKnots: number
  ): void {
    const h = 136;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 8, 4, 0.74)';
    ctx.fillRect(x, y, w, h);
    this.drawCornerBrackets(ctx, x, y, w, h, 10, COLORS.GREEN_DIM, 1.8);

    // Left Mini-Dial: Artificial Horizon Pitch Gyro
    const gyroCx = x + 46;
    const gyroCy = y + 58;
    const gyroR = 30;
    const pitchDeg = (lander.angle * 180) / Math.PI;
    const attSafe = Math.abs(pitchDeg) <= PHYSICS.SAFE_ANGLE_DEG;

    ctx.strokeStyle = attSafe ? COLORS.GREEN_PRIMARY : COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(gyroCx, gyroCy, gyroR, 0, Math.PI * 2);
    ctx.stroke();

    // Fixed +/-7 deg safe reference ticks
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(gyroCx - gyroR - 4, gyroCy);
    ctx.lineTo(gyroCx - gyroR + 5, gyroCy);
    ctx.moveTo(gyroCx + gyroR - 5, gyroCy);
    ctx.lineTo(gyroCx + gyroR + 4, gyroCy);
    ctx.stroke();

    // Rotating Shuttle Attitude Bar inside Gyro
    ctx.save();
    ctx.translate(gyroCx, gyroCy);
    ctx.rotate(lander.angle);
    ctx.strokeStyle = attSafe ? COLORS.GREEN_BRIGHT : COLORS.RED_KLAXON;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(-gyroR + 7, 0);
    ctx.lineTo(-7, 0);
    ctx.lineTo(0, -8);
    ctx.lineTo(7, 0);
    ctx.lineTo(gyroR - 7, 0);
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.font = 'bold 10px "Share Tech Mono", monospace';
    ctx.fillStyle = attSafe ? COLORS.GREEN_PRIMARY : COLORS.AMBER_CAUTION;
    ctx.fillText(`ATT ${pitchDeg >= 0 ? '+' : ''}${pitchDeg.toFixed(1)}°`, gyroCx, gyroCy + gyroR + 14);

    // Right Mini-Dial: Wind Vector Compass + Knots
    const windCx = x + 130;
    const windCy = y + 58;
    const windR = 30;
    const windCol = lander.inWindShear
      ? COLORS.RED_KLAXON
      : windKnots > 9
        ? COLORS.AMBER_CAUTION
        : COLORS.GREEN_PRIMARY;

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(windCx, windCy, windR, 0, Math.PI * 2);
    ctx.stroke();

    if (windKnots > 0.4) {
      const wAng = Math.atan2(-lander.currentWindVy, lander.currentWindVx);
      const tipX = windCx + Math.cos(wAng) * (windR - 6);
      const tipY = windCy + Math.sin(wAng) * (windR - 6);
      const tailX = windCx - Math.cos(wAng) * (windR - 10);
      const tailY = windCy - Math.sin(wAng) * (windR - 10);

      ctx.strokeStyle = windCol;
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(
        tipX - Math.cos(wAng - 0.5) * 8,
        tipY - Math.sin(wAng - 0.5) * 8
      );
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(
        tipX - Math.cos(wAng + 0.5) * 8,
        tipY - Math.sin(wAng + 0.5) * 8
      );
      ctx.stroke();
    } else {
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
      ctx.fillText('VACUUM', windCx, windCy + 3);
    }

    ctx.font = 'bold 10px "Share Tech Mono", monospace';
    ctx.fillStyle = windCol;
    ctx.fillText(`WIND ${windKnots.toFixed(0)}KT`, windCx, windCy + windR + 14);

    ctx.font = '9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(`GRAV ${sector.gravity.toFixed(2)} M/S²`, x + w * 0.5, y + h - 9);
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
    const boxH = 132;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 8, 4, 0.88)';
    ctx.fillRect(x, y, w, boxH);
    this.drawCornerBrackets(ctx, x, y, w, boxH, 10, COLORS.AMBER_CAUTION, 2.0);

    ctx.font = 'bold 11px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.textAlign = 'left';
    ctx.fillText(`PAD LOCK // ${pad.label}`, x + 9, y + 16);

    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.textAlign = 'right';
    ctx.fillText(`${distM.toFixed(0)}M`, x + w - 9, y + 16);

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
      const ry = y + 36 + idx * 19;
      ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText(r.label, x + 9, ry);

      ctx.textAlign = 'center';
      ctx.fillStyle = r.ok ? COLORS.GREEN_PRIMARY : COLORS.RED_KLAXON;
      ctx.fillText(r.val, x + w * 0.45, ry);

      ctx.textAlign = 'right';
      ctx.fillText(r.status, x + w - 9, ry);
    });

    const alignY = y + 100;
    const alignW = w - 18;
    const alignX = x + 9;
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(alignX, alignY, alignW, 20);

    const padCenter = (pad.x1 + pad.x2) * 0.5;
    const padHalfW = (pad.x2 - pad.x1) * 0.5;
    const viewHalfM = Math.max(22, padHalfW * 2.4);

    const padLeftPx = alignX + alignW * (0.5 - padHalfW / (viewHalfM * 2));
    const padRightPx = alignX + alignW * (0.5 + padHalfW / (viewHalfM * 2));
    ctx.fillStyle = 'rgba(255, 176, 0, 0.28)';
    ctx.fillRect(padLeftPx, alignY + 12, padRightPx - padLeftPx, 6);
    ctx.strokeStyle = COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(padLeftPx, alignY + 12);
    ctx.lineTo(padRightPx, alignY + 12);
    ctx.stroke();

    const offsetM = Math.max(-viewHalfM, Math.min(viewHalfM, lander.pos.x - padCenter));
    const shuttlePx = alignX + alignW * (0.5 + offsetM / (viewHalfM * 2));
    const spanHalfPx = (PHYSICS.STRUT_SPAN_HALF_X / (viewHalfM * 2)) * alignW;
    const aligned = Math.abs(lander.pos.x - padCenter) + PHYSICS.STRUT_SPAN_HALF_X <= padHalfW + 0.85;

    ctx.strokeStyle = aligned ? COLORS.GREEN_BRIGHT : COLORS.RED_KLAXON;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(shuttlePx - spanHalfPx, alignY + 8);
    ctx.lineTo(shuttlePx + spanHalfPx, alignY + 8);
    ctx.moveTo(shuttlePx, alignY + 3);
    ctx.lineTo(shuttlePx, alignY + 11);
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

    if (lander.ceilingClearance < 18) {
      alerts.push({ text: '!! OVERHEAD CEILING PROXIMITY !!', color: COLORS.RED_KLAXON });
    }
    if (lander.agl < 32 && lander.vel.y < -PHYSICS.SAFE_VS_MAX) {
      alerts.push({ text: '!! HIGH DESCENT RATE — PULL UP !!', color: COLORS.RED_KLAXON });
    }
    if (lander.inWindShear) {
      alerts.push({ text: 'CAUTION // ALTITUDE WIND SHEAR', color: COLORS.AMBER_CAUTION });
    }
    if (lander.inThermalUpdraft) {
      alerts.push({ text: 'CAUTION // THERMAL UPDRAFT PLUME', color: COLORS.AMBER_CAUTION });
    }
    if (sector.emInterference > 0.45 && lander.sensorCapacitor >= PHYSICS.DIR_LIDAR_COST) {
      alerts.push({
        text: 'ION WHITEOUT // [SPACE] OR [LEFT-CLICK] ACTIVE LIDAR',
        color: COLORS.GREEN_PRIMARY,
      });
    }

    if (alerts.length === 0) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    const centerSlotX = w * 0.46;
    alerts.slice(0, 2).forEach((al, idx) => {
      if (al.color === COLORS.RED_KLAXON && !pulse) return;
      const ay = 58 + idx * 24;
      const tw = ctx.measureText(al.text).width + 24;
      ctx.fillStyle = 'rgba(2, 8, 4, 0.88)';
      ctx.fillRect(centerSlotX - tw * 0.5, ay - 13, tw, 20);
      ctx.strokeStyle = al.color;
      ctx.lineWidth = 1.8;
      ctx.strokeRect(centerSlotX - tw * 0.5, ay - 13, tw, 20);
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
    const bw = Math.min(590, w - 260);
    const bh = 34;
    const bx = Math.max(24, w * 0.44 - bw * 0.5);
    const by = h - 54;

    ctx.fillStyle = 'rgba(2, 8, 4, 0.92)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = COLORS.GREEN_PRIMARY;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(bx, by, bw, bh);

    for (let i = 0; i < 5; i++) {
      const amp = 4 + Math.abs(Math.sin(timeSec * 18 + i * 1.4)) * 15;
      ctx.fillStyle = COLORS.AMBER_CAUTION;
      ctx.fillRect(bx + 10 + i * 5.5, by + bh * 0.5 - amp * 0.5, 3.5, amp);
    }

    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.textAlign = 'left';
    ctx.fillText(`MU-TH-UR // ${text}`, bx + 44, by + 21);
    ctx.restore();
  }

  private drawStatusToast(ctx: CanvasRenderingContext2D, w: number, text: string): void {
    ctx.save();
    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    const tw = ctx.measureText(text).width + 28;
    const cx = w * 0.46;
    const bx = cx - tw * 0.5;
    const by = 104;
    ctx.fillStyle = 'rgba(2, 8, 4, 0.9)';
    ctx.fillRect(bx, by, tw, 24);
    ctx.strokeStyle = COLORS.AMBER_CAUTION;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(bx, by, tw, 24);
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, by + 16);
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

    ctx.fillStyle = active ? 'rgba(68, 255, 119, 0.18)' : 'rgba(2, 8, 4, 0.88)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? accent : COLORS.GREEN_DIM;
    ctx.lineWidth = active ? 2.4 : 1.5;
    ctx.strokeRect(x, y, w, h);

    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = active ? COLORS.GREEN_BRIGHT : accent;
    ctx.textAlign = 'center';
    ctx.fillText(active ? `> ${label} <` : label, x + w * 0.5, y + h * 0.5 + 4.5);
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
    ctx.fillRect(20, 42, w - 40, h - 62);

    const boxW = Math.min(680, w - 80);
    const boxH = Math.min(360, h - 120);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.GREEN_PRIMARY, 2.4);

    ctx.font = 'bold 17px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.textAlign = 'left';
    ctx.fillText('INTERFACE 2037 // MU-TH-UR 6000 BOOT SEQUENCE', bx + 24, by + 36);

    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;

    let remaining = state.bootProgressChars;
    let cursorDrawn = false;
    BOOT_LINES.forEach((line, idx) => {
      const ly = by + 76 + idx * 28;
      if (remaining <= 0) return;
      const slice = line.slice(0, remaining);
      remaining -= line.length;
      ctx.fillText(slice, bx + 24, ly);
      if (remaining <= 0 && !cursorDrawn) {
        cursorDrawn = true;
        if (Math.sin(state.timeSec * 12) > 0) {
          const cw = ctx.measureText(slice).width;
          ctx.fillRect(bx + 26 + cw, ly - 11, 9, 14);
        }
      }
    });

    this.addButton(
      ctx,
      'boot-continue',
      w * 0.5 - 170,
      by + boxH - 52,
      340,
      36,
      '[SPACE / CLICK] POWER ON COMMAND BUS',
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
    const boxW = Math.min(720, w - 70);
    const boxH = Math.min(470, h - 90);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5 + 8;

    ctx.fillStyle = 'rgba(2, 8, 4, 0.92)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 20, COLORS.GREEN_PRIMARY, 2.4);

    ctx.textAlign = 'center';
    ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText('WEYLAND-YUTANI CORP // USCSS NOSTROMO DROP-SHUTTLE', w * 0.5, by + 32);

    ctx.font = 'bold 29px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText('ORBITAL DESCENT TELEMETRY', w * 0.5, by + 64);

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText('LV-426 / THEDUS VECTOR NAVIGATION & ACTIVE LIDAR SYSTEM', w * 0.5, by + 84);

    const btnW = Math.min(460, boxW - 60);
    const btnX = w * 0.5 - btnW * 0.5;
    const startY = by + 108;
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
        startY + idx * 44,
        btnW,
        35,
        it.label,
        state.menuCursor === idx,
        state.hoveredButtonId
      );
    });

    const legY = startY + 196;
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(bx + 24, legY, boxW - 48, boxH - (legY - by) - 18);

    ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.textAlign = 'left';
    ctx.fillText('FLIGHT DECK CONTROLS // DESKTOP INTERFACE', bx + 36, legY + 18);

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    const leftControls = [
      '[W / UP]       MAIN ENGINE (+SHIFT: MAX OVERDRIVE)',
      '[A / D]        RCS ATTITUDE ROTATION THRUSTERS',
      '[S / DOWN]     RETRO-STABILIZER ASSIST (DAMP DRIFT)',
      '[SPACEBAR]     OMNIDIRECTIONAL LIDAR TERRAIN SWEEP',
    ];
    const rightControls = [
      '[MOUSE AIM]    STEER NOSE SPOTLIGHT & SCANNER',
      '[LEFT-CLICK]   FOCUSED LONG-RANGE LIDAR PING',
      '[SCROLL WHEEL] TACTICAL CAMERA ZOOM (1.0X–3.5X)',
      '[R / ESC]      QUICK-RETRY SECTOR // COMMAND MENU',
    ];

    leftControls.forEach((txt, i) => {
      ctx.fillText(txt, bx + 36, legY + 40 + i * 19);
    });
    rightControls.forEach((txt, i) => {
      ctx.fillText(txt, bx + boxW * 0.52, legY + 40 + i * 19);
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
    const boxW = Math.min(650, w - 80);
    const boxH = 290;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(2, 8, 4, 0.94)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.AMBER_CAUTION, 2.4);

    ctx.textAlign = 'left';
    ctx.font = 'bold 16.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText(
      `MU-TH-UR 6000 // ${state.sector.code}: ${state.sector.name}`,
      bx + 22,
      by + 32
    );

    ctx.font = 'bold 11px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(state.sector.subtitle, bx + 22, by + 52);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx + 22, by + 62);
    ctx.lineTo(bx + boxW - 22, by + 62);
    ctx.stroke();

    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    let rem = state.briefingProgressChars;
    state.sector.briefingLines.forEach((line, i) => {
      if (rem <= 0) return;
      const shown = line.slice(0, rem);
      rem -= line.length;
      ctx.fillText(`> ${shown}`, bx + 22, by + 90 + i * 26);
    });

    this.addButton(
      ctx,
      'briefing-launch',
      w * 0.5 - 155,
      by + boxH - 50,
      310,
      35,
      '[SPACE / ENTER] RELEASE ORBITAL CLAMPS',
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
    const boxW = Math.min(620, w - 80);
    const boxH = 385;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(2, 8, 4, 0.94)';
    ctx.fillRect(bx, by, boxW, boxH);
    const gradeColor =
      bd.grade === 'SOFT_KISS'
        ? COLORS.GREEN_BRIGHT
        : bd.grade === 'HARD_SURVIVAL'
          ? COLORS.AMBER_CAUTION
          : COLORS.GREEN_PRIMARY;
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, gradeColor, 2.4);

    ctx.textAlign = 'left';
    ctx.font = 'bold 16.5px "Share Tech Mono", monospace';
    ctx.fillStyle = gradeColor;
    const gradeBanner =
      bd.grade === 'SOFT_KISS'
        ? 'TOUCHDOWN CONFIRMED // PRECISION KISS LANDING'
        : bd.grade === 'HARD_SURVIVAL'
          ? 'SURVIVAL TOUCHDOWN // HULL & GEAR DAMAGED'
          : 'TOUCHDOWN CONFIRMED // EXTRACTION NOMINAL';
    ctx.fillText(gradeBanner, bx + 22, by + 32);

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(
      `V/S: ${bd.touchdownVs.toFixed(2)} M/S  |  H/S: ${bd.touchdownHs.toFixed(2)} M/S  |  ATT: ${bd.touchdownDeg.toFixed(1)}°  |  RATING: ${bd.accuracyRating} (${bd.accuracyPercent}%)`,
      bx + 22,
      by + 52
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
      const ry = by + 88 + i * 28;
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
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
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx + 22, by + 236);
    ctx.lineTo(bx + boxW - 22, by + 236);
    ctx.stroke();

    ctx.font = 'bold 16.5px "Share Tech Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('SECTOR TELEMETRY SCORE', bx + 22, by + 264);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText(`+${Math.round(bd.sectorTotal * anim).toLocaleString()} PTS`, bx + boxW - 22, by + 264);

    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(`CUMULATIVE MISSION TOTAL: ${Math.round(state.missionScore).toLocaleString()} PTS`, bx + boxW - 22, by + 288);

    const isFinalCampaignSector =
      !state.sector.endlessMode && state.sector.index >= 6;
    this.addButton(
      ctx,
      'tally-next',
      w * 0.5 - 165,
      by + boxH - 52,
      330,
      36,
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
    const boxW = Math.min(560, w - 80);
    const boxH = 240;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(8, 3, 3, 0.9)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.RED_KLAXON, 2.6);

    ctx.textAlign = 'center';
    ctx.font = 'bold 21px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.RED_KLAXON;
    ctx.fillText('SIGNAL TERMINATED // HULL BREACH', w * 0.5, by + 40);

    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText(state.lastFailure?.reason ?? 'CATASTROPHIC STRUCTURAL IMPACT', w * 0.5, by + 68);

    if (state.lastFailure) {
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      ctx.fillText(
        `IMPACT TELEMETRY — V/S: ${state.lastFailure.impactVs.toFixed(1)} M/S | H/S: ${state.lastFailure.impactHs.toFixed(1)} M/S | ATT: ${state.lastFailure.impactDeg.toFixed(1)}°`,
        w * 0.5,
        by + 96
      );
    }

    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText('CONSECUTIVE DROP STREAK RESET TO 1X', w * 0.5, by + 122);

    this.addButton(
      ctx,
      'breach-retry',
      bx + 32,
      by + boxH - 58,
      235,
      36,
      '[R] RETRY SECTOR',
      true,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION
    );
    this.addButton(
      ctx,
      'breach-end',
      bx + boxW - 267,
      by + boxH - 58,
      235,
      36,
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
    const boxW = 420;
    const boxH = 260;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(2, 8, 4, 0.94)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 16, COLORS.GREEN_PRIMARY, 2.2);

    ctx.textAlign = 'center';
    ctx.font = 'bold 16.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText('MU-TH-UR 6000 // COMMAND INTERRUPT', w * 0.5, by + 34);

    this.addButton(
      ctx,
      'pause-resume',
      bx + 45,
      by + 64,
      330,
      36,
      '[ESC] RESUME DESCENT',
      state.menuCursor === 0,
      state.hoveredButtonId
    );
    this.addButton(
      ctx,
      'pause-retry',
      bx + 45,
      by + 114,
      330,
      36,
      '[R] QUICK-RETRY SECTOR',
      state.menuCursor === 1,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION
    );
    this.addButton(
      ctx,
      'pause-abort',
      bx + 45,
      by + 164,
      330,
      36,
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
    const boxW = Math.min(600, w - 80);
    const boxH = 270;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(2, 8, 4, 0.95)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.GREEN_BRIGHT, 2.4);

    ctx.textAlign = 'center';
    ctx.font = 'bold 20px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('ALL 6 LV-426 CAMPAIGN SECTORS EXTRACTED', w * 0.5, by + 42);

    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText(
      `FINAL TELEMETRY SCORE: ${Math.round(state.missionScore).toLocaleString()} PTS`,
      w * 0.5,
      by + 80
    );

    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      'USCSS NOSTROMO / NARCISSUS ORBITAL DOCKING SEQUENCE COMPLETE.',
      w * 0.5,
      by + 112
    );

    this.addButton(
      ctx,
      'complete-endless',
      bx + 35,
      by + boxH - 64,
      255,
      38,
      'CONTINUE DEEP-SURVEY',
      true,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION
    );
    this.addButton(
      ctx,
      'complete-manifest',
      bx + boxW - 290,
      by + boxH - 64,
      255,
      38,
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
    const boxW = Math.min(540, w - 80);
    const boxH = 260;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(2, 8, 4, 0.95)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.AMBER_CAUTION, 2.4);

    ctx.textAlign = 'center';
    ctx.font = 'bold 18px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText('TOP-10 CREW MANIFEST QUALIFICATION', w * 0.5, by + 38);

    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      `MISSION SCORE: ${Math.round(state.missionScore).toLocaleString()} PTS // ENTER OFFICER CALLSIGN`,
      w * 0.5,
      by + 68
    );

    const inW = 280;
    const inX = w * 0.5 - inW * 0.5;
    const inY = by + 96;
    ctx.strokeStyle = COLORS.GREEN_BRIGHT;
    ctx.lineWidth = 2.2;
    ctx.strokeRect(inX, inY, inW, 44);

    const blink = Math.sin(state.timeSec * 10) > 0 ? '_' : ' ';
    ctx.font = 'bold 22px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText(`${state.callsignDraft}${blink}`, w * 0.5, inY + 30);

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText('TYPE CALLSIGN (A–Z, 0–9) AND PRESS [ENTER]', w * 0.5, by + 166);

    this.addButton(
      ctx,
      'callsign-submit',
      w * 0.5 - 130,
      by + boxH - 54,
      260,
      36,
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
    const boxW = Math.min(700, w - 60);
    const boxH = Math.min(450, h - 70);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.fillStyle = 'rgba(2, 8, 4, 0.96)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.GREEN_PRIMARY, 2.4);

    ctx.textAlign = 'left';
    ctx.font = 'bold 16.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText('MU-TH-UR 6000 // PERSISTENT CREW MANIFEST (TOP 10)', bx + 22, by + 32);

    const headY = by + 60;
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText('RNK', bx + 22, headY);
    ctx.fillText('CALLSIGN', bx + 72, headY);
    ctx.fillText('SECTOR', bx + 205, headY);
    ctx.fillText('ACCURACY', bx + 305, headY);
    ctx.fillText('DATE', bx + 420, headY);
    ctx.textAlign = 'right';
    ctx.fillText('SCORE', bx + boxW - 22, headY);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx + 22, headY + 7);
    ctx.lineTo(bx + boxW - 22, headY + 7);
    ctx.stroke();

    state.manifestEntries.slice(0, 10).forEach((entry, idx) => {
      const ry = headY + 26 + idx * 23;
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = idx === 0 ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
      ctx.fillText(`#${String(idx + 1).padStart(2, '0')}`, bx + 22, ry);
      ctx.fillText(entry.callsign, bx + 72, ry);
      ctx.fillText(entry.highestSector, bx + 205, ry);
      ctx.fillText(`${entry.accuracyRating} (${entry.accuracyPercent}%)`, bx + 305, ry);
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.fillText(entry.date, bx + 420, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = idx === 0 ? COLORS.AMBER_CAUTION : COLORS.GREEN_BRIGHT;
      ctx.fillText(entry.score.toLocaleString(), bx + boxW - 22, ry);
    });

    const logY = by + boxH - 86;
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.beginPath();
    ctx.moveTo(bx + 22, logY);
    ctx.lineTo(bx + boxW - 22, logY);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    const recent = state.sessionLogs.slice(-2);
    recent.forEach((line, i) => {
      ctx.fillText(`LOG> ${line}`, bx + 22, logY + 18 + i * 15);
    });

    this.addButton(
      ctx,
      'logs-close',
      w * 0.5 - 125,
      by + boxH - 42,
      250,
      30,
      '[ESC / CLICK] CLOSE LOGS',
      true,
      state.hoveredButtonId
    );
    ctx.restore();
  }
}
