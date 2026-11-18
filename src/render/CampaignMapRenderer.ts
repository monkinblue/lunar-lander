import { COLORS } from '../constants';
import { SectorGenerator } from '../levels/SectorGenerator';
import type { MenuModeSelection, SectorConfig, ViewportRect } from '../types';
import type { CrtInteractiveButton } from './HudRenderer';

export interface SectorMapSummary {
  num: number;
  code: string;
  shortTitle: string;
  hazardTag: string;
  sector: SectorConfig;
}

export interface CampaignMapRenderParams {
  width: number;
  height: number;
  topHeaderY: number;
  menuBox: ViewportRect;
  selectedMenuMode: MenuModeSelection;
  selectedStartSector: number;
  hoveredButtonId: string | null;
  buttonsOut: CrtInteractiveButton[];
  timeSec: number;
}

/**
 * Renders the full-screen 1979 ALIEN / MU-TH-UR 6000 6-Sector Campaign Descent Survey Map
 * across the Main Menu background, giving immediate visual scope & context that Campaign
 * Descent is a 6-Sector expedition from High Orbit (SEC-01) down to the Reactor Core (SEC-06).
 */
export class CampaignMapRenderer {
  private readonly sectors: SectorMapSummary[];

  constructor() {
    const meta: Array<{ num: number; shortTitle: string; hazardTag: string }> = [
      { num: 1, shortTitle: 'THEDUS ORBITAL', hazardTag: '1.62G • VACUUM • 1X–3X' },
      { num: 2, shortTitle: 'ACHERON BASALT', hazardTag: '2.40G • HIGH-G GORGE • +FUEL' },
      { num: 3, shortTitle: 'SILICATE GALE', hazardTag: '2.08G • COUNTER-SHEAR WINDS' },
      { num: 4, shortTitle: 'DERELICT CAVERN', hazardTag: '1.95G • PITCH-BLACK CAVE' },
      { num: 5, shortTitle: 'EM WHITEOUT', hazardTag: '2.20G • ION OPTIC BLACKOUT' },
      { num: 6, shortTitle: 'THERMAL SHAFT', hazardTag: '2.35G • CORE FINALE • 6X' },
    ];

    this.sectors = meta.map((m) => {
      const sec = SectorGenerator.createCampaignSector(m.num);
      return {
        num: m.num,
        code: sec.code,
        shortTitle: m.shortTitle,
        hazardTag: m.hazardTag,
        sector: sec,
      };
    });
  }

  public getSectorSummaries(): readonly SectorMapSummary[] {
    return this.sectors;
  }

  public render(ctx: CanvasRenderingContext2D, params: CampaignMapRenderParams): void {
    const { width: w, height: h, topHeaderY, menuBox, timeSec } = params;
    ctx.save();

    // 1. Deep Nostromo Cathode Field + Subtle Tactical Survey Grid
    ctx.fillStyle = COLORS.BG_DEEP;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(22, 68, 36, 0.24)';
    ctx.lineWidth = 1;
    const gridStep = 46;
    ctx.beginPath();
    for (let gx = (w % gridStep) * 0.5; gx < w; gx += gridStep) {
      ctx.moveTo(gx, topHeaderY);
      ctx.lineTo(gx, h - 24);
    }
    for (let gy = topHeaderY + 18; gy < h - 24; gy += gridStep) {
      ctx.moveTo(14, gy);
      ctx.lineTo(w - 14, gy);
    }
    ctx.stroke();

    // Subtle Curved LV-426 Planetary Limb Wireframe Arcs in Deep Background
    ctx.strokeStyle = 'rgba(42, 132, 68, 0.16)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(
        w * 0.5,
        h * 1.42 + i * 48,
        w * (0.72 + i * 0.06),
        h * 0.62,
        0,
        Math.PI * 1.12,
        Math.PI * 1.88
      );
      ctx.stroke();
    }

    // Check flanking space around the central menu box
    const marginX = Math.max(16, Math.round(w * 0.016));
    const gapToMenu = 18;
    const leftFlankW = Math.floor(menuBox.x - marginX - gapToMenu);
    const rightFlankX = Math.ceil(menuBox.x + menuBox.width + gapToMenu);
    const rightFlankW = Math.floor(w - marginX - rightFlankX);

    if (leftFlankW < 155 || rightFlankW < 155) {
      ctx.restore();
      return;
    }

    const colTopY = topHeaderY + 52;
    const bottomCorridorY = Math.min(h - 36, Math.max(menuBox.y + menuBox.height + 18, h - 44));
    const colAvailH = Math.max(300, bottomCorridorY - colTopY - 18);
    const cardGap = 14;
    const cardH = Math.floor((colAvailH - cardGap * 2) / 3);

    // 2. Flanking Column Scope Headers (Highlighting "6-SECTOR CAMPAIGN DESCENT")
    ctx.textAlign = 'left';
    ctx.font = 'bold 16px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('LV-426 CAMPAIGN MAP // 6 SECTORS TOTAL', marginX, topHeaderY + 21);
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText('UPPER DESCENT: SECTORS 01 → 03 (ORBIT TO GALE)', marginX, topHeaderY + 40);

    ctx.textAlign = 'right';
    ctx.font = 'bold 16px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('DEEP CORE APPROACH // SECTORS 04 → 06', w - marginX, topHeaderY + 21);
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText('CAVERNS → ION STORM → REACTOR FINALE', w - marginX, topHeaderY + 40);

    // Compute exact card rectangles for all 6 Campaign Sectors
    const cardRects: ViewportRect[] = [];
    for (let i = 0; i < 3; i++) {
      cardRects.push({
        x: marginX,
        y: colTopY + i * (cardH + cardGap),
        width: leftFlankW,
        height: cardH,
      });
    }
    for (let i = 0; i < 3; i++) {
      cardRects.push({
        x: rightFlankX,
        y: colTopY + i * (cardH + cardGap),
        width: rightFlankW,
        height: cardH,
      });
    }

    // 3. Draw Connecting 6-Sector Descent Trajectory Vector Path + Animated Drop-Shuttle
    this.drawDescentRouteConnectors(ctx, w, h, cardRects, menuBox, timeSec);

    // 4. Render All 6 Topographic Sector Mini-Map Cards
    this.sectors.forEach((summary, idx) => {
      const rect = cardRects[idx];
      this.drawSectorMiniCard(ctx, summary, rect, params);
    });

    ctx.restore();
  }

  private drawDescentRouteConnectors(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    cards: readonly ViewportRect[],
    menuBox: ViewportRect,
    timeSec: number
  ): void {
    ctx.save();
    const dashOffset = -(timeSec * 28) % 24;

    // Vertical drop connectors between Left cards (01->02, 02->03) and Right cards (04->05, 05->06)
    const pairs: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 5],
    ];

    ctx.strokeStyle = COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.0;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = dashOffset;

    for (const [a, b] of pairs) {
      const ca = cards[a];
      const cb = cards[b];
      const cx = ca.x + ca.width * 0.5;
      const y1 = ca.y + ca.height;
      const y2 = cb.y;

      ctx.beginPath();
      ctx.moveTo(cx, y1);
      ctx.lineTo(cx, y2);
      ctx.stroke();

      // Small directional chevron arrow
      ctx.setLineDash([]);
      const midY = (y1 + y2) * 0.5 + 2;
      ctx.fillStyle = COLORS.AMBER_BRIGHT;
      ctx.beginPath();
      ctx.moveTo(cx, midY + 4);
      ctx.lineTo(cx - 4.5, midY - 3);
      ctx.lineTo(cx + 4.5, midY - 3);
      ctx.closePath();
      ctx.fill();
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = dashOffset;
    }

    // Cross-screen subterranean transit path from SEC-03 bottom -> under Menu -> up to SEC-04 top
    const c3 = cards[2];
    const c4 = cards[3];
    const transitY = Math.min(h - 32, Math.max(c3.y + c3.height + 11, menuBox.y + menuBox.height + 12));
    const startX = c3.x + c3.width * 0.5;
    const startY = c3.y + c3.height;
    const midRightX = c4.x - 10;
    const endX = c4.x + c4.width * 0.22;
    const endY = c4.y;

    ctx.strokeStyle = 'rgba(255, 176, 0, 0.65)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX, transitY);
    ctx.lineTo(midRightX, transitY);
    ctx.lineTo(midRightX, endY - 8);
    ctx.lineTo(endX, endY - 8);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Subsurface Transit Scope Callout Centered Beneath Menu Box
    if (transitY < h - 18 && transitY > menuBox.y + menuBox.height + 4) {
      const label = '▲ CAMPAIGN ROUTE: 6 SECTORS TOTAL (SEC-01 ORBIT ──► SEC-06 REACTOR CORE) ▲';
      ctx.font = 'bold 14px "Share Tech Mono", monospace';
      const tw = ctx.measureText(label).width + 28;
      ctx.fillStyle = 'rgba(4, 11, 7, 0.94)';
      ctx.fillRect(w * 0.5 - tw * 0.5, transitY - 11, tw, 22);
      ctx.fillStyle = '#FFB000';
      ctx.textAlign = 'center';
      ctx.fillText(label, w * 0.5, transitY + 5);
    }

    ctx.restore();
  }

  private drawSectorMiniCard(
    ctx: CanvasRenderingContext2D,
    summary: SectorMapSummary,
    rect: ViewportRect,
    params: CampaignMapRenderParams
  ): void {
    const { x, y, width: cw, height: ch } = rect;
    const btnId = `menu-map-sec-${summary.num}`;
    params.buttonsOut.push({
      id: btnId,
      rect,
      label: `${summary.code} ${summary.shortTitle}`,
    });

    const isRankedAllOrange = params.selectedMenuMode === 'RANKED_CAMPAIGN';
    const isPracticeSelected =
      params.selectedMenuMode === 'PRACTICE' && params.selectedStartSector === summary.num;
    const isHovered = params.hoveredButtonId === btnId;
    const isFinale = summary.num === 6;

    ctx.save();

    // Card Background & Nostromo Framing: ALL 6 MAPS GLOW ORANGE IN RANKED CAMPAIGN!
    ctx.fillStyle = isRankedAllOrange
      ? 'rgba(46, 20, 4, 0.88)'
      : isPracticeSelected
        ? 'rgba(22, 54, 30, 0.88)'
        : isHovered
          ? 'rgba(18, 42, 24, 0.84)'
          : 'rgba(5, 14, 9, 0.80)';
    ctx.fillRect(x, y, cw, ch);

    const borderCol = isRankedAllOrange
      ? COLORS.AMBER_CAUTION
      : isPracticeSelected
        ? COLORS.GREEN_BRIGHT
        : isHovered
          ? '#FFB000'
          : COLORS.GREEN_DIM;
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = isRankedAllOrange || isPracticeSelected || isHovered ? 2.6 : 1.5;
    ctx.strokeRect(x, y, cw, ch);

    // Stage Badge Pill [01/06] .. [06/06] (High-contrast glowing phosphor text on dark framed badge so CRT bloom never blurs digits!)
    const badgeText = isFinale ? `06/06 FINALE` : `0${summary.num}/06`;
    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    const badgeW = ctx.measureText(badgeText).width + 16;
    ctx.fillStyle = isRankedAllOrange
      ? 'rgba(88, 36, 4, 0.95)'
      : isPracticeSelected
        ? 'rgba(20, 68, 34, 0.95)'
        : 'rgba(8, 30, 16, 0.95)';
    ctx.fillRect(x + 8, y + 6, badgeW, 22);
    ctx.strokeStyle = isRankedAllOrange
      ? COLORS.AMBER_BRIGHT
      : isPracticeSelected
        ? '#FFFFFF'
        : COLORS.GREEN_BRIGHT;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(x + 8, y + 6, badgeW, 22);

    ctx.fillStyle = isRankedAllOrange
      ? '#FFF0C2'
      : isPracticeSelected
        ? '#FFFFFF'
        : COLORS.GREEN_BRIGHT;
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, x + 8 + badgeW * 0.5, y + 22);

    // Sector Title (Larger & Crisper)
    ctx.textAlign = 'left';
    const titleFontPx = cw < 290 ? 14.5 : 16.5;
    ctx.font = `bold ${titleFontPx}px "Share Tech Mono", monospace`;
    ctx.fillStyle = isRankedAllOrange
      ? COLORS.AMBER_BRIGHT
      : isPracticeSelected
        ? '#FFFFFF'
        : COLORS.GREEN_BRIGHT;
    const titleX = x + 15 + badgeW;
    const maxTitleW = Math.max(60, cw - (titleX - x) - 8);
    let fullTitle = `${summary.code}: ${summary.shortTitle}`;
    while (fullTitle.length > 8 && ctx.measureText(fullTitle).width > maxTitleW) {
      fullTitle = `${fullTitle.slice(0, -2)}…`;
    }
    ctx.fillText(fullTitle, titleX, y + 23);

    // Hazard Telemetry Subtitle + Ranked / Practice Target Tag
    ctx.font = cw < 290 ? 'bold 12px "JetBrains Mono", monospace' : 'bold 13.5px "JetBrains Mono", monospace';
    const rightTag = isRankedAllOrange ? '★ RANKED' : isPracticeSelected ? '► PRACTICE' : '';
    const rightTagW = rightTag ? ctx.measureText(rightTag).width + 12 : 0;
    const maxHazW = Math.max(60, cw - 16 - rightTagW);
    let hazStr = summary.hazardTag;
    while (hazStr.length > 8 && ctx.measureText(hazStr).width > maxHazW) {
      hazStr = `${hazStr.slice(0, -2)}…`;
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = isRankedAllOrange
      ? '#FFD27D'
      : isPracticeSelected
        ? COLORS.GREEN_BRIGHT
        : COLORS.GREEN_PRIMARY;
    ctx.fillText(hazStr, x + 8, y + 43);

    if (rightTag) {
      const pulse = isRankedAllOrange
        ? 0.76 + 0.24 * Math.sin(params.timeSec * 6.5 + summary.num * 0.5)
        : 0.72 + 0.28 * Math.sin(params.timeSec * 8);
      ctx.globalAlpha = pulse;
      ctx.textAlign = 'right';
      ctx.fillStyle = isRankedAllOrange ? COLORS.AMBER_BRIGHT : COLORS.GREEN_BRIGHT;
      ctx.fillText(rightTag, x + cw - 8, y + 43);
      ctx.globalAlpha = 1;
    }

    // Miniature Vector Topographic Cross-Section Viewport inside Card
    const mapX = x + 8;
    const mapY = y + 50;
    const mapW = cw - 16;
    const mapH = Math.max(36, ch - 58);

    ctx.fillStyle = isRankedAllOrange
      ? 'rgba(16, 6, 1, 0.92)'
      : summary.sector.darknessLevel > 0.8
        ? 'rgba(1, 4, 2, 0.95)'
        : 'rgba(2, 8, 4, 0.88)';
    ctx.fillRect(mapX, mapY, mapW, mapH);
    ctx.strokeStyle = isRankedAllOrange ? 'rgba(255, 140, 0, 0.55)' : 'rgba(32, 96, 52, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mapX, mapY, mapW, mapH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX, mapY, mapW, mapH);
    ctx.clip();

    const sec = summary.sector;
    const toSx = (wx: number) => mapX + (wx / sec.worldWidth) * mapW;
    const toSy = (wy: number) => mapY + mapH - (wy / (sec.worldHeight * 0.92)) * mapH;

    // Environmental Hazard Indicators inside Mini-Map:
    // A. Wind Shear Streaks (SEC-03, SEC-05)
    if (sec.windBands.length > 0) {
      ctx.strokeStyle = 'rgba(255, 176, 0, 0.34)';
      ctx.lineWidth = 1.2;
      for (let b = 0; b < Math.min(3, sec.windBands.length); b++) {
        const band = sec.windBands[b];
        const wy = Math.min(sec.worldHeight * 0.8, (band.minY + Math.min(sec.worldHeight, band.maxY)) * 0.5);
        const sy = toSy(wy);
        const dir = band.baseVx >= 0 ? 1 : -1;
        const shift = ((params.timeSec * 26 * dir) % 42 + 42) % 42;
        ctx.beginPath();
        for (let lx = mapX - 20 + shift; lx < mapX + mapW; lx += 42) {
          ctx.moveTo(lx, sy);
          ctx.lineTo(lx + 18, sy);
        }
        ctx.stroke();
      }
    }

    // B. EM Ion Interference Wave (SEC-05)
    if (sec.emBlackoutPulse) {
      ctx.strokeStyle = 'rgba(130, 210, 255, 0.36)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let ix = 0; ix <= mapW; ix += 6) {
        const wy = mapY + mapH * 0.32 + Math.sin(ix * 0.14 + params.timeSec * 6) * 4.5;
        if (ix === 0) ctx.moveTo(mapX + ix, wy);
        else ctx.lineTo(mapX + ix, wy);
      }
      ctx.stroke();
    }

    // C. Rising Thermal Reactor Plumes (SEC-06)
    if (sec.thermalVents.length > 0) {
      ctx.strokeStyle = 'rgba(255, 95, 45, 0.45)';
      ctx.lineWidth = 1.4;
      for (const vent of sec.thermalVents) {
        const vx = toSx(vent.x);
        const rise = (params.timeSec * 18) % 16;
        ctx.beginPath();
        ctx.moveTo(vx, mapY + mapH - 6 - rise);
        ctx.lineTo(vx, mapY + mapH - 18 - rise);
        ctx.stroke();
      }
    }

    // D. Overhead Enclosed Cavern Ceiling Polyline (SEC-04, SEC-06)
    if (sec.ceiling && sec.ceiling.length > 1) {
      ctx.fillStyle = isRankedAllOrange ? 'rgba(95, 42, 6, 0.30)' : 'rgba(20, 58, 32, 0.32)';
      ctx.beginPath();
      ctx.moveTo(mapX, mapY);
      for (let i = 0; i < sec.ceiling.length; i += 2) {
        ctx.lineTo(toSx(sec.ceiling[i].x), toSy(sec.ceiling[i].y));
      }
      const lastC = sec.ceiling[sec.ceiling.length - 1];
      ctx.lineTo(toSx(lastC.x), toSy(lastC.y));
      ctx.lineTo(mapX + mapW, mapY);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = isRankedAllOrange || isPracticeSelected ? COLORS.AMBER_CAUTION : COLORS.GREEN_MID;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < sec.ceiling.length; i += 2) {
        const px = toSx(sec.ceiling[i].x);
        const py = toSy(sec.ceiling[i].y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // E. Planetary Surface / Gorge Terrain Polyline
    if (sec.terrain.length > 1) {
      ctx.fillStyle = isRankedAllOrange ? 'rgba(120, 52, 6, 0.28)' : 'rgba(24, 72, 38, 0.28)';
      ctx.beginPath();
      ctx.moveTo(mapX, mapY + mapH);
      for (let i = 0; i < sec.terrain.length; i += 2) {
        ctx.lineTo(toSx(sec.terrain[i].x), toSy(sec.terrain[i].y));
      }
      const lastT = sec.terrain[sec.terrain.length - 1];
      ctx.lineTo(toSx(lastT.x), toSy(lastT.y));
      ctx.lineTo(mapX + mapW, mapY + mapH);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = isRankedAllOrange
        ? COLORS.AMBER_BRIGHT
        : isPracticeSelected
          ? COLORS.GREEN_BRIGHT
          : COLORS.GREEN_PRIMARY;
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      for (let i = 0; i < sec.terrain.length; i += 2) {
        const px = toSx(sec.terrain[i].x);
        const py = toSy(sec.terrain[i].y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // F. Highlighted Landing Pads & Fuel Depots
    for (const pad of sec.pads) {
      const px1 = toSx(pad.x1);
      const px2 = Math.max(px1 + 7, toSx(pad.x2));
      const py = toSy(pad.y);
      ctx.strokeStyle = pad.type === 'DEPOT' ? '#44FF77' : '#FFB000';
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.moveTo(px1, py);
      ctx.lineTo(px2, py);
      ctx.stroke();
    }

    ctx.restore();
    ctx.restore();
  }
}
