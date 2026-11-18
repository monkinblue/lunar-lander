import { COLORS } from '../constants';
import type { Vec2, ViewportRect } from '../types';
import type { CrtInteractiveButton } from './HudRenderer';

export const BOOT_TIMING = {
  FLASH_END_SEC: 0.88,
  LOGO_DRAW_END_SEC: 5.55,
  LOGO_HOLD_END_SEC: 7.40,
  PROTOCOL_START_SEC: 7.95,
} as const;

interface MeasuredPath {
  points: Vec2[];
  cumLengths: number[];
  totalLength: number;
}

interface GlyphSpec {
  widthFactor: number;
  contours: Array<Array<[number, number]>>;
}

/**
 * Hand-crafted Ron Cobb / 1979 ALIEN (USCSS Nostromo) double-walled outlined geometric
 * CAD vector glyphs on a normalized [0..1] x [0..1] grid.
 * Every letter and numeral is a pure closed vector contour traced by the CRT electron beam!
 */
const WX = 0.21;
const HY = 0.155;
const CH = 0.125;

const NOSTROMO_VECTOR_GLYPHS: Record<string, GlyphSpec> = {
  L: {
    widthFactor: 0.94,
    contours: [
      [
        [0, 0],
        [WX, 0],
        [WX, 1 - HY],
        [1, 1 - HY],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  },
  U: {
    widthFactor: 1.0,
    contours: [
      [
        [0, 0],
        [WX, 0],
        [WX, 1 - HY],
        [1 - WX, 1 - HY],
        [1 - WX, 0],
        [1, 0],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, 0],
      ],
    ],
  },
  N: {
    widthFactor: 1.04,
    contours: [
      [
        [0, 0],
        [WX, 0],
        [1 - WX, 0.63],
        [1 - WX, 0],
        [1, 0],
        [1, 1],
        [1 - WX, 1],
        [WX, 0.37],
        [WX, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  },
  A: {
    widthFactor: 1.02,
    contours: [
      [
        [0, 1],
        [0, CH],
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 1],
        [1 - WX, 1],
        [1 - WX, 0.59],
        [WX, 0.59],
        [WX, 1],
        [0, 1],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 0.44],
        [WX, 0.44],
        [WX, HY],
      ],
    ],
  },
  R: {
    widthFactor: 1.02,
    contours: [
      [
        [0, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.44],
        [1 - CH, 0.54],
        [0.68, 0.54],
        [1, 1],
        [0.77, 1],
        [0.46, 0.54],
        [WX, 0.54],
        [WX, 1],
        [0, 1],
        [0, 0],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 0.40],
        [WX, 0.40],
        [WX, HY],
      ],
    ],
  },
  D: {
    widthFactor: 1.02,
    contours: [
      [
        [0, 0],
        [1 - CH * 1.45, 0],
        [1, CH * 1.45],
        [1, 1 - CH * 1.45],
        [1 - CH * 1.45, 1],
        [0, 1],
        [0, 0],
      ],
      [
        [WX, HY],
        [1 - WX - 0.04, HY],
        [1 - WX, HY + 0.05],
        [1 - WX, 1 - HY - 0.05],
        [1 - WX - 0.04, 1 - HY],
        [WX, 1 - HY],
        [WX, HY],
      ],
    ],
  },
  E: {
    widthFactor: 0.95,
    contours: [
      [
        [0, 0],
        [1, 0],
        [1, HY],
        [WX, HY],
        [WX, 0.425],
        [0.84, 0.425],
        [0.84, 0.575],
        [WX, 0.575],
        [WX, 1 - HY],
        [1, 1 - HY],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  },
  '1': {
    widthFactor: 0.54,
    contours: [
      [
        [0.10, 0.14],
        [0.44, 0],
        [0.82, 0],
        [0.82, 1],
        [0.40, 1],
        [0.40, 0.25],
        [0.10, 0.29],
        [0.10, 0.14],
      ],
    ],
  },
  '8': {
    widthFactor: 1.0,
    contours: [
      [
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.43],
        [0.89, 0.50],
        [1, 0.57],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, 0.57],
        [0.11, 0.50],
        [0, 0.43],
        [0, CH],
        [CH, 0],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 0.425],
        [WX, 0.425],
        [WX, HY],
      ],
      [
        [WX, 0.575],
        [1 - WX, 0.575],
        [1 - WX, 1 - HY],
        [WX, 1 - HY],
        [WX, 0.575],
      ],
    ],
  },
  '0': {
    widthFactor: 1.0,
    contours: [
      [
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, CH],
        [CH, 0],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 1 - HY],
        [WX, 1 - HY],
        [WX, HY],
      ],
    ],
  },
  '9': {
    widthFactor: 1.0,
    contours: [
      [
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, 0.74],
        [WX, 0.74],
        [WX, 1 - HY],
        [1 - WX, 1 - HY],
        [1 - WX, 0.56],
        [CH, 0.56],
        [0, 0.46],
        [0, CH],
        [CH, 0],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 0.42],
        [WX, 0.42],
        [WX, HY],
      ],
    ],
  },
  '2': {
    widthFactor: 1.0,
    contours: [
      [
        [0, CH],
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.46],
        [1 - CH, 0.56],
        [WX, 0.56],
        [WX, 1 - HY],
        [1, 1 - HY],
        [1, 1],
        [0, 1],
        [0, 0.52],
        [CH, 0.42],
        [1 - WX, 0.42],
        [1 - WX, HY],
        [WX, HY],
        [WX, 0.25],
        [0, 0.25],
        [0, CH],
      ],
    ],
  },
  '4': {
    widthFactor: 1.0,
    contours: [
      [
        [0.55, 0],
        [0.78, 0],
        [0.78, 0.56],
        [1, 0.56],
        [1, 0.71],
        [0.78, 0.71],
        [0.78, 1],
        [0.57, 1],
        [0.57, 0.71],
        [0, 0.71],
        [0, 0.55],
        [0.55, 0],
      ],
      [
        [0.57, 0.24],
        [0.57, 0.56],
        [0.22, 0.56],
        [0.57, 0.24],
      ],
    ],
  },
  '6': {
    widthFactor: 1.0,
    contours: [
      [
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.26],
        [1 - WX, 0.26],
        [1 - WX, HY],
        [WX, HY],
        [WX, 0.44],
        [1 - CH, 0.44],
        [1, 0.54],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, CH],
        [CH, 0],
      ],
      [
        [WX, 0.58],
        [1 - WX, 0.58],
        [1 - WX, 1 - HY],
        [WX, 1 - HY],
        [WX, 0.58],
      ],
    ],
  },
};

export interface BootLogoRenderParams {
  width: number;
  height: number;
  timeSec: number;
  bootPoweredOn: boolean;
  mobileMode: boolean;
  bootElapsedSec: number;
  bootProgressChars: number;
  bootLines: readonly string[];
  hoveredButtonId: string | null;
  buttonsOut: CrtInteractiveButton[];
}

export class BootLogoRenderer {
  private channelAPaths: MeasuredPath[] = [];
  private channelATotalLen = 0;

  private channelBPaths: MeasuredPath[] = [];
  private channelBTotalLen = 0;

  constructor() {
    this.buildEmblemVectorGeometry();
  }

  private measurePath(pts: Array<[number, number]>): MeasuredPath {
    const points: Vec2[] = pts.map(([x, y]) => ({ x, y }));
    const cumLengths: number[] = [0];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      cumLengths.push(total);
    }
    return { points, cumLengths, totalLength: total };
  }

  private appendTextContours(
    target: MeasuredPath[],
    text: string,
    leftX: number,
    rightX: number,
    topY: number,
    height: number,
    gapRatio = 0.21
  ): void {
    const chars = Array.from(text);
    let unitSum = 0;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === ' ') {
        unitSum += 0.56;
      } else {
        unitSum += NOSTROMO_VECTOR_GLYPHS[ch]?.widthFactor ?? 1.0;
      }
      if (i < chars.length - 1 && ch !== ' ' && chars[i + 1] !== ' ') {
        unitSum += gapRatio;
      } else if (i < chars.length - 1) {
        unitSum += gapRatio * 0.55;
      }
    }

    const availW = rightX - leftX;
    const baseCharW = availW / Math.max(1, unitSum);
    let cursorX = leftX;

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === ' ') {
        cursorX += baseCharW * (0.56 + gapRatio * 0.55);
        continue;
      }
      const spec = NOSTROMO_VECTOR_GLYPHS[ch];
      const cw = baseCharW * (spec?.widthFactor ?? 1.0);
      if (spec) {
        for (const contour of spec.contours) {
          const scaledPts: Array<[number, number]> = contour.map(([nx, ny]) => [
            cursorX + nx * cw,
            topY + ny * height,
          ]);
          target.push(this.measurePath(scaledPts));
        }
      }
      const nextIsSpace = i < chars.length - 1 && chars[i + 1] === ' ';
      cursorX += cw + baseCharW * (nextIsSpace ? gapRatio * 0.55 : gapRatio);
    }
  }

  private buildEmblemVectorGeometry(): void {
    const chA: MeasuredPath[] = [];
    const chB: MeasuredPath[] = [];

    // =========================================================================
    // CHANNEL A: OUTER STEPPED NOSTROMO ARCHITECTURE + LUNAR LANDER SILHOUETTE + "LUNAR LANDER"
    // =========================================================================

    // 1. Complete Stepped Outer Hull Frame (exact proportions of 1979 Alien red monitor emblem!)
    chA.push(
      this.measurePath([
        [-436, -108],
        [-58, -108],
        [28, -194],
        [368, -194],
        [368, 12],
        [438, 12],
        [438, 138],
        [-436, 138],
        [-436, -108],
      ])
    );

    // 2. Dorsal Spacecraft / Drop-Shuttle Inner Structural Bay
    chA.push(
      this.measurePath([
        [-40, -108],
        [34, -182],
        [356, -182],
        [356, -108],
        [-40, -108],
      ])
    );

    // 3. Forward Angled Bridge Canopy & L-Viewport Cutout (matching Nostromo silhouette!)
    chA.push(
      this.measurePath([
        [48, -122],
        [78, -166],
        [204, -166],
        [204, -148],
        [114, -148],
        [114, -122],
        [48, -122],
      ])
    );

    // 4. Midship Avionics Airlock Dividers & Telemetry Ports
    chA.push(
      this.measurePath([
        [224, -182],
        [224, -108],
      ])
    );
    chA.push(
      this.measurePath([
        [238, -182],
        [238, -108],
      ])
    );
    chA.push(
      this.measurePath([
        [250, -168],
        [264, -168],
        [264, -154],
        [250, -154],
        [250, -168],
      ])
    );

    // 5. Integrated Aft Docked Lunar Lander Descent Module Silhouette inside Dorsal Bay
    chA.push(
      this.measurePath([
        [292, -168],
        [324, -168],
        [334, -154],
        [330, -136],
        [286, -136],
        [282, -154],
        [292, -168],
      ])
    );
    // Splayed Lunar Lander Struts + Footpads + Descent Nozzle inside Aft Bay
    chA.push(
      this.measurePath([
        [288, -136],
        [274, -118],
        [266, -118],
        [281, -118],
      ])
    );
    chA.push(
      this.measurePath([
        [328, -136],
        [342, -118],
        [335, -118],
        [350, -118],
      ])
    );
    chA.push(
      this.measurePath([
        [301, -136],
        [296, -123],
        [320, -123],
        [315, -136],
      ])
    );

    // 6. Tier-1 Inner Double-Wall Structural Rail
    chA.push(
      this.measurePath([
        [-424, -96],
        [356, -96],
        [356, 6],
        [-424, 6],
        [-424, -96],
      ])
    );

    // 7. Tier-1 Vector-Outlined Block Title: "LUNAR LANDER"
    this.appendTextContours(chA, 'LUNAR LANDER', -406, 338, -85, 80, 0.20);

    // =========================================================================
    // CHANNEL B: LOWER STEPPED BULKHEAD + ICONIC "180924609" REGISTRATION BLOCK
    // =========================================================================

    // 1. Horizontal Structural Mid-Deck Rail + Tier-2 Stepped Inner Wall
    chB.push(
      this.measurePath([
        [368, 12],
        [-436, 12],
      ])
    );
    chB.push(
      this.measurePath([
        [-424, 24],
        [426, 24],
        [426, 126],
        [-424, 126],
        [-424, 24],
      ])
    );

    // 2. Tier-2 Vector-Outlined Block Registration: "180924609"
    this.appendTextContours(chB, '180924609', -406, 408, 35, 80, 0.19);

    this.channelAPaths = chA;
    this.channelATotalLen = chA.reduce((acc, p) => acc + p.totalLength, 0);

    this.channelBPaths = chB;
    this.channelBTotalLen = chB.reduce((acc, p) => acc + p.totalLength, 0);
  }

  public render(ctx: CanvasRenderingContext2D, params: BootLogoRenderParams): void {
    const { width: w, height: h, bootPoweredOn, bootElapsedSec } = params;

    if (!bootPoweredOn) {
      this.drawDormantScreen(ctx, w, h, params);
      return;
    }

    if (bootElapsedSec < BOOT_TIMING.LOGO_HOLD_END_SEC) {
      this.drawRedAlienLogoStartup(ctx, w, h, params);
      return;
    }

    if (bootElapsedSec < BOOT_TIMING.PROTOCOL_START_SEC) {
      this.drawModeSwitchTransition(ctx, w, h, params);
      return;
    }

    this.drawFullScreenAwakeningProtocol(ctx, w, h, params);
  }

  /**
   * Stage 0: Full-Screen Dormant Terminal ("Option to Awaken") — zero HUD chrome!
   */
  private drawDormantScreen(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: BootLogoRenderParams
  ): void {
    ctx.save();
    ctx.fillStyle = '#020403';
    ctx.fillRect(0, 0, w, h);

    // Subtle unpowered dark CRT glass reflection gradient
    const glassGrad = ctx.createRadialGradient(
      w * 0.5,
      h * 0.46,
      20,
      w * 0.5,
      h * 0.5,
      Math.max(w, h) * 0.68
    );
    glassGrad.addColorStop(0, 'rgba(18, 34, 24, 0.22)');
    glassGrad.addColorStop(0.65, 'rgba(6, 12, 8, 0.12)');
    glassGrad.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
    ctx.fillStyle = glassGrad;
    ctx.fillRect(0, 0, w, h);

    const cy = h * 0.5;
    const pulse = 0.55 + 0.45 * Math.sin(params.timeSec * 3.1);
    const isNarrow = w < 560;

    ctx.strokeStyle = `rgba(255, 148, 24, ${(0.24 + pulse * 0.34).toFixed(2)})`;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(w * 0.14, cy - 68);
    ctx.lineTo(w * 0.86, cy - 68);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = isNarrow
      ? 'bold 14.5px "Share Tech Mono", monospace'
      : 'bold 18px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      isNarrow
        ? 'WEYLAND-YUTANI // USCSS NOSTROMO 2037'
        : 'WEYLAND-YUTANI CORP // USCSS NOSTROMO TERMINAL 2037',
      w * 0.5,
      cy - 90
    );

    const btnW = Math.min(540, w - 32);
    const btnH = 54;
    const btnX = w * 0.5 - btnW * 0.5;
    const btn1Y = cy - 48;
    const rect1: ViewportRect = { x: btnX, y: btn1Y, width: btnW, height: btnH };
    params.buttonsOut.push({
      id: 'boot-awaken',
      rect: rect1,
      label: '[ CLICK OR PRESS SPACE ] AWAKEN MU-TH-UR 6000',
    });

    const hov1 = params.hoveredButtonId === 'boot-awaken';
    ctx.fillStyle = hov1 ? 'rgba(255, 158, 28, 0.22)' : 'rgba(14, 26, 18, 0.90)';
    ctx.fillRect(btnX, btn1Y, btnW, btnH);
    ctx.strokeStyle = hov1 ? COLORS.AMBER_BRIGHT : COLORS.AMBER_CAUTION;
    ctx.lineWidth = hov1 ? 2.8 : 2.2;
    ctx.strokeRect(btnX, btn1Y, btnW, btnH);

    ctx.font = isNarrow
      ? 'bold 15px "Share Tech Mono", monospace'
      : 'bold 18.5px "Share Tech Mono", monospace';
    ctx.fillStyle = hov1 ? '#FFF3D1' : COLORS.AMBER_BRIGHT;
    ctx.fillText(
      isNarrow
        ? '> AWAKEN MU-TH-UR 6000 (DESKTOP) <'
        : '> [ CLICK OR PRESS SPACE ] AWAKEN MU-TH-UR 6000 <',
      w * 0.5,
      btn1Y + 34
    );

    // Second Button Directly Below: Dedicated Mobile (Phone) Flight Deck Mode!
    const btn2Y = btn1Y + btnH + 16;
    const rect2: ViewportRect = { x: btnX, y: btn2Y, width: btnW, height: btnH };
    params.buttonsOut.push({
      id: 'boot-awaken-mobile',
      rect: rect2,
      label: '[ MOBILE PLAY ] AWAKEN PHONE FLIGHT DECK',
    });

    const hov2 = params.hoveredButtonId === 'boot-awaken-mobile';
    ctx.fillStyle = hov2 ? 'rgba(59, 224, 104, 0.24)' : 'rgba(8, 26, 15, 0.92)';
    ctx.fillRect(btnX, btn2Y, btnW, btnH);
    ctx.strokeStyle = hov2 ? '#FFFFFF' : COLORS.GREEN_PRIMARY;
    ctx.lineWidth = hov2 ? 2.8 : 2.2;
    ctx.strokeRect(btnX, btn2Y, btnW, btnH);

    ctx.fillStyle = hov2 ? '#FFFFFF' : COLORS.GREEN_BRIGHT;
    ctx.fillText(
      isNarrow
        ? '> [ MOBILE PLAY ] PHONE FLIGHT DECK <'
        : '> [ MOBILE PLAY ] AWAKEN HANDHELD FLIGHT DECK <',
      w * 0.5,
      btn2Y + 34
    );

    const standbyStr = isNarrow
      ? 'STANDBY RELAY ARMED // AUDIO TELEMETRY READY'
      : 'STANDBY CATHODE RELAY ARMED // ACOUSTIC TELEMETRY READY';
    let footPx = isNarrow ? 12.5 : 14.5;
    ctx.font = `bold ${footPx}px "JetBrains Mono", monospace`;
    while (footPx > 10 && ctx.measureText(standbyStr).width > w - 24) {
      footPx -= 0.5;
      ctx.font = `bold ${footPx}px "JetBrains Mono", monospace`;
    }
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(standbyStr, w * 0.5, btn2Y + btnH + 34);

    ctx.restore();
  }

  /**
   * Stage 1 & 2: Full-Screen 1979 CRT Tube Turn-On Distorted Flash + Red Nostromo CRT Screen
   * with Live Electron-Beam Procedural Vector Tracing of "LUNAR LANDER / 180924609".
   */
  private drawRedAlienLogoStartup(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: BootLogoRenderParams
  ): void {
    const t = params.bootElapsedSec;
    ctx.save();

    // 1. Base Black Cathode Void
    ctx.fillStyle = '#050101';
    ctx.fillRect(0, 0, w, h);

    // Warm-up curve for the iconic 1979 Alien Red CRT Raster Screen (Reference Photo 2)
    const rasterWarmup = Math.max(0, Math.min(1, (t - 0.10) / 0.68));
    if (rasterWarmup > 0.01) {
      const humFlicker = 0.96 + 0.04 * Math.sin(params.timeSec * 376.99) * Math.cos(params.timeSec * 23.0);
      const redAlpha = rasterWarmup * humFlicker;

      // Illuminated 1979 Crimson/Oxblood CRT Tube Flood with Deep Curved Corner Vignette
      const cx = w * 0.5;
      const cy = h * 0.46;
      const outerR = Math.hypot(w * 0.62, h * 0.62);
      const redGrad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.04, cx, cy, outerR);
      redGrad.addColorStop(0, `rgba(154, 30, 20, ${(0.95 * redAlpha).toFixed(3)})`);
      redGrad.addColorStop(0.45, `rgba(116, 19, 13, ${(0.94 * redAlpha).toFixed(3)})`);
      redGrad.addColorStop(0.78, `rgba(58, 8, 6, ${(0.96 * redAlpha).toFixed(3)})`);
      redGrad.addColorStop(1, 'rgba(12, 1, 1, 0.99)');

      ctx.fillStyle = redGrad;
      ctx.fillRect(0, 0, w, h);

      // Subtle Horizontal Analog Raster Scanline Bars over the Red Phosphor
      ctx.fillStyle = 'rgba(0, 0, 0, 0.20)';
      for (let sy = 0; sy < h; sy += 4) {
        ctx.fillRect(0, sy, w, 1.5);
      }

      // Faint rolling 60Hz hum bar drifting slowly up the red CRT screen
      const humBarY = ((params.timeSec * 68) % (h + 160)) - 80;
      const humGrad = ctx.createLinearGradient(0, humBarY - 65, 0, humBarY + 65);
      humGrad.addColorStop(0, 'rgba(255, 90, 60, 0)');
      humGrad.addColorStop(0.5, `rgba(255, 95, 65, ${(0.065 * redAlpha).toFixed(3)})`);
      humGrad.addColorStop(1, 'rgba(255, 90, 60, 0)');
      ctx.fillStyle = humGrad;
      ctx.fillRect(0, humBarY - 65, w, 130);
    }

    // 2. WEIRD DISTORTED CRT TUBE TURN-ON FLASH (0.00s -> 0.88s)
    if (t < BOOT_TIMING.FLASH_END_SEC) {
      const u = t / BOOT_TIMING.FLASH_END_SEC; // 0..1

      // Phase A (0.00..0.24): Jagged HV deflection arc tearing horizontally out of center singularity
      if (u < 0.42) {
        const arcP = u / 0.42;
        const spanW = w * Math.min(1.08, 0.08 + Math.pow(arcP, 0.42) * 1.05);
        const arcAlpha = Math.sin(arcP * Math.PI);

        // Outer crimson/amber high-voltage plasma bloom
        const bloomH = 18 + arcP * 150;
        const arcGrad = ctx.createRadialGradient(
          w * 0.5,
          h * 0.5,
          4,
          w * 0.5,
          h * 0.5,
          Math.max(spanW * 0.55, bloomH)
        );
        arcGrad.addColorStop(0, `rgba(255, 250, 240, ${(0.95 * arcAlpha).toFixed(3)})`);
        arcGrad.addColorStop(0.28, `rgba(255, 150, 95, ${(0.78 * arcAlpha).toFixed(3)})`);
        arcGrad.addColorStop(0.65, `rgba(220, 42, 24, ${(0.45 * arcAlpha).toFixed(3)})`);
        arcGrad.addColorStop(1, 'rgba(90, 8, 4, 0)');
        ctx.fillStyle = arcGrad;
        ctx.fillRect(0, h * 0.5 - bloomH, w, bloomH * 2);

        // Warped S-curved HV electron discharge filament
        ctx.save();
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.98 * (1 - arcP * 0.35)).toFixed(3)})`;
        ctx.lineWidth = Math.max(2, (1 - arcP) * 11 + 2.5);
        ctx.shadowColor = '#FF9966';
        ctx.shadowBlur = 24;
        ctx.beginPath();
        const startX = w * 0.5 - spanW * 0.5;
        const segs = 36;
        for (let i = 0; i <= segs; i++) {
          const f = i / segs;
          const px = startX + spanW * f;
          const env = Math.sin(f * Math.PI);
          const warpY =
            Math.sin(f * 13.0 + t * 85.0) * 26 * env * (1 - arcP * 0.6) +
            Math.cos(f * 29.0 - t * 120.0) * 9 * env;
          const py = h * 0.5 + warpY;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Phase B (0.12..0.88): Distorted Anamorphic Tube Flash & Asymmetric Yoke Tear Bars
      if (u > 0.10) {
        const flashP = (u - 0.10) / 0.90;
        const surge = Math.sin(Math.pow(flashP, 0.55) * Math.PI) * (1 - flashP * 0.45);

        // Overexposed chromatic CRT raster flash (warm incandescent center + cyan/violet gun split)
        const flashGrad = ctx.createRadialGradient(
          w * (0.5 + Math.sin(t * 44) * 0.06 * (1 - flashP)),
          h * (0.48 + Math.cos(t * 37) * 0.05 * (1 - flashP)),
          10,
          w * 0.5,
          h * 0.5,
          Math.max(w, h) * 0.72
        );
        flashGrad.addColorStop(0, `rgba(255, 242, 232, ${(0.72 * surge).toFixed(3)})`);
        flashGrad.addColorStop(0.32, `rgba(255, 110, 75, ${(0.52 * surge).toFixed(3)})`);
        flashGrad.addColorStop(0.68, `rgba(135, 165, 255, ${(0.24 * surge).toFixed(3)})`);
        flashGrad.addColorStop(1, 'rgba(30, 4, 4, 0)');
        ctx.fillStyle = flashGrad;
        ctx.fillRect(0, 0, w, h);

        // Horizontal magnetic sync-tear bands snapping into lock
        const tearCount = 5;
        for (let k = 0; k < tearCount; k++) {
          const bandNorm = ((k * 0.21 + t * 3.7) % 1.0);
          const by = bandNorm * h;
          const bh = (6 + (k % 3) * 10) * (1 - flashP);
          if (bh > 1.2) {
            ctx.fillStyle =
              k % 2 === 0
                ? `rgba(255, 225, 210, ${(0.26 * surge).toFixed(3)})`
                : `rgba(150, 205, 255, ${(0.20 * surge).toFixed(3)})`;
            ctx.fillRect(0, by, w, bh);
          }
        }
      }
    }

    // 3. PROCEDURAL ELECTRON-BEAM DRAWING OF THE "LUNAR LANDER / 180924609" EMBLEM
    if (t >= BOOT_TIMING.FLASH_END_SEC * 0.82) {
      const rawDraw =
        (t - BOOT_TIMING.FLASH_END_SEC * 0.82) /
        (BOOT_TIMING.LOGO_DRAW_END_SEC - BOOT_TIMING.FLASH_END_SEC * 0.82);
      const drawProgA = this.easeInOutSine(Math.max(0, Math.min(1, rawDraw)));
      const drawProgB = this.easeInOutSine(Math.max(0, Math.min(1, (rawDraw - 0.08) / 0.92)));

      // Scale emblem boldly to match Reference Photo 2 full-screen framing
      const scale = Math.min((w * 0.78) / 910, (h * 0.66) / 380);
      const originX = w * 0.5;
      const originY = h * 0.43 + (t < 1.15 ? Math.sin(t * 36) * Math.exp(-t * 3.2) * 8 : 0);

      ctx.save();
      ctx.translate(originX, originY);
      ctx.scale(scale, scale);
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 6;
      ctx.lineCap = 'square';

      this.renderProceduralBeamChannel(
        ctx,
        this.channelAPaths,
        this.channelATotalLen * drawProgA,
        drawProgA < 0.999 && drawProgA > 0.001,
        params.timeSec
      );

      if (drawProgB > 0.001) {
        this.renderProceduralBeamChannel(
          ctx,
          this.channelBPaths,
          this.channelBTotalLen * drawProgB,
          drawProgB < 0.999,
          params.timeSec + 1.7
        );
      }

      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Draws a sequence of vector paths up to `targetDist` in design units,
   * rendering authentic 1979 CRT chromatic edge fringes, hot freshly-excited phosphor wake,
   * and the searing oblong white-hot CRT electron-beam spot from Reference Photo 1!
   */
  private renderProceduralBeamChannel(
    ctx: CanvasRenderingContext2D,
    paths: readonly MeasuredPath[],
    targetDist: number,
    showBeamSpot: boolean,
    timeSec: number
  ): void {
    if (targetDist <= 0) return;

    let rem = targetDist;
    let tipPos: Vec2 | null = null;
    const wakeWindow = 105; // Design units of freshly-excited incandescent phosphor behind the beam head

    // Pass 1: Subtle 1979 CRT Red/Blue Chromatic Halation Under-Glow (matches Reference Photo 2!)
    ctx.save();
    ctx.strokeStyle = 'rgba(135, 188, 255, 0.36)';
    ctx.lineWidth = 7.6;
    ctx.beginPath();
    rem = targetDist;
    for (const p of paths) {
      if (rem <= 0) break;
      const drawLen = Math.min(p.totalLength, rem);
      this.traceSubPath(ctx, p, 0, drawLen, 2.2, 0.4);
      rem -= p.totalLength;
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 165, 145, 0.32)';
    ctx.lineWidth = 6.8;
    ctx.beginPath();
    rem = targetDist;
    for (const p of paths) {
      if (rem <= 0) break;
      const drawLen = Math.min(p.totalLength, rem);
      this.traceSubPath(ctx, p, 0, drawLen, -2.0, -0.3);
      rem -= p.totalLength;
    }
    ctx.stroke();

    // Pass 2: Crisp Incandescent Pale-Ice-White Vector Core Stroke (#EEF7FF)
    ctx.strokeStyle = '#EEF7FF';
    ctx.lineWidth = 3.2;
    ctx.shadowColor = 'rgba(185, 222, 255, 0.72)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    rem = targetDist;
    for (const p of paths) {
      if (rem <= 0) break;
      const drawLen = Math.min(p.totalLength, rem);
      const endPt = this.traceSubPath(ctx, p, 0, drawLen, 0, 0);
      if (rem <= p.totalLength) {
        tipPos = endPt;
      }
      rem -= p.totalLength;
    }
    ctx.stroke();
    ctx.restore();

    // Pass 3: Live CRT Electron-Beam Head & Hot Phosphor Wake (Reference Photo 1!)
    if (showBeamSpot && tipPos) {
      // Freshly excited hot-white wake over the last `wakeWindow` units traced
      const wakeStartGlobal = Math.max(0, targetDist - wakeWindow);
      ctx.save();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 5.0;
      ctx.shadowColor = '#FFFFFF';
      ctx.shadowBlur = 18;
      ctx.beginPath();

      let acc = 0;
      for (const p of paths) {
        const pStart = acc;
        const pEnd = acc + p.totalLength;
        const segLo = Math.max(pStart, wakeStartGlobal);
        const segHi = Math.min(pEnd, targetDist);
        if (segHi > segLo) {
          this.traceSubPath(ctx, p, segLo - pStart, segHi - pStart, 0, 0);
        }
        acc = pEnd;
        if (acc >= targetDist) break;
      }
      ctx.stroke();

      // Searing Oblong CRT Electron-Beam Spot Flare at (tipPos.x, tipPos.y)
      const flicker = 0.92 + 0.08 * Math.sin(timeSec * 90);
      const outerR = 38 * flicker;
      const spotGlow = ctx.createRadialGradient(
        tipPos.x,
        tipPos.y,
        1.5,
        tipPos.x,
        tipPos.y,
        outerR
      );
      spotGlow.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      spotGlow.addColorStop(0.22, 'rgba(225, 248, 255, 0.88)');
      spotGlow.addColorStop(0.52, 'rgba(255, 155, 130, 0.36)');
      spotGlow.addColorStop(1, 'rgba(255, 80, 60, 0)');

      ctx.fillStyle = spotGlow;
      ctx.beginPath();
      ctx.arc(tipPos.x, tipPos.y, outerR, 0, Math.PI * 2);
      ctx.fill();

      // Horizontally stretched intense electron beam core (exact match to Reference Photo 1!)
      ctx.translate(tipPos.x, tipPos.y);
      ctx.fillStyle = 'rgba(210, 245, 255, 0.92)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 17 * flicker, 6.2 * flicker, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.ellipse(0, 0, 10.5 * flicker, 3.6 * flicker, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  private traceSubPath(
    ctx: CanvasRenderingContext2D,
    path: MeasuredPath,
    startDist: number,
    endDist: number,
    offsetX: number,
    offsetY: number
  ): Vec2 {
    const pts = path.points;
    const cums = path.cumLengths;
    if (pts.length === 0) return { x: 0, y: 0 };
    if (endDist <= startDist) return pts[0];

    let started = false;
    let lastPt: Vec2 = pts[0];

    for (let i = 0; i < pts.length - 1; i++) {
      const d0 = cums[i];
      const d1 = cums[i + 1];
      const segLen = d1 - d0;
      if (segLen <= 1e-5) continue;
      if (d1 <= startDist) continue;
      if (d0 >= endDist) break;

      const t0 = startDist > d0 ? (startDist - d0) / segLen : 0;
      const t1 = endDist < d1 ? (endDist - d0) / segLen : 1;

      const sx = pts[i].x + (pts[i + 1].x - pts[i].x) * t0 + offsetX;
      const sy = pts[i].y + (pts[i + 1].y - pts[i].y) * t0 + offsetY;
      const ex = pts[i].x + (pts[i + 1].x - pts[i].x) * t1 + offsetX;
      const ey = pts[i].y + (pts[i + 1].y - pts[i].y) * t1 + offsetY;

      if (!started) {
        ctx.moveTo(sx, sy);
        started = true;
      }
      ctx.lineTo(ex, ey);
      lastPt = { x: ex - offsetX, y: ey - offsetY };
    }

    return lastPt;
  }

  /**
   * Stage 3: 1979 Video-Bus Vertical Sync Collapse Transition (Red Monitor -> Green Protocol)
   */
  private drawModeSwitchTransition(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: BootLogoRenderParams
  ): void {
    const p =
      (params.bootElapsedSec - BOOT_TIMING.LOGO_HOLD_END_SEC) /
      (BOOT_TIMING.PROTOCOL_START_SEC - BOOT_TIMING.LOGO_HOLD_END_SEC);
    ctx.save();

    ctx.fillStyle = '#030704';
    ctx.fillRect(0, 0, w, h);

    if (p < 0.5) {
      // Collapse red CRT raster vertically into a hot phosphor band
      const collapse = 1 - p * 2;
      const bandH = Math.max(4, h * collapse * collapse);
      const by = h * 0.5 - bandH * 0.5;

      ctx.fillStyle = `rgba(140, 26, 18, ${(0.85 * collapse).toFixed(3)})`;
      ctx.fillRect(0, by, w, bandH);

      ctx.fillStyle = `rgba(255, 220, 195, ${(0.75 * (1 - collapse * 0.4)).toFixed(3)})`;
      ctx.fillRect(0, h * 0.5 - 3, w, 6);
    } else {
      // Snap open P39 green terminal raster
      const open = (p - 0.5) * 2;
      const bandH = Math.max(4, h * open * open);
      const by = h * 0.5 - bandH * 0.5;

      ctx.fillStyle = 'rgba(18, 68, 34, 0.32)';
      ctx.fillRect(0, by, w, bandH);

      ctx.fillStyle = `rgba(155, 255, 185, ${(0.65 * (1 - open)).toFixed(3)})`;
      ctx.fillRect(0, h * 0.5 - 2.5, w, 5);
    }

    ctx.restore();
  }

  /**
   * Stage 4: Full-Screen Interface 2037 // MU-TH-UR 6000 Awakening Protocol
   * Scales cleanly across the entire monitor with zero flight HUD clutter.
   */
  private drawFullScreenAwakeningProtocol(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: BootLogoRenderParams
  ): void {
    ctx.save();
    ctx.fillStyle = COLORS.BG_DEEP;
    ctx.fillRect(0, 0, w, h);

    // Subtle full-screen P39 green cathode glow
    const greenGlow = ctx.createRadialGradient(
      w * 0.5,
      h * 0.5,
      30,
      w * 0.5,
      h * 0.5,
      Math.max(w, h) * 0.68
    );
    greenGlow.addColorStop(0, 'rgba(26, 78, 42, 0.16)');
    greenGlow.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = greenGlow;
    ctx.fillRect(0, 0, w, h);

    // Full-screen outer corner framing brackets
    const edgePad = Math.max(18, Math.round(Math.min(w, h) * 0.028));
    this.drawBrackets(
      ctx,
      edgePad,
      edgePad,
      w - edgePad * 2,
      h - edgePad * 2,
      26,
      COLORS.GREEN_DIM,
      2.2
    );

    // Clean Single-Column Handheld Layout when in Mobile Mode or on Narrow Phone Screens
    if (params.mobileMode || w < 720) {
      const mPad = Math.max(16, Math.round(w * 0.05));
      const boxW = w - mPad * 2;
      const boxH = Math.min(460, h - edgePad * 2 - 20);
      const bx = mPad;
      const by = (h - boxH) * 0.5;

      this.drawBrackets(ctx, bx, by, boxW, boxH, 16, COLORS.GREEN_PRIMARY, 2.2);

      ctx.font = 'bold 18px "Share Tech Mono", monospace';
      ctx.fillStyle = COLORS.AMBER_CAUTION;
      ctx.textAlign = 'left';
      ctx.fillText('MU-TH-UR 6000 // HANDHELD DECK', bx + 14, by + 32);

      ctx.strokeStyle = COLORS.AMBER_DIM;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(bx + 14, by + 42);
      ctx.lineTo(bx + boxW - 14, by + 42);
      ctx.stroke();

      const mobileBootLines = [
        'USCSS NOSTROMO // REG. 180924609',
        'MU-TH-UR 6000 CORE // ONLINE',
        'BEACON LOCK // LV-426 ORBITAL WELL',
        'SPECIAL ORDER 937 // PRIORITY ONE',
        'NARCISSUS TOUCH TELEMETRY // READY',
        'AWAITING PILOT DIRECTIVE.',
      ];

      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      let remChars = Math.floor(params.bootProgressChars * 0.65);
      const lineStep = Math.min(36, Math.floor((boxH - 132) / mobileBootLines.length));
      mobileBootLines.forEach((line, idx) => {
        if (remChars <= 0) return;
        const slice = line.slice(0, remChars);
        remChars -= line.length;
        ctx.fillStyle = idx === 3 ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
        ctx.fillText(slice, bx + 14, by + 72 + idx * lineStep);
      });

      const btnW = boxW - 28;
      const btnH = 50;
      const btnX = bx + 14;
      const btnY = by + boxH - btnH - 16;
      params.buttonsOut.push({
        id: 'boot-continue',
        rect: { x: btnX, y: btnY, width: btnW, height: btnH },
        label: 'TAP TO ENTER MOBILE FLIGHT DECK',
      });

      ctx.fillStyle = 'rgba(24, 58, 34, 0.90)';
      ctx.fillRect(btnX, btnY, btnW, btnH);
      ctx.strokeStyle = COLORS.AMBER_CAUTION;
      ctx.lineWidth = 2.4;
      ctx.strokeRect(btnX, btnY, btnW, btnH);

      ctx.font = 'bold 16.5px "Share Tech Mono", monospace';
      ctx.fillStyle = COLORS.AMBER_BRIGHT;
      ctx.textAlign = 'center';
      ctx.fillText('> TAP TO ENTER FLIGHT DECK <', btnX + btnW * 0.5, btnY + 32);

      ctx.restore();
      return;
    }

    const baseW = 940;
    const baseH = 468;
    const uiScale = Math.max(0.76, Math.min(1.36, Math.min((w - 64) / baseW, (h - 64) / baseH)));

    const cx = w * 0.5;
    const cy = h * 0.5;
    ctx.translate(cx, cy);
    ctx.scale(uiScale, uiScale);

    const bx = -baseW * 0.5;
    const by = -baseH * 0.5;
    const mainW = Math.floor(baseW * 0.74);
    const auxX = bx + mainW + 16;
    const auxW = baseW - mainW - 16;

    this.drawBrackets(ctx, bx, by, mainW, baseH, 20, COLORS.GREEN_PRIMARY, 2.4);

    ctx.font = 'bold 22px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.textAlign = 'left';
    ctx.fillText('INTERFACE 2037 // MU-TH-UR 6000 AWAKENING', bx + 22, by + 38);

    ctx.strokeStyle = COLORS.AMBER_DIM;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(bx + 22, by + 50);
    ctx.lineTo(bx + mainW - 22, by + 50);
    ctx.stroke();

    ctx.font = 'bold 15.5px "JetBrains Mono", monospace';
    let remaining = Math.floor(params.bootProgressChars);
    let cursorDrawn = false;
    params.bootLines.forEach((line, idx) => {
      const ly = by + 86 + idx * 39;
      if (remaining <= 0) return;
      const slice = line.slice(0, remaining);
      remaining -= line.length;
      ctx.fillStyle = idx === 4 ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
      ctx.fillText(slice, bx + 22, ly);
      if (remaining <= 0 && !cursorDrawn) {
        cursorDrawn = true;
        if (Math.sin(params.timeSec * 12) > 0) {
          const cw = ctx.measureText(slice).width;
          ctx.fillStyle = COLORS.AMBER_BRIGHT;
          ctx.fillRect(bx + 25 + cw, ly - 14, 11, 18);
        }
      }
    });

    this.drawBrackets(ctx, auxX, by, auxW, baseH, 16, COLORS.AMBER_CAUTION, 2.2);
    ctx.font = 'bold 15px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.fillText('CORE REGISTERS', auxX + 14, by + 32);

    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    const stepTick = Math.floor(params.timeSec * 8);
    for (let r = 0; r < 8; r++) {
      const activeRow = params.bootProgressChars > r * 35;
      ctx.fillStyle = activeRow ? COLORS.GREEN_PRIMARY : COLORS.GREEN_DIM;
      const addr = (0x2030 + r * 16).toString(16).toUpperCase();
      const v1 = activeRow
        ? (((stepTick + r * 73) * 269) & 0xff).toString(16).toUpperCase().padStart(2, '0')
        : '00';
      const v2 = activeRow
        ? (((stepTick + r * 31) * 613) & 0xff).toString(16).toUpperCase().padStart(2, '0')
        : '00';
      const v3 = activeRow
        ? (((stepTick + r * 19) * 977) & 0xff).toString(16).toUpperCase().padStart(2, '0')
        : '00';
      ctx.fillText(`${addr}: ${v1} ${v2} ${v3}`, auxX + 14, by + 60 + r * 20);
    }

    const sysLabels = ['LIFE SUPP', 'CRYO BAY', 'NAV RADAR', 'DROP POD'];
    sysLabels.forEach((lbl, sIdx) => {
      const lit = params.bootProgressChars > (sIdx + 1) * 68;
      const sy = by + 236 + sIdx * 38;
      ctx.fillStyle = lit
        ? sIdx === 3
          ? 'rgba(255, 148, 24, 0.24)'
          : 'rgba(54, 201, 94, 0.18)'
        : 'rgba(18, 58, 31, 0.18)';
      ctx.fillRect(auxX + 14, sy, auxW - 28, 28);
      ctx.strokeStyle = lit
        ? sIdx === 3
          ? COLORS.AMBER_CAUTION
          : COLORS.GREEN_PRIMARY
        : COLORS.GREEN_DIM;
      ctx.lineWidth = 1.8;
      ctx.strokeRect(auxX + 14, sy, auxW - 28, 28);

      ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
      ctx.fillStyle = lit
        ? sIdx === 3
          ? COLORS.AMBER_BRIGHT
          : COLORS.GREEN_BRIGHT
        : COLORS.GREEN_DIM;
      ctx.textAlign = 'center';
      ctx.fillText(lit ? `${lbl}: ON` : `${lbl}: --`, auxX + auxW * 0.5, sy + 19);
    });

    const btnLocalW = 430;
    const btnLocalH = 44;
    const btnLocalX = bx + mainW * 0.5 - btnLocalW * 0.5;
    const btnLocalY = by + baseH - 58;

    const screenBtnRect: ViewportRect = {
      x: cx + btnLocalX * uiScale,
      y: cy + btnLocalY * uiScale,
      width: btnLocalW * uiScale,
      height: btnLocalH * uiScale,
    };
    params.buttonsOut.push({
      id: 'boot-continue',
      rect: screenBtnRect,
      label: '[SPACE / CLICK] ENTER COMMAND TERMINAL',
    });

    const hovered = params.hoveredButtonId === 'boot-continue';
    ctx.fillStyle = hovered ? 'rgba(54, 201, 94, 0.26)' : 'rgba(16, 42, 24, 0.88)';
    ctx.fillRect(btnLocalX, btnLocalY, btnLocalW, btnLocalH);
    ctx.strokeStyle = hovered ? COLORS.GREEN_BRIGHT : COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.6;
    ctx.strokeRect(btnLocalX, btnLocalY, btnLocalW, btnLocalH);

    ctx.font = 'bold 17px "Share Tech Mono", monospace';
    ctx.fillStyle = hovered ? COLORS.GREEN_BRIGHT : COLORS.AMBER_BRIGHT;
    ctx.textAlign = 'center';
    ctx.fillText(
      '> [ SPACE / CLICK ] ENTER COMMAND TERMINAL <',
      btnLocalX + btnLocalW * 0.5,
      btnLocalY + 28
    );

    ctx.restore();
  }

  private drawBrackets(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    len: number,
    color: string,
    lineWidth: number
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

  private easeInOutSine(x: number): number {
    return -(Math.cos(Math.PI * x) - 1) * 0.5;
  }
}
