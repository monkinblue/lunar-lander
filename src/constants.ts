export const COLORS = {
  BG_DEEP: '#030805',
  GREEN_PRIMARY: '#3BE068',
  GREEN_BRIGHT: '#8EF5AB',
  GREEN_MID: '#238C40',
  GREEN_DIM: '#103D1F',
  GREEN_FAINT: '#082010',
  AMBER_CAUTION: '#FF8C00',
  AMBER_BRIGHT: '#FFB238',
  AMBER_DIM: '#5E3400',
  RED_KLAXON: '#FF3318',
  RED_DIM: '#6B1206',
  CHASSIS_OUTER: '#0A0D0B',
  CHASSIS_PANEL: '#111614',
  CHASSIS_EDGE: '#242F28',
  CHASSIS_TEXT: '#8EA896',
} as const;

export const PHYSICS = {
  FIXED_DT: 1 / 60,
  MAX_FRAME_DT: 0.1,

  // Narcissus / Cheyenne Drop-Shuttle Mass & Propulsion (SI units: kg, N, m, s)
  DRY_MASS_KG: 950,
  MAIN_THRUST_N: 5800,
  OVERDRIVE_MULTIPLIER: 1.35, // Shift + W emergency burn
  MAIN_BURN_RATE_KG_S: 8.2, // kg/s at 100% throttle
  OVERDRIVE_BURN_PENALTY: 1.65,
  THROTTLE_SPOOL_UP_RATE: 4.6, // /s
  THROTTLE_SPOOL_DOWN_RATE: 6.4, // /s

  // Attitude & RCS (Snappy high-authority roll speed & preserved momentum)
  RCS_TORQUE_NM: 24800,
  RCS_BURN_RATE_KG_S: 0.80,
  SAS_DAMPING_TORQUE: 3400,
  SAS_BURN_RATE_KG_S: 0.22,

  // Emergency One-Time Solid-Rocket Thrust Pulse ([SPACEBAR])
  EMERGENCY_PULSE_THRUST_N: 26500,
  EMERGENCY_PULSE_DURATION_S: 0.46,
  EMERGENCY_PULSE_INSTANT_DV: 3.8,

  // S / Down Retro-Stabilizer Assist
  RETRO_ANGULAR_DAMP: 10500,
  RETRO_UPRIGHT_TORQUE: 6200,
  RETRO_LATERAL_THRUST_N: 2100,
  RETRO_BURN_RATE_KG_S: 3.8,

  // Shuttle Geometry (meters)
  HULL_RADIUS_M: 2.6,
  HULL_TOP_Y: 3.3,
  STRUT_SPAN_HALF_X: 3.6, // 7.2m total footpad span
  STRUT_REST_BOTTOM_Y: -3.2, // relative to center of mass
  STRUT_MAX_TRAVEL_M: 0.95, // spring compression travel
  STRUT_SPRING_K: 42000,
  STRUT_DAMPER_C: 9200,

  // Sensors & 3 Discrete Tactical Radar Cell Charges ([LEFT-CLICK])
  CAPACITOR_RECHARGE_PER_S: 6.5, // Slow emergency-only cell regen when 0 charges remain
  OMNI_LIDAR_COST: 1,
  OMNI_LIDAR_RANGE_M: 225,
  OMNI_LIDAR_SPEED_M_S: 175,
  DIR_LIDAR_COST: 1,
  DIR_LIDAR_RANGE_M: 295,
  DIR_LIDAR_SPEED_M_S: 225,
  DIR_LIDAR_HALF_ARC: 0.56, // Generous ~64 deg tactical cone for 3-charge radar economy
  SPOTLIGHT_RANGE_M: 42,
  SPOTLIGHT_HALF_ARC: 0.17,
  LIDAR_DECAY_SECONDS: 2.35,

  // Approach & Landing Thresholds
  APPROACH_PROXIMITY_M: 90,
  SAFE_VS_MAX: 2.2,
  SAFE_HS_MAX: 1.2,
  SAFE_ANGLE_DEG: 7.0,
  KISS_VS_MAX: 0.8,
  KISS_HS_MAX: 0.4,
  SURVIVAL_VS_MAX: 3.8,
  SURVIVAL_HS_MAX: 2.1,
  SURVIVAL_ANGLE_DEG: 13.5,

  // Refuel Depot Rate
  DEPOT_REFUEL_RATE_KG_S: 32,

  // Scoring Constants
  BASE_PAD_VALUE: 1000,
  FUEL_SCORE_MULTIPLIER: 15,
  MAX_KISS_BONUS: 1500,
  NO_DAMAGE_BONUS: 1000,
} as const;

export const VOICE_TRANSCRIPTS: Record<string, string> = {
  voice_boot: 'INTERFACE 2037 READY. ORBITAL DESCENT TELEMETRY ONLINE.',
  voice_wind: 'CAUTION. ATMOSPHERIC WIND SHEAR.',
  voice_wind_shear_short: 'WIND SHEAR.',
  voice_interference: 'ELECTROMAGNETIC INTERFERENCE. ENGAGE RADAR.',
  voice_fuel_low: 'CAUTION. PROPELLANT TWENTY-FIVE PERCENT.',
  voice_proximity: 'DESCENT RATE.',
  voice_pull_up: 'PULL UP.',
  voice_bank_angle: 'BANK ANGLE.',
  voice_lateral_drift: 'LATERAL DRIFT.',
  voice_minimums: 'MINIMUMS.',
  voice_obstacle: 'OBSTACLE.',
  voice_touchdown: 'CONTACT LIGHT. ENGINE STOP.',
  voice_hull_breach: 'CRITICAL HULL BREACH. SIGNAL LOST.',
};
