import { COLORS, PHYSICS } from '../constants';
import type { SafeAreaInsets } from '../types';
import type { SectorMapSummary } from './CampaignMapRenderer';
import {
  HudRenderer,
  type CrtInteractiveButton,
  type HudRenderContext,
} from './HudRenderer';

export interface MobileActiveTouchState {
  thrust: boolean;
  overdrive: boolean;
  rollLeft: boolean;
  rollRight: boolean;
  retro: boolean;
}

export class MobileHudRenderer {
  public static getSafeCorridor(
    w: number,
    h: number,
    insets: SafeAreaInsets,
    isFullscreen = false
  ): { topPx: number; bottomPx: number; deckHeightPx: number; bottomPadPx: number } {
    const isLandscape = w > h * 1.15;
    const deckH = isLandscape ? 108 : 136;
    const topPx = Math.max(isFullscreen ? 10 : 8, insets.top) + 54;
    // Extra fullscreen bottom clearance keeps touch buttons clear of curved OLED corners & OS gesture bar
    const fsExtraBot = isFullscreen ? (isLandscape ? 16 : 24) : 0;
    const bottomPadPx = Math.max(12 + fsExtraBot, insets.bottom + 8 + fsExtraBot);
    const bottomPx = h - bottomPadPx - deckH - 6;
    return {
      topPx,
      bottomPx: Math.max(topPx + 110, bottomPx),
      deckHeightPx: deckH,
      bottomPadPx,
    };
  }

  public render(
    ctx: CanvasRenderingContext2D,
    state: HudRenderContext,
    insets: SafeAreaInsets,
    sectorSummaries: readonly SectorMapSummary[],
    touchHoldState: MobileActiveTouchState,
    buttonsOut: CrtInteractiveButton[],
    touchControlsOut: CrtInteractiveButton[]
  ): void {
    const w = state.width;
    const h = state.height;

    if (state.phase === 'TITLE_MENU') {
      this.drawMobileTitleMenu(ctx, w, h, state, insets, sectorSummaries, buttonsOut);
    } else {
      this.drawMobileTopBar(ctx, w, state, insets, buttonsOut);

      if (state.phase === 'SECTOR_BRIEFING') {
        this.drawMobileBriefingModal(ctx, w, h, state, buttonsOut);
      } else {
        this.drawMobileGoNoGoAndWarnings(ctx, w, h, state, insets);

        if (state.phase === 'FLIGHT') {
          this.drawMobileTouchFlightDeck(
            ctx,
            w,
            h,
            state,
            insets,
            touchHoldState,
            buttonsOut,
            touchControlsOut
          );
        } else if (state.phase === 'PAUSED') {
          this.drawMobileSystemMenuModal(ctx, w, h, state, buttonsOut);
        } else if (state.phase === 'SECTOR_TALLY' && state.lastBreakdown) {
          this.drawMobileTallyModal(ctx, w, h, state, buttonsOut);
        } else if (state.phase === 'HULL_BREACH') {
          this.drawMobileBreachModal(ctx, w, h, state, buttonsOut);
        } else if (state.phase === 'CALLSIGN_ENTRY') {
          this.drawMobileCallsignModal(ctx, w, h, state, buttonsOut);
        } else if (state.phase === 'CAMPAIGN_COMPLETE') {
          this.drawMobileCampaignCompleteModal(ctx, w, h, state, buttonsOut);
        }
      }
    }

    if (state.bezel.osdMenuOpen) {
      this.drawMobileSystemMenuModal(ctx, w, h, state, buttonsOut);
    } else if (state.bezel.flightLogsOpen) {
      this.drawMobileManifestModal(ctx, w, h, state, insets, buttonsOut);
    }
  }

  private addTouchButton(
    ctx: CanvasRenderingContext2D,
    buttonsOut: CrtInteractiveButton[],
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    selected: boolean,
    hoveredId: string | null,
    accent: string = COLORS.GREEN_PRIMARY,
    solidFill = false,
    fontPx = 15
  ): void {
    buttonsOut.push({ id, rect: { x, y, width: w, height: h }, label });
    const active = selected || hoveredId === id;

    let fitPx = fontPx;
    ctx.font = `bold ${fitPx}px "Share Tech Mono", monospace`;
    while (fitPx > 11 && ctx.measureText(label).width > w - 10) {
      fitPx -= 0.5;
      ctx.font = `bold ${fitPx}px "Share Tech Mono", monospace`;
    }
    const textBaseY = y + h * 0.5 + Math.round(fitPx * 0.34);

    if (solidFill) {
      ctx.fillStyle = active ? COLORS.AMBER_BRIGHT : COLORS.AMBER_CAUTION;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#FFF2CC';
      ctx.lineWidth = 2.4;
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = '#040905';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + w * 0.5, textBaseY);
      return;
    }

    ctx.fillStyle = active ? 'rgba(54, 201, 94, 0.22)' : 'rgba(6, 16, 10, 0.92)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? accent : COLORS.GREEN_DIM;
    ctx.lineWidth = active ? 2.4 : 1.7;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = active ? '#FFFFFF' : accent;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w * 0.5, textBaseY);
  }

  // =========================================================================
  // 1. MOBILE MAIN MENU (WITH RED RANKED HEADER, 6-SECTOR MAP & [COMMIT])
  // =========================================================================

  private drawMobileTitleMenu(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    insets: SafeAreaInsets,
    sectorSummaries: readonly SectorMapSummary[],
    buttonsOut: CrtInteractiveButton[]
  ): void {
    ctx.save();
    ctx.fillStyle = COLORS.BG_DEEP;
    ctx.fillRect(0, 0, w, h);

    // Subtle background grid
    ctx.strokeStyle = 'rgba(20, 62, 34, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 0; gx < w; gx += 42) {
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
    }
    for (let gy = 0; gy < h; gy += 42) {
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
    }
    ctx.stroke();

    const padX = Math.max(12, insets.left + 10, insets.right + 10);
    const topY = Math.max(state.isFullscreen ? 12 : 10, insets.top + 8);
    const fsBotExtra = state.isFullscreen ? 24 : 0;
    const botPad = Math.max(12 + fsBotExtra, insets.bottom + 10 + fsBotExtra);
    const contentW = Math.min(540, w - padX * 2);
    const cx = w * 0.5;
    const leftX = cx - contentW * 0.5;

    // Top Quick Utility Bar (>=44px touch targets)
    const utilH = 44;
    const utilGap = 6;
    const utilW = Math.floor((contentW - utilGap * 3) / 4);
    const utils = [
      {
        id: 'hud-mute-toggle',
        label: state.bezel.audioMuted ? 'SND:OFF' : 'SND:ON',
        accent: state.bezel.audioMuted ? COLORS.RED_KLAXON : COLORS.GREEN_BRIGHT,
        active: !state.bezel.audioMuted,
      },
      {
        id: 'hud-fullscreen-toggle',
        label: state.isFullscreen ? 'EXIT FL' : 'FULLSCR',
        accent: COLORS.AMBER_BRIGHT,
        active: state.isFullscreen,
      },
      {
        id: 'hud-logs-toggle',
        label: 'SCORES',
        accent: '#FFB000',
        active: state.bezel.flightLogsOpen,
      },
      {
        id: 'hud-osd-toggle',
        label: 'MENU',
        accent: COLORS.GREEN_BRIGHT,
        active: state.bezel.osdMenuOpen,
      },
    ];
    utils.forEach((u, idx) => {
      this.addTouchButton(
        ctx,
        buttonsOut,
        u.id,
        leftX + idx * (utilW + utilGap),
        topY,
        utilW,
        utilH,
        u.label,
        u.active,
        state.hoveredButtonId,
        u.accent,
        false,
        14
      );
    });

    let curY = topY + utilH + 10;
    const isRanked = state.selectedMenuMode === 'RANKED_CAMPAIGN';
    const isPractice = state.selectedMenuMode === 'PRACTICE';
    const isEndless = state.selectedMenuMode === 'ENDLESS';

    // Title: Turns RED when Ranked Campaign is selected!
    ctx.textAlign = 'center';
    ctx.font = w < 380 ? 'bold 23px "Share Tech Mono", monospace' : 'bold 27px "Share Tech Mono", monospace';
    ctx.fillStyle = isRanked ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY;
    ctx.fillText('ORBITAL DESCENT TELEMETRY', cx, curY + 20);
    curY += 28;

    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillStyle = isRanked ? COLORS.AMBER_BRIGHT : COLORS.GREEN_PRIMARY;
    ctx.fillText(
      isRanked
        ? '★ RANKED 6-SECTOR GAUNTLET // 3 SHUTTLES ★'
        : isPractice
          ? `PRACTICE SINGLE MAP // SEC-0${state.selectedStartSector} OF 06`
          : 'ENDLESS PROCEDURAL SURVEY // RANKED',
      cx,
      curY + 8
    );
    curY += 16;

    // Compact Live Global #01 Leader Strip
    const champH = 42;
    ctx.fillStyle = 'rgba(22, 14, 3, 0.80)';
    ctx.fillRect(leftX, curY, contentW, champH);
    ctx.strokeStyle = '#FFB000';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(leftX, curY, contentW, champH);

    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFB000';
    const campChamp = state.campaignLeader
      ? `${state.campaignLeader.callsign} (${state.campaignLeader.score.toLocaleString()})`
      : 'UNCLAIMED';
    const endChamp = state.endlessLeader
      ? `${state.endlessLeader.callsign} (${state.endlessLeader.score.toLocaleString()})`
      : 'UNCLAIMED';
    ctx.fillText(`#1 CAMPAIGN: ${campChamp}`, leftX + 8, curY + 17);
    ctx.fillText(`#1 ENDLESS:  ${endChamp}`, leftX + 8, curY + 35);
    curY += champH + 8;

    // 6-Sector Campaign Descent Mini-Map Grid (2 rows x 3 cols)
    // Glows ALL ORANGE when Ranked Campaign is chosen; sub-clickable in Practice Mode!
    const availBeforeButtons = Math.max(92, h - botPad - curY - 236);
    const mapGridH = Math.min(162, availBeforeButtons);
    const cols = 3;
    const rows = 2;
    const tileGap = 6;
    const tileW = Math.floor((contentW - tileGap * (cols - 1)) / cols);
    const tileH = Math.max(44, Math.floor((mapGridH - tileGap) / rows));

    sectorSummaries.slice(0, 6).forEach((s, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const tx = leftX + col * (tileW + tileGap);
      const ty = curY + row * (tileH + tileGap);
      const tileId = `menu-map-sec-${s.num}`;
      buttonsOut.push({
        id: tileId,
        rect: { x: tx, y: ty, width: tileW, height: tileH },
        label: `SEC-0${s.num}`,
      });

      const pracSel = isPractice && state.selectedStartSector === s.num;
      ctx.fillStyle = isRanked
        ? 'rgba(54, 24, 4, 0.90)'
        : pracSel
          ? 'rgba(20, 56, 30, 0.92)'
          : 'rgba(5, 14, 9, 0.85)';
      ctx.fillRect(tx, ty, tileW, tileH);

      ctx.strokeStyle = isRanked
        ? COLORS.AMBER_CAUTION
        : pracSel
          ? COLORS.GREEN_BRIGHT
          : COLORS.GREEN_DIM;
      ctx.lineWidth = isRanked || pracSel ? 2.2 : 1.3;
      ctx.strokeRect(tx, ty, tileW, tileH);

      ctx.textAlign = 'left';
      ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
      ctx.fillStyle = isRanked
        ? COLORS.AMBER_BRIGHT
        : pracSel
          ? COLORS.GREEN_BRIGHT
          : COLORS.GREEN_PRIMARY;
      ctx.fillText(`0${s.num}/06`, tx + 5, ty + 14);

      ctx.textAlign = 'right';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.fillStyle = isRanked ? '#FFB000' : pracSel ? '#FFFFFF' : COLORS.GREEN_MID;
      ctx.fillText(isRanked ? 'RANKED' : pracSel ? '►DROP' : s.code, tx + tileW - 5, ty + 14);

      // Mini terrain & ceiling vector trace inside tile
      const mx = tx + 4;
      const my = ty + 17;
      const mw = tileW - 8;
      const mh = Math.max(18, tileH - 21);
      const sec = s.sector;
      const toX = (wx: number) => mx + (wx / sec.worldWidth) * mw;
      const toY = (wy: number) => my + mh - (wy / (sec.worldHeight * 0.95)) * mh;

      if (sec.ceiling && sec.ceiling.length > 1) {
        ctx.strokeStyle = isRanked ? 'rgba(255, 140, 0, 0.65)' : COLORS.GREEN_DIM;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let k = 0; k < sec.ceiling.length; k += 4) {
          const px = toX(sec.ceiling[k].x);
          const py = Math.max(my, Math.min(my + mh, toY(sec.ceiling[k].y)));
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      ctx.strokeStyle = isRanked
        ? COLORS.AMBER_BRIGHT
        : pracSel
          ? COLORS.GREEN_BRIGHT
          : COLORS.GREEN_PRIMARY;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k < sec.terrain.length; k += 4) {
        const px = toX(sec.terrain[k].x);
        const py = Math.max(my, Math.min(my + mh, toY(sec.terrain[k].y)));
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    });

    curY += tileH * 2 + tileGap + 8;

    // Dedicated Mode Selector Buttons + Bottom Orange [COMMIT] Button (all >=44px tall)
    const btnH = 44;
    const btnGap = 6;

    this.addTouchButton(
      ctx,
      buttonsOut,
      'menu-select-ranked',
      leftX,
      curY,
      contentW,
      btnH,
      isRanked ? '★ RANKED CAMPAIGN (ALL 6 SECTORS) ★' : 'RANKED CAMPAIGN (ALL 6 SECTORS)',
      isRanked,
      state.hoveredButtonId,
      isRanked ? COLORS.AMBER_BRIGHT : COLORS.AMBER_CAUTION,
      false,
      15.5
    );
    curY += btnH + btnGap;

    this.addTouchButton(
      ctx,
      buttonsOut,
      'menu-select-practice',
      leftX,
      curY,
      contentW,
      btnH,
      isPractice
        ? `► PRACTICE: SEC-0${state.selectedStartSector} (SINGLE MAP) ◄`
        : `PRACTICE MODE (TAP ANY MAP 01–06 ABOVE)`,
      isPractice,
      state.hoveredButtonId,
      COLORS.GREEN_BRIGHT,
      false,
      15
    );
    curY += btnH + btnGap;

    this.addTouchButton(
      ctx,
      buttonsOut,
      'menu-select-endless',
      leftX,
      curY,
      contentW,
      btnH,
      isEndless ? '► ENDLESS DEEP-SURVEY (RANKED) ◄' : 'ENDLESS DEEP-SURVEY (RANKED)',
      isEndless,
      state.hoveredButtonId,
      COLORS.GREEN_PRIMARY,
      false,
      15
    );
    curY += btnH + btnGap + 2;

    // Prominent Solid-Orange [COMMIT] Button at Bottom!
    const commitLabel = isRanked
      ? '[ COMMIT ] — LAUNCH RANKED CAMPAIGN'
      : isPractice
        ? `[ COMMIT ] — PRACTICE SEC-0${state.selectedStartSector}`
        : '[ COMMIT ] — LAUNCH ENDLESS SURVEY';
    this.addTouchButton(
      ctx,
      buttonsOut,
      'menu-commit',
      leftX,
      curY,
      contentW,
      48,
      commitLabel,
      true,
      state.hoveredButtonId,
      COLORS.AMBER_BRIGHT,
      true,
      16.5
    );
    curY += 54;

    // Smart SAS Explanation Note below [COMMIT] on Mobile Menu (auto-fitted to contentW!)
    const sasMobileNote = state.bezel.sasEnabled
      ? 'SAS [ON]: 50% GENTLE ROLL (NO AUTO-LEVEL)'
      : 'SAS [OFF]: 50% GENTLE ROLL (NO AUTO-LEVEL)';
    let sasFontPx = 13.5;
    ctx.font = `bold ${sasFontPx}px "Share Tech Mono", monospace`;
    while (sasFontPx > 10.5 && ctx.measureText(sasMobileNote).width > contentW - 8) {
      sasFontPx -= 0.5;
      ctx.font = `bold ${sasFontPx}px "Share Tech Mono", monospace`;
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = state.bezel.sasEnabled ? COLORS.GREEN_BRIGHT : '#FFB000';
    ctx.fillText(sasMobileNote, cx, curY + 11);

    ctx.restore();
  }

  // =========================================================================
  // 2. SPACE-PRESERVING MOBILE IN-FLIGHT TOP BAR + GO/CAUTION/NO-GO + DECK
  // =========================================================================

  private drawMobileTopBar(
    ctx: CanvasRenderingContext2D,
    w: number,
    state: HudRenderContext,
    insets: SafeAreaInsets,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    ctx.save();
    const topY = Math.max(state.isFullscreen ? 8 : 6, insets.top + 4);
    const padL = Math.max(8, insets.left + 8);
    const padR = Math.max(8, insets.right + 8);
    const barH = 46;

    ctx.fillStyle = 'rgba(3, 9, 5, 0.88)';
    ctx.fillRect(0, 0, w, topY + barH + 4);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(padL, topY + barH + 2);
    ctx.lineTo(w - padR, topY + barH + 2);
    ctx.stroke();

    // Left: 3 Shuttle Life Pips + Score + Fuel Bar
    const lowLives = state.lives === 1;
    for (let i = 0; i < state.maxLives; i++) {
      const alive = i < state.lives;
      const sx = padL + i * 18;
      const sy = topY + 6;
      ctx.fillStyle = alive ? (lowLives ? '#FFB000' : '#44FF77') : 'rgba(90, 20, 14, 0.5)';
      ctx.strokeStyle = alive ? (lowLives ? '#FFB000' : COLORS.GREEN_PRIMARY) : COLORS.RED_DIM;
      ctx.lineWidth = 1.4;
      ctx.fillRect(sx, sy, 13, 14);
      ctx.strokeRect(sx, sy, 13, 14);
    }

    ctx.textAlign = 'left';
    ctx.font = 'bold 17.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText(
      String(Math.round(state.displayedScore)).padStart(6, '0'),
      padL + 58,
      topY + 19
    );

    // Compact Fuel Progress Bar underneath score & lives
    const fuelRatio = Math.max(0, Math.min(1, state.lander.fuelKg / Math.max(1, state.lander.maxFuelKg)));
    const fBarW = Math.min(138, Math.max(92, w * 0.31));
    const fBarY = topY + 25;
    ctx.strokeStyle = COLORS.AMBER_DIM;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(padL, fBarY, fBarW, 16);
    ctx.fillStyle = fuelRatio <= 0.18 ? COLORS.RED_KLAXON : COLORS.AMBER_CAUTION;
    ctx.fillRect(padL + 2, fBarY + 2, Math.max(0, (fBarW - 4) * fuelRatio), 12);

    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`FUEL ${state.lander.fuelKg.toFixed(0)}K`, padL + 5, fBarY + 12.5);

    // Right: >=44x44 Touch Buttons [SAS] [FULL] [MENU]
    const btnW = 56;
    const btnH = 44;
    const gap = 6;
    let rx = w - padR - btnW;

    this.addTouchButton(
      ctx,
      buttonsOut,
      'hud-osd-toggle',
      rx,
      topY + 1,
      btnW,
      btnH,
      'MENU',
      state.bezel.osdMenuOpen,
      state.hoveredButtonId,
      '#FFB000',
      false,
      14
    );
    rx -= btnW + gap;

    this.addTouchButton(
      ctx,
      buttonsOut,
      'hud-fullscreen-toggle',
      rx,
      topY + 1,
      btnW,
      btnH,
      state.isFullscreen ? 'EXIT' : 'FULL',
      state.isFullscreen,
      state.hoveredButtonId,
      COLORS.AMBER_BRIGHT,
      false,
      14
    );
    rx -= btnW + gap;

    this.addTouchButton(
      ctx,
      buttonsOut,
      'hud-sas-toggle',
      rx,
      topY + 1,
      btnW,
      btnH,
      state.bezel.sasEnabled ? 'SAS:50%' : 'SAS:OFF',
      state.bezel.sasEnabled,
      state.hoveredButtonId,
      state.bezel.sasEnabled ? COLORS.GREEN_BRIGHT : COLORS.AMBER_CAUTION,
      false,
      13.5
    );

    ctx.restore();
  }

  private drawMobileGoNoGoAndWarnings(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    insets: SafeAreaInsets
  ): void {
    const lander = state.lander;
    const snap =
      (state.phase === 'SECTOR_TALLY' || state.phase === 'HULL_BREACH') && state.touchdownSnapshot
        ? state.touchdownSnapshot
        : null;

    // Find closest pad
    let closestPad = snap?.pad ?? null;
    let closestDist = snap?.dist ?? Infinity;
    if (!snap) {
      for (const p of state.sector.pads) {
        const cx = (p.x1 + p.x2) * 0.5;
        const d = Math.hypot(lander.pos.x - cx, lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y - p.y);
        if (d < closestDist) {
          closestDist = d;
          closestPad = p;
        }
      }
    }

    const corridor = MobileHudRenderer.getSafeCorridor(w, h, insets, state.isFullscreen);

    if (closestPad && (snap !== null || (lander.alive && closestDist <= PHYSICS.APPROACH_PROXIMITY_M))) {
      const vs = snap ? snap.vs : Math.abs(Math.min(0, lander.vel.y));
      const hs = snap ? snap.hs : Math.abs(lander.vel.x);
      const deg = snap ? snap.deg : Math.abs((lander.angle * 180) / Math.PI);
      const padCx = (closestPad.x1 + closestPad.x2) * 0.5;
      const offsetM = snap ? snap.offsetM : lander.pos.x - padCx;
      const padHalfW = Math.max(1, (closestPad.x2 - closestPad.x1) * 0.5);
      const safeBoundM = Math.max(1.0, padHalfW - PHYSICS.STRUT_SPAN_HALF_X + 0.85);
      const kissBoundM = Math.min(padHalfW * 0.48, safeBoundM);

      const cards = [
        {
          lbl: 'V/S',
          val: `${vs.toFixed(1)}`,
          kiss: vs < PHYSICS.KISS_VS_MAX,
          go: vs <= PHYSICS.SAFE_VS_MAX,
          fatal: vs > PHYSICS.SURVIVAL_VS_MAX,
        },
        {
          lbl: 'H/S',
          val: `${hs.toFixed(1)}`,
          kiss: hs < PHYSICS.KISS_HS_MAX,
          go: hs <= PHYSICS.SAFE_HS_MAX,
          fatal: hs > PHYSICS.SURVIVAL_HS_MAX,
        },
        {
          lbl: 'ATT',
          val: `${deg.toFixed(0)}°`,
          kiss: deg <= 3.0,
          go: deg <= PHYSICS.SAFE_ANGLE_DEG,
          fatal: deg > PHYSICS.SURVIVAL_ANGLE_DEG,
        },
      ];

      const panelW = Math.min(404, w - 12);
      const panelX = (w - panelW) * 0.5;
      const panelY = corridor.topPx + 2;
      const panelH = 62;

      ctx.save();
      ctx.fillStyle = 'rgba(3, 9, 5, 0.92)';
      ctx.fillRect(panelX, panelY, panelW, panelH);
      ctx.strokeStyle = COLORS.GREEN_DIM;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(panelX, panelY, panelW, panelH);

      const cGap = 5;
      const cW = (panelW - 12 - cGap * 2) / 3;
      cards.forEach((c, idx) => {
        const cx = panelX + 6 + idx * (cW + cGap);
        const col = c.go ? COLORS.GREEN_PRIMARY : c.fatal ? COLORS.RED_KLAXON : COLORS.AMBER_CAUTION;
        const tag = c.kiss ? 'KISS' : c.go ? 'GO' : c.fatal ? 'NO-GO' : 'CAUTION';

        ctx.strokeStyle = col;
        ctx.lineWidth = 1.7;
        ctx.strokeRect(cx, panelY + 4, cW, 31);

        ctx.textAlign = 'left';
        ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(`${c.lbl} ${c.val}`, cx + 4, panelY + 24);

        ctx.textAlign = 'right';
        ctx.font = 'bold 12px "Share Tech Mono", monospace';
        ctx.fillStyle = col;
        ctx.fillText(tag, cx + cW - 4, panelY + 24);
      });

      // Mini Soft-Kiss ILS Centerline Strip
      const ilsX = panelX + 8;
      const ilsW = panelW - 16;
      const ilsY = panelY + 41;
      const ilsH = 15;
      const maxRangeM = Math.max(15, padHalfW * 1.85);
      const toX = (m: number) =>
        ilsX + ilsW * (0.5 + Math.max(-0.48, Math.min(0.48, m / (maxRangeM * 2))));

      ctx.fillStyle = 'rgba(2, 6, 4, 0.96)';
      ctx.fillRect(ilsX, ilsY, ilsW, ilsH);
      ctx.strokeStyle = COLORS.GREEN_DIM;
      ctx.strokeRect(ilsX, ilsY, ilsW, ilsH);

      const kl = toX(-kissBoundM);
      const kr = toX(kissBoundM);
      ctx.fillStyle = 'rgba(59, 224, 104, 0.24)';
      ctx.fillRect(kl, ilsY + 1, kr - kl, ilsH - 2);

      const bugX = toX(offsetM);
      const inKiss = Math.abs(offsetM) <= kissBoundM;
      const inSafe = Math.abs(offsetM) <= safeBoundM;
      ctx.fillStyle = inKiss
        ? COLORS.GREEN_BRIGHT
        : inSafe
          ? COLORS.AMBER_BRIGHT
          : COLORS.RED_KLAXON;
      ctx.beginPath();
      ctx.moveTo(bugX, ilsY + 2);
      ctx.lineTo(bugX + 5, ilsY + ilsH * 0.5);
      ctx.lineTo(bugX, ilsY + ilsH - 2);
      ctx.lineTo(bugX - 5, ilsY + ilsH * 0.5);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    // Compact Airbus Warning Pill right above the Touch Flight Deck
    if (state.phase === 'FLIGHT' && lander.alive) {
      const warnings = HudRenderer.computeAvionicsWarnings(lander, state.emBlackoutActive);
      if (warnings.length > 0) {
        const primary = warnings[0];
        const wy = corridor.bottomPx - 36;
        const label = primary.critical ? `▲ ${primary.text} ▲` : `◆ ${primary.text} ◆`;
        ctx.save();
        ctx.font = 'bold 16.5px "Share Tech Mono", monospace';
        const bw = Math.min(w - 20, ctx.measureText(label).width + 30);
        const bx = (w - bw) * 0.5;
        ctx.fillStyle = primary.critical ? 'rgba(32, 5, 4, 0.94)' : 'rgba(22, 14, 3, 0.94)';
        ctx.fillRect(bx, wy, bw, 30);
        ctx.strokeStyle = primary.critical ? COLORS.RED_KLAXON : COLORS.AMBER_CAUTION;
        ctx.lineWidth = 2.2;
        ctx.strokeRect(bx, wy, bw, 30);
        ctx.fillStyle = primary.critical ? '#FF7862' : COLORS.AMBER_BRIGHT;
        ctx.textAlign = 'center';
        ctx.fillText(label, w * 0.5, wy + 21);
        ctx.restore();
      }
    }
  }

  /**
   * Ergonomic Dual-Thumb Multi-Touch 1979 Nostromo Flight Deck along bottom safe-area:
   * - Left Thumb: [ ◄ ROLL L ]  [ ▼ BRAKE ]  [ ROLL R ► ]
   * - Center: Radar Charge Cells (Tap anywhere on terrain/cavern to ping radar!)
   * - Right Thumb: [ ⚡ 1X PULSE ] + Dual-Stage [ ▲ THRUST / ▲▲ OVERDRIVE ] Throttle Pad!
   */
  private drawMobileTouchFlightDeck(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    insets: SafeAreaInsets,
    touchHoldState: MobileActiveTouchState,
    buttonsOut: CrtInteractiveButton[],
    touchControlsOut: CrtInteractiveButton[]
  ): void {
    ctx.save();
    const corridor = MobileHudRenderer.getSafeCorridor(w, h, insets, state.isFullscreen);
    const deckTop = corridor.bottomPx + 4;
    const padL = Math.max(10, insets.left + 8);
    const padR = Math.max(10, insets.right + 8);
    const padB = corridor.bottomPadPx;

    ctx.fillStyle = 'rgba(3, 10, 6, 0.92)';
    ctx.fillRect(0, deckTop - 4, w, h - deckTop + 4);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(padL, deckTop - 3);
    ctx.lineTo(w - padR, deckTop - 3);
    ctx.stroke();

    // Top Micro-Telemetry Readout Line inside Deck (AGL, V/S, Radar Pings — guaranteed zero overlap!)
    const lander = state.lander;
    const leftTel = `AGL ${lander.agl.toFixed(0)}M | V/S ${lander.vel.y.toFixed(1)} | H/S ${lander.vel.x.toFixed(1)}`;
    const rightTel = `RADAR [${lander.radarCharges}/${lander.maxRadarCharges}]`;
    const availTelW = w - padL - padR - 4;
    let telFontPx = 13.5;
    ctx.font = `bold ${telFontPx}px "JetBrains Mono", monospace`;
    while (
      telFontPx > 10.5 &&
      ctx.measureText(leftTel).width + ctx.measureText(rightTel).width + 14 > availTelW
    ) {
      telFontPx -= 0.5;
      ctx.font = `bold ${telFontPx}px "JetBrains Mono", monospace`;
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(leftTel, padL + 2, deckTop + 14);

    ctx.textAlign = 'right';
    ctx.fillStyle = lander.radarCharges > 0 ? COLORS.GREEN_BRIGHT : COLORS.AMBER_CAUTION;
    ctx.fillText(rightTel, w - padR - 2, deckTop + 14);

    const ctrlY = deckTop + 21;
    const ctrlH = Math.max(52, h - padB - ctrlY);
    const totalW = w - padL - padR;

    // Left Group (54% width): [ ◄ ROLL L ] [ ▼ BRAKE ] [ ROLL R ► ]
    const leftGroupW = Math.floor(totalW * 0.54);
    const gap = 6;
    const rollW = Math.floor((leftGroupW - gap * 2) * 0.38);
    const brakeW = leftGroupW - rollW * 2 - gap * 2;

    this.drawHoldPad(
      ctx,
      touchControlsOut,
      'touch-roll-left',
      padL,
      ctrlY,
      rollW,
      ctrlH,
      '◄ ROLL',
      touchHoldState.rollLeft,
      COLORS.GREEN_BRIGHT
    );

    this.drawHoldPad(
      ctx,
      touchControlsOut,
      'touch-retro',
      padL + rollW + gap,
      ctrlY,
      brakeW,
      ctrlH,
      'STAB',
      touchHoldState.retro,
      COLORS.AMBER_BRIGHT
    );

    this.drawHoldPad(
      ctx,
      touchControlsOut,
      'touch-roll-right',
      padL + rollW + gap + brakeW + gap,
      ctrlY,
      rollW,
      ctrlH,
      'ROLL ►',
      touchHoldState.rollRight,
      COLORS.GREEN_BRIGHT
    );

    // Right Group (43% width): [ ⚡ PULSE ] + Tall [ ▲▲ OVR / ▲ THRUST ] Pad
    const rightGroupW = totalW - leftGroupW - 10;
    const rightStartX = w - padR - rightGroupW;
    const pulseW = Math.max(54, Math.floor(rightGroupW * 0.34));
    const thrustW = rightGroupW - pulseW - gap;
    const thrustX = rightStartX + pulseW + gap;

    // 1x Emergency Pulse Button (One-Shot)
    const pulseArmed = lander.emergencyPulseAvailable;
    this.addTouchButton(
      ctx,
      buttonsOut,
      'touch-pulse',
      rightStartX,
      ctrlY,
      pulseW,
      ctrlH,
      pulseArmed ? '⚡PULSE' : 'USED',
      lander.emergencyPulseTimer > 0,
      state.hoveredButtonId,
      pulseArmed ? COLORS.AMBER_CAUTION : COLORS.RED_DIM,
      false,
      14
    );

    // Dual-Stage Vertical Throttle Pad: Upper 34% = OVERDRIVE (135%), Lower 66% = MAIN THRUST (100%)
    const ovrH = Math.max(26, Math.floor(ctrlH * 0.34));
    const mainH = ctrlH - ovrH - 3;

    this.drawHoldPad(
      ctx,
      touchControlsOut,
      'touch-overdrive',
      thrustX,
      ctrlY,
      thrustW,
      ovrH,
      '▲▲ OVR',
      touchHoldState.overdrive,
      COLORS.RED_KLAXON
    );

    this.drawHoldPad(
      ctx,
      touchControlsOut,
      'touch-thrust',
      thrustX,
      ctrlY + ovrH + 3,
      thrustW,
      mainH,
      '▲ THRUST',
      touchHoldState.thrust || touchHoldState.overdrive,
      COLORS.AMBER_BRIGHT
    );

    ctx.restore();
  }

  private drawHoldPad(
    ctx: CanvasRenderingContext2D,
    controlsOut: CrtInteractiveButton[],
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    active: boolean,
    accent: string
  ): void {
    controlsOut.push({ id, rect: { x, y, width: w, height: h }, label });
    ctx.fillStyle = active ? 'rgba(255, 168, 36, 0.34)' : 'rgba(8, 22, 13, 0.92)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? '#FFFFFF' : accent;
    ctx.lineWidth = active ? 2.8 : 2.0;
    ctx.strokeRect(x, y, w, h);

    let fitPx = 15.5;
    ctx.font = `bold ${fitPx}px "Share Tech Mono", monospace`;
    while (fitPx > 11.5 && ctx.measureText(label).width > w - 8) {
      fitPx -= 0.5;
      ctx.font = `bold ${fitPx}px "Share Tech Mono", monospace`;
    }
    ctx.fillStyle = active ? '#FFFFFF' : accent;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w * 0.5, y + h * 0.5 + Math.round(fitPx * 0.34));
  }

  // =========================================================================
  // 3. CLEAN MOBILE MODALS (BRIEFING, TALLY, BREACH, CALLSIGN, MENU, MANIFEST)
  // =========================================================================

  private drawMobileBriefingModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const boxW = Math.min(460, w - 24);
    const boxH = Math.min(310, h - 90);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(5, 14, 9, 0.96)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.2;
    ctx.strokeRect(bx, by, boxW, boxH);

    const fullHeader = `${state.sector.code} // ${state.sector.name}`;
    ctx.textAlign = 'left';
    ctx.font =
      fullHeader.length > 30
        ? 'bold 15px "Share Tech Mono", monospace'
        : 'bold 18px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText(fullHeader, bx + 14, by + 30);

    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(`GRAVITY: ${state.sector.gravity.toFixed(2)} M/S²  |  FUEL: ${state.sector.initialFuelKg} KG`, bx + 14, by + 52);

    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    const maxChars = Math.max(24, Math.floor((boxW - 28) / 8.3));
    let cy = by + 80;
    for (const line of state.sector.briefingLines.slice(0, 3)) {
      const words = line.split(' ');
      let cur = '';
      for (const word of words) {
        if ((cur + ' ' + word).trim().length > maxChars) {
          ctx.fillText(cur, bx + 14, cy);
          cy += 20;
          cur = word;
        } else {
          cur = (cur + ' ' + word).trim();
        }
      }
      if (cur && cy < by + boxH - 68) {
        ctx.fillText(cur, bx + 14, cy);
        cy += 24;
      }
    }

    this.addTouchButton(
      ctx,
      buttonsOut,
      'briefing-launch',
      bx + 14,
      by + boxH - 58,
      boxW - 28,
      46,
      'ENGAGE LATCH & DROP',
      true,
      state.hoveredButtonId,
      COLORS.AMBER_BRIGHT,
      true,
      16.5
    );
    ctx.restore();
  }

  private drawMobileTallyModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const bd = state.lastBreakdown!;
    const boxW = Math.min(448, w - 20);
    const boxH = Math.min(320, h - 126);
    const bx = (w - boxW) * 0.5;
    const by = Math.max(124, (h - boxH) * 0.5 + 24);

    ctx.save();
    ctx.fillStyle = 'rgba(5, 15, 9, 0.96)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = COLORS.GREEN_PRIMARY;
    ctx.lineWidth = 2.2;
    ctx.strokeRect(bx, by, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.font = 'bold 18px "Share Tech Mono", monospace';
    ctx.fillStyle =
      bd.grade === 'SOFT_KISS'
        ? COLORS.GREEN_BRIGHT
        : bd.grade === 'HARD_SURVIVAL'
          ? COLORS.AMBER_CAUTION
          : COLORS.GREEN_PRIMARY;
    ctx.fillText(
      bd.grade === 'SOFT_KISS'
        ? '★ PRECISION SOFT KISS ★'
        : bd.grade === 'HARD_SURVIVAL'
          ? '▲ SURVIVAL TOUCHDOWN (CAUTION) ▲'
          : '● EXTRACTION CONFIRMED ●',
      w * 0.5,
      by + 30
    );

    const rows: Array<[string, string]> = [
      [`PAD [${bd.padLabel} ${bd.padMultiplier}X]`, `+${bd.padScore.toLocaleString()}`],
      [`FUEL BONUS`, `+${bd.fuelBonus.toLocaleString()}`],
      [`KISS + INTEGRITY`, `+${(bd.precisionKissBonus + bd.noDamageBonus).toLocaleString()}`],
      [`STREAK MULTIPLIER`, `×${bd.streakMultiplier}`],
      [`SECTOR TOTAL`, `+${bd.sectorTotal.toLocaleString()} PTS`],
    ];

    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    rows.forEach(([k, v], i) => {
      const ry = by + 62 + i * 28;
      ctx.textAlign = 'left';
      ctx.fillStyle = i === 4 ? COLORS.GREEN_BRIGHT : COLORS.GREEN_PRIMARY;
      ctx.fillText(k, bx + 16, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = i === 4 ? '#FFB000' : COLORS.AMBER_BRIGHT;
      ctx.fillText(v, bx + boxW - 16, ry);
    });

    const isFinal = !state.sector.endlessMode && state.sector.index >= 6;
    this.addTouchButton(
      ctx,
      buttonsOut,
      'tally-next',
      bx + 16,
      by + boxH - 58,
      boxW - 32,
      46,
      state.isPracticeRun
        ? 'PRACTICE COMPLETE — MENU'
        : isFinal
          ? 'COMPLETE CAMPAIGN'
          : 'NEXT SECTOR',
      true,
      state.hoveredButtonId,
      COLORS.AMBER_BRIGHT,
      true,
      16.5
    );
    ctx.restore();
  }

  private drawMobileBreachModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const boxW = Math.min(448, w - 20);
    const boxH = 244;
    const bx = (w - boxW) * 0.5;
    const by = Math.max(126, (h - boxH) * 0.5 + 20);
    const gameOver = state.lives <= 0;

    ctx.save();
    ctx.fillStyle = 'rgba(20, 5, 4, 0.96)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = COLORS.RED_KLAXON;
    ctx.lineWidth = 2.4;
    ctx.strokeRect(bx, by, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.font = 'bold 20px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.RED_KLAXON;
    ctx.fillText(
      gameOver ? 'GAME OVER // ALL SHUTTLES LOST' : `HULL BREACH // ${state.lives} SHUTTLE LEFT`,
      w * 0.5,
      by + 34
    );

    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText(
      (state.lastFailure?.reason ?? 'CATASTROPHIC IMPACT').slice(0, 36),
      w * 0.5,
      by + 65
    );
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      state.isPracticeRun && gameOver
        ? `PRACTICE ENDED (${state.sector.code})`
        : `RUN SCORE: ${Math.round(state.missionScore).toLocaleString()} PTS (${state.highestSectorCode})`,
      w * 0.5,
      by + 92
    );

    if (gameOver) {
      this.addTouchButton(
        ctx,
        buttonsOut,
        'breach-end',
        bx + 16,
        by + boxH - 60,
        boxW - 32,
        46,
        state.missionScore > 0 && !state.isPracticeRun ? 'TRANSMIT GLOBAL SCORE' : 'RETURN TO MENU',
        true,
        state.hoveredButtonId,
        COLORS.AMBER_BRIGHT,
        true,
        16
      );
    } else {
      this.addTouchButton(
        ctx,
        buttonsOut,
        'breach-retry',
        bx + 16,
        by + boxH - 112,
        boxW - 32,
        44,
        `REDEPLOY SHUTTLE (${state.lives} LEFT)`,
        true,
        state.hoveredButtonId,
        COLORS.AMBER_BRIGHT,
        true,
        15.5
      );
      this.addTouchButton(
        ctx,
        buttonsOut,
        'breach-end',
        bx + 16,
        by + boxH - 58,
        boxW - 32,
        44,
        state.isPracticeRun ? 'RETURN TO MENU' : 'END RUN / MENU',
        false,
        state.hoveredButtonId,
        COLORS.GREEN_MID,
        false,
        14.5
      );
    }
    ctx.restore();
  }

  private drawMobileCallsignModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const boxW = Math.min(440, w - 24);
    const boxH = 282;
    const bx = (w - boxW) * 0.5;
    const by = Math.max(54, (h - boxH) * 0.36);
    const isDone =
      state.uplinkSubmitState === 'CONFIRMED' || state.uplinkSubmitState === 'OFFLINE_SAVED';
    const isSending = state.uplinkSubmitState === 'TRANSMITTING';

    ctx.save();
    ctx.fillStyle = 'rgba(6, 15, 9, 0.97)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = '#FFB000';
    ctx.lineWidth = 2.4;
    ctx.strokeRect(bx, by, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.font = 'bold 16.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('GLOBAL LEADERBOARD UPLINK', w * 0.5, by + 30);

    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      `${Math.round(state.missionScore).toLocaleString()} PTS  |  ${state.highestSectorCode}  |  ACC ${state.avgAccuracyPercent}%`,
      w * 0.5,
      by + 54
    );

    // Tappable Callsign Input Field (Focuses native phone virtual keyboard!)
    const inX = bx + 16;
    const inY = by + 72;
    const inW = boxW - 32 - (isDone ? 0 : 62);
    buttonsOut.push({
      id: 'callsign-focus-input',
      rect: { x: inX, y: inY, width: inW, height: 48 },
      label: 'TAP TO EDIT CALLSIGN',
    });

    ctx.fillStyle = 'rgba(2, 7, 4, 0.96)';
    ctx.fillRect(inX, inY, inW, 48);
    ctx.strokeStyle = isDone ? '#44FF77' : '#FFB000';
    ctx.lineWidth = 2.2;
    ctx.strokeRect(inX, inY, inW, 48);

    const blink = !isDone && !isSending && Math.sin(state.timeSec * 10) > 0 ? '_' : '';
    ctx.font = 'bold 19px "JetBrains Mono", monospace';
    ctx.fillStyle = isDone ? '#44FF77' : COLORS.AMBER_BRIGHT;
    ctx.fillText(`${state.callsignDraft}${blink}`, inX + inW * 0.5, inY + 31);

    if (!isDone) {
      this.addTouchButton(
        ctx,
        buttonsOut,
        'callsign-backspace',
        inX + inW + 6,
        inY,
        56,
        48,
        '⌫',
        false,
        state.hoveredButtonId,
        COLORS.AMBER_CAUTION,
        false,
        16
      );
    }

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = isDone ? '#44FF77' : COLORS.GREEN_MID;
    ctx.fillText(
      isDone && state.uplinkConfirmText
        ? state.uplinkConfirmText.slice(0, 42)
        : 'TAP CALLSIGN BOX TO OPEN KEYBOARD',
      w * 0.5,
      by + 144
    );

    if (isDone) {
      this.addTouchButton(
        ctx,
        buttonsOut,
        'callsign-finish',
        bx + 16,
        by + boxH - 60,
        boxW - 32,
        46,
        'VIEW GLOBAL LEADERBOARD',
        true,
        state.hoveredButtonId,
        '#44FF77',
        true,
        14.5
      );
    } else {
      this.addTouchButton(
        ctx,
        buttonsOut,
        'callsign-submit',
        bx + 16,
        by + boxH - 112,
        boxW - 32,
        46,
        isSending ? 'TRANSMITTING...' : 'TRANSMIT TO LEADERBOARD',
        true,
        state.hoveredButtonId,
        COLORS.AMBER_BRIGHT,
        true,
        14.5
      );
      this.addTouchButton(
        ctx,
        buttonsOut,
        'callsign-skip',
        bx + 16,
        by + boxH - 58,
        boxW - 32,
        44,
        'SKIP UPLINK',
        false,
        state.hoveredButtonId,
        COLORS.GREEN_MID,
        false,
        13
      );
    }
    ctx.restore();
  }

  private drawMobileCampaignCompleteModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const boxW = Math.min(440, w - 24);
    const boxH = 246;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(6, 16, 10, 0.97)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = COLORS.GREEN_BRIGHT;
    ctx.lineWidth = 2.4;
    ctx.strokeRect(bx, by, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.font = 'bold 18px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('ALL 6 SECTORS COMPLETE!', w * 0.5, by + 34);

    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(`${Math.round(state.missionScore).toLocaleString()} PTS`, w * 0.5, by + 68);

    this.addTouchButton(
      ctx,
      buttonsOut,
      'complete-manifest',
      bx + 16,
      by + boxH - 114,
      boxW - 32,
      46,
      state.isPracticeRun ? 'RETURN TO MENU' : 'TRANSMIT GLOBAL SCORE',
      true,
      state.hoveredButtonId,
      COLORS.AMBER_BRIGHT,
      true,
      14.5
    );
    this.addTouchButton(
      ctx,
      buttonsOut,
      'complete-endless',
      bx + 16,
      by + boxH - 58,
      boxW - 32,
      44,
      'PLAY ENDLESS SURVEY',
      false,
      state.hoveredButtonId,
      COLORS.GREEN_PRIMARY,
      false,
      13.5
    );
    ctx.restore();
  }

  private drawMobileSystemMenuModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const inRun =
      state.phase === 'FLIGHT' || state.phase === 'PAUSED' || state.phase === 'SECTOR_BRIEFING';
    const boxW = Math.min(440, w - 24);
    const boxH = Math.min(h - 32, inRun ? 426 : 324);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(4, 12, 7, 0.98)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.4;
    ctx.strokeRect(bx, by, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.font = 'bold 19px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText('SYSTEM & FLIGHT MENU', w * 0.5, by + 30);

    let cy = by + 46;
    const bw = boxW - 32;
    const bh = 44;
    const gap = 8;

    if (inRun) {
      this.addTouchButton(
        ctx,
        buttonsOut,
        'osd-resume',
        bx + 16,
        cy,
        bw,
        bh,
        'RESUME DESCENT',
        true,
        state.hoveredButtonId,
        COLORS.AMBER_BRIGHT,
        true,
        16
      );
      cy += bh + gap;

      const halfW = Math.floor((bw - gap) * 0.5);
      this.addTouchButton(
        ctx,
        buttonsOut,
        'osd-retry',
        bx + 16,
        cy,
        halfW,
        bh,
        state.lives > 1 ? `REDEPLOY (-1)` : 'LAST SHUTTLE',
        false,
        state.hoveredButtonId,
        state.lives > 1 ? COLORS.AMBER_CAUTION : COLORS.RED_DIM,
        false,
        14
      );
      this.addTouchButton(
        ctx,
        buttonsOut,
        'osd-abort',
        bx + 16 + halfW + gap,
        cy,
        halfW,
        bh,
        state.isPracticeRun ? 'RETURN TO MENU' : 'END RUN / MENU',
        false,
        state.hoveredButtonId,
        COLORS.RED_KLAXON,
        false,
        14
      );
      cy += bh + gap + 4;
    }

    this.addTouchButton(
      ctx,
      buttonsOut,
      'osd-sas-toggle',
      bx + 16,
      cy,
      bw,
      bh,
      `SAS 50% GENTLE ROLL: ${state.bezel.sasEnabled ? 'ON' : 'OFF'}`,
      state.bezel.sasEnabled,
      state.hoveredButtonId,
      state.bezel.sasEnabled ? COLORS.GREEN_BRIGHT : COLORS.AMBER_CAUTION,
      false,
      15
    );
    cy += bh + gap;

    this.addTouchButton(
      ctx,
      buttonsOut,
      'osd-mute-toggle',
      bx + 16,
      cy,
      bw,
      bh,
      `AUDIO BUS: ${state.bezel.audioMuted ? 'MUTED' : 'ACTIVE'}`,
      !state.bezel.audioMuted,
      state.hoveredButtonId,
      state.bezel.audioMuted ? COLORS.RED_KLAXON : COLORS.GREEN_BRIGHT,
      false,
      15
    );
    cy += bh + gap;

    const crtPct = Math.round(state.bezel.crtIntensity * 100);
    const thirdW = Math.floor((bw - gap * 2) / 3);
    this.addTouchButton(
      ctx,
      buttonsOut,
      'osd-crt-0',
      bx + 16,
      cy,
      thirdW,
      bh,
      'CRT 0%',
      crtPct === 0,
      state.hoveredButtonId,
      COLORS.AMBER_BRIGHT,
      false,
      12.5
    );
    this.addTouchButton(
      ctx,
      buttonsOut,
      'osd-crt-50',
      bx + 16 + thirdW + gap,
      cy,
      thirdW,
      bh,
      'CRT 50%',
      Math.abs(crtPct - 50) <= 10,
      state.hoveredButtonId,
      COLORS.AMBER_BRIGHT,
      false,
      12.5
    );
    this.addTouchButton(
      ctx,
      buttonsOut,
      'hud-fullscreen-toggle',
      bx + 16 + (thirdW + gap) * 2,
      cy,
      thirdW,
      bh,
      state.isFullscreen ? 'EXIT FL' : 'FULLSCR',
      state.isFullscreen,
      state.hoveredButtonId,
      COLORS.GREEN_BRIGHT,
      false,
      12.5
    );
    cy += bh + gap;

    this.addTouchButton(
      ctx,
      buttonsOut,
      'osd-close',
      bx + 16,
      by + boxH - 54,
      bw,
      44,
      'CLOSE MENU',
      false,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION,
      false,
      14
    );

    ctx.restore();
  }

  private drawMobileManifestModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    insets: SafeAreaInsets,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const padX = Math.max(10, insets.left + 8);
    const padY = Math.max(12, insets.top + 8);
    const fsBotExtra = state.isFullscreen ? 24 : 0;
    const boxW = Math.min(520, w - padX * 2);
    const boxH = Math.min(560, h - padY - Math.max(12 + fsBotExtra, insets.bottom + 8 + fsBotExtra));
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(4, 12, 7, 0.98)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = COLORS.GREEN_PRIMARY;
    ctx.lineWidth = 2.2;
    ctx.strokeRect(bx, by, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.font = 'bold 18.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText('GLOBAL CREW MANIFEST', w * 0.5, by + 28);

    const tabGap = 8;
    const tabW = Math.floor((boxW - 24 - tabGap) * 0.5);
    this.addTouchButton(
      ctx,
      buttonsOut,
      'logs-tab-campaign',
      bx + 12,
      by + 38,
      tabW,
      44,
      'CAMPAIGN',
      state.manifestTab === 'CAMPAIGN',
      state.hoveredButtonId,
      '#FFB000',
      false,
      15
    );
    this.addTouchButton(
      ctx,
      buttonsOut,
      'logs-tab-endless',
      bx + 12 + tabW + tabGap,
      by + 38,
      tabW,
      44,
      'ENDLESS',
      state.manifestTab === 'ENDLESS',
      state.hoveredButtonId,
      '#FFB000',
      false,
      15
    );

    const headY = by + 102;
    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.textAlign = 'left';
    ctx.fillText('#', bx + 14, headY);
    ctx.fillText('CALLSIGN', bx + 46, headY);
    ctx.fillText('SEC', bx + boxW - 156, headY);
    ctx.textAlign = 'right';
    ctx.fillText('SCORE', bx + boxW - 14, headY);

    const availH = boxH - 184;
    const maxRows = Math.min(12, Math.max(6, Math.floor(availH / 24)));
    const rowStep = Math.min(25, Math.floor(availH / maxRows));
    const playerTag = state.playerSavedCallsign.trim().toUpperCase();
    const recentRun =
      state.lastSubmittedRun && state.lastSubmittedRun.mode === state.manifestTab
        ? state.lastSubmittedRun
        : null;

    const visible = state.manifestEntries.slice(0, maxRows);
    let matchedNewIdx = -1;
    if (recentRun) {
      if (recentRun.docId) {
        matchedNewIdx = visible.findIndex((e) => e.id === recentRun.docId);
      }
      if (matchedNewIdx === -1) {
        matchedNewIdx = visible.findIndex(
          (e) =>
            e.callsign.toUpperCase() === recentRun.callsign.toUpperCase() &&
            e.score === recentRun.score &&
            e.sector === recentRun.sector
        );
      }
    }

    visible.forEach((entry, idx) => {
      const ry = headY + 23 + idx * rowStep;
      const isNew = idx === matchedNewIdx;
      const isPlayer = playerTag.length > 0 && entry.callsign.toUpperCase() === playerTag;

      if (isNew) {
        ctx.fillStyle = 'rgba(68, 255, 119, 0.24)';
        ctx.fillRect(bx + 10, ry - 15, boxW - 20, rowStep - 1);
        ctx.strokeStyle = '#44FF77';
        ctx.lineWidth = 1.8;
        ctx.strokeRect(bx + 10, ry - 15, boxW - 20, rowStep - 1);
      } else if (isPlayer) {
        ctx.fillStyle = 'rgba(255, 176, 0, 0.06)';
        ctx.fillRect(bx + 12, ry - 14, boxW - 24, rowStep - 2);
      }

      ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = isNew ? '#FFFFFF' : isPlayer || idx === 0 ? '#FFB000' : COLORS.GREEN_PRIMARY;
      ctx.fillText(String(idx + 1).padStart(2, '0'), bx + 14, ry);
      const nameStr = isNew ? `${entry.callsign.slice(0, 9)} ★NEW` : entry.callsign.slice(0, 12);
      ctx.fillText(nameStr, bx + 46, ry);
      ctx.fillText(entry.highestSector, bx + boxW - 156, ry);
      ctx.textAlign = 'right';
      ctx.fillText(entry.score.toLocaleString(), bx + boxW - 14, ry);
    });

    this.addTouchButton(
      ctx,
      buttonsOut,
      'logs-close',
      bx + 16,
      by + boxH - 54,
      boxW - 32,
      44,
      'CLOSE MANIFEST',
      true,
      state.hoveredButtonId,
      COLORS.AMBER_CAUTION,
      false,
      14
    );

    ctx.restore();
  }
}
