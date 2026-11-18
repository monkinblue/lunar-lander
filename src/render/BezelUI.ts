import { COLORS } from '../constants';
import type { BezelState, ViewportRect } from '../types';

export type BezelControlId =
  | 'sas'
  | 'autoZoom'
  | 'crtDial'
  | 'audioMute'
  | 'flightLogs';

export interface BezelControlHitbox {
  id: BezelControlId;
  rect: ViewportRect;
}

export class BezelUI {
  public hitboxes: BezelControlHitbox[] = [];
  public hoveredId: BezelControlId | null = null;
  public draggingDial = false;

  public computeCrtViewport(totalWidth: number, totalHeight: number): ViewportRect {
    const rightPanelW = Math.max(156, Math.min(184, Math.round(totalWidth * 0.145)));
    const bottomPanelH = 74;
    const topMargin = 16;
    const leftMargin = 18;

    return {
      x: leftMargin,
      y: topMargin,
      width: Math.max(320, totalWidth - leftMargin - rightPanelW - 12),
      height: Math.max(240, totalHeight - topMargin - bottomPanelH - 10),
    };
  }

  public hitTest(clientX: number, clientY: number): BezelControlId | null {
    for (const hb of this.hitboxes) {
      const r = hb.rect;
      if (
        clientX >= r.x &&
        clientX <= r.x + r.width &&
        clientY >= r.y &&
        clientY <= r.y + r.height
      ) {
        return hb.id;
      }
    }
    return null;
  }

  public dialValueFromPointer(clientX: number, clientY: number): number | null {
    const dialBox = this.hitboxes.find((h) => h.id === 'crtDial');
    if (!dialBox) return null;
    const cx = dialBox.rect.x + dialBox.rect.width * 0.5;
    const cy = dialBox.rect.y + 52;
    const ang = Math.atan2(clientY - cy, clientX - cx); // -PI..PI, -PI/2 is top
    // Map -225 deg .. +45 deg (-1.25 PI .. +0.25 PI) around top
    let deg = (ang * 180) / Math.PI + 90; // 0 is top, -135 is bottom-left, +135 is bottom-right
    if (deg > 180) deg -= 360;
    const clamped = Math.max(-135, Math.min(135, deg));
    return (clamped + 135) / 270;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    totalWidth: number,
    totalHeight: number,
    crtRect: ViewportRect,
    bezel: BezelState,
    audioBusLevel: number,
    timeSec: number
  ): void {
    this.hitboxes = [];
    ctx.clearRect(0, 0, totalWidth, totalHeight);

    // Paint Industrial Chassis Masks ONLY outside the CRT glass recess
    ctx.save();
    ctx.fillStyle = COLORS.CHASSIS_OUTER;
    // Top strip
    ctx.fillRect(0, 0, totalWidth, crtRect.y);
    // Bottom deck
    ctx.fillRect(0, crtRect.y + crtRect.height, totalWidth, totalHeight - (crtRect.y + crtRect.height));
    // Left strip
    ctx.fillRect(0, crtRect.y, crtRect.x, crtRect.height);
    // Right rack
    ctx.fillRect(
      crtRect.x + crtRect.width,
      crtRect.y,
      totalWidth - (crtRect.x + crtRect.width),
      crtRect.height
    );

    // Molded Recessed CRT Bezel Frame Bevel
    this.drawCrtRecessBevel(ctx, crtRect);

    // Right Vertical Hardware Rack
    const rackX = crtRect.x + crtRect.width + 10;
    const rackY = crtRect.y;
    const rackW = totalWidth - rackX - 12;
    const rackH = crtRect.height;
    this.drawRightHardwareRack(ctx, rackX, rackY, rackW, rackH, bezel, audioBusLevel, timeSec);

    // Bottom Industrial Switch Bezel
    const botX = crtRect.x;
    const botY = crtRect.y + crtRect.height + 8;
    const botW = totalWidth - botX - 12;
    const botH = totalHeight - botY - 8;
    this.drawBottomSwitchDeck(ctx, botX, botY, botW, botH, bezel);

    ctx.restore();
  }

  private drawCrtRecessBevel(ctx: CanvasRenderingContext2D, r: ViewportRect): void {
    ctx.save();
    // Outer industrial bevel seam
    ctx.strokeStyle = '#2B3830';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x - 3, r.y - 3, r.width + 6, r.height + 6);

    ctx.strokeStyle = '#050806';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x - 1, r.y - 1, r.width + 2, r.height + 2);

    // Corner Torx bolts around CRT housing
    const bolts = [
      [r.x - 9, r.y - 8],
      [r.x + r.width + 5, r.y - 8],
      [r.x - 9, r.y + r.height + 4],
      [r.x + r.width + 5, r.y + r.height + 4],
    ];
    for (const [bx, by] of bolts) {
      this.drawHexBolt(ctx, bx, by, 3.4);
    }
    ctx.restore();
  }

  private drawHexBolt(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
    ctx.save();
    ctx.fillStyle = '#18201B';
    ctx.strokeStyle = '#36463D';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#090D0A';
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.55, cy);
    ctx.lineTo(cx + radius * 0.55, cy);
    ctx.stroke();
    ctx.restore();
  }

  private drawRightHardwareRack(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    bezel: BezelState,
    audioBusLevel: number,
    timeSec: number
  ): void {
    ctx.fillStyle = COLORS.CHASSIS_PANEL;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLORS.CHASSIS_EDGE;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x, y, w, h);

    this.drawHexBolt(ctx, x + 9, y + 9, 3);
    this.drawHexBolt(ctx, x + w - 9, y + 9, 3);
    this.drawHexBolt(ctx, x + 9, y + h - 9, 3);
    this.drawHexBolt(ctx, x + w - 9, y + h - 9, 3);

    // Top Serial Nameplate
    ctx.font = 'bold 10px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.CHASSIS_TEXT;
    ctx.textAlign = 'center';
    ctx.fillText('WEYLAND-YUTANI', x + w * 0.5, y + 25);
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#5E7566';
    ctx.fillText('CRT & COMMS BUS', x + w * 0.5, y + 38);

    ctx.strokeStyle = COLORS.CHASSIS_EDGE;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 46);
    ctx.lineTo(x + w - 10, y + 46);
    ctx.stroke();

    // 1. Rotary Potentiometer Dial: [CRT GLASS & BLOOM INTENSITY]
    const dialRect: ViewportRect = { x: x + 8, y: y + 56, width: w - 16, height: 122 };
    this.hitboxes.push({ id: 'crtDial', rect: dialRect });
    this.drawRotaryPotentiometer(
      ctx,
      dialRect,
      'CRT GLASS & BLOOM',
      bezel.crtIntensity,
      this.hoveredId === 'crtDial' || this.draggingDial
    );

    // 2. Mechanical Toggle Switch: [INTERCOM / AUDIO BUS MUTE] + Live VU Meter
    const audioY = y + 190;
    const audioRect: ViewportRect = { x: x + 8, y: audioY, width: w - 16, height: 108 };
    this.hitboxes.push({ id: 'audioMute', rect: audioRect });
    this.drawVerticalSwitchModule(
      ctx,
      audioRect,
      'INTERCOM / AUDIO',
      !bezel.audioMuted,
      bezel.audioMuted ? 'MUTED' : 'ACTIVE',
      this.hoveredId === 'audioMute',
      audioBusLevel
    );

    // 3. Illuminated Push-Latch Button: [MU-TH-UR FLIGHT LOGS]
    const logsY = audioY + 120;
    const logsRect: ViewportRect = { x: x + 8, y: logsY, width: w - 16, height: 76 };
    this.hitboxes.push({ id: 'flightLogs', rect: logsRect });
    this.drawIlluminatedPushLatch(
      ctx,
      logsRect,
      'MU-TH-UR FLIGHT LOGS',
      bezel.flightLogsOpen ? 'DISPLAYING' : 'CREW MANIFEST',
      bezel.flightLogsOpen,
      this.hoveredId === 'flightLogs',
      timeSec
    );

    // Decorative Ron Cobb Semiotic Standard Telemetry Plate at bottom of rack if room permits
    const remY = logsY + 90;
    if (y + h - remY > 56) {
      ctx.strokeStyle = '#1F2923';
      ctx.strokeRect(x + 10, remY, w - 20, y + h - remY - 14);
      const midX = x + w * 0.5;
      const midY = remY + (y + h - remY - 14) * 0.5;

      // Semiotic geometric radiation/thruster caution glyph
      ctx.strokeStyle = '#384D40';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(midX, midY - 6, 11, 0, Math.PI * 2);
      ctx.moveTo(midX - 16, midY - 6);
      ctx.lineTo(midX + 16, midY - 6);
      ctx.moveTo(midX, midY - 22);
      ctx.lineTo(midX, midY + 10);
      ctx.stroke();

      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillStyle = '#4B6153';
      ctx.textAlign = 'center';
      ctx.fillText('SYS-2037 // NARCISSUS', midX, y + h - 22);
    }
  }

  private drawBottomSwitchDeck(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    bezel: BezelState
  ): void {
    ctx.fillStyle = COLORS.CHASSIS_PANEL;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLORS.CHASSIS_EDGE;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x, y, w, h);

    this.drawHexBolt(ctx, x + 8, y + 8, 2.8);
    this.drawHexBolt(ctx, x + 8, y + h - 8, 2.8);
    this.drawHexBolt(ctx, x + w - 8, y + 8, 2.8);
    this.drawHexBolt(ctx, x + w - 8, y + h - 8, 2.8);

    const modW = Math.min(265, Math.max(195, (w - 220) * 0.44));
    const modH = h - 12;

    // 1. [SAS ATTITUDE DAMPENER: ON/OFF]
    const sasRect: ViewportRect = { x: x + 22, y: y + 6, width: modW, height: modH };
    this.hitboxes.push({ id: 'sas', rect: sasRect });
    this.drawHorizontalToggleSwitch(
      ctx,
      sasRect,
      'SAS ATTITUDE DAMPENER',
      bezel.sasEnabled,
      this.hoveredId === 'sas'
    );

    // 2. [AUTO-ZOOM APPROACH: ON/OFF]
    const zoomRect: ViewportRect = { x: x + 34 + modW, y: y + 6, width: modW, height: modH };
    this.hitboxes.push({ id: 'autoZoom', rect: zoomRect });
    this.drawHorizontalToggleSwitch(
      ctx,
      zoomRect,
      'AUTO-ZOOM APPROACH',
      bezel.autoZoomEnabled,
      this.hoveredId === 'autoZoom'
    );

    // Engraved Console Inspection Plate on right end of bottom deck
    const plateX = zoomRect.x + zoomRect.width + 18;
    const plateW = x + w - plateX - 18;
    if (plateW > 130) {
      ctx.strokeStyle = '#202A24';
      ctx.strokeRect(plateX, y + 8, plateW, h - 16);
      ctx.textAlign = 'left';
      ctx.font = 'bold 10px "Share Tech Mono", monospace';
      ctx.fillStyle = '#738C7C';
      ctx.fillText('USCSS NOSTROMO // REG. 180924609', plateX + 12, y + 25);
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillStyle = '#4E6356';
      ctx.fillText('SCROLL: ZOOM | MOUSE: SPOTLIGHT + LIDAR', plateX + 12, y + 42);
    }
  }

  private drawRotaryPotentiometer(
    ctx: CanvasRenderingContext2D,
    r: ViewportRect,
    title: string,
    value: number,
    hovered: boolean
  ): void {
    ctx.save();
    ctx.fillStyle = hovered ? '#18211C' : '#0E1411';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = hovered ? COLORS.GREEN_PRIMARY : '#27342C';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    ctx.font = 'bold 9.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.CHASSIS_TEXT;
    ctx.textAlign = 'center';
    ctx.fillText(title, r.x + r.width * 0.5, r.y + 14);

    const cx = r.x + r.width * 0.5;
    const cy = r.y + 58;
    const outerR = 26;

    // Vernier potentiometer ticks (-135 deg to +135 deg around top)
    for (let i = 0; i <= 10; i++) {
      const frac = i / 10;
      const rad = ((-135 + frac * 270 - 90) * Math.PI) / 180;
      const lit = frac <= value + 0.02;
      ctx.strokeStyle = lit ? COLORS.GREEN_PRIMARY : '#2E3D34';
      ctx.lineWidth = i % 5 === 0 ? 1.6 : 1.0;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rad) * (outerR + 3), cy + Math.sin(rad) * (outerR + 3));
      ctx.lineTo(cx + Math.cos(rad) * (outerR + 8), cy + Math.sin(rad) * (outerR + 8));
      ctx.stroke();
    }

    // Knurled Aluminum Rotary Knob Body
    ctx.fillStyle = '#1C2620';
    ctx.strokeStyle = hovered ? COLORS.GREEN_BRIGHT : '#4A5E52';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#0B100D';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR - 5, 0, Math.PI * 2);
    ctx.stroke();

    // Illuminated Phosphor Indicator Line on Knob
    const pointerRad = ((-135 + value * 270 - 90) * Math.PI) / 180;
    ctx.strokeStyle = COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(pointerRad) * 6, cy + Math.sin(pointerRad) * 6);
    ctx.lineTo(cx + Math.cos(pointerRad) * (outerR - 3), cy + Math.sin(pointerRad) * (outerR - 3));
    ctx.stroke();

    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(`INTENSITY ${Math.round(value * 100)}%`, cx, r.y + r.height - 9);
    ctx.restore();
  }

  private drawVerticalSwitchModule(
    ctx: CanvasRenderingContext2D,
    r: ViewportRect,
    title: string,
    isOn: boolean,
    statusLabel: string,
    hovered: boolean,
    vuLevel: number
  ): void {
    ctx.save();
    ctx.fillStyle = hovered ? '#18211C' : '#0E1411';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = hovered ? COLORS.GREEN_PRIMARY : '#27342C';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    ctx.font = 'bold 9.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.CHASSIS_TEXT;
    ctx.textAlign = 'center';
    ctx.fillText(title, r.x + r.width * 0.5, r.y + 14);

    // Mechanical Toggle Switch Slot + Bat Lever
    const swX = r.x + r.width * 0.34;
    const swY = r.y + 50;
    this.drawBatLeverVertical(ctx, swX, swY, isOn);

    // 8-Segment Live Audio Bus VU Meter next to switch
    const vuX = r.x + r.width * 0.62;
    const vuTop = r.y + 26;
    const segs = 7;
    for (let s = 0; s < segs; s++) {
      const thresh = (segs - 1 - s) / segs;
      const active = isOn && vuLevel > thresh * 0.85;
      ctx.fillStyle = !active
        ? '#1A241E'
        : s === 0
          ? COLORS.RED_KLAXON
          : s <= 2
            ? COLORS.AMBER_CAUTION
            : COLORS.GREEN_PRIMARY;
      ctx.fillRect(vuX, vuTop + s * 7, 18, 4.5);
    }

    // Status LED + Text
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillStyle = isOn ? COLORS.GREEN_PRIMARY : COLORS.RED_KLAXON;
    ctx.fillText(`BUS: ${statusLabel}`, r.x + r.width * 0.5, r.y + r.height - 9);
    ctx.restore();
  }

  private drawIlluminatedPushLatch(
    ctx: CanvasRenderingContext2D,
    r: ViewportRect,
    title: string,
    subLabel: string,
    active: boolean,
    hovered: boolean,
    timeSec: number
  ): void {
    ctx.save();
    ctx.fillStyle = hovered ? '#18211C' : '#0E1411';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = active ? COLORS.AMBER_CAUTION : hovered ? COLORS.GREEN_PRIMARY : '#27342C';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    ctx.font = 'bold 9.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.CHASSIS_TEXT;
    ctx.textAlign = 'center';
    ctx.fillText(title, r.x + r.width * 0.5, r.y + 15);

    // Backlit Amber/Green Tactile Cap
    const capX = r.x + 12;
    const capY = r.y + 24;
    const capW = r.width - 24;
    const capH = 38;
    const glow = active ? 0.28 + 0.08 * Math.sin(timeSec * 8) : hovered ? 0.14 : 0.05;
    ctx.fillStyle = active
      ? `rgba(255, 176, 0, ${glow.toFixed(2)})`
      : `rgba(51, 255, 102, ${glow.toFixed(2)})`;
    ctx.fillRect(capX, capY, capW, capH);

    ctx.strokeStyle = active ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(capX, capY, capW, capH);

    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillStyle = active ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
    ctx.fillText(subLabel, r.x + r.width * 0.5, capY + 23);
    ctx.restore();
  }

  private drawHorizontalToggleSwitch(
    ctx: CanvasRenderingContext2D,
    r: ViewportRect,
    title: string,
    isOn: boolean,
    hovered: boolean
  ): void {
    ctx.save();
    ctx.fillStyle = hovered ? '#18211C' : '#0E1411';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = hovered ? COLORS.GREEN_PRIMARY : '#27342C';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    // Guard brackets left/right of toggle lever
    const swX = r.x + 34;
    const swY = r.y + r.height * 0.5;
    ctx.strokeStyle = '#45574C';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(swX - 18, swY - 14);
    ctx.lineTo(swX - 22, swY - 14);
    ctx.lineTo(swX - 22, swY + 14);
    ctx.lineTo(swX - 18, swY + 14);
    ctx.stroke();

    this.drawBatLeverVertical(ctx, swX, swY, isOn);

    // Title + ON/OFF Status Jewel
    ctx.textAlign = 'left';
    ctx.font = 'bold 10.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.CHASSIS_TEXT;
    ctx.fillText(title, r.x + 66, r.y + 21);

    // Glowing LED Indicator
    const ledX = r.x + 71;
    const ledY = r.y + 36;
    ctx.fillStyle = isOn ? COLORS.GREEN_PRIMARY : COLORS.AMBER_CAUTION;
    ctx.beginPath();
    ctx.arc(ledX, ledY, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText(isOn ? 'ENGAGED [ON]' : 'BYPASSED [OFF]', ledX + 10, ledY + 4);
    ctx.restore();
  }

  private drawBatLeverVertical(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    isUpOn: boolean
  ): void {
    // Hex mounting bushing
    ctx.fillStyle = '#222D27';
    ctx.strokeStyle = '#586E60';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#080C0A';
    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Metallic Toggle Bat Handle (tilted UP when ON, DOWN when OFF)
    const tipY = isUpOn ? cy - 16 : cy + 16;
    ctx.strokeStyle = '#B7C9BE';
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, tipY);
    ctx.stroke();

    ctx.fillStyle = isUpOn ? COLORS.GREEN_BRIGHT : '#8DA194';
    ctx.beginPath();
    ctx.arc(cx, tipY, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineCap = 'butt';
  }
}
