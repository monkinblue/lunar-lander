export interface Vec2 {
  x: number;
  y: number;
}

export type PadType = 'EXTRACTION' | 'DEPOT';

export interface LandingPad {
  id: string;
  label: string;
  type: PadType;
  x1: number;
  x2: number;
  y: number;
  multiplier: number;
}

export interface WindBand {
  minY: number;
  maxY: number;
  label: string;
  baseVx: number; // m/s (+ East / right, - West / left)
  gustAmp: number;
  gustFreq: number;
  turbulenceVy: number;
}

export interface ThermalVent {
  x: number;
  y: number;
  width: number;
  maxHeight: number;
  updraftAccel: number; // m/s^2 upward
  phase: number;
}

export interface SectorConfig {
  index: number;
  code: string;
  name: string;
  subtitle: string;
  briefingLines: string[];
  gravity: number; // m/s^2
  initialFuelKg: number;
  maxFuelKg: number;
  worldWidth: number;
  worldHeight: number;
  spawnPos: Vec2;
  spawnVel: Vec2;
  terrain: Vec2[];
  terrainIllum: Float32Array;
  ceiling: Vec2[] | null;
  ceilingIllum: Float32Array | null;
  strataLayers: Vec2[][];
  pads: LandingPad[];
  windBands: WindBand[];
  thermalVents: ThermalVent[];
  darknessLevel: number; // 0 = full wireframe visibility, 1 = pitch dark cavern
  emInterference: number; // 0 = clean, 0.85 = heavy ion storm static masking unpinged terrain
  emBlackoutPulse: boolean; // Sector 06 periodic sensor whiteout surges
  dustDensity: number;
  initialRadarCharges: number;
  endlessMode: boolean;
}

export interface LanderState {
  pos: Vec2;
  prevPos: Vec2;
  vel: Vec2;
  angle: number; // radians; 0 = upright, + = clockwise (tilt right)
  prevAngle: number;
  angularVel: number; // rad/s (+ = clockwise)
  throttle: number; // 0 .. 1.35
  targetThrottle: number;
  overdrive: boolean;
  gimbalAngle: number;
  rcsLeftActive: boolean; // firing jets to rotate CCW (left)
  rcsRightActive: boolean; // firing jets to rotate CW (right)
  retroActive: boolean; // S / Down retro-stabilizer active
  fuelKg: number;
  maxFuelKg: number;
  dryMassKg: number;
  hullIntegrity: number; // 0 .. 100
  strutCompressionL: number; // 0 .. 1
  strutCompressionR: number; // 0 .. 1
  strutDamaged: boolean;
  rcsDamaged: boolean;
  tookSectorDamage: boolean;
  sensorCapacitor: number; // 0 .. 100 (emergency cell backup progress when 0 charges remain)
  radarCharges: number;
  maxRadarCharges: number;
  emergencyPulseAvailable: boolean;
  emergencyPulseTimer: number;
  spotlightAngle: number; // world angle (atan2(dy, dx))
  spotlightRange: number;
  spotlightHit: Vec2 | null;
  spotlightDist: number;
  groundedPad: LandingPad | null;
  groundedTime: number;
  refuelingActive: boolean;
  alive: boolean;
  agl: number; // Altitude above ground level immediately underneath
  ceilingClearance: number; // Distance to cavern ceiling directly overhead (Infinity if none)
  currentWindVx: number;
  currentWindVy: number;
  netAccelG: number; // Current sensed G-load
  surfaceSlopeDeg: number; // Slope immediately underneath shuttle
  inWindShear: boolean;
  inThermalUpdraft: boolean;
}

export interface LidarWave {
  origin: Vec2;
  radius: number;
  maxRadius: number;
  speed: number;
  directional: boolean;
  dirAngle: number;
  halfArc: number;
  alpha: number;
}

export interface DebrisSegment {
  pos: Vec2;
  vel: Vec2;
  angle: number;
  angularVel: number;
  p1: Vec2;
  p2: Vec2;
  color: string;
  life: number;
  maxLife: number;
}

export interface ThrusterParticle {
  pos: Vec2;
  vel: Vec2;
  life: number;
  maxLife: number;
  kind: 'MAIN' | 'OVERDRIVE' | 'RCS' | 'SPARK' | 'DUST';
  size: number;
}

export interface ShockwaveRing {
  pos: Vec2;
  radius: number;
  maxRadius: number;
  alpha: number;
}

export type LandingGrade = 'SOFT_KISS' | 'NOMINAL_SAFE' | 'HARD_SURVIVAL' | 'CATASTROPHIC';

export interface LandingEvaluation {
  grade: LandingGrade;
  pad: LandingPad | null;
  impactVs: number;
  impactHs: number;
  impactDeg: number;
  centerOffsetRatio: number; // 0 = dead center, 1 = pad edge
  reason: string;
}

export interface SectorScoreBreakdown {
  sectorCode: string;
  sectorName: string;
  grade: LandingGrade;
  padLabel: string;
  basePadValue: number;
  padMultiplier: number;
  padScore: number;
  remainingFuelKg: number;
  fuelBonus: number;
  touchdownVs: number;
  touchdownHs: number;
  touchdownDeg: number;
  padCenterOffsetRatio: number;
  precisionKissBonus: number;
  noDamageBonus: number;
  subtotal: number;
  streakMultiplier: number;
  sectorTotal: number;
  accuracyRating: string;
  accuracyPercent: number;
}

export type LeaderboardMode = 'CAMPAIGN' | 'ENDLESS';

export interface CrewManifestEntry {
  id?: string;
  callsign: string;
  score: number;
  sector: number;
  highestSector: string;
  accuracyRating: string;
  accuracyPercent: number;
  mode: LeaderboardMode;
  date: string;
  isArchiveFallback?: boolean;
}

export interface TouchdownSnapshot {
  pad: LandingPad;
  dist: number;
  vs: number;
  hs: number;
  deg: number;
  offsetM: number;
  grade: LandingGrade;
}

export interface BezelState {
  sasEnabled: boolean;
  autoZoomEnabled: boolean;
  crtIntensity: number; // 0.0 to 1.0
  audioMuted: boolean;
  flightLogsOpen: boolean;
  osdMenuOpen: boolean;
}

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type GamePhase =
  | 'BOOT'
  | 'TITLE_MENU'
  | 'SECTOR_BRIEFING'
  | 'FLIGHT'
  | 'PAUSED'
  | 'SECTOR_TALLY'
  | 'HULL_BREACH'
  | 'CALLSIGN_ENTRY'
  | 'CAMPAIGN_COMPLETE';

export type VoiceCalloutId =
  | 'voice_boot'
  | 'voice_wind'
  | 'voice_wind_shear_short'
  | 'voice_interference'
  | 'voice_fuel_low'
  | 'voice_proximity'
  | 'voice_pull_up'
  | 'voice_bank_angle'
  | 'voice_lateral_drift'
  | 'voice_minimums'
  | 'voice_obstacle'
  | 'voice_touchdown'
  | 'voice_hull_breach';

export type SfxId =
  | 'screen_power_on'
  | 'nostromo_boot_sequence'
  | 'computer_telemetry_chirp'
  | 'tape_drive_servo'
  | 'ui_keyclick'
  | 'ui_keyclick_alt'
  | 'button_latch_lock'
  | 'keypress_return'
  | 'ui_toggle_switch'
  | 'thruster_ignite'
  | 'emergency_thrust_pulse'
  | 'computer_transition_dark'
  | 'computer_sector_engage'
  | 'computer_touchdown_confirm'
  | 'lidar_ping'
  | 'alien_motion_ping'
  | 'proximity_klaxon'
  | 'landing_soft_mech'
  | 'landing_hard_thud'
  | 'landing_strut_thud'
  | 'hull_explosion';
