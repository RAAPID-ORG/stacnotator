/**
 * Application-wide constants
 */

// Keyboard shortcuts
export const DIGIT_INPUT_TIMEOUT_MS = 300;

// Auto-close durations for alerts (in milliseconds)
export const ALERT_AUTO_CLOSE_DURATION = {
  SUCCESS: 3000,
  ERROR: 5000,
  INFO: 3000,
  WARNING: 4000,
} as const;

// Default zoom level
export const DEFAULT_MAP_ZOOM = 13;
