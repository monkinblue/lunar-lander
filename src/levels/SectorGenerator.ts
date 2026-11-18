import type { LandingPad, SectorConfig, ThermalVent, Vec2, WindBand } from '../types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PadSpec {
  id: string;
  label: string;
  type: 'EXTRACTION' | 'DEPOT';
  centerX: number;
  width: number;
  y: number;
  multiplier: number;
}

interface ControlAnchor {
  x: number;
  y: number;
}

function buildPolylineWithPads(
  worldWidth: number,
  stepM: number,
  anchors: ControlAnchor[],
  padSpecs: PadSpec[],
  rng: () => number,
  roughness: number
): { points: Vec2[]; pads: LandingPad[] } {
  const sortedAnchors = [...anchors].sort((a, b) => a.x - b.x);

  const sampleAnchorY = (x: number): number => {
    if (x <= sortedAnchors[0].x) return sortedAnchors[0].y;
    if (x >= sortedAnchors[sortedAnchors.length - 1].x) {
      return sortedAnchors[sortedAnchors.length - 1].y;
    }
    for (let i = 0; i < sortedAnchors.length - 1; i++) {
      const a = sortedAnchors[i];
      const b = sortedAnchors[i + 1];
      if (x >= a.x && x <= b.x) {
        const t = (x - a.x) / Math.max(0.001, b.x - a.x);
        const smooth = t * t * (3 - 2 * t);
        return a.y + (b.y - a.y) * smooth;
      }
    }
    return sortedAnchors[0].y;
  };

  const pads: LandingPad[] = padSpecs.map((p) => ({
    id: p.id,
    label: p.label,
    type: p.type,
    x1: p.centerX - p.width * 0.5,
    x2: p.centerX + p.width * 0.5,
    y: p.y,
    multiplier: p.multiplier,
  }));

  // Build exact X coordinates ensuring exact pad endpoints are vertices
  const xs = new Set<number>();
  for (let x = 0; x <= worldWidth; x += stepM) {
    xs.add(Math.round(x * 10) / 10);
  }
  xs.add(0);
  xs.add(worldWidth);

  for (const pad of pads) {
    // Delete grid points strictly inside pad so pad is a clean crisp flat segment
    for (const existing of Array.from(xs)) {
      if (existing > pad.x1 - 1.5 && existing < pad.x2 + 1.5) {
        xs.delete(existing);
      }
    }
    xs.add(Math.round(pad.x1 * 10) / 10);
    xs.add(Math.round(pad.x2 * 10) / 10);
  }

  const sortedX = Array.from(xs).sort((a, b) => a - b);
  const points: Vec2[] = [];

  for (const x of sortedX) {
    // Check if on or near a pad
    let matchedPad: LandingPad | null = null;
    let minPadEdgeDist = Infinity;
    let nearestPadY = 0;

    for (const pad of pads) {
      const x1 = Math.round(pad.x1 * 10) / 10;
      const x2 = Math.round(pad.x2 * 10) / 10;
      if (x >= x1 - 0.05 && x <= x2 + 0.05) {
        matchedPad = pad;
        break;
      }
      const dist = x < x1 ? x1 - x : x - x2;
      if (dist < minPadEdgeDist) {
        minPadEdgeDist = dist;
        nearestPadY = pad.y;
      }
    }

    if (matchedPad) {
      points.push({ x, y: matchedPad.y });
    } else {
      let base = sampleAnchorY(x);
      const jitter =
        (rng() - 0.5) * roughness +
        Math.sin(x * 0.11) * (roughness * 0.28) +
        Math.cos(x * 0.27) * (roughness * 0.14);
      let y = base + jitter;

      // Smoothly blend terrain shoulders into nearby pad elevation within 18m
      if (minPadEdgeDist < 18) {
        const blend = minPadEdgeDist / 18;
        const ease = blend * blend;
        y = nearestPadY * (1 - ease) + y * ease;
      }
      points.push({ x, y: Math.max(8, y) });
    }
  }

  return { points, pads };
}

function buildStrataLayers(terrain: Vec2[], rng: () => number, count = 3): Vec2[][] {
  const layers: Vec2[][] = [];
  for (let l = 1; l <= count; l++) {
    const depth = l * 9.5;
    const layer: Vec2[] = [];
    for (let i = 0; i < terrain.length; i += 2) {
      const p = terrain[i];
      const offset = depth + Math.sin(p.x * 0.06 + l * 1.9) * 3.2 + (rng() - 0.5) * 2.2;
      layer.push({ x: p.x, y: p.y - offset });
    }
    if (terrain.length > 0 && layer[layer.length - 1].x < terrain[terrain.length - 1].x) {
      const last = terrain[terrain.length - 1];
      layer.push({ x: last.x, y: last.y - depth });
    }
    layers.push(layer);
  }
  return layers;
}

function buildCeilingPolyline(
  worldWidth: number,
  stepM: number,
  anchors: ControlAnchor[],
  floorPoints: Vec2[],
  spawnPos: Vec2,
  pads: LandingPad[],
  rng: () => number,
  stalactiteAmp: number,
  minClearanceM: number
): Vec2[] {
  const sortedAnchors = [...anchors].sort((a, b) => a.x - b.x);
  const sampleCeilingAnchor = (x: number): number => {
    if (x <= sortedAnchors[0].x) return sortedAnchors[0].y;
    if (x >= sortedAnchors[sortedAnchors.length - 1].x) {
      return sortedAnchors[sortedAnchors.length - 1].y;
    }
    for (let i = 0; i < sortedAnchors.length - 1; i++) {
      const a = sortedAnchors[i];
      const b = sortedAnchors[i + 1];
      if (x >= a.x && x <= b.x) {
        const t = (x - a.x) / Math.max(0.001, b.x - a.x);
        const smooth = t * t * (3 - 2 * t);
        return a.y + (b.y - a.y) * smooth;
      }
    }
    return sortedAnchors[0].y;
  };

  const sampleFloorY = (x: number): number => {
    for (let i = 0; i < floorPoints.length - 1; i++) {
      const a = floorPoints[i];
      const b = floorPoints[i + 1];
      if (x >= a.x && x <= b.x) {
        const t = (x - a.x) / Math.max(0.001, b.x - a.x);
        return a.y + (b.y - a.y) * t;
      }
    }
    return floorPoints[0].y;
  };

  const ceiling: Vec2[] = [];
  for (let x = 0; x <= worldWidth + 0.01; x += stepM) {
    const cx = Math.min(worldWidth, x);
    let cy = sampleCeilingAnchor(cx);

    // Occasional hanging stalactites away from spawn & directly over pads
    const distSpawn = Math.abs(cx - spawnPos.x);
    const nearPad = pads.some((p) => cx >= p.x1 - 10 && cx <= p.x2 + 10);

    if (distSpawn > 24 && !nearPad) {
      const spike = Math.pow(rng(), 2.2) * stalactiteAmp;
      cy -= spike + (rng() - 0.5) * 5;
    } else {
      cy += (rng() - 0.5) * 3;
    }

    const floorY = sampleFloorY(cx);
    let minAllowed = floorY + minClearanceM;
    if (distSpawn <= 26) {
      minAllowed = Math.max(minAllowed, spawnPos.y + 22);
    }
    for (const p of pads) {
      if (cx >= p.x1 - 12 && cx <= p.x2 + 12) {
        minAllowed = Math.max(minAllowed, p.y + Math.max(minClearanceM, 48));
      }
    }

    ceiling.push({ x: cx, y: Math.max(minAllowed, cy) });
  }
  return ceiling;
}

export class SectorGenerator {
  public static readonly CAMPAIGN_SECTOR_COUNT = 6;

  public static createCampaignSector(sectorNumber: number): SectorConfig {
    switch (sectorNumber) {
      case 1:
        return this.createSector01();
      case 2:
        return this.createSector02();
      case 3:
        return this.createSector03();
      case 4:
        return this.createSector04();
      case 5:
        return this.createSector05();
      case 6:
      default:
        return this.createSector06();
    }
  }

  // =========================================================================
  // SECTOR 01: THEDUS ORBITAL CALIBRATION
  // =========================================================================
  private static createSector01(): SectorConfig {
    const rng = mulberry32(203701);
    const worldWidth = 420;
    const worldHeight = 260;

    const anchors: ControlAnchor[] = [
      { x: 0, y: 98 },
      { x: 55, y: 62 },
      { x: 115, y: 38 },
      { x: 185, y: 52 },
      { x: 245, y: 34 },
      { x: 315, y: 68 },
      { x: 365, y: 84 },
      { x: 420, y: 112 },
    ];

    const padSpecs: PadSpec[] = [
      { id: 's1-p1', label: 'PAD-ALPHA', type: 'EXTRACTION', centerX: 115, width: 28, y: 38, multiplier: 1 },
      { id: 's1-p2', label: 'PAD-BETA', type: 'EXTRACTION', centerX: 245, width: 20, y: 34, multiplier: 2 },
      { id: 's1-p3', label: 'PAD-GAMMA', type: 'EXTRACTION', centerX: 358, width: 15, y: 82, multiplier: 3 },
    ];

    const { points: terrain, pads } = buildPolylineWithPads(worldWidth, 6, anchors, padSpecs, rng, 7);

    return {
      index: 1,
      code: 'SEC-01',
      name: 'THEDUS ORBITAL CALIBRATION',
      subtitle: 'VACUUM PROVING GROUND // ZERO ATMOSPHERIC INTERFERENCE',
      briefingLines: [
        'ORBITAL INSERTION NOMINAL. GRAVITY WELL: 1.62 M/S² (VACUUM).',
        'PRIMARY OBJECTIVE: CALIBRATE DESCENT ENGINE SPOOL & RCS ATTITUDE THRUSTERS.',
        'PAD-ALPHA (1X) AND PAD-BETA (2X) OFFER WIDE APPROACH CORRIDORS.',
        'OPTIONAL: PAD-GAMMA (3X) ON EASTERN RIDGE FOR PRECISION PILOTS.',
      ],
      gravity: 1.62,
      initialFuelKg: 410,
      maxFuelKg: 410,
      worldWidth,
      worldHeight,
      spawnPos: { x: 78, y: 214 },
      spawnVel: { x: 4.2, y: -1.2 },
      terrain,
      terrainIllum: new Float32Array(Math.max(1, terrain.length - 1)),
      ceiling: null,
      ceilingIllum: null,
      strataLayers: buildStrataLayers(terrain, rng, 3),
      pads,
      windBands: [],
      thermalVents: [],
      darknessLevel: 0,
      emInterference: 0,
      emBlackoutPulse: false,
      dustDensity: 0.08,
      initialRadarCharges: 3,
      endlessMode: false,
    };
  }

  // =========================================================================
  // SECTOR 02: ACHERON BASALT RIM (Deep Canyon 5x + Intermediate Refuel Depot)
  // =========================================================================
  private static createSector02(): SectorConfig {
    const rng = mulberry32(203702);
    const worldWidth = 440;
    const worldHeight = 275;

    const anchors: ControlAnchor[] = [
      { x: 0, y: 155 },
      { x: 65, y: 128 },
      { x: 112, y: 122 },
      { x: 155, y: 142 },
      { x: 198, y: 98 },
      { x: 238, y: 112 },
      { x: 268, y: 48 },
      { x: 304, y: 22 },
      { x: 342, y: 58 },
      { x: 382, y: 138 },
      { x: 440, y: 168 },
    ];

    const padSpecs: PadSpec[] = [
      { id: 's2-p1', label: 'RIM-OUTPOST', type: 'EXTRACTION', centerX: 112, width: 20, y: 122, multiplier: 2 },
      { id: 's2-depot', label: 'REFUEL-DEPOT', type: 'DEPOT', centerX: 198, width: 19, y: 98, multiplier: 0 },
      { id: 's2-p2', label: 'GORGE-FLOOR', type: 'EXTRACTION', centerX: 304, width: 13.5, y: 22, multiplier: 5 },
    ];

    const { points: terrain, pads } = buildPolylineWithPads(worldWidth, 5.5, anchors, padSpecs, rng, 10);

    return {
      index: 2,
      code: 'SEC-02',
      name: 'ACHERON BASALT RIM',
      subtitle: 'HIGH-GRAVITY CANYON // INTERMEDIATE PROPELLANT DEPOT ONLINE',
      briefingLines: [
        'WARNING: PLANETARY GRAVITY ELEVATED TO 2.40 M/S². MASS DEPLETION CRITICAL.',
        'RAZOR BASALT GORGE PROTECTS HIGH-VALUE 5X EXTRACTION ZONE AT 22M DATUM.',
        'TACTICAL OPTION: TOUCH DOWN ON [REFUEL-DEPOT] AT X:198M TO REPLENISH TANKS,',
        'THEN RE-IGNITE MAIN THRUSTER FOR FINAL CANYON EXTRACTION.',
      ],
      gravity: 2.4,
      initialFuelKg: 350,
      maxFuelKg: 420,
      worldWidth,
      worldHeight,
      spawnPos: { x: 62, y: 232 },
      spawnVel: { x: 3.4, y: -1.5 },
      terrain,
      terrainIllum: new Float32Array(Math.max(1, terrain.length - 1)),
      ceiling: null,
      ceilingIllum: null,
      strataLayers: buildStrataLayers(terrain, rng, 4),
      pads,
      windBands: [
        {
          minY: 115,
          maxY: 280,
          label: 'RIM KATABATIC DRAFT',
          baseVx: 4.8,
          gustAmp: 2.2,
          gustFreq: 0.42,
          turbulenceVy: 0.25,
        },
      ],
      thermalVents: [],
      darknessLevel: 0.08,
      emInterference: 0.05,
      emBlackoutPulse: false,
      dustDensity: 0.22,
      initialRadarCharges: 3,
      endlessMode: false,
    };
  }

  // =========================================================================
  // SECTOR 03: SILICATE GALE BASIN (Dynamic Altitude-Banded Wind Shear)
  // =========================================================================
  private static createSector03(): SectorConfig {
    const rng = mulberry32(203703);
    const worldWidth = 450;
    const worldHeight = 270;

    const anchors: ControlAnchor[] = [
      { x: 0, y: 135 },
      { x: 75, y: 68 },
      { x: 135, y: 54 },
      { x: 195, y: 88 },
      { x: 255, y: 42 },
      { x: 315, y: 76 },
      { x: 372, y: 32 },
      { x: 450, y: 128 },
    ];

    const padSpecs: PadSpec[] = [
      { id: 's3-p1', label: 'BASIN-WEST', type: 'EXTRACTION', centerX: 135, width: 21, y: 54, multiplier: 2 },
      { id: 's3-p2', label: 'DUNE-SHELF', type: 'EXTRACTION', centerX: 255, width: 16.5, y: 42, multiplier: 3 },
      { id: 's3-p3', label: 'GALE-SINK', type: 'EXTRACTION', centerX: 372, width: 13.5, y: 32, multiplier: 5 },
    ];

    const { points: terrain, pads } = buildPolylineWithPads(worldWidth, 6, anchors, padSpecs, rng, 9);

    const windBands: WindBand[] = [
      {
        minY: 165,
        maxY: 280,
        label: 'UPPER JETSTREAM',
        baseVx: 12.8,
        gustAmp: 4.6,
        gustFreq: 0.48,
        turbulenceVy: 0.65,
      },
      {
        minY: 85,
        maxY: 165,
        label: 'COUNTER-SHEAR LAYER',
        baseVx: -13.6,
        gustAmp: 5.2,
        gustFreq: 0.64,
        turbulenceVy: 0.9,
      },
      {
        minY: 0,
        maxY: 85,
        label: 'BOUNDARY GUST ZONE',
        baseVx: 4.42,
        gustAmp: 2.34,
        gustFreq: 0.52,
        turbulenceVy: 0.29,
      },
    ];

    return {
      index: 3,
      code: 'SEC-03',
      name: 'SILICATE GALE BASIN',
      subtitle: 'SEVERE ALTITUDE WIND SHEAR // PARTICULATE STREAMING ACTIVE',
      briefingLines: [
        'CAUTION: SEVERE MULTI-BANDED SILICATE GALE DETECTED ACROSS BASIN.',
        'UPPER JETSTREAM DRIVES EAST (+18 KTS); MID-ALTITUDE SHEAR REVERSES WEST (-20 KTS).',
        'ALIGN THRUST AGAINST PROGRADE DRIFT VECTOR OR ENGAGE [S] RETRO-STABILIZER.',
        'GALE-SINK PAD (5X) LIES IN EASTERN BOUNDARY LAYER TROUGH.',
      ],
      gravity: 2.08,
      initialFuelKg: 420,
      maxFuelKg: 420,
      worldWidth,
      worldHeight,
      spawnPos: { x: 88, y: 228 },
      spawnVel: { x: 2.0, y: -1.0 },
      terrain,
      terrainIllum: new Float32Array(Math.max(1, terrain.length - 1)),
      ceiling: null,
      ceilingIllum: null,
      strataLayers: buildStrataLayers(terrain, rng, 3),
      pads,
      windBands,
      thermalVents: [],
      darknessLevel: 0.12,
      emInterference: 0.12,
      emBlackoutPulse: false,
      dustDensity: 1.0,
      initialRadarCharges: 3,
      endlessMode: false,
    };
  }

  // =========================================================================
  // SECTOR 04: SUBTERRANEAN DERELICT CAVERN (Enclosed Ceiling & Spotlight)
  // =========================================================================
  private static createSector04(): SectorConfig {
    const rng = mulberry32(203704);
    const worldWidth = 460;
    const worldHeight = 270;

    const floorAnchors: ControlAnchor[] = [
      { x: 0, y: 148 },
      { x: 70, y: 132 },
      { x: 135, y: 118 },
      { x: 195, y: 74 },
      { x: 255, y: 68 },
      { x: 315, y: 42 },
      { x: 382, y: 28 },
      { x: 460, y: 95 },
    ];

    const padSpecs: PadSpec[] = [
      { id: 's4-p1', label: 'SHAFT-LEDGE', type: 'EXTRACTION', centerX: 135, width: 19, y: 118, multiplier: 2 },
      { id: 's4-p2', label: 'VAULT-MID', type: 'EXTRACTION', centerX: 255, width: 15.5, y: 68, multiplier: 4 },
      { id: 's4-p3', label: 'DERELICT-CHAMBER', type: 'EXTRACTION', centerX: 382, width: 13.5, y: 28, multiplier: 6 },
    ];

    const { points: terrain, pads } = buildPolylineWithPads(worldWidth, 5.5, floorAnchors, padSpecs, rng, 8);

    const spawnPos = { x: 64, y: 204 };
    const ceilingAnchors: ControlAnchor[] = [
      { x: 0, y: 248 },
      { x: 75, y: 242 },
      { x: 145, y: 192 },
      { x: 205, y: 148 },
      { x: 265, y: 136 },
      { x: 325, y: 108 },
      { x: 385, y: 96 },
      { x: 460, y: 155 },
    ];

    const ceiling = buildCeilingPolyline(
      worldWidth,
      6,
      ceilingAnchors,
      terrain,
      spawnPos,
      pads,
      rng,
      16,
      48
    );

    return {
      index: 4,
      code: 'SEC-04',
      name: 'SUBTERRANEAN DERELICT CAVERN',
      subtitle: 'ENCLOSED OVERHEAD ROOF // ZERO AMBIENT ILLUMINATION',
      briefingLines: [
        'ENTERING PITCH-BLACK SUBSURFACE LAVA TUBE. FULL OVERHEAD CEILING.',
        'PASSIVE OPTICS BLIND BEYOND HULL PERIMETER — AIM & [LEFT-CLICK] RADAR (3 CELLS).',
        'RESERVE [SPACEBAR] FOR YOUR SINGLE 1X-PER-GAME EMERGENCY ABORT PULSE.',
        'DEEP DERELICT-CHAMBER EXTRACTION PAD CARRIES 6X HAZARD MULTIPLIER.',
      ],
      gravity: 1.95,
      initialFuelKg: 430,
      maxFuelKg: 430,
      worldWidth,
      worldHeight,
      spawnPos,
      spawnVel: { x: 1.4, y: -0.8 },
      terrain,
      terrainIllum: new Float32Array(Math.max(1, terrain.length - 1)),
      ceiling,
      ceilingIllum: new Float32Array(Math.max(1, ceiling.length - 1)),
      strataLayers: buildStrataLayers(terrain, rng, 3),
      pads,
      windBands: [],
      thermalVents: [],
      darknessLevel: 0.995,
      emInterference: 0.08,
      emBlackoutPulse: false,
      dustDensity: 0.35,
      initialRadarCharges: 3,
      endlessMode: false,
    };
  }

  // =========================================================================
  // SECTOR 05: ELECTROMAGNETIC WHITEOUT (Ion Storm & 4s LIDAR Decay)
  // =========================================================================
  private static createSector05(): SectorConfig {
    const rng = mulberry32(203705);
    const worldWidth = 460;
    const worldHeight = 275;

    const anchors: ControlAnchor[] = [
      { x: 0, y: 152 },
      { x: 68, y: 112 },
      { x: 122, y: 96 },
      { x: 175, y: 138 },
      { x: 228, y: 78 },
      { x: 282, y: 118 },
      { x: 336, y: 36 },
      { x: 398, y: 52 },
      { x: 460, y: 145 },
    ];

    const padSpecs: PadSpec[] = [
      { id: 's5-p1', label: 'RELAY-RIDGE', type: 'EXTRACTION', centerX: 122, width: 19, y: 96, multiplier: 2 },
      { id: 's5-depot', label: 'STORM-DEPOT', type: 'DEPOT', centerX: 228, width: 18, y: 78, multiplier: 0 },
      { id: 's5-p2', label: 'ION-TRENCH', type: 'EXTRACTION', centerX: 336, width: 13.5, y: 36, multiplier: 5 },
      { id: 's5-p3', label: 'ARRAY-EAST', type: 'EXTRACTION', centerX: 398, width: 15, y: 52, multiplier: 4 },
    ];

    const { points: terrain, pads } = buildPolylineWithPads(worldWidth, 5.5, anchors, padSpecs, rng, 11);

    const windBands: WindBand[] = [
      {
        minY: 120,
        maxY: 280,
        label: 'ION SQUALL UPPER',
        baseVx: -9.8,
        gustAmp: 4.2,
        gustFreq: 0.55,
        turbulenceVy: 0.65,
      },
      {
        minY: 0,
        maxY: 120,
        label: 'ION SURFACE DRIFT',
        baseVx: 4.81,
        gustAmp: 2.21,
        gustFreq: 0.48,
        turbulenceVy: 0.29,
      },
    ];

    return {
      index: 5,
      code: 'SEC-05',
      name: 'ELECTROMAGNETIC WHITEOUT',
      subtitle: 'HEAVY ION INTERFERENCE // ACTIVE LIDAR TERRAIN PING REQUIRED',
      briefingLines: [
        'WARNING: INTERMITTENT IONOSPHERIC SURGES CAUSE COMPLETE TERRAIN OPTIC BLACKOUTS.',
        'WHEN OPTICS DROP OUT, AIM & [LEFT-CLICK] DIRECTIONAL RADAR (3 CELLS) TO SEE.',
        '[SPACEBAR] ARMS YOUR SINGLE 1X-PER-GAME EMERGENCY THRUST PULSE FOR ABORT.',
        'STORM-DEPOT AVAILABLE AT X:228M; ION-TRENCH (5X) LIES BEYOND EASTERN SPIRE.',
      ],
      gravity: 2.2,
      initialFuelKg: 390,
      maxFuelKg: 430,
      worldWidth,
      worldHeight,
      spawnPos: { x: 64, y: 232 },
      spawnVel: { x: 2.6, y: -1.1 },
      terrain,
      terrainIllum: new Float32Array(Math.max(1, terrain.length - 1)),
      ceiling: null,
      ceilingIllum: null,
      strataLayers: buildStrataLayers(terrain, rng, 3),
      pads,
      windBands,
      thermalVents: [],
      darknessLevel: 0.34,
      emInterference: 0.88,
      emBlackoutPulse: true,
      dustDensity: 0.72,
      initialRadarCharges: 3,
      endlessMode: false,
    };
  }

  // =========================================================================
  // SECTOR 06: ATMOSPHERE PROCESSOR THERMAL SHAFT (Master Finale)
  // =========================================================================
  private static createSector06(): SectorConfig {
    const rng = mulberry32(203706);
    const worldWidth = 480;
    const worldHeight = 280;

    const floorAnchors: ControlAnchor[] = [
      { x: 0, y: 158 },
      { x: 72, y: 138 },
      { x: 132, y: 118 },
      { x: 186, y: 84 },
      { x: 242, y: 92 },
      { x: 298, y: 48 },
      { x: 356, y: 54 },
      { x: 412, y: 24 },
      { x: 480, y: 110 },
    ];

    const padSpecs: PadSpec[] = [
      { id: 's6-depot', label: 'DUCT-DEPOT', type: 'DEPOT', centerX: 132, width: 17.5, y: 118, multiplier: 0 },
      { id: 's6-p1', label: 'VENT-BYPASS', type: 'EXTRACTION', centerX: 242, width: 16, y: 92, multiplier: 3 },
      { id: 's6-p2', label: 'REACTOR-BASE', type: 'EXTRACTION', centerX: 412, width: 13, y: 24, multiplier: 6 },
    ];

    const { points: terrain, pads } = buildPolylineWithPads(worldWidth, 5.5, floorAnchors, padSpecs, rng, 9);

    const spawnPos = { x: 58, y: 214 };
    const ceilingAnchors: ControlAnchor[] = [
      { x: 0, y: 258 },
      { x: 80, y: 252 },
      { x: 150, y: 198 },
      { x: 230, y: 168 },
      { x: 310, y: 138 },
      { x: 390, y: 112 },
      { x: 435, y: 104 },
      { x: 480, y: 175 },
    ];

    const ceiling = buildCeilingPolyline(
      worldWidth,
      6,
      ceilingAnchors,
      terrain,
      spawnPos,
      pads,
      rng,
      14,
      50
    );

    const sampleFloorAt = (x: number): number => {
      for (let i = 0; i < terrain.length - 1; i++) {
        if (x >= terrain[i].x && x <= terrain[i + 1].x) {
          const t = (x - terrain[i].x) / Math.max(0.01, terrain[i + 1].x - terrain[i].x);
          return terrain[i].y + (terrain[i + 1].y - terrain[i].y) * t;
        }
      }
      return 60;
    };

    const thermalVents: ThermalVent[] = [
      { x: 186, y: sampleFloorAt(186), width: 19, maxHeight: 102, updraftAccel: 9.8, phase: 0.0 },
      { x: 298, y: sampleFloorAt(298), width: 20, maxHeight: 108, updraftAccel: 10.6, phase: 2.1 },
      { x: 356, y: sampleFloorAt(356), width: 18, maxHeight: 96, updraftAccel: 10.2, phase: 4.2 },
    ];

    const windBands: WindBand[] = [
      {
        minY: 130,
        maxY: 280,
        label: 'INTAKE CROSSFLOW',
        baseVx: 10.6,
        gustAmp: 4.2,
        gustFreq: 0.58,
        turbulenceVy: 0.65,
      },
      {
        minY: 0,
        maxY: 130,
        label: 'EXHAUST BACKDRAFT',
        baseVx: -6.37,
        gustAmp: 2.93,
        gustFreq: 0.65,
        turbulenceVy: 0.52,
      },
    ];

    return {
      index: 6,
      code: 'SEC-06',
      name: 'ATMOSPHERE PROCESSOR THERMAL SHAFT',
      subtitle: 'MASTER EXTRACTION // THERMAL UPDRAFTS + INTERMITTENT EM SURGES',
      briefingLines: [
        'FINAL DESCENT INTO HADLEY PROCESSOR EXHAUST SHAFT. GRAVITY: 2.50 M/S².',
        'HAZARDS: ENCLOSED COOLING DUCTS, VERTICAL THERMAL UPDRAFT VENTS, WIND GUSTS,',
        'AND INTERMITTENT ELECTROMAGNETIC SENSOR BLACKOUT PULSES.',
        'FUEL RESERVES RESTRICTED (315 KG). USE DUCT-DEPOT OR DESCEND DIRECT TO 6X CORE.',
      ],
      gravity: 2.5,
      initialFuelKg: 315,
      maxFuelKg: 430,
      worldWidth,
      worldHeight,
      spawnPos,
      spawnVel: { x: 2.2, y: -1.0 },
      terrain,
      terrainIllum: new Float32Array(Math.max(1, terrain.length - 1)),
      ceiling,
      ceilingIllum: new Float32Array(Math.max(1, ceiling.length - 1)),
      strataLayers: buildStrataLayers(terrain, rng, 4),
      pads,
      windBands,
      thermalVents,
      darknessLevel: 0.94,
      emInterference: 0.48,
      emBlackoutPulse: true,
      dustDensity: 0.85,
      initialRadarCharges: 3,
      endlessMode: false,
    };
  }

  // =========================================================================
  // ENDLESS DEEP-SURVEY PROCEDURAL GENERATOR
  // =========================================================================
  public static createEndlessSector(depthNumber: number, runSeed: number): SectorConfig {
    const rng = mulberry32((runSeed ^ Math.imul(depthNumber, 0x9e3779b1)) >>> 0);
    const worldWidth = 460;
    const worldHeight = 275;

    const difficulty = Math.min(1, (depthNumber - 1) / 8);
    const gravity = Math.round((1.75 + rng() * 0.65 + difficulty * 0.32) * 100) / 100;
    const hasCeiling = depthNumber >= 2 && rng() < 0.45 + difficulty * 0.2;
    const hasWind = rng() < 0.65 + difficulty * 0.25;
    const hasEM = depthNumber >= 2 && rng() < 0.45 + difficulty * 0.25;
    const hasVents = depthNumber >= 2 && rng() < 0.5;

    // Generate 8 anchors across width
    const anchors: ControlAnchor[] = [];
    const segCount = 7;
    for (let i = 0; i <= segCount; i++) {
      const x = (i / segCount) * worldWidth;
      let y = 32 + rng() * 105;
      if (i === 0 || i === segCount) y = 125 + rng() * 35;
      anchors.push({ x, y });
    }

    // Place 3 pads + 1 refuel depot
    const p1X = 115 + rng() * 25;
    const pDepotX = 205 + rng() * 25;
    const p2X = 295 + rng() * 25;
    const p3X = 385 + rng() * 25;

    const p1Y = 75 + rng() * 38;
    const pDepotY = 70 + rng() * 42;
    const p2Y = 42 + rng() * 35;
    const p3Y = 22 + rng() * 24;

    anchors.push(
      { x: p1X, y: p1Y },
      { x: pDepotX, y: pDepotY },
      { x: p2X, y: p2Y },
      { x: p3X, y: p3Y }
    );

    const multHigh = Math.min(6, 4 + Math.floor(rng() * 3));
    const padSpecs: PadSpec[] = [
      { id: `ds-${depthNumber}-p1`, label: 'SURVEY-A', type: 'EXTRACTION', centerX: p1X, width: 18.5, y: p1Y, multiplier: 2 },
      { id: `ds-${depthNumber}-dep`, label: 'SURVEY-DEPOT', type: 'DEPOT', centerX: pDepotX, width: 17.5, y: pDepotY, multiplier: 0 },
      { id: `ds-${depthNumber}-p2`, label: 'SURVEY-B', type: 'EXTRACTION', centerX: p2X, width: 15, y: p2Y, multiplier: 4 },
      { id: `ds-${depthNumber}-p3`, label: 'CORE-SITE', type: 'EXTRACTION', centerX: p3X, width: 13, y: p3Y, multiplier: multHigh },
    ];

    const { points: terrain, pads } = buildPolylineWithPads(worldWidth, 5.5, anchors, padSpecs, rng, 10 + difficulty * 4);
    const spawnPos = { x: 62, y: hasCeiling ? 210 : 230 };

    let ceiling: Vec2[] | null = null;
    if (hasCeiling) {
      const cAnchors = anchors.map((a) => ({
        x: a.x,
        y: Math.min(258, a.y + 72 + rng() * 32),
      }));
      ceiling = buildCeilingPolyline(worldWidth, 6, cAnchors, terrain, spawnPos, pads, rng, 14, 48);
    }

    const windBands: WindBand[] = [];
    if (hasWind) {
      const dir = rng() < 0.5 ? 1 : -1;
      windBands.push(
        {
          minY: 130,
          maxY: 280,
          label: 'HIGH-ALT GALE',
          baseVx: dir * (5.5 + rng() * 5.5),
          gustAmp: 2.5 + rng() * 2,
          gustFreq: 0.52,
          turbulenceVy: 0.45,
        },
        {
          minY: 0,
          maxY: 130,
          label: 'BASIN COUNTERFLOW',
          baseVx: -dir * (4.5 + rng() * 5.0) * 0.65,
          gustAmp: (2.2 + rng() * 2) * 0.65,
          gustFreq: 0.6,
          turbulenceVy: 0.29,
        }
      );
    }

    const thermalVents: ThermalVent[] = [];
    if (hasVents) {
      const candidateXs = [155 + rng() * 85, 255 + rng() * 115];
      for (const vx of candidateXs) {
        const nearPad = pads.some((p) => Math.abs(vx - (p.x1 + p.x2) * 0.5) < 22);
        if (!nearPad) {
          let fy = 60;
          for (let i = 0; i < terrain.length - 1; i++) {
            if (vx >= terrain[i].x && vx <= terrain[i + 1].x) {
              fy = (terrain[i].y + terrain[i + 1].y) * 0.5;
              break;
            }
          }
          thermalVents.push({
            x: vx,
            y: fy,
            width: 19,
            maxHeight: 100,
            updraftAccel: 9.8,
            phase: rng() * 6,
          });
        }
      }
    }

    const codeNum = String(depthNumber).padStart(2, '0');
    const sectorDesignations = [
      'LV-426 FISSURE',
      'ORIGAE BASALT TRENCH',
      'CALPAMOS RIFT',
      'FIORINA SLAG CHASM',
      'LV-223 SILICATE VAULT',
      'THEDUS DEEP CRATER',
    ];
    const baseTitle = sectorDesignations[(depthNumber - 1) % sectorDesignations.length];

    return {
      index: 100 + depthNumber,
      code: `DS-${codeNum}`,
      name: `${baseTitle} // SURVEY ${codeNum}`,
      subtitle: 'ENDLESS DEEP-SURVEY TELEMETRY // PROCEDURAL ANOMALY ZONE',
      briefingLines: [
        `DEEP-SURVEY DROP ${codeNum}. LOCAL GRAVITY WELL: ${gravity.toFixed(2)} M/S².`,
        `HAZARD PROFILE: ${hasCeiling ? 'ENCLOSED CAVERN // ' : 'OPEN SKY // '}${hasWind ? 'SHEAR WINDS // ' : 'CALM // '}${hasEM ? 'ION STATIC' : 'CLEAN RADAR'}.`,
        'CONSECUTIVE SAFE EXTRACTIONS MULTIPLY ALL SECTOR TELEMETRY SCORES.',
        `HIGH-PRIORITY EXTRACTION PAD [CORE-SITE] RATED AT ${multHigh}X.`,
      ],
      gravity,
      initialFuelKg: Math.round(380 - difficulty * 45),
      maxFuelKg: 430,
      worldWidth,
      worldHeight,
      spawnPos,
      spawnVel: { x: 2.4, y: -1.1 },
      terrain,
      terrainIllum: new Float32Array(Math.max(1, terrain.length - 1)),
      ceiling,
      ceilingIllum: ceiling ? new Float32Array(Math.max(1, ceiling.length - 1)) : null,
      strataLayers: buildStrataLayers(terrain, rng, 3),
      pads,
      windBands,
      thermalVents,
      darknessLevel: hasCeiling ? 0.99 : hasEM ? 0.78 : 0.1,
      emInterference: hasEM ? 0.88 : 0.06,
      emBlackoutPulse: depthNumber >= 4 && hasEM,
      dustDensity: hasWind ? 0.85 : 0.25,
      initialRadarCharges: 3,
      endlessMode: true,
    };
  }
}
