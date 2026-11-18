export const COLORS = {
  BG_DEEP: '#08130C',
  GREEN_PRIMARY: '#36C95E',
  GREEN_BRIGHT: '#7BE098',
  GREEN_MID: '#23823D',
  GREEN_DIM: '#123A1F',
  GREEN_FAINT: '#0B2313',
  AMBER_CAUTION: '#FF6600',
  AMBER_BRIGHT: '#FF8C24',
  AMBER_DIM: '#542000',
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
  THROTTLE_SPOOL_UP_RATE: 4.2, // /s
  THROTTLE_SPOOL_DOWN_RATE: 6.0, // /s

  // Attitude & RCS
  RCS_TORQUE_NM: 6200,
  RCS_BURN_RATE_KG_S: 0.95,
  SAS_DAMPING_TORQUE: 3400,
  SAS_BURN_RATE_KG_S: 0.35,

  // S / Down Retro-Stabilizer Assist
  RETRO_ANGULAR_DAMP: 7200,
  RETRO_UPRIGHT_TORQUE: 5200,
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

  // Sensors & Discrete Tactical Radar Cell Charges
  CAPACITOR_RECHARGE_PER_S: 7.5, // Slow emergency-only cell regen when 0 charges remain
  OMNI_LIDAR_COST: 1,
  OMNI_LIDAR_RANGE_M: 215,
  OMNI_LIDAR_SPEED_M_S: 165,
  DIR_LIDAR_COST: 1,
  DIR_LIDAR_RANGE_M: 285,
  DIR_LIDAR_SPEED_M_S: 215,
  DIR_LIDAR_HALF_ARC: 0.36, // ~41 deg focused long-range cone
  SPOTLIGHT_RANGE_M: 42, // Short-range nose inspection beam so caves genuinely require radar
  SPOTLIGHT_HALF_ARC: 0.17,
  LIDAR_DECAY_SECONDS: 1.75, // Fast phosphor fade so radar sweeps must be timed tactically

  // Approach & Landing Thresholds
  APPROACH_PROXIMITY_M: 80,
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
  voice_wind: 'WIND SHEAR.',
  voice_interference: 'ELECTROMAGNETIC INTERFERENCE. ENGAGE RADAR.',
  voice_fuel_low: 'CAUTION. PROPELLANT TWENTY-FIVE PERCENT.',
  voice_proximity: 'DESCENT RATE.',
  voice_pull_up: 'PULL UP.',
  voice_bank_angle: 'BANK ANGLE.',
  voice_touchdown: 'CONTACT LIGHT. ENGINE STOP.',
  voice_hull_breach: 'CRITICAL HULL BREACH. SIGNAL LOST.',
};
