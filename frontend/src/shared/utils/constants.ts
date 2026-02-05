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

// Map controls
export const MAP_PAN_STEP = 50; // pixels
export const MAP_ZOOM_STEP = 1;

// Default zoom level
export const DEFAULT_MAP_ZOOM = 13;

// Map layer z-index values
export const MAP_Z_INDEX = {
  ANNOTATIONS_PANE: 650,
  EDIT_HANDLES_PANE: 700,
  OVERLAY_PANE: 400,
  MARKER_PANE: 600,
} as const;

// Map animation settings
export const MAP_ANIMATION = {
  WHEEL_PX_PER_ZOOM: 60,
  ZOOM_THRESHOLD: 4,
  PAN_OFFSET_PIXELS: 100,
} as const;

// Marker icon sizes
export const MARKER_ICON_SIZE = {
  DEFAULT: 24,
  ANCHOR_OFFSET: 12,
  POPUP_ANCHOR_Y: -12,
} as const;

// Map styling defaults
export const MAP_STYLES = {
  POLYGON_WEIGHT: 2,
  POLYGON_WEIGHT_SELECTED: 3,
  POLYGON_WEIGHT_HOVERED: 2.5,
  POLYGON_FILL_OPACITY: 0.2,
  POLYGON_FILL_OPACITY_SELECTED: 0.3,
  POLYGON_FILL_OPACITY_HOVERED: 0.25,
  LINE_WEIGHT: 3,
  MARKER_OPACITY_DEFAULT: 0.7,
  MARKER_OPACITY_HOVERED: 0.85,
  MARKER_OPACITY_SELECTED: 1,
} as const;
