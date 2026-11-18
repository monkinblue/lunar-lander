import { COLORS, PHYSICS } from '../constants';
import type {
  DebrisSegment,
  LanderState,
  LandingEvaluation,
  LandingGrade,
  LandingPad,
  LidarWave,
  SectorConfig,
  ShockwaveRing,
  ThrusterParticle,
  Vec2,
} from '../types';

export interface FlightControlInput {
  throttleUp: boolean; // W or ArrowUp
  overdrive: boolean; // Shift + W
  rotateLeft: boolean; // A or ArrowLeft
  rotateRight: boolean; // D or ArrowRight
  retroStabilizer: boolean; // S or ArrowDown
  sasEnabled: boolean; // Bezel toggle
  aimWorldPos: Vec2; // Mouse cursor projected into world coordinates
}

export interface PhysicsEvents {
  onTouchdownConfirmed?: (evalResult: LandingEvaluation) => void;
  onHardImpactGlitch?: (intensity: number, reason: string) => void;
  onStrutContactThud?: (intensity: number) => void;
  onCatastrophicBreach?: (evalResult: LandingEvaluation) => void;
}

function normalizeAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function raySegmentIntersect(
  origin: Vec2,
  dir: Vec2,
  maxDist: number,
  a: Vec2,
  b: Vec2
): number | null {
  const v1x = origin.x - a.x;
  const v1y = origin.y - a.y;
  const v2x = b.x - a.x;
  const v2y = b.y - a.y;
  const v3x = -dir.y;
  const v3y = dir.x;

  const dot = v2x * v3x + v2y * v3y;
  if (Math.abs(dot) < 1e-6) return null;

  const t1 = (v2x * v1y - v2y * v1x) / dot;
  const t2 = (v1x * v3x + v1y * v3y) / dot;

  if (t1 >= 0 && t1 <= maxDist && t2 >= 0 && t2 <= 1) {
    return t1;
  }
  return null;
}

export class PhysicsEngine {
  public lidarWaves: LidarWave[] = [];
  public particles: ThrusterParticle[] = [];
  public ambientDust: ThrusterParticle[] = [];
  public debris: DebrisSegment[] = [];
  public shockwaves: ShockwaveRing[] = [];

  private simTime = 0;
  private firstContactPeakVs = 0;
  private firstContactPeakHs = 0;
  private firstContactPeakDeg = 0;
  private hadPadContact = false;
  private touchdownLocked = false;
  private thudCooldown = 0;

  public createInitialLander(sector: SectorConfig): LanderState {
    this.lidarWaves = [];
    this.particles = [];
    this.debris = [];
    this.shockwaves = [];
    this.simTime = 0;
    this.firstContactPeakVs = 0;
    this.firstContactPeakHs = 0;
    this.firstContactPeakDeg = 0;
    this.hadPadContact = false;
    this.touchdownLocked = false;
    this.thudCooldown = 0;

    this.seedAmbientDust(sector);

    const floorY = this.samplePolylineY(sector.terrain, sector.spawnPos.x) ?? 0;
    const ceilY = sector.ceiling ? this.samplePolylineY(sector.ceiling, sector.spawnPos.x) : null;

    return {
      pos: { ...sector.spawnPos },
      prevPos: { ...sector.spawnPos },
      vel: { ...sector.spawnVel },
      angle: 0,
      prevAngle: 0,
      angularVel: 0,
      throttle: 0,
      targetThrottle: 0,
      overdrive: false,
      gimbalAngle: 0,
      rcsLeftActive: false,
      rcsRightActive: false,
      retroActive: false,
      fuelKg: sector.initialFuelKg,
      maxFuelKg: sector.maxFuelKg,
      dryMassKg: PHYSICS.DRY_MASS_KG,
      hullIntegrity: 100,
      strutCompressionL: 0,
      strutCompressionR: 0,
      strutDamaged: false,
      rcsDamaged: false,
      tookSectorDamage: false,
      sensorCapacitor: 100,
      radarCharges: sector.initialRadarCharges,
      maxRadarCharges: sector.initialRadarCharges,
      emergencyPulseAvailable: true,
      emergencyPulseTimer: 0,
      spotlightAngle: -Math.PI * 0.5,
      spotlightRange: PHYSICS.SPOTLIGHT_RANGE_M,
      spotlightHit: null,
      spotlightDist: PHYSICS.SPOTLIGHT_RANGE_M,
      groundedPad: null,
      groundedTime: 0,
      refuelingActive: false,
      alive: true,
      agl: Math.max(0, sector.spawnPos.y + PHYSICS.STRUT_REST_BOTTOM_Y - floorY),
      ceilingClearance: ceilY !== null ? Math.max(0, ceilY - (sector.spawnPos.y + PHYSICS.HULL_TOP_Y)) : Infinity,
      currentWindVx: 0,
      currentWindVy: 0,
      netAccelG: 0,
      surfaceSlopeDeg: 0,
      inWindShear: false,
      inThermalUpdraft: false,
    };
  }

  private seedAmbientDust(sector: SectorConfig): void {
    this.ambientDust = [];
    const count = Math.floor(40 + sector.dustDensity * 130);
    for (let i = 0; i < count; i++) {
      this.ambientDust.push({
        pos: {
          x: Math.random() * sector.worldWidth,
          y: Math.random() * sector.worldHeight,
        },
        vel: { x: 0, y: 0 },
        life: Math.random() * 10,
        maxLife: 10,
        kind: 'DUST',
        size: 0.7 + Math.random() * 1.3,
      });
    }
  }

  /**
   * One-time-use Solid-Rocket Emergency Thrust Pulse ([SPACEBAR]):
   * Fires an explosive pyrotechnic abort kick + 0.46s high-G solid-motor burn
   * to arrest fatal descent rates or shear emergencies.
   */
  public triggerEmergencyThrustPulse(lander: LanderState): boolean {
    if (!lander.alive || !lander.emergencyPulseAvailable || this.touchdownLocked) return false;
    lander.emergencyPulseAvailable = false;
    lander.emergencyPulseTimer = PHYSICS.EMERGENCY_PULSE_DURATION_S;
    lander.throttle = PHYSICS.OVERDRIVE_MULTIPLIER;

    // Lift off immediately if sitting on a depot pad
    if (lander.groundedPad) {
      lander.groundedPad = null;
      lander.groundedTime = 0;
      lander.refuelingActive = false;
    }

    const ax = Math.sin(lander.angle);
    const ay = Math.cos(lander.angle);
    lander.vel.x += ax * PHYSICS.EMERGENCY_PULSE_INSTANT_DV;
    lander.vel.y += ay * PHYSICS.EMERGENCY_PULSE_INSTANT_DV;
    lander.angularVel *= 0.25;

    const nozzle = this.localToWorld(lander, 0, -2.35);
    this.shockwaves.push({
      pos: { ...nozzle },
      radius: 1.2,
      maxRadius: 34,
      alpha: 0.95,
    });
    this.spawnSparks(nozzle, 28);
    return true;
  }

  public triggerOmniLidar(lander: LanderState): boolean {
    if (!lander.alive || lander.radarCharges < PHYSICS.OMNI_LIDAR_COST) return false;
    lander.radarCharges = Math.max(0, lander.radarCharges - PHYSICS.OMNI_LIDAR_COST);
    if (lander.radarCharges === 0) {
      lander.sensorCapacitor = 0;
    }
    this.lidarWaves.push({
      origin: { ...lander.pos },
      radius: 2,
      maxRadius: PHYSICS.OMNI_LIDAR_RANGE_M,
      speed: PHYSICS.OMNI_LIDAR_SPEED_M_S,
      directional: false,
      dirAngle: 0,
      halfArc: Math.PI,
      alpha: 1,
    });
    return true;
  }

  public triggerDirectionalLidar(lander: LanderState): boolean {
    if (!lander.alive || lander.radarCharges < PHYSICS.DIR_LIDAR_COST) return false;
    lander.radarCharges = Math.max(0, lander.radarCharges - PHYSICS.DIR_LIDAR_COST);
    if (lander.radarCharges === 0) {
      lander.sensorCapacitor = 0;
    }
    this.lidarWaves.push({
      origin: { ...lander.pos },
      radius: 2,
      maxRadius: PHYSICS.DIR_LIDAR_RANGE_M,
      speed: PHYSICS.DIR_LIDAR_SPEED_M_S,
      directional: true,
      dirAngle: lander.spotlightAngle,
      halfArc: PHYSICS.DIR_LIDAR_HALF_ARC,
      alpha: 1,
    });
    return true;
  }

  public samplePolylineY(poly: Vec2[], x: number): number | null {
    if (poly.length === 0) return null;
    if (x <= poly[0].x) return poly[0].y;
    if (x >= poly[poly.length - 1].x) return poly[poly.length - 1].y;

    // Binary search since polyline X is sorted monotonically
    let lo = 0;
    let hi = poly.length - 2;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const a = poly[mid];
      const b = poly[mid + 1];
      if (x < a.x) {
        hi = mid - 1;
      } else if (x > b.x) {
        lo = mid + 1;
      } else {
        const span = b.x - a.x;
        if (span <= 1e-5) return a.y;
        const t = (x - a.x) / span;
        return a.y + (b.y - a.y) * t;
      }
    }
    return poly[0].y;
  }

  public sampleTerrainSlopeDeg(poly: Vec2[], x: number): number {
    if (poly.length < 2) return 0;
    let lo = 0;
    let hi = poly.length - 2;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const a = poly[mid];
      const b = poly[mid + 1];
      if (x < a.x) hi = mid - 1;
      else if (x > b.x) lo = mid + 1;
      else {
        return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      }
    }
    return 0;
  }

  public sampleWindAt(sector: SectorConfig, x: number, y: number): { vx: number; vy: number; shear: boolean } {
    if (sector.windBands.length === 0) return { vx: 0, vy: 0, shear: false };
    let vx = 0;
    let vy = 0;
    let shear = false;

    for (let i = 0; i < sector.windBands.length; i++) {
      const b = sector.windBands[i];
      if (y >= b.minY && y <= b.maxY) {
        const gust =
          Math.sin(this.simTime * b.gustFreq * Math.PI * 2 + x * 0.018) * b.gustAmp +
          Math.cos(this.simTime * b.gustFreq * 1.7 + y * 0.04) * (b.gustAmp * 0.35);
        vx = b.baseVx + gust;
        vy = Math.sin(this.simTime * 2.1 + x * 0.05) * b.turbulenceVy;

        // Detect shear transition zone near band borders
        if ((b.minY > 5 && Math.abs(y - b.minY) < 9) || (b.maxY < sector.worldHeight - 5 && Math.abs(y - b.maxY) < 9)) {
          shear = true;
        }
        break;
      }
    }
    return { vx, vy, shear };
  }

  public step(
    dt: number,
    lander: LanderState,
    sector: SectorConfig,
    input: FlightControlInput,
    events: PhysicsEvents
  ): void {
    this.simTime += dt;
    if (this.thudCooldown > 0) this.thudCooldown = Math.max(0, this.thudCooldown - dt);

    lander.prevPos.x = lander.pos.x;
    lander.prevPos.y = lander.pos.y;
    lander.prevAngle = lander.angle;

    // Update LIDAR illumination decay (4.0 seconds linear phosphor decay)
    this.updateLidarAndDecay(dt, sector);
    this.updateParticles(dt, sector);
    this.updateAmbientDust(dt, sector);
    this.updateDebrisAndShockwaves(dt, sector);

    if (!lander.alive) {
      return;
    }

    // Emergency backup cell generator ONLY when 0 radar charges remain (~13.3s for 1 reserve cell)
    if (lander.radarCharges <= 0) {
      lander.sensorCapacitor = Math.min(100, lander.sensorCapacitor + PHYSICS.CAPACITOR_RECHARGE_PER_S * dt);
      if (lander.sensorCapacitor >= 100) {
        lander.radarCharges = 1;
        lander.sensorCapacitor = 100;
      }
    } else {
      lander.sensorCapacitor = 100;
    }

    // Aim steerable nose spotlight toward mouse world target
    const aimDx = input.aimWorldPos.x - lander.pos.x;
    const aimDy = input.aimWorldPos.y - lander.pos.y;
    if (aimDx * aimDx + aimDy * aimDy > 0.25) {
      const desiredAim = Math.atan2(aimDy, aimDx);
      const diff = normalizeAngle(desiredAim - lander.spotlightAngle);
      lander.spotlightAngle = normalizeAngle(lander.spotlightAngle + diff * Math.min(1, dt * 16));
    }
    this.updateSpotlightRaycast(lander, sector);

    // Mass-depletion calculation
    const hasFuel = lander.fuelKg > 0.01;
    const totalMass = lander.dryMassKg + lander.fuelKg;
    const momentOfInertia = 4600 + lander.fuelKg * 4.4;

    // Main Descent Engine Throttle Spool-Up / Spool-Down Inertia
    if (input.throttleUp && hasFuel && !this.touchdownLocked) {
      lander.overdrive = input.overdrive;
      lander.targetThrottle = input.overdrive ? PHYSICS.OVERDRIVE_MULTIPLIER : 1.0;
    } else {
      lander.overdrive = false;
      lander.targetThrottle = 0;
    }

    if (lander.throttle < lander.targetThrottle) {
      const rate = lander.overdrive ? PHYSICS.THROTTLE_SPOOL_UP_RATE * 1.45 : PHYSICS.THROTTLE_SPOOL_UP_RATE;
      lander.throttle = Math.min(lander.targetThrottle, lander.throttle + rate * dt);
    } else if (lander.throttle > lander.targetThrottle) {
      lander.throttle = Math.max(lander.targetThrottle, lander.throttle - PHYSICS.THROTTLE_SPOOL_DOWN_RATE * dt);
    }

    if (!hasFuel) {
      lander.throttle = 0;
      lander.overdrive = false;
    }

    // Attitude & RCS Control
    let torque = 0;
    lander.rcsLeftActive = false;
    lander.rcsRightActive = false;
    lander.retroActive = false;

    const rcsHealthFactor = lander.rcsDamaged
      ? 0.72 + 0.1 * Math.sin(this.simTime * 19)
      : 1.0;

    let rotCmd = 0;
    if (input.rotateLeft && !this.touchdownLocked) rotCmd -= 1;
    if (input.rotateRight && !this.touchdownLocked) rotCmd += 1;

    if (rotCmd !== 0 && hasFuel) {
      torque += rotCmd * PHYSICS.RCS_TORQUE_NM * rcsHealthFactor;
      lander.fuelKg = Math.max(0, lander.fuelKg - PHYSICS.RCS_BURN_RATE_KG_S * dt);
      if (rotCmd < 0) lander.rcsLeftActive = true;
      if (rotCmd > 0) lander.rcsRightActive = true;
    } else if (input.sasEnabled && !input.retroStabilizer && hasFuel && Math.abs(lander.angularVel) > 0.012) {
      // Bezel [SAS ATTITUDE DAMPENER]
      const dampSign = -Math.sign(lander.angularVel);
      const dampMag = Math.min(PHYSICS.SAS_DAMPING_TORQUE, Math.abs(lander.angularVel) * 9500);
      torque += dampSign * dampMag * rcsHealthFactor;
      lander.fuelKg = Math.max(0, lander.fuelKg - PHYSICS.SAS_BURN_RATE_KG_S * (dampMag / PHYSICS.SAS_DAMPING_TORQUE) * dt);
      if (dampSign < 0) lander.rcsLeftActive = true;
      if (dampSign > 0) lander.rcsRightActive = true;
    }

    // Gimbaled main thruster vectoring
    const targetGimbal = rotCmd * 0.14;
    lander.gimbalAngle += (targetGimbal - lander.gimbalAngle) * Math.min(1, dt * 12);

    // Forces accumulator
    let forceX = 0;
    let forceY = -sector.gravity * totalMass;

    // S / Down Retro-Stabilizer Assist: opposes spin, uprights attitude, and brakes lateral drift at higher fuel cost
    if (input.retroStabilizer && hasFuel && !this.touchdownLocked && lander.groundedPad === null) {
      lander.retroActive = true;
      const spinDamp = -lander.angularVel * PHYSICS.RETRO_ANGULAR_DAMP;
      const upright = -lander.angle * PHYSICS.RETRO_UPRIGHT_TORQUE;
      torque += (spinDamp + upright) * rcsHealthFactor;

      if (Math.abs(lander.vel.x) > 0.08) {
        const brakeDir = -Math.sign(lander.vel.x);
        const brakeScale = Math.min(1, Math.abs(lander.vel.x) / 1.8);
        forceX += brakeDir * PHYSICS.RETRO_LATERAL_THRUST_N * brakeScale;
      }

      lander.rcsLeftActive = true;
      lander.rcsRightActive = true;
      lander.fuelKg = Math.max(0, lander.fuelKg - PHYSICS.RETRO_BURN_RATE_KG_S * dt);
    }

    // Solid-Rocket Emergency Thrust Pulse ([SPACEBAR])
    if (lander.emergencyPulseTimer > 0) {
      lander.emergencyPulseTimer = Math.max(0, lander.emergencyPulseTimer - dt);
      lander.overdrive = true;
      lander.throttle = PHYSICS.OVERDRIVE_MULTIPLIER;
      const pulseThrust = PHYSICS.EMERGENCY_PULSE_THRUST_N;
      forceX += Math.sin(lander.angle) * pulseThrust;
      forceY += Math.cos(lander.angle) * pulseThrust;
      // Auto-damping gyro kick during emergency burn
      torque += (-lander.angularVel * 8500 - lander.angle * 6500);
      this.emitMainPlumeParticles(lander, sector);
    }

    // Main Descent Engine Thrust + Propellant Burn
    if (lander.throttle > 0.001 && hasFuel && lander.emergencyPulseTimer <= 0) {
      const thrustMag = lander.throttle * PHYSICS.MAIN_THRUST_N;
      const thrustAngle = lander.angle + lander.gimbalAngle * 0.35;
      // angle > 0 is clockwise tilt right -> sin(angle) > 0 pushes +X (right), cos(angle) > 0 pushes +Y (up)
      forceX += Math.sin(thrustAngle) * thrustMag;
      forceY += Math.cos(thrustAngle) * thrustMag;
      torque += lander.gimbalAngle * thrustMag * 0.35;

      const burnMult = lander.throttle > 1.0 ? PHYSICS.OVERDRIVE_BURN_PENALTY : 1.0;
      const fuelBurned = lander.throttle * PHYSICS.MAIN_BURN_RATE_KG_S * burnMult * dt;
      lander.fuelKg = Math.max(0, lander.fuelKg - fuelBurned);

      // Lift off from Refuel Depot when thrusting
      if (lander.groundedPad && lander.targetThrottle > 0.2) {
        lander.groundedPad = null;
        lander.groundedTime = 0;
        lander.refuelingActive = false;
        this.hadPadContact = false;
        this.firstContactPeakVs = 0;
        this.firstContactPeakHs = 0;
        this.firstContactPeakDeg = 0;
      }

      this.emitMainPlumeParticles(lander, sector);
    }

    if (lander.rcsLeftActive || lander.rcsRightActive) {
      this.emitRcsParticles(lander);
    }

    // Altitude-Layered Wind Forces (ZERO drag in vacuum so momentum is 100% conserved;
    // strong aerodynamic wind coupling & gust torque in atmospheric wind sectors!)
    const wind = this.sampleWindAt(sector, lander.pos.x, lander.pos.y);
    lander.currentWindVx = wind.vx;
    lander.currentWindVy = wind.vy;
    lander.inWindShear = wind.shear;

    if (lander.groundedPad === null && sector.windBands.length > 0) {
      // Strong wind pressure pushes shuttle toward wind velocity without killing pilot momentum
      const windActive = Math.abs(wind.vx) > 0.05 || Math.abs(wind.vy) > 0.05;
      if (windActive) {
        const relVx = wind.vx - lander.vel.x;
        const relVy = wind.vy - lander.vel.y;
        forceX += wind.vx * 135 + relVx * 52;
        forceY += wind.vy * 65 + relVy * 22;
        // Aerodynamic weathercocking roll torque from crosswind gusts & shear
        torque += wind.vx * 78 + (wind.shear ? Math.sin(this.simTime * 8.5) * 920 : 0);
      }
    }

    // Vertical Thermal Updraft Vents (Sector 06 & Deep-Survey)
    lander.inThermalUpdraft = false;
    for (const vent of sector.thermalVents) {
      const halfW = vent.width * 0.5 + 1.8;
      if (
        Math.abs(lander.pos.x - vent.x) <= halfW &&
        lander.pos.y >= vent.y &&
        lander.pos.y <= vent.y + vent.maxHeight
      ) {
        lander.inThermalUpdraft = true;
        const heightRatio = 1 - (lander.pos.y - vent.y) / vent.maxHeight;
        const pulse = 0.75 + 0.25 * Math.sin(this.simTime * 3.4 + vent.phase);
        forceY += totalMass * vent.updraftAccel * (0.45 + 0.55 * heightRatio) * pulse;
        torque += Math.sin(this.simTime * 11 + vent.phase) * 680 * heightRatio;
      }
    }

    // Integrate Rigid-Body Linear & Angular Velocity (high momentum conservation)
    const nonGravFx = forceX;
    const nonGravFy = forceY + sector.gravity * totalMass;
    lander.netAccelG = Math.hypot(nonGravFx, nonGravFy) / (totalMass * 9.80665);

    lander.vel.x += (forceX / totalMass) * dt;
    lander.vel.y += (forceY / totalMass) * dt;
    lander.angularVel += (torque / momentOfInertia) * dt;

    lander.angularVel = Math.max(-9.5, Math.min(9.5, lander.angularVel));

    lander.pos.x += lander.vel.x * dt;
    lander.pos.y += lander.vel.y * dt;
    lander.angle = normalizeAngle(lander.angle + lander.angularVel * dt);

    // Keep within sector lateral telemetry corridor
    const margin = 9;
    if (lander.pos.x < margin) {
      lander.pos.x = margin;
      if (lander.vel.x < 0) lander.vel.x *= -0.35;
    } else if (lander.pos.x > sector.worldWidth - margin) {
      lander.pos.x = sector.worldWidth - margin;
      if (lander.vel.x > 0) lander.vel.x *= -0.35;
    }
    if (lander.pos.y > sector.worldHeight + 18) {
      lander.pos.y = sector.worldHeight + 18;
      if (lander.vel.y > 0) lander.vel.y *= 0.2;
    }

    // Evaluate Articulated Struts, Terrain/Ceiling Collisions & Touchdown
    this.resolveContactsAndLanding(dt, lander, sector, events);

    // Update AGL, Surface Slope & Overhead Ceiling Clearance
    const centerFloorY = this.samplePolylineY(sector.terrain, lander.pos.x) ?? 0;
    lander.agl = Math.max(0, lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y - centerFloorY);
    lander.surfaceSlopeDeg = this.sampleTerrainSlopeDeg(sector.terrain, lander.pos.x);
    if (sector.ceiling) {
      const centerCeilY = this.samplePolylineY(sector.ceiling, lander.pos.x) ?? Infinity;
      lander.ceilingClearance = Math.max(0, centerCeilY - (lander.pos.y + PHYSICS.HULL_TOP_Y));
    } else {
      lander.ceilingClearance = Infinity;
    }
  }

  private localToWorld(lander: LanderState, lx: number, ly: number): Vec2 {
    // Local +X right, +Y up; angle > 0 rotates clockwise:
    // worldX = pos.x + lx * cos(a) + ly * sin(a)
    // worldY = pos.y - lx * sin(a) + ly * cos(a)
    const c = Math.cos(lander.angle);
    const s = Math.sin(lander.angle);
    return {
      x: lander.pos.x + lx * c + ly * s,
      y: lander.pos.y - lx * s + ly * c,
    };
  }

  private findPadUnderX(pads: LandingPad[], xL: number, xR: number): LandingPad | null {
    const minX = Math.min(xL, xR);
    const maxX = Math.max(xL, xR);
    for (const pad of pads) {
      // Allow 0.85m footpad edge tolerance on pad boundary
      if (minX >= pad.x1 - 0.85 && maxX <= pad.x2 + 0.85) {
        return pad;
      }
    }
    return null;
  }

  private resolveContactsAndLanding(
    dt: number,
    lander: LanderState,
    sector: SectorConfig,
    events: PhysicsEvents
  ): void {
    // 1. Check Overhead Ceiling & Hull Perimeter Collisions
    const hullCheckPoints: Vec2[] = [
      { x: 0, y: PHYSICS.HULL_TOP_Y }, // Nose crown
      { x: -PHYSICS.HULL_RADIUS_M, y: 1.1 }, // Upper left shoulder
      { x: PHYSICS.HULL_RADIUS_M, y: 1.1 }, // Upper right shoulder
      { x: -PHYSICS.HULL_RADIUS_M * 0.95, y: -1.3 }, // Lower left hull
      { x: PHYSICS.HULL_RADIUS_M * 0.95, y: -1.3 }, // Lower right hull
    ];

    const speed = Math.hypot(lander.vel.x, lander.vel.y);

    for (const lp of hullCheckPoints) {
      const wp = this.localToWorld(lander, lp.x, lp.y);

      // Ceiling check
      if (sector.ceiling) {
        const ceilY = this.samplePolylineY(sector.ceiling, wp.x);
        if (ceilY !== null && wp.y >= ceilY) {
          if (speed > 1.75 || lander.vel.y > 1.35) {
            this.triggerCatastrophicBreakup(lander, 'OVERHEAD CAVERN CEILING STRIKE', events);
            return;
          }
          // Minor ceiling scrape survival
          lander.pos.y -= wp.y - ceilY + 0.25;
          lander.vel.y = -Math.abs(lander.vel.y) * 0.35;
          lander.hullIntegrity = Math.max(10, lander.hullIntegrity - 18);
          lander.tookSectorDamage = true;
          lander.rcsDamaged = true;
          events.onHardImpactGlitch?.(0.65, 'CEILING SCRAPE // RCS DAMAGED');
          this.spawnSparks(wp, 10);
        }
      }

      // Hull body striking rock floor directly (e.g. upside down or cliff wall strike)
      const floorY = this.samplePolylineY(sector.terrain, wp.x);
      if (floorY !== null && wp.y <= floorY) {
        this.triggerCatastrophicBreakup(lander, 'PRIMARY HULL TERRAIN IMPACT', events);
        return;
      }
    }

    // 2. Articulated Left & Right Landing Gear Footpads
    const restFootL = this.localToWorld(lander, -PHYSICS.STRUT_SPAN_HALF_X, PHYSICS.STRUT_REST_BOTTOM_Y);
    const restFootR = this.localToWorld(lander, PHYSICS.STRUT_SPAN_HALF_X, PHYSICS.STRUT_REST_BOTTOM_Y);

    const floorYL = this.samplePolylineY(sector.terrain, restFootL.x) ?? 0;
    const floorYR = this.samplePolylineY(sector.terrain, restFootR.x) ?? 0;

    const penL = floorYL - restFootL.y;
    const penR = floorYR - restFootR.y;

    if (penL <= 0 && penR <= 0) {
      // Airborne: relax spring struts smoothly back to extended position
      lander.strutCompressionL = Math.max(0, lander.strutCompressionL - dt * 4.5);
      lander.strutCompressionR = Math.max(0, lander.strutCompressionR - dt * 4.5);
      lander.groundedPad = null;
      lander.groundedTime = 0;
      lander.refuelingActive = false;
      return;
    }

    // At least one footpad is in ground contact!
    const impactVs = Math.abs(Math.min(0, lander.vel.y));
    const impactHs = Math.abs(lander.vel.x);
    const impactDeg = Math.abs((lander.angle * 180) / Math.PI);

    const matchedPad = this.findPadUnderX(sector.pads, restFootL.x, restFootR.x);

    if (!matchedPad) {
      // Contacting jagged unpadded rock or straddling pad cliff edge!
      const slopeL = Math.abs(this.sampleTerrainSlopeDeg(sector.terrain, restFootL.x));
      const slopeR = Math.abs(this.sampleTerrainSlopeDeg(sector.terrain, restFootR.x));
      if (
        impactVs > 1.55 ||
        impactHs > 1.85 ||
        impactDeg > 11 ||
        Math.max(slopeL, slopeR) > 16
      ) {
        this.triggerCatastrophicBreakup(lander, 'UNPREPARED TERRAIN IMPACT // STRUT SHEAR', events);
        return;
      }

      // Low-speed rough terrain bounce warning
      const maxPen = Math.max(penL, penR);
      lander.pos.y += maxPen + 0.08;
      lander.vel.y = Math.max(0.8, Math.abs(lander.vel.y) * 0.45);
      lander.vel.x *= 0.6;
      lander.strutDamaged = true;
      lander.tookSectorDamage = true;
      lander.hullIntegrity = Math.max(15, lander.hullIntegrity - 16);
      this.spawnSparks(penL > penR ? restFootL : restFootR, 12);
      events.onHardImpactGlitch?.(0.55, 'OFF-PAD TERRAIN CONTACT // STRUT DAMAGED');
      return;
    }

    // Footpads are over a valid Landing Pad!
    if (!this.hadPadContact) {
      this.hadPadContact = true;
      this.firstContactPeakVs = impactVs;
      this.firstContactPeakHs = impactHs;
      this.firstContactPeakDeg = impactDeg;

      // Evaluate catastrophic vs hard survival vs clean contact on initial touchdown
      if (
        impactVs > PHYSICS.SURVIVAL_VS_MAX ||
        impactHs > PHYSICS.SURVIVAL_HS_MAX ||
        impactDeg > PHYSICS.SURVIVAL_ANGLE_DEG
      ) {
        const failReason =
          impactVs > PHYSICS.SURVIVAL_VS_MAX
            ? `EXCESSIVE DESCENT RATE (${impactVs.toFixed(1)} M/S)`
            : impactHs > PHYSICS.SURVIVAL_HS_MAX
              ? `EXCESSIVE LATERAL DRIFT (${impactHs.toFixed(1)} M/S)`
              : `CRITICAL ATTITUDE ANGLE (${impactDeg.toFixed(1)}°)`;
        this.triggerCatastrophicBreakup(lander, failReason, events);
        return;
      }

      if (
        impactVs > PHYSICS.SAFE_VS_MAX ||
        impactHs > PHYSICS.SAFE_HS_MAX ||
        impactDeg > PHYSICS.SAFE_ANGLE_DEG
      ) {
        // Hard Survival Landing!
        lander.tookSectorDamage = true;
        lander.strutDamaged = true;
        lander.rcsDamaged = true;
        lander.hullIntegrity = Math.max(18, lander.hullIntegrity - 36);
        this.spawnSparks(restFootL, 10);
        this.spawnSparks(restFootR, 10);
        events.onHardImpactGlitch?.(0.85, 'HARD TOUCHDOWN // GEAR & RCS DAMAGED');
      } else if (this.thudCooldown <= 0) {
        this.thudCooldown = 0.45;
        events.onStrutContactThud?.(Math.min(1, 0.35 + impactVs / 2.5));
      }
    } else {
      this.firstContactPeakVs = Math.max(this.firstContactPeakVs, impactVs);
      this.firstContactPeakHs = Math.max(this.firstContactPeakHs, impactHs);
      this.firstContactPeakDeg = Math.max(this.firstContactPeakDeg, impactDeg);
    }

    // Instant Magnetic Pad Friction Stop & Zero Wind-Draft Delay Upon Landing!
    const compL = Math.max(0.22, Math.min(1, penL / PHYSICS.STRUT_MAX_TRAVEL_M + 0.25));
    const compR = Math.max(0.22, Math.min(1, penR / PHYSICS.STRUT_MAX_TRAVEL_M + 0.25));
    lander.strutCompressionL = compL + (lander.strutDamaged ? 0.18 : 0);
    lander.strutCompressionR = compR;

    const wantsClimb = lander.targetThrottle >= 0.25 || lander.emergencyPulseTimer > 0;

    if (!wantsClimb) {
      // Lock onto pad immediately: friction & magnetic pad clamps bring craft to a dead stop at once
      lander.groundedPad = matchedPad;
      lander.vel.x = 0;
      lander.vel.y = 0;
      lander.angularVel = 0;
      lander.angle = lander.strutDamaged ? -0.035 : 0;
      lander.pos.y = matchedPad.y - PHYSICS.STRUT_REST_BOTTOM_Y - 0.22;
      lander.groundedTime += dt;

      if (matchedPad.type === 'DEPOT') {
        if (lander.fuelKg < lander.maxFuelKg - 0.05) {
          lander.refuelingActive = true;
          lander.fuelKg = Math.min(
            lander.maxFuelKg,
            lander.fuelKg + PHYSICS.DEPOT_REFUEL_RATE_KG_S * dt
          );
        } else {
          lander.refuelingActive = false;
        }
        if (lander.radarCharges < lander.maxRadarCharges) {
          if (Math.floor(lander.groundedTime * 2.5) > Math.floor((lander.groundedTime - dt) * 2.5)) {
            lander.radarCharges = Math.min(lander.maxRadarCharges, lander.radarCharges + 1);
          }
        }
        if (lander.groundedTime > 0.8) {
          lander.strutDamaged = false;
          lander.rcsDamaged = false;
          lander.hullIntegrity = Math.min(100, lander.hullIntegrity + 16 * dt);
        }
      } else if (matchedPad.type === 'EXTRACTION' && !this.touchdownLocked && lander.groundedTime >= 0.04) {
        this.touchdownLocked = true;
        lander.throttle = 0;
        const padCenter = (matchedPad.x1 + matchedPad.x2) * 0.5;
        const padHalfW = Math.max(1, (matchedPad.x2 - matchedPad.x1) * 0.5);
        const centerOffsetRatio = Math.min(1, Math.abs(lander.pos.x - padCenter) / padHalfW);

        let grade: LandingGrade = 'NOMINAL_SAFE';
        if (
          this.firstContactPeakVs > PHYSICS.SAFE_VS_MAX ||
          this.firstContactPeakHs > PHYSICS.SAFE_HS_MAX ||
          this.firstContactPeakDeg > PHYSICS.SAFE_ANGLE_DEG
        ) {
          grade = 'HARD_SURVIVAL';
        } else if (
          this.firstContactPeakVs < PHYSICS.KISS_VS_MAX &&
          this.firstContactPeakHs < PHYSICS.KISS_HS_MAX &&
          centerOffsetRatio <= 0.48
        ) {
          grade = 'SOFT_KISS';
        }

        events.onTouchdownConfirmed?.({
          grade,
          pad: matchedPad,
          impactVs: this.firstContactPeakVs,
          impactHs: this.firstContactPeakHs,
          impactDeg: this.firstContactPeakDeg,
          centerOffsetRatio,
          reason: 'TOUCHDOWN CONFIRMED',
        });
      }
    }
  }

  private triggerCatastrophicBreakup(
    lander: LanderState,
    reason: string,
    events: PhysicsEvents
  ): void {
    if (!lander.alive) return;
    lander.alive = false;
    lander.throttle = 0;
    lander.hullIntegrity = 0;

    // Expanding shockwave rings
    this.shockwaves.push(
      { pos: { ...lander.pos }, radius: 1.5, maxRadius: 46, alpha: 1.0 },
      { pos: { ...lander.pos }, radius: 0.5, maxRadius: 28, alpha: 0.85 }
    );

    // Spawn rigid-body skeletal wireframe breakup fragments
    const localSegments: Array<[Vec2, Vec2, string]> = [
      [{ x: -1.8, y: 2.8 }, { x: 1.8, y: 2.8 }, COLORS.GREEN_PRIMARY],
      [{ x: 1.8, y: 2.8 }, { x: 2.6, y: 0.8 }, COLORS.GREEN_PRIMARY],
      [{ x: 2.6, y: 0.8 }, { x: 2.0, y: -1.5 }, COLORS.GREEN_PRIMARY],
      [{ x: -1.8, y: 2.8 }, { x: -2.6, y: 0.8 }, COLORS.GREEN_PRIMARY],
      [{ x: -2.6, y: 0.8 }, { x: -2.0, y: -1.5 }, COLORS.GREEN_PRIMARY],
      [{ x: -2.0, y: -1.5 }, { x: 2.0, y: -1.5 }, COLORS.GREEN_PRIMARY],
      // Landing struts & footpads
      [{ x: -1.8, y: -1.2 }, { x: -3.6, y: -3.1 }, COLORS.AMBER_CAUTION],
      [{ x: 1.8, y: -1.2 }, { x: 3.6, y: -3.1 }, COLORS.AMBER_CAUTION],
      [{ x: -4.2, y: -3.1 }, { x: -3.0, y: -3.1 }, COLORS.AMBER_CAUTION],
      [{ x: 3.0, y: -3.1 }, { x: 4.2, y: -3.1 }, COLORS.AMBER_CAUTION],
      // Engine bell & internal frame trusses
      [{ x: -0.9, y: -1.5 }, { x: -1.4, y: -2.6 }, COLORS.RED_KLAXON],
      [{ x: 0.9, y: -1.5 }, { x: 1.4, y: -2.6 }, COLORS.RED_KLAXON],
      [{ x: -1.6, y: 0.8 }, { x: 1.6, y: -0.8 }, COLORS.GREEN_MID],
      [{ x: -1.6, y: -0.8 }, { x: 1.6, y: 0.8 }, COLORS.GREEN_MID],
    ];

    for (const [a, b, color] of localSegments) {
      const wa = this.localToWorld(lander, a.x, a.y);
      const wb = this.localToWorld(lander, b.x, b.y);
      const mid = { x: (wa.x + wb.x) * 0.5, y: (wa.y + wb.y) * 0.5 };
      const outDx = mid.x - lander.pos.x;
      const outDy = mid.y - lander.pos.y;
      const outLen = Math.max(0.4, Math.hypot(outDx, outDy));
      const burst = 5 + Math.random() * 11;

      this.debris.push({
        pos: mid,
        vel: {
          x: lander.vel.x * 0.45 + (outDx / outLen) * burst + (Math.random() - 0.5) * 6,
          y: Math.abs(lander.vel.y) * 0.35 + (outDy / outLen) * burst + 3 + Math.random() * 7,
        },
        angle: 0,
        angularVel: (Math.random() - 0.5) * 11,
        p1: { x: wa.x - mid.x, y: wa.y - mid.y },
        p2: { x: wb.x - mid.x, y: wb.y - mid.y },
        color,
        life: 5.5,
        maxLife: 5.5,
      });
    }

    this.spawnSparks(lander.pos, 42);

    events.onCatastrophicBreach?.({
      grade: 'CATASTROPHIC',
      pad: null,
      impactVs: Math.abs(lander.vel.y),
      impactHs: Math.abs(lander.vel.x),
      impactDeg: Math.abs((lander.angle * 180) / Math.PI),
      centerOffsetRatio: 1,
      reason,
    });
  }

  private updateSpotlightRaycast(lander: LanderState, sector: SectorConfig): void {
    const nose = this.localToWorld(lander, 0, 1.4);
    const dir = { x: Math.cos(lander.spotlightAngle), y: Math.sin(lander.spotlightAngle) };
    let closest = lander.spotlightRange;
    let hit = false;

    const testPoly = (poly: Vec2[], illum: Float32Array | null) => {
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i];
        const b = poly[i + 1];
        // Quick bounding box cull
        const minX = Math.min(a.x, b.x) - 2;
        const maxX = Math.max(a.x, b.x) + 2;
        if (nose.x + dir.x * closest < minX && nose.x < minX) continue;
        if (nose.x + dir.x * closest > maxX && nose.x > maxX) continue;

        const d = raySegmentIntersect(nose, dir, closest, a, b);
        if (d !== null && d < closest) {
          closest = d;
          hit = true;
        }

        // Short-range nose headlight only reveals rock right at the beam tip (never replaces radar!)
        if (illum) {
          const mx = (a.x + b.x) * 0.5 - nose.x;
          const my = (a.y + b.y) * 0.5 - nose.y;
          const distSq = mx * mx + my * my;
          if (distSq < 26 * 26) {
            const ang = Math.atan2(my, mx);
            const diff = Math.abs(normalizeAngle(ang - lander.spotlightAngle));
            if (diff <= PHYSICS.SPOTLIGHT_HALF_ARC) {
              const dist = Math.sqrt(distSq);
              const spotBoost = (1 - dist / 26) * (1 - diff / PHYSICS.SPOTLIGHT_HALF_ARC) * 0.28;
              if (spotBoost > illum[i]) {
                illum[i] = spotBoost;
              }
            }
          }
        }
      }
    };

    testPoly(sector.terrain, sector.terrainIllum);
    if (sector.ceiling) {
      testPoly(sector.ceiling, sector.ceilingIllum);
    }

    lander.spotlightDist = closest;
    lander.spotlightHit = hit
      ? { x: nose.x + dir.x * closest, y: nose.y + dir.y * closest }
      : null;
  }

  private updateLidarAndDecay(dt: number, sector: SectorConfig): void {
    const decayAmount = dt / PHYSICS.LIDAR_DECAY_SECONDS;
    for (let i = 0; i < sector.terrainIllum.length; i++) {
      if (sector.terrainIllum[i] > 0) {
        sector.terrainIllum[i] = Math.max(0, sector.terrainIllum[i] - decayAmount);
      }
    }
    if (sector.ceilingIllum) {
      for (let i = 0; i < sector.ceilingIllum.length; i++) {
        if (sector.ceilingIllum[i] > 0) {
          sector.ceilingIllum[i] = Math.max(0, sector.ceilingIllum[i] - decayAmount);
        }
      }
    }

    for (let w = this.lidarWaves.length - 1; w >= 0; w--) {
      const wave = this.lidarWaves[w];
      const prevR = wave.radius;
      wave.radius += wave.speed * dt;
      wave.alpha = Math.max(0, 1 - wave.radius / wave.maxRadius);

      const sweepPoly = (poly: Vec2[], illum: Float32Array) => {
        for (let i = 0; i < poly.length - 1; i++) {
          const mx = (poly[i].x + poly[i + 1].x) * 0.5 - wave.origin.x;
          const my = (poly[i].y + poly[i + 1].y) * 0.5 - wave.origin.y;
          const dist = Math.hypot(mx, my);
          if (dist >= prevR - 6 && dist <= wave.radius + 6) {
            if (wave.directional) {
              const ang = Math.atan2(my, mx);
              if (Math.abs(normalizeAngle(ang - wave.dirAngle)) > wave.halfArc) {
                continue;
              }
            }
            illum[i] = 1.0;
          }
        }
      };

      sweepPoly(sector.terrain, sector.terrainIllum);
      if (sector.ceiling && sector.ceilingIllum) {
        sweepPoly(sector.ceiling, sector.ceilingIllum);
      }

      if (wave.radius >= wave.maxRadius) {
        this.lidarWaves.splice(w, 1);
      }
    }
  }

  private emitMainPlumeParticles(lander: LanderState, sector: SectorConfig): void {
    const nozzle = this.localToWorld(lander, 0, -2.35);
    const thrustAngle = lander.angle + lander.gimbalAngle * 0.35;
    const exhaustDirX = -Math.sin(thrustAngle);
    const exhaustDirY = -Math.cos(thrustAngle);

    const count = lander.overdrive ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 0.28;
      const spd = (18 + lander.throttle * 26) * (0.85 + Math.random() * 0.3);
      const ca = Math.cos(spread);
      const sa = Math.sin(spread);
      const vx = (exhaustDirX * ca - exhaustDirY * sa) * spd + lander.vel.x;
      const vy = (exhaustDirX * sa + exhaustDirY * ca) * spd + lander.vel.y;

      this.particles.push({
        pos: { x: nozzle.x + (Math.random() - 0.5) * 0.5, y: nozzle.y + (Math.random() - 0.5) * 0.5 },
        vel: { x: vx, y: vy },
        life: 0.22 + Math.random() * 0.14,
        maxLife: 0.36,
        kind: lander.overdrive ? 'OVERDRIVE' : 'MAIN',
        size: 1.2 + lander.throttle * 1.4,
      });
    }

    // Surface regolith dust kick-up when hovering within 22m of ground
    if (lander.agl < 22 && Math.random() < lander.throttle * 0.85) {
      const groundY = this.samplePolylineY(sector.terrain, lander.pos.x) ?? 0;
      const side = Math.random() < 0.5 ? -1 : 1;
      this.particles.push({
        pos: { x: lander.pos.x + side * (1 + Math.random() * 3), y: groundY + 0.3 },
        vel: { x: side * (6 + Math.random() * 12) * lander.throttle, y: 1.5 + Math.random() * 4 },
        life: 0.55 + Math.random() * 0.35,
        maxLife: 0.9,
        kind: 'DUST',
        size: 1.4,
      });
    }
  }

  private emitRcsParticles(lander: LanderState): void {
    if (Math.random() > 0.65) return;
    if (lander.rcsLeftActive) {
      const podR = this.localToWorld(lander, 2.45, 1.55);
      this.particles.push({
        pos: podR,
        vel: { x: lander.vel.x + 8, y: lander.vel.y + 5 },
        life: 0.14,
        maxLife: 0.14,
        kind: 'RCS',
        size: 1.0,
      });
    }
    if (lander.rcsRightActive) {
      const podL = this.localToWorld(lander, -2.45, 1.55);
      this.particles.push({
        pos: podL,
        vel: { x: lander.vel.x - 8, y: lander.vel.y + 5 },
        life: 0.14,
        maxLife: 0.14,
        kind: 'RCS',
        size: 1.0,
      });
    }
  }

  private spawnSparks(origin: Vec2, count: number): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 4 + Math.random() * 19;
      this.particles.push({
        pos: { ...origin },
        vel: { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd + 2 },
        life: 0.4 + Math.random() * 0.65,
        maxLife: 1.05,
        kind: 'SPARK',
        size: 1.3,
      });
    }
  }

  private updateParticles(dt: number, sector: SectorConfig): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      if (p.kind === 'SPARK') {
        p.vel.y -= sector.gravity * 1.4 * dt;
      }
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;

      const fy = this.samplePolylineY(sector.terrain, p.pos.x);
      if (fy !== null && p.pos.y < fy) {
        p.pos.y = fy + 0.1;
        p.vel.y = Math.abs(p.vel.y) * 0.4;
        p.vel.x *= 0.7;
      }
    }
  }

  private updateAmbientDust(dt: number, sector: SectorConfig): void {
    for (const d of this.ambientDust) {
      const w = this.sampleWindAt(sector, d.pos.x, d.pos.y);
      d.vel.x = w.vx * 1.35 + (sector.windBands.length === 0 ? 0.35 : 0);
      d.vel.y = w.vy - 0.55;

      d.pos.x += d.vel.x * dt;
      d.pos.y += d.vel.y * dt;

      if (d.pos.x < 0) d.pos.x += sector.worldWidth;
      if (d.pos.x > sector.worldWidth) d.pos.x -= sector.worldWidth;
      if (d.pos.y < 0) d.pos.y = sector.worldHeight;
      if (d.pos.y > sector.worldHeight) d.pos.y = 4;
    }
  }

  private updateDebrisAndShockwaves(dt: number, sector: SectorConfig): void {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.radius += 58 * dt;
      s.alpha = Math.max(0, 1 - s.radius / s.maxRadius);
      if (s.radius >= s.maxRadius) {
        this.shockwaves.splice(i, 1);
      }
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const seg = this.debris[i];
      seg.life -= dt;
      if (seg.life <= 0) {
        this.debris.splice(i, 1);
        continue;
      }
      seg.vel.y -= sector.gravity * dt;
      seg.pos.x += seg.vel.x * dt;
      seg.pos.y += seg.vel.y * dt;
      seg.angle += seg.angularVel * dt;

      const fy = this.samplePolylineY(sector.terrain, seg.pos.x);
      if (fy !== null && seg.pos.y <= fy + 0.5) {
        seg.pos.y = fy + 0.5;
        seg.vel.y = Math.abs(seg.vel.y) * 0.42;
        seg.vel.x *= 0.68;
        seg.angularVel *= 0.65;
      }
    }
  }
}
