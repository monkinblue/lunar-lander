import { COLORS, PHYSICS } from '../constants';
import type { PhysicsEngine } from '../physics/PhysicsEngine';
import type { LanderState, LandingPad, SectorConfig, Vec2 } from '../types';

export interface CameraView {
  x: number;
  y: number;
  zoom: number;
  pxPerMeter: number;
  widthPx: number;
  heightPx: number;
}

export class WorldRenderer {
  public worldToScreen(cam: CameraView, wx: number, wy: number): Vec2 {
    return {
      x: cam.widthPx * 0.5 + (wx - cam.x) * cam.pxPerMeter,
      y: cam.heightPx * 0.5 - (wy - cam.y) * cam.pxPerMeter,
    };
  }

  public screenToWorld(cam: CameraView, sx: number, sy: number): Vec2 {
    return {
      x: cam.x + (sx - cam.widthPx * 0.5) / cam.pxPerMeter,
      y: cam.y - (sy - cam.heightPx * 0.5) / cam.pxPerMeter,
    };
  }

  public render(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    sector: SectorConfig,
    lander: LanderState,
    physics: PhysicsEngine,
    interpAlpha: number,
    timeSec: number,
    effectiveEmInterference: number,
    cursorWorld: Vec2 | null
  ): void {
    const w = cam.widthPx;
    const h = cam.heightPx;

    ctx.fillStyle = COLORS.BG_DEEP;
    ctx.fillRect(0, 0, w, h);

    const renderPos: Vec2 = {
      x: lander.prevPos.x + (lander.pos.x - lander.prevPos.x) * interpAlpha,
      y: lander.prevPos.y + (lander.pos.y - lander.prevPos.y) * interpAlpha,
    };
    const renderAngle = lander.prevAngle + (lander.angle - lander.prevAngle) * interpAlpha;

    // 1. Dim Structural CAD Grid (#0D3B1E) for high line-weight contrast
    this.drawCadGrid(ctx, cam, sector, effectiveEmInterference);

    // 2. Wind Shear Altitude Dividers & Streaming Silicate Dust
    this.drawWindBandsAndDust(ctx, cam, sector, physics, timeSec);

    // 3. Vertical Thermal Updraft Vents
    this.drawThermalVents(ctx, cam, sector, timeSec);

    // 4. Shuttle Nose Spotlight Cone
    if (lander.alive) {
      this.drawNoseSpotlight(ctx, cam, lander, renderPos, renderAngle);
    }

    // 5. 3D-Faceted Cliff Wireframes, Perspective Basin Mesh & Enclosed Ceiling
    this.drawTopography(
      ctx,
      cam,
      sector,
      renderPos,
      effectiveEmInterference
    );

    // 6. Chunky Landing Pads & Blinking Approach Beacons
    this.drawLandingPads(ctx, cam, sector.pads, lander, timeSec);

    // 7. Expanding LIDAR Radar Sweep Waves
    this.drawLidarWaves(ctx, cam, physics);

    // 8. Propulsion & Spark Particles
    this.drawParticles(ctx, cam, physics);

    // 9. Beefed-Up Skeletal Drop-Shuttle OR Breakup Debris + Shockwaves
    this.drawShockwaves(ctx, cam, physics);
    if (lander.alive) {
      this.drawDropShuttle(ctx, cam, lander, renderPos, renderAngle, timeSec);
      this.drawFlightVelocityReticle(ctx, cam, sector, physics, lander, renderPos);
    } else {
      this.drawDebris(ctx, cam, physics);
    }

    // 10. Tactical Mouse Cursor Aim Reticle
    if (cursorWorld && lander.alive) {
      this.drawWorldAimReticle(ctx, cam, cursorWorld, lander);
    }
  }

  private drawCadGrid(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    sector: SectorConfig,
    emInterference: number
  ): void {
    const gridAlpha = Math.max(
      0.015,
      (1 - sector.darknessLevel * 0.96) * (1 - emInterference * 0.85) * 0.42
    );
    if (gridAlpha < 0.025) return;
    ctx.save();
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.globalAlpha = gridAlpha;
    ctx.lineWidth = 1.0;

    const minWorldX = Math.max(0, Math.floor((cam.x - cam.widthPx / (2 * cam.pxPerMeter)) / 50) * 50);
    const maxWorldX = Math.min(
      sector.worldWidth,
      Math.ceil((cam.x + cam.widthPx / (2 * cam.pxPerMeter)) / 50) * 50
    );
    const minWorldY = Math.max(0, Math.floor((cam.y - cam.heightPx / (2 * cam.pxPerMeter)) / 50) * 50);
    const maxWorldY = Math.min(
      sector.worldHeight + 40,
      Math.ceil((cam.y + cam.heightPx / (2 * cam.pxPerMeter)) / 50) * 50
    );

    ctx.beginPath();
    for (let gx = minWorldX; gx <= maxWorldX; gx += 50) {
      const sTop = this.worldToScreen(cam, gx, maxWorldY);
      const sBot = this.worldToScreen(cam, gx, minWorldY);
      ctx.moveTo(sTop.x, sTop.y);
      ctx.lineTo(sBot.x, sBot.y);
    }
    for (let gy = minWorldY; gy <= maxWorldY; gy += 50) {
      const sL = this.worldToScreen(cam, minWorldX, gy);
      const sR = this.worldToScreen(cam, maxWorldX, gy);
      ctx.moveTo(sL.x, sL.y);
      ctx.lineTo(sR.x, sR.y);
    }
    ctx.stroke();

    ctx.strokeStyle = COLORS.GREEN_MID;
    ctx.globalAlpha = gridAlpha * 0.55;
    ctx.beginPath();
    for (let gx = minWorldX; gx <= maxWorldX; gx += 25) {
      for (let gy = minWorldY; gy <= maxWorldY; gy += 25) {
        const p = this.worldToScreen(cam, gx, gy);
        ctx.moveTo(p.x - 3.5, p.y);
        ctx.lineTo(p.x + 3.5, p.y);
        ctx.moveTo(p.x, p.y - 3.5);
        ctx.lineTo(p.x, p.y + 3.5);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawWindBandsAndDust(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    sector: SectorConfig,
    physics: PhysicsEngine,
    timeSec: number
  ): void {
    ctx.save();

    if (sector.windBands.length > 1) {
      ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
      for (const band of sector.windBands) {
        if (band.minY > 5) {
          const left = this.worldToScreen(cam, 0, band.minY);
          const right = this.worldToScreen(cam, sector.worldWidth, band.minY);
          if (left.y > 40 && left.y < cam.heightPx - 40) {
            ctx.strokeStyle = 'rgba(255, 140, 0, 0.34)';
            ctx.lineWidth = 1.4;
            ctx.setLineDash([8, 10]);
            ctx.beginPath();
            ctx.moveTo(Math.max(0, left.x), left.y);
            ctx.lineTo(Math.min(cam.widthPx, right.x), right.y);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = 'rgba(255, 140, 0, 0.74)';
            const arrow = band.baseVx > 0 ? '>>>' : '<<<';
            ctx.fillText(
              `SHEAR ${band.minY}M // ${band.label} ${arrow}`,
              Math.max(24, left.x + 10),
              left.y - 6
            );
          }
        }
      }
    }

    for (const d of physics.ambientDust) {
      const sp = this.worldToScreen(cam, d.pos.x, d.pos.y);
      if (sp.x < -30 || sp.x > cam.widthPx + 30 || sp.y < -30 || sp.y > cam.heightPx + 30) continue;

      const windMag = Math.hypot(d.vel.x, d.vel.y);
      const streakScale = Math.max(0.05, Math.min(0.16, windMag * 0.01));
      const tail = this.worldToScreen(
        cam,
        d.pos.x - d.vel.x * streakScale,
        d.pos.y - d.vel.y * streakScale
      );

      const shimmer = 0.32 + 0.22 * Math.sin(timeSec * 5 + d.pos.x);
      ctx.strokeStyle =
        windMag > 6
          ? `rgba(255, 140, 0, ${(shimmer * 0.92).toFixed(2)})`
          : `rgba(59, 224, 104, ${(shimmer * 0.72).toFixed(2)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(tail.x, tail.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawThermalVents(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    sector: SectorConfig,
    timeSec: number
  ): void {
    if (sector.thermalVents.length === 0) return;
    ctx.save();

    for (const vent of sector.thermalVents) {
      const baseC = this.worldToScreen(cam, vent.x, vent.y);
      const topC = this.worldToScreen(cam, vent.x, vent.y + vent.maxHeight);
      const halfWpx = vent.width * 0.5 * cam.pxPerMeter;

      if (baseC.x + halfWpx < 0 || baseC.x - halfWpx > cam.widthPx) continue;

      ctx.strokeStyle = COLORS.AMBER_CAUTION;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(baseC.x - halfWpx, baseC.y + 3);
      ctx.lineTo(baseC.x - halfWpx * 0.7, baseC.y - 5);
      ctx.lineTo(baseC.x + halfWpx * 0.7, baseC.y - 5);
      ctx.lineTo(baseC.x + halfWpx, baseC.y + 3);
      ctx.stroke();

      const chevronCount = 8;
      for (let i = 0; i < chevronCount; i++) {
        const prog = (timeSec * 1.15 + vent.phase * 0.2 + i / chevronCount) % 1;
        const wy = vent.y + prog * vent.maxHeight;
        const sway = Math.sin(timeSec * 4.5 + prog * 6 + vent.phase) * 1.6;
        const p = this.worldToScreen(cam, vent.x + sway, wy);
        const alpha = Math.sin(prog * Math.PI) * 0.94;
        const wSpan = halfWpx * (0.55 + prog * 0.42);

        ctx.strokeStyle = `rgba(255, 152, 24, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(p.x - wSpan, p.y + 7);
        ctx.lineTo(p.x, p.y - 6);
        ctx.lineTo(p.x + wSpan, p.y + 7);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(255, 140, 0, 0.28)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 7]);
      ctx.beginPath();
      ctx.moveTo(baseC.x - halfWpx, baseC.y);
      ctx.lineTo(topC.x - halfWpx, topC.y);
      ctx.moveTo(baseC.x + halfWpx, baseC.y);
      ctx.lineTo(topC.x + halfWpx, topC.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  private drawNoseSpotlight(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    lander: LanderState,
    renderPos: Vec2,
    renderAngle: number
  ): void {
    const c = Math.cos(renderAngle);
    const s = Math.sin(renderAngle);
    const noseWorld: Vec2 = {
      x: renderPos.x + 1.4 * s,
      y: renderPos.y + 1.4 * c,
    };
    const noseScreen = this.worldToScreen(cam, noseWorld.x, noseWorld.y);

    const dist = lander.spotlightDist;
    const a1 = lander.spotlightAngle - PHYSICS.SPOTLIGHT_HALF_ARC;
    const a2 = lander.spotlightAngle + PHYSICS.SPOTLIGHT_HALF_ARC;

    const edge1 = this.worldToScreen(
      cam,
      noseWorld.x + Math.cos(a1) * dist,
      noseWorld.y + Math.sin(a1) * dist
    );
    const edge2 = this.worldToScreen(
      cam,
      noseWorld.x + Math.cos(a2) * dist,
      noseWorld.y + Math.sin(a2) * dist
    );
    const midEnd = this.worldToScreen(
      cam,
      noseWorld.x + Math.cos(lander.spotlightAngle) * dist,
      noseWorld.y + Math.sin(lander.spotlightAngle) * dist
    );

    ctx.save();
    const grad = ctx.createRadialGradient(
      noseScreen.x,
      noseScreen.y,
      4,
      noseScreen.x,
      noseScreen.y,
      Math.max(20, dist * cam.pxPerMeter)
    );
    grad.addColorStop(0, 'rgba(68, 255, 119, 0.24)');
    grad.addColorStop(0.55, 'rgba(68, 255, 119, 0.08)');
    grad.addColorStop(1, 'rgba(68, 255, 119, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(noseScreen.x, noseScreen.y);
    ctx.lineTo(edge1.x, edge1.y);
    ctx.lineTo(midEnd.x, midEnd.y);
    ctx.lineTo(edge2.x, edge2.y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(68, 255, 119, 0.32)';
    ctx.lineWidth = 1.3;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.moveTo(noseScreen.x, noseScreen.y);
    ctx.lineTo(edge1.x, edge1.y);
    ctx.moveTo(noseScreen.x, noseScreen.y);
    ctx.lineTo(edge2.x, edge2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (lander.spotlightHit) {
      const hp = this.worldToScreen(cam, lander.spotlightHit.x, lander.spotlightHit.y);
      ctx.strokeStyle = COLORS.GREEN_BRIGHT;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(hp.x, hp.y - 6);
      ctx.lineTo(hp.x + 6, hp.y);
      ctx.lineTo(hp.x, hp.y + 6);
      ctx.lineTo(hp.x - 6, hp.y);
      ctx.closePath();
      ctx.stroke();

      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      ctx.fillText(`${lander.spotlightDist.toFixed(0)}M`, hp.x + 10, hp.y - 4);
    }

    ctx.restore();
  }

  private computeSegmentVisibility(
    midX: number,
    midY: number,
    illum: number,
    landerPos: Vec2,
    darknessLevel: number,
    emInterference: number
  ): { baseAlpha: number; lidarAlpha: number; staticObscured: boolean } {
    const dist = Math.hypot(midX - landerPos.x, midY - landerPos.y);
    const glowRadius = darknessLevel > 0.7 ? 12 : 24;
    const glowStrength = darknessLevel > 0.7 ? 0.34 : 0.75;
    const hullGlow = dist < glowRadius ? Math.pow(1 - dist / glowRadius, 1.8) * glowStrength : 0;
    const passiveVisibility = Math.max(0, 1 - darknessLevel) * Math.max(0, 1 - emInterference * 0.97);
    const baseAlpha = Math.min(1, Math.max(passiveVisibility, hullGlow));
    const lidarAlpha = Math.pow(Math.min(1, Math.max(0, illum)), 1.3);
    const staticObscured = emInterference > 0.35 && lidarAlpha < 0.12 && dist >= glowRadius;
    return { baseAlpha, lidarAlpha, staticObscured };
  }

  private drawTopography(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    sector: SectorConfig,
    landerPos: Vec2,
    emInterference: number
  ): void {
    ctx.save();

    // Solid rock occlusion matching BG_DEEP so unpinged cave walls never reveal silhouettes!
    if (sector.terrain.length > 1) {
      ctx.fillStyle = COLORS.BG_DEEP;
      ctx.beginPath();
      const first = this.worldToScreen(cam, sector.terrain[0].x, sector.terrain[0].y);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < sector.terrain.length; i++) {
        const p = this.worldToScreen(cam, sector.terrain[i].x, sector.terrain[i].y);
        ctx.lineTo(p.x, p.y);
      }
      const last = this.worldToScreen(
        cam,
        sector.terrain[sector.terrain.length - 1].x,
        sector.terrain[sector.terrain.length - 1].y
      );
      ctx.lineTo(last.x, cam.heightPx + 40);
      ctx.lineTo(first.x, cam.heightPx + 40);
      ctx.closePath();
      ctx.fill();
    }

    if (sector.ceiling && sector.ceiling.length > 1) {
      ctx.fillStyle = COLORS.BG_DEEP;
      ctx.beginPath();
      const first = this.worldToScreen(cam, sector.ceiling[0].x, sector.ceiling[0].y);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < sector.ceiling.length; i++) {
        const p = this.worldToScreen(cam, sector.ceiling[i].x, sector.ceiling[i].y);
        ctx.lineTo(p.x, p.y);
      }
      const last = this.worldToScreen(
        cam,
        sector.ceiling[sector.ceiling.length - 1].x,
        sector.ceiling[sector.ceiling.length - 1].y
      );
      ctx.lineTo(last.x, -40);
      ctx.lineTo(first.x, -40);
      ctx.closePath();
      ctx.fill();
    }

    // 3D-Style Triangulated Cliff Facet Wireframe & Subsurface Perspective Grid (matching reference monitor!)
    this.draw3dCliffWireframeFacets(
      ctx,
      cam,
      sector,
      landerPos,
      emInterference
    );

    // Bold High-Intensity Primary Rock Rim + 4s Decaying LIDAR Phosphor
    this.drawRockSurfaceSegments(
      ctx,
      cam,
      sector.terrain,
      sector.terrainIllum,
      landerPos,
      sector.darknessLevel,
      emInterference,
      1
    );

    if (sector.ceiling && sector.ceilingIllum) {
      this.drawRockSurfaceSegments(
        ctx,
        cam,
        sector.ceiling,
        sector.ceilingIllum,
        landerPos,
        sector.darknessLevel,
        emInterference,
        -1
      );
    }

    ctx.restore();
  }

  /**
   * Renders triangulated 3D wireframe cliff faces and perspective foreground floor grid
   * beneath the terrain crest to recreate the faceted vector mesa look from the 1979 CRT reference.
   */
  private draw3dCliffWireframeFacets(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    sector: SectorConfig,
    landerPos: Vec2,
    emInterference: number
  ): void {
    const poly = sector.terrain;
    if (poly.length < 3) return;

    const cliffDrop1 = 13;
    const cliffDrop2 = 27;

    // 1. Triangulated cliff face ribs descending from terrain rim
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      const sa = this.worldToScreen(cam, a.x, a.y);
      const sb = this.worldToScreen(cam, b.x, b.y);
      if ((sa.x < -40 && sb.x < -40) || (sa.x > cam.widthPx + 40 && sb.x > cam.widthPx + 40)) {
        continue;
      }

      const illum = sector.terrainIllum[i] ?? 0;
      const vis = this.computeSegmentVisibility(
        (a.x + b.x) * 0.5,
        (a.y + b.y) * 0.5,
        illum,
        landerPos,
        sector.darknessLevel,
        emInterference
      );
      const alpha = Math.max(vis.baseAlpha * 0.62, vis.lidarAlpha * 0.85);
      if (alpha < 0.03) continue;

      // Project 3D foreshortened cliff ribs slightly forward/skewed for depth
      const skewA = Math.sin(a.x * 0.07) * 3.2;
      const skewB = Math.sin(b.x * 0.07) * 3.2;
      const mA = this.worldToScreen(cam, a.x + skewA, a.y - cliffDrop1);
      const mB = this.worldToScreen(cam, b.x + skewB, b.y - cliffDrop1);
      const dA = this.worldToScreen(cam, a.x + skewA * 1.5, a.y - cliffDrop2);
      const dB = this.worldToScreen(cam, b.x + skewB * 1.5, b.y - cliffDrop2);

      ctx.strokeStyle =
        vis.lidarAlpha > 0.25
          ? `rgba(68, 255, 119, ${(alpha * 0.68).toFixed(3)})`
          : `rgba(34, 168, 75, ${(alpha * 0.58).toFixed(3)})`;
      ctx.lineWidth = 1.25;

      ctx.beginPath();
      // Vertical facet edge + diagonal triangulation + mid cliff shelf
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(mA.x, mA.y);
      ctx.lineTo(mB.x, mB.y);
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(mB.x, mB.y);
      ctx.stroke();

      // Deeper perspective floor/strata wireframe mesh
      ctx.strokeStyle = `rgba(13, 59, 30, ${(alpha * 0.85).toFixed(3)})`;
      ctx.lineWidth = 1.05;
      ctx.beginPath();
      ctx.moveTo(mA.x, mA.y);
      ctx.lineTo(dA.x, dA.y);
      ctx.lineTo(dB.x, dB.y);
      ctx.moveTo(mB.x, mB.y);
      ctx.lineTo(dA.x, dA.y);

      // Perspective ground grid lines extending toward foreground bottom
      if (i % 2 === 0) {
        const fg = this.worldToScreen(cam, a.x + (a.x - cam.x) * 0.16, a.y - 58);
        ctx.moveTo(dA.x, dA.y);
        ctx.lineTo(fg.x, fg.y);
      }
      ctx.stroke();
    }

    // Horizontal perspective ground grid rungs below cliff base
    if (sector.darknessLevel < 0.7 && emInterference < 0.7) {
      ctx.strokeStyle = COLORS.GREEN_DIM;
      ctx.lineWidth = 1.0;
      for (const depth of [36, 46, 56]) {
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < poly.length; i += 2) {
          const p = poly[i];
          const illum = sector.terrainIllum[Math.min(i, sector.terrainIllum.length - 1)] ?? 0;
          const vis = this.computeSegmentVisibility(
            p.x,
            p.y,
            illum,
            landerPos,
            sector.darknessLevel,
            emInterference
          );
          if (Math.max(vis.baseAlpha, vis.lidarAlpha) < 0.08) {
            started = false;
            continue;
          }
          const sp = this.worldToScreen(
            cam,
            p.x + (p.x - cam.x) * (depth / 360),
            p.y - depth
          );
          if (!started) {
            ctx.moveTo(sp.x, sp.y);
            started = true;
          } else {
            ctx.lineTo(sp.x, sp.y);
          }
        }
        ctx.stroke();
      }
    }
  }

  private drawRockSurfaceSegments(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    poly: Vec2[],
    illumArr: Float32Array,
    landerPos: Vec2,
    darknessLevel: number,
    emInterference: number,
    tickDir: 1 | -1
  ): void {
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      const sa = this.worldToScreen(cam, a.x, a.y);
      const sb = this.worldToScreen(cam, b.x, b.y);
      if ((sa.x < -30 && sb.x < -30) || (sa.x > cam.widthPx + 30 && sb.x > cam.widthPx + 30)) {
        continue;
      }

      const midX = (a.x + b.x) * 0.5;
      const midY = (a.y + b.y) * 0.5;
      const illum = illumArr[i] ?? 0;
      const vis = this.computeSegmentVisibility(
        midX,
        midY,
        illum,
        landerPos,
        darknessLevel,
        emInterference
      );

      const combinedAlpha = Math.max(vis.baseAlpha, vis.lidarAlpha);
      if (combinedAlpha < 0.025) continue;

      // Toned-down vintage P39 green rock crest line
      if (vis.lidarAlpha > 0.12) {
        const bright = Math.min(1, 0.4 + vis.lidarAlpha * 0.6);
        ctx.strokeStyle =
          vis.lidarAlpha > 0.7
            ? `rgba(123, 224, 152, ${bright.toFixed(3)})`
            : `rgba(54, 201, 94, ${bright.toFixed(3)})`;
        ctx.lineWidth = 2.6 + vis.lidarAlpha * 0.8;
      } else {
        ctx.strokeStyle = `rgba(54, 201, 94, ${(combinedAlpha * 0.88).toFixed(3)})`;
        ctx.lineWidth = 2.3;
      }

      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();

      // Overhead ceiling stalactite ribs
      if (tickDir === -1) {
        ctx.strokeStyle = `rgba(34, 168, 75, ${(combinedAlpha * 0.55).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sa.x, sa.y - 16);
        ctx.stroke();
      }
    }
  }

  private drawLandingPads(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    pads: LandingPad[],
    lander: LanderState,
    timeSec: number
  ): void {
    ctx.save();

    for (const pad of pads) {
      const pL = this.worldToScreen(cam, pad.x1, pad.y);
      const pR = this.worldToScreen(cam, pad.x2, pad.y);
      if (pR.x < -60 || pL.x > cam.widthPx + 60) continue;

      const padW = pR.x - pL.x;
      const midX = (pL.x + pR.x) * 0.5;
      const isDepot = pad.type === 'DEPOT';
      const padColor = isDepot ? COLORS.GREEN_PRIMARY : COLORS.AMBER_CAUTION;

      // Chunky Perspective Pad Apron & Deck Girder
      ctx.strokeStyle = padColor;
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(pL.x, pL.y);
      ctx.lineTo(pR.x, pR.y);
      ctx.stroke();

      // Perspective landing box outline + internal truss ribs
      const deckH = Math.max(6, 1.8 * cam.pxPerMeter);
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = isDepot ? COLORS.GREEN_PRIMARY : COLORS.AMBER_CAUTION;
      ctx.beginPath();
      ctx.moveTo(pL.x + 2, pL.y);
      ctx.lineTo(pL.x - 4, pL.y + deckH);
      ctx.lineTo(pR.x + 4, pL.y + deckH);
      ctx.lineTo(pR.x - 2, pL.y);
      for (let s = 1; s <= 3; s++) {
        const rx = pL.x + (padW * s) / 4;
        ctx.moveTo(rx, pL.y);
        ctx.lineTo(rx, pL.y + deckH);
      }
      ctx.stroke();

      // Blinking Strobe Posts
      const blinkOn = Math.sin(timeSec * 6.5 + pad.x1 * 0.1) > -0.15;
      for (const bx of [pL.x, pR.x]) {
        ctx.strokeStyle = padColor;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(bx, pL.y);
        ctx.lineTo(bx, pL.y - 9);
        ctx.stroke();

        if (blinkOn) {
          ctx.fillStyle = isDepot ? COLORS.GREEN_BRIGHT : COLORS.AMBER_BRIGHT;
          ctx.beginPath();
          ctx.arc(bx, pL.y - 11, 3.0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Bold Descending Beacon Chevrons
      for (let c = 0; c < 3; c++) {
        const phase = (timeSec * 1.4 + c / 3) % 1;
        const cy = pL.y - 38 + phase * 22;
        const cAlpha = Math.sin(phase * Math.PI) * 0.9;
        ctx.strokeStyle = isDepot
          ? `rgba(59, 224, 104, ${cAlpha.toFixed(2)})`
          : `rgba(255, 140, 0, ${cAlpha.toFixed(2)})`;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(midX - 8, cy - 5);
        ctx.lineTo(midX, cy + 2);
        ctx.lineTo(midX + 8, cy - 5);
        ctx.stroke();
      }

      ctx.font = 'bold 15px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = padColor;
      const badge = isDepot ? `[${pad.label} // +FUEL]` : `[${pad.label} // ${pad.multiplier}X]`;
      ctx.fillText(badge, midX, pL.y + deckH + 19);

      if (lander.groundedPad?.id === pad.id && isDepot) {
        ctx.font = 'bold 14px "JetBrains Mono", monospace';
        ctx.fillStyle = COLORS.GREEN_BRIGHT;
        const statusTxt = lander.refuelingActive
          ? '>> PUMPING PROPELLANT // W TO LIFTOFF <<'
          : '>> TANKS FULL // PRESS W TO LIFTOFF <<';
        ctx.fillText(statusTxt, midX, pL.y - 48);
      }
    }

    ctx.textAlign = 'left';
    ctx.restore();
  }

  private drawLidarWaves(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    physics: PhysicsEngine
  ): void {
    if (physics.lidarWaves.length === 0) return;
    ctx.save();

    for (const wave of physics.lidarWaves) {
      const originS = this.worldToScreen(cam, wave.origin.x, wave.origin.y);
      const rPx = wave.radius * cam.pxPerMeter;
      const startCanvasAng = wave.directional ? -(wave.dirAngle + wave.halfArc) : 0;
      const endCanvasAng = wave.directional ? -(wave.dirAngle - wave.halfArc) : Math.PI * 2;

      ctx.strokeStyle = `rgba(68, 255, 119, ${(wave.alpha * 0.92).toFixed(3)})`;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      if (wave.directional) {
        ctx.moveTo(originS.x, originS.y);
        ctx.arc(originS.x, originS.y, rPx, startCanvasAng, endCanvasAng, false);
        ctx.closePath();
      } else {
        ctx.arc(originS.x, originS.y, rPx, 0, Math.PI * 2);
      }
      ctx.stroke();

      if (rPx > 16) {
        ctx.strokeStyle = `rgba(68, 255, 119, ${(wave.alpha * 0.35).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(originS.x, originS.y, rPx - 12, startCanvasAng, endCanvasAng, false);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawParticles(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    physics: PhysicsEngine
  ): void {
    if (physics.particles.length === 0) return;
    ctx.save();

    for (const p of physics.particles) {
      const sp = this.worldToScreen(cam, p.pos.x, p.pos.y);
      if (sp.x < -20 || sp.x > cam.widthPx + 20 || sp.y < -20 || sp.y > cam.heightPx + 20) continue;
      const t = Math.max(0, p.life / p.maxLife);
      const tail = this.worldToScreen(
        cam,
        p.pos.x - p.vel.x * 0.042,
        p.pos.y - p.vel.y * 0.042
      );

      if (p.kind === 'OVERDRIVE') {
        ctx.strokeStyle = `rgba(255, 59, 31, ${(t * 0.95).toFixed(2)})`;
        ctx.lineWidth = 2.6;
      } else if (p.kind === 'MAIN') {
        ctx.strokeStyle =
          t > 0.45
            ? `rgba(255, 140, 0, ${(t * 0.94).toFixed(2)})`
            : `rgba(59, 224, 104, ${(t * 0.85).toFixed(2)})`;
        ctx.lineWidth = 2.1;
      } else if (p.kind === 'RCS') {
        ctx.strokeStyle = `rgba(142, 245, 171, ${(t * 0.92).toFixed(2)})`;
        ctx.lineWidth = 1.8;
      } else if (p.kind === 'SPARK') {
        ctx.strokeStyle = `rgba(255, 178, 56, ${t.toFixed(2)})`;
        ctx.lineWidth = 2.2;
      } else {
        ctx.strokeStyle = `rgba(68, 255, 119, ${(t * 0.58).toFixed(2)})`;
        ctx.lineWidth = 1.5;
      }

      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(tail.x, tail.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Beefed-Up Skeletal Drop-Shuttle with Heavy Structural Trusses, Latticed Landing Struts,
   * Curved Dish Footpads, and Visible Coiled Spring-Damper Compression on Touchdown.
   */
  private drawDropShuttle(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    lander: LanderState,
    renderPos: Vec2,
    renderAngle: number,
    timeSec: number
  ): void {
    const center = this.worldToScreen(cam, renderPos.x, renderPos.y);
    const s = cam.pxPerMeter;

    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(renderAngle);

    const lx = (x: number) => x * s;
    const ly = (y: number) => -y * s;

    // 1. Heavy Gimbaled Main Engine Bell & Blooming Vector Plume
    ctx.save();
    ctx.translate(lx(0), ly(-1.5));
    ctx.rotate(lander.gimbalAngle);

    ctx.fillStyle = '#020804';
    ctx.strokeStyle = lander.overdrive ? COLORS.RED_KLAXON : COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(lx(-0.62), ly(0));
    ctx.lineTo(lx(-1.18), ly(-0.92));
    ctx.lineTo(lx(1.18), ly(-0.92));
    ctx.lineTo(lx(0.62), ly(0));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Nozzle cooling ribs
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(lx(-0.9), ly(-0.48));
    ctx.lineTo(lx(0.9), ly(-0.48));
    ctx.stroke();

    if ((lander.throttle > 0.01 && lander.fuelKg > 0) || lander.emergencyPulseTimer > 0) {
      const flicker = 0.85 + 0.28 * Math.sin(timeSec * 68);
      const isPulse = lander.emergencyPulseTimer > 0;
      const plumeLen = isPulse
        ? (11.5 + lander.emergencyPulseTimer * 10) * flicker
        : (2.5 + lander.throttle * 6.2) * flicker;
      const outerColor = isPulse || lander.overdrive ? COLORS.RED_KLAXON : COLORS.AMBER_CAUTION;
      const innerColor = isPulse ? '#FFF4D4' : lander.overdrive ? COLORS.AMBER_BRIGHT : COLORS.GREEN_BRIGHT;
      const plumeHalfW = isPulse ? 1.55 : 0.96;

      ctx.strokeStyle = outerColor;
      ctx.lineWidth = isPulse ? 3.8 : 2.8;
      ctx.beginPath();
      ctx.moveTo(lx(-plumeHalfW), ly(-0.92));
      ctx.lineTo(lx(0), ly(-0.92 - plumeLen));
      ctx.lineTo(lx(plumeHalfW), ly(-0.92));
      ctx.stroke();

      ctx.strokeStyle = innerColor;
      ctx.lineWidth = isPulse ? 2.8 : 2.0;
      ctx.beginPath();
      ctx.moveTo(lx(-plumeHalfW * 0.52), ly(-0.92));
      ctx.lineTo(lx(0), ly(-0.92 - plumeLen * 0.65));
      ctx.lineTo(lx(plumeHalfW * 0.52), ly(-0.92));
      ctx.stroke();
    }
    ctx.restore();

    // 2. Beefed-Up Articulating Latticed Landing Struts + Curved Dish Footpads (matching reference!)
    const drawHeavyLandingGear = (side: -1 | 1, compression: number) => {
      const compNorm = Math.max(0, Math.min(1.15, compression));
      const compM = compNorm * PHYSICS.STRUT_MAX_TRAVEL_M;
      const footY = PHYSICS.STRUT_REST_BOTTOM_Y + compM;
      const footX = side * (PHYSICS.STRUT_SPAN_HALF_X + compM * 0.42);
      const kneeX = side * (2.78 + compM * 0.48);
      const kneeY = -1.78 + compM * 0.62;

      const primaryCol =
        lander.strutDamaged && side === -1 ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY;

      // Primary heavy A-frame tubular trusses
      ctx.strokeStyle = primaryCol;
      ctx.lineWidth = 2.6;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lx(side * 1.85), ly(-0.42)); // Upper hull outrigger
      ctx.lineTo(lx(kneeX), ly(kneeY));       // Knee joint
      ctx.lineTo(lx(footX), ly(footY + 0.16)); // Footpad ball joint

      ctx.moveTo(lx(side * 1.62), ly(-1.42)); // Lower hull bulkhead lug
      ctx.lineTo(lx(kneeX), ly(kneeY));
      ctx.stroke();

      // Internal Warren truss cross-webbing inside upper leg triangle
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx(side * 1.74), ly(-0.92));
      ctx.lineTo(lx(side * 2.32 + side * compM * 0.2), ly(-1.35 + compM * 0.3));
      ctx.lineTo(lx(side * 1.62), ly(-1.42));
      ctx.stroke();

      // Visible Telescoping Hydraulic Spring-Damper Strut Cylinder (squeezes brightly on touchdown!)
      const mountX = side * 1.72;
      const mountY = -1.35;
      const dx = footX - mountX;
      const dy = footY + 0.18 - mountY;

      ctx.strokeStyle = compNorm > 0.08 ? COLORS.AMBER_BRIGHT : COLORS.AMBER_CAUTION;
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.moveTo(lx(mountX), ly(mountY));
      ctx.lineTo(lx(footX), ly(footY + 0.18));
      ctx.stroke();

      // Coiled spring damper rings along the shock cylinder (compress closer together under load!)
      const coils = 4;
      const perpLen = Math.max(0.01, Math.hypot(dx, dy));
      const nx = (-dy / perpLen) * 0.22;
      const ny = (dx / perpLen) * 0.22;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let cIdx = 1; cIdx <= coils; cIdx++) {
        const t = 0.22 + (cIdx / (coils + 1)) * 0.56;
        const cxCoil = mountX + dx * t;
        const cyCoil = mountY + dy * t;
        ctx.moveTo(lx(cxCoil - nx), ly(cyCoil - ny));
        ctx.lineTo(lx(cxCoil + nx), ly(cyCoil + ny));
      }
      ctx.stroke();

      // Iconic Curved Dish Footpad (matching the reference photo's saucer footpad!)
      ctx.strokeStyle = compNorm > 0.08 ? COLORS.AMBER_BRIGHT : COLORS.GREEN_PRIMARY;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(lx(footX - 0.78), ly(footY + 0.22));
      ctx.quadraticCurveTo(lx(footX), ly(footY - 0.12), lx(footX + 0.78), ly(footY + 0.22));
      ctx.closePath();
      ctx.stroke();
    };

    drawHeavyLandingGear(-1, lander.strutCompressionL);
    drawHeavyLandingGear(1, lander.strutCompressionR);

    // 3. Beefed-Up Primary Narcissus Skeletal Hull Frame (Thick Double-Truss Construction)
    ctx.fillStyle = 'rgba(2, 8, 4, 0.92)';
    ctx.strokeStyle = lander.hullIntegrity < 50 ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
    ctx.lineWidth = 3.0;
    ctx.lineJoin = 'miter';

    ctx.beginPath();
    ctx.moveTo(lx(-1.25), ly(2.92));
    ctx.lineTo(lx(1.25), ly(2.92));
    ctx.lineTo(lx(2.48), ly(1.28));
    ctx.lineTo(lx(2.15), ly(-1.45));
    ctx.lineTo(lx(-2.15), ly(-1.45));
    ctx.lineTo(lx(-2.48), ly(1.28));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Heavy Internal Structural Trusses, Cross-Bracing & Armored Canopy
    ctx.strokeStyle = COLORS.GREEN_PRIMARY;
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    // Main horizontal load beam
    ctx.moveTo(lx(-2.35), ly(0.22));
    ctx.lineTo(lx(2.35), ly(0.22));
    // Lower X-truss bay bracing
    ctx.moveTo(lx(-2.15), ly(-1.45));
    ctx.lineTo(lx(0), ly(0.22));
    ctx.lineTo(lx(2.15), ly(-1.45));
    // Upper canopy frame
    ctx.moveTo(lx(-1.05), ly(2.22));
    ctx.lineTo(lx(1.05), ly(2.22));
    ctx.lineTo(lx(1.48), ly(1.02));
    ctx.lineTo(lx(-1.48), ly(1.02));
    ctx.closePath();
    // Center spine + sensor mast
    ctx.moveTo(lx(0), ly(1.02));
    ctx.lineTo(lx(0), ly(3.55));
    ctx.stroke();

    // Glowing Amber Propellant Cells inside Lower Hull
    const fuelRatio = Math.max(0, Math.min(1, lander.fuelKg / Math.max(1, lander.maxFuelKg)));
    const tankH = 1.28;
    for (const side of [-1, 1]) {
      const tx = side * 1.12 - 0.4;
      ctx.strokeStyle = COLORS.GREEN_MID;
      ctx.lineWidth = 1.3;
      ctx.strokeRect(lx(tx), ly(-0.1), 0.8 * s, tankH * s);

      if (fuelRatio > 0.01) {
        ctx.fillStyle =
          fuelRatio <= 0.25 ? 'rgba(255, 51, 24, 0.82)' : 'rgba(255, 140, 0, 0.78)';
        const fillH = tankH * fuelRatio;
        ctx.fillRect(lx(tx) + 1.5, ly(-1.38 + fillH), 0.8 * s - 3, fillH * s);
      }
    }

    // 4. Chunky Side RCS Thruster Pods & Cold-Gas Puffs
    for (const side of [-1, 1]) {
      ctx.strokeStyle = lander.rcsDamaged ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY;
      ctx.lineWidth = 2.0;
      ctx.strokeRect(lx(side * 2.48 - (side > 0 ? 0 : 0.44)), ly(1.68), 0.44 * s, 0.6 * s);
    }

    const drawGasPuff = (ox: number, oy: number, dx: number, dy: number) => {
      ctx.strokeStyle = COLORS.GREEN_BRIGHT;
      ctx.lineWidth = 2.0;
      const len = 1.65 + Math.random() * 0.6;
      ctx.beginPath();
      ctx.moveTo(lx(ox), ly(oy));
      ctx.lineTo(lx(ox + dx * len - dy * 0.32), ly(oy + dy * len + dx * 0.32));
      ctx.lineTo(lx(ox + dx * len + dy * 0.32), ly(oy + dy * len - dx * 0.32));
      ctx.closePath();
      ctx.stroke();
    };

    if (lander.rcsLeftActive) {
      drawGasPuff(2.85, 1.72, 0.68, 0.75);
      drawGasPuff(-2.68, 1.05, -0.52, -0.85);
    }
    if (lander.rcsRightActive) {
      drawGasPuff(-2.85, 1.72, -0.68, 0.75);
      drawGasPuff(2.68, 1.05, 0.52, -0.85);
    }
    if (lander.retroActive && Math.abs(lander.vel.x) > 0.15) {
      const puffSide = lander.vel.x > 0 ? 1 : -1;
      drawGasPuff(puffSide * 2.95, 1.38, puffSide * 1.35, 0);
    }

    ctx.restore();
  }

  /**
   * Velocity-Scaled Flight Path Marker + Predictive Ballistic Drift Arc:
   * - Extends outward and pulls inward smoothly in direct proportion to shuttle velocity.
   * - Integrates gravity & atmospheric wind over a 3.4s lookahead to accurately predict
   *   lateral drift and exact ground/pad impact point (no useless retrograde 'X').
   */
  private drawFlightVelocityReticle(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    sector: SectorConfig,
    physics: PhysicsEngine,
    lander: LanderState,
    renderPos: Vec2
  ): void {
    const speed = Math.hypot(lander.vel.x, lander.vel.y);
    if (speed < 0.12 || lander.groundedPad !== null) return;

    const totalMass = lander.dryMassKg + lander.fuelKg;
    const stepDt = 0.14;
    const maxSteps = 24; // ~3.36 seconds ballistic prediction lookahead

    // Simulate ballistic curve from shuttle footpad level so ground intersection predicts exact touchdown X!
    let simX = renderPos.x;
    let simY = renderPos.y + PHYSICS.STRUT_REST_BOTTOM_Y;
    let simVx = lander.vel.x;
    let simVy = lander.vel.y;

    const arcWorld: Vec2[] = [{ x: simX, y: simY }];
    let groundHit: Vec2 | null = null;
    let fpmWorld: Vec2 | null = null;

    // Velocity-scaled lookahead time (pulls smoothly IN as speed drops, extends OUT at high speed)
    const fpmLookaheadSteps = Math.max(2, Math.min(14, Math.round(2 + speed * 1.45)));

    for (let i = 1; i <= maxSteps; i++) {
      let ax = 0;
      let ay = -sector.gravity;

      if (sector.windBands.length > 0) {
        const w = physics.sampleWindAt(sector, simX, simY - PHYSICS.STRUT_REST_BOTTOM_Y);
        ax += (w.vx * 135 + (w.vx - simVx) * 52) / totalMass;
        ay += (w.vy * 65 + (w.vy - simVy) * 22) / totalMass;
      }

      simVx += ax * stepDt;
      simVy += ay * stepDt;
      simX += simVx * stepDt;
      simY += simVy * stepDt;

      const floorY = physics.samplePolylineY(sector.terrain, simX);
      if (floorY !== null && simY <= floorY) {
        groundHit = { x: simX, y: floorY };
        arcWorld.push(groundHit);
        if (!fpmWorld) fpmWorld = groundHit;
        break;
      }

      arcWorld.push({ x: simX, y: simY });
      if (i === fpmLookaheadSteps) {
        fpmWorld = { x: simX, y: simY };
      }
    }

    if (!fpmWorld) {
      fpmWorld = arcWorld[arcWorld.length - 1];
    }

    const isUnsafe =
      Math.abs(Math.min(0, lander.vel.y)) > PHYSICS.SAFE_VS_MAX ||
      Math.abs(lander.vel.x) > PHYSICS.SAFE_HS_MAX;
    const col = isUnsafe ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;

    ctx.save();

    // 1. Dotted Predictive Drift Trajectory Curve
    ctx.strokeStyle = isUnsafe ? 'rgba(255, 140, 0, 0.50)' : 'rgba(59, 224, 104, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    const s0 = this.worldToScreen(cam, arcWorld[0].x, arcWorld[0].y);
    ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < arcWorld.length; i++) {
      const sp = this.worldToScreen(cam, arcWorld[i].x, arcWorld[i].y);
      ctx.lineTo(sp.x, sp.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Velocity-Scaled Flight Path Marker (-o- prograde symbol)
    const fpScreen = this.worldToScreen(cam, fpmWorld.x, fpmWorld.y);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(fpScreen.x, fpScreen.y, 6.5, 0, Math.PI * 2);
    ctx.moveTo(fpScreen.x - 13, fpScreen.y);
    ctx.lineTo(fpScreen.x - 6.5, fpScreen.y);
    ctx.moveTo(fpScreen.x + 6.5, fpScreen.y);
    ctx.lineTo(fpScreen.x + 13, fpScreen.y);
    ctx.moveTo(fpScreen.x, fpScreen.y - 13);
    ctx.lineTo(fpScreen.x, fpScreen.y - 6.5);
    ctx.stroke();

    // 3. Ground Drift Impact Predictor Bracket if trajectory meets surface within 3.3s
    if (groundHit) {
      const gh = this.worldToScreen(cam, groundHit.x, groundHit.y);
      ctx.strokeStyle = isUnsafe ? COLORS.RED_KLAXON : COLORS.GREEN_BRIGHT;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(gh.x - 8, gh.y - 3);
      ctx.lineTo(gh.x - 8, gh.y + 3);
      ctx.moveTo(gh.x + 8, gh.y - 3);
      ctx.lineTo(gh.x + 8, gh.y + 3);
      ctx.moveTo(gh.x - 8, gh.y);
      ctx.lineTo(gh.x + 8, gh.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawShockwaves(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    physics: PhysicsEngine
  ): void {
    if (physics.shockwaves.length === 0) return;
    ctx.save();
    for (const ring of physics.shockwaves) {
      const c = this.worldToScreen(cam, ring.pos.x, ring.pos.y);
      ctx.strokeStyle = `rgba(255, 140, 0, ${ring.alpha.toFixed(3)})`;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, ring.radius * cam.pxPerMeter, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawDebris(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    physics: PhysicsEngine
  ): void {
    ctx.save();
    for (const seg of physics.debris) {
      const c = this.worldToScreen(cam, seg.pos.x, seg.pos.y);
      const ca = Math.cos(seg.angle);
      const sa = Math.sin(seg.angle);
      const x1 = c.x + (seg.p1.x * ca + seg.p1.y * sa) * cam.pxPerMeter;
      const y1 = c.y - (-seg.p1.x * sa + seg.p1.y * ca) * cam.pxPerMeter;
      const x2 = c.x + (seg.p2.x * ca + seg.p2.y * sa) * cam.pxPerMeter;
      const y2 = c.y - (-seg.p2.x * sa + seg.p2.y * ca) * cam.pxPerMeter;

      ctx.globalAlpha = Math.max(0, Math.min(1, seg.life / seg.maxLife));
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawWorldAimReticle(
    ctx: CanvasRenderingContext2D,
    cam: CameraView,
    cursorWorld: Vec2,
    lander: LanderState
  ): void {
    const sp = this.worldToScreen(cam, cursorWorld.x, cursorWorld.y);
    if (sp.x < 8 || sp.x > cam.widthPx - 8 || sp.y < 8 || sp.y > cam.heightPx - 8) return;

    ctx.save();
    const ready = lander.radarCharges >= PHYSICS.DIR_LIDAR_COST;
    ctx.strokeStyle = ready ? COLORS.GREEN_PRIMARY : COLORS.AMBER_CAUTION;
    ctx.lineWidth = 1.8;

    const r = 10;
    ctx.beginPath();
    ctx.moveTo(sp.x - r, sp.y - r + 4.5);
    ctx.lineTo(sp.x - r, sp.y - r);
    ctx.lineTo(sp.x - r + 4.5, sp.y - r);

    ctx.moveTo(sp.x + r - 4.5, sp.y - r);
    ctx.lineTo(sp.x + r, sp.y - r);
    ctx.lineTo(sp.x + r, sp.y - r + 4.5);

    ctx.moveTo(sp.x - r, sp.y + r - 4.5);
    ctx.lineTo(sp.x - r, sp.y + r);
    ctx.lineTo(sp.x - r + 4.5, sp.y + r);

    ctx.moveTo(sp.x + r - 4.5, sp.y + r);
    ctx.lineTo(sp.x + r, sp.y + r);
    ctx.lineTo(sp.x + r, sp.y + r - 4.5);

    ctx.moveTo(sp.x - 2.5, sp.y);
    ctx.lineTo(sp.x + 2.5, sp.y);
    ctx.moveTo(sp.x, sp.y - 2.5);
    ctx.lineTo(sp.x, sp.y + 2.5);
    ctx.stroke();
    ctx.restore();
  }
}
