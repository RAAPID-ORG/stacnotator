/**
 * Single source of truth for hotkey labels and descriptions shown in help
 * panels and tooltips. The bindings themselves live in useAnnotationKeyboard
 * (task mode + bindings shared across both work modes, e.g. crosshair) and
 * useOpenModeKeyboard (explore) - change both together.
 */

export interface Shortcut {
  key: string;
  description: string;
}

/** Explore tool-switch keys, shared by the tool buttons and the help panels. */
export const TOOL_KEYS = {
  pan: 'P',
  annotate: 'R',
  edit: 'E',
  labelvector: 'B',
  timeseries: 'T',
} as const;

export const HOTKEYS = {
  crosshair: { key: 'X', description: 'Toggle crosshair' },
  toggleDrawn: { key: 'Shift+X', description: 'Toggle drawn objects' },
  cycleView: { key: 'U', description: 'Cycle view' },
  viewSync: { key: 'L', description: 'Toggle view link (sync windows)' },
  cycleSource: { key: 'I', description: 'Cycle imagery source' },
  cycleViz: { key: 'Shift+I', description: 'Cycle visualization' },
  toggleOverlay: { key: 'O', description: 'Toggle overlay layer' },
  cycleOverlays: { key: 'Shift+O', description: 'Cycle overlay layers' },
  toggleVectorLayer: { key: 'V', description: 'Toggle vector layer' },
  cycleVectorLayers: { key: 'Shift+V', description: 'Cycle vector layers' },
  toggleGuide: { key: 'G', description: 'Toggle campaign guide' },
  toggleHelp: { key: 'H', description: 'Toggle keyboard help' },
  panMap: { key: '↑ ↓ ← →', description: 'Pan map' },
  zoomMap: { key: 'Alt+↑ / ↓', description: 'Zoom in / out' },
  prevNextSlice: { key: 'A / D', description: 'Previous / Next slice' },
  prevNextCollection: { key: 'Shift+A / D', description: 'Previous / Next collection' },
} satisfies Record<string, Shortcut>;

export const TASK_MODE_SHORTCUTS: Shortcut[] = [
  { key: 'W / S', description: 'Previous / Next task' },
  HOTKEYS.prevNextSlice,
  HOTKEYS.prevNextCollection,
  HOTKEYS.panMap,
  HOTKEYS.zoomMap,
  { key: 'Space', description: 'Recenter maps' },
  HOTKEYS.crosshair,
  HOTKEYS.cycleView,
  HOTKEYS.viewSync,
  HOTKEYS.cycleSource,
  HOTKEYS.cycleViz,
  HOTKEYS.toggleOverlay,
  HOTKEYS.cycleOverlays,
  { key: '1-9, 0', description: 'Select label by number' },
  { key: 'Q / E', description: 'Decrease / Increase confidence' },
  { key: 'Shift+1-5', description: 'Set confidence level' },
  { key: 'Enter', description: 'Submit annotation' },
  { key: 'B', description: 'Skip annotation' },
  { key: 'F', description: 'Toggle flag for review' },
  { key: 'C', description: 'Focus comment' },
  { key: 'Escape', description: 'Unfocus input' },
  HOTKEYS.toggleGuide,
  HOTKEYS.toggleHelp,
];

export const EXPLORE_TOOL_SHORTCUTS: Shortcut[] = [
  { key: TOOL_KEYS.pan, description: 'Pan tool' },
  { key: TOOL_KEYS.annotate, description: 'Annotate tool' },
  { key: TOOL_KEYS.edit, description: 'Edit tool' },
  { key: TOOL_KEYS.labelvector, description: 'Label vector tool' },
  { key: TOOL_KEYS.timeseries, description: 'Timeseries probe' },
  { key: '1-9', description: 'Select label & annotate' },
  { key: 'F', description: 'Flag selected (edit tool)' },
  { key: 'Space', description: 'Fit view to annotations' },
];

export const EXPLORE_NAVIGATION_SHORTCUTS: Shortcut[] = [
  HOTKEYS.prevNextSlice,
  HOTKEYS.prevNextCollection,
];

export const EXPLORE_MAP_SHORTCUTS: Shortcut[] = [
  HOTKEYS.panMap,
  HOTKEYS.zoomMap,
  HOTKEYS.crosshair,
  HOTKEYS.toggleDrawn,
  HOTKEYS.viewSync,
  HOTKEYS.cycleSource,
  HOTKEYS.cycleViz,
  HOTKEYS.toggleOverlay,
  HOTKEYS.cycleOverlays,
  HOTKEYS.toggleVectorLayer,
  HOTKEYS.cycleVectorLayers,
  HOTKEYS.cycleView,
  HOTKEYS.toggleGuide,
  HOTKEYS.toggleHelp,
];

// Mouse gestures of the explore edit tool, shown in the side-panel legend.
const EXPLORE_EDIT_GESTURES: Shortcut[] = [
  { key: 'Click', description: 'Select / edit (edit tool)' },
  { key: 'Click edge', description: 'Insert vertex' },
  { key: 'Alt+drag', description: 'Move feature' },
  { key: 'Shift+drag', description: 'Multi-select' },
  { key: 'Del', description: 'Delete selection' },
  { key: 'Esc', description: 'Cancel edit' },
];

/** Non-tool rows of the explore side-panel legend, in display order. */
export const EXPLORE_PANEL_SHORTCUTS: Shortcut[] = [
  { key: '1-9', description: 'Select label' },
  HOTKEYS.crosshair,
  HOTKEYS.toggleDrawn,
  ...EXPLORE_EDIT_GESTURES,
  HOTKEYS.viewSync,
  HOTKEYS.cycleSource,
  HOTKEYS.cycleViz,
  HOTKEYS.toggleOverlay,
  HOTKEYS.cycleOverlays,
  HOTKEYS.toggleVectorLayer,
  HOTKEYS.cycleVectorLayers,
  { key: 'F', description: 'Flag selected (edit tool)' },
];
