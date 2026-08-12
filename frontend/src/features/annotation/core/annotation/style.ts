import type { GeometryType } from './labels';

export interface LabelStyle {
  fillColor: string; // '#rrggbb'
  fillOpacity: number; // 0..1
  strokeColor: string; // '#rrggbb'
  strokeOpacity: number; // 0..1
  strokeWidth: number; // px
}

export interface Emphasis {
  selected?: boolean;
  hovered?: boolean;
}

/** localStorage key for a label's per-campaign override. */
export const styleKey = (campaignId: number, labelId: number) => `${campaignId}:${labelId}`;

/** Defaults reproduce the original hardcoded look when there is no override. */
export const DEFAULT_FILL_OPACITY = 0.2;
export const DEFAULT_STROKE_OPACITY = 1;
export const defaultStrokeWidth = (geometryType: GeometryType) => (geometryType === 'line' ? 3 : 2);

/**
 * Layer a (possibly partial) user override on top of the label's default
 * color. Any field the user has not set falls back to the original look.
 */
export function resolveLabelStyle(
  defaultColor: string,
  geometryType: GeometryType,
  override?: Partial<LabelStyle>
): LabelStyle {
  return {
    fillColor: override?.fillColor ?? defaultColor,
    fillOpacity: override?.fillOpacity ?? DEFAULT_FILL_OPACITY,
    strokeColor: override?.strokeColor ?? defaultColor,
    strokeOpacity: override?.strokeOpacity ?? DEFAULT_STROKE_OPACITY,
    strokeWidth: override?.strokeWidth ?? defaultStrokeWidth(geometryType),
  };
}

/**
 * Fill opacity bumped for selected/hovered emphasis, clamped to a valid
 * alpha. Selected wins over hovered.
 */
export function emphasizedFillOpacity(base: number, { selected, hovered }: Emphasis): number {
  return Math.min(1, base + (selected ? 0.15 : hovered ? 0.05 : 0));
}

/** Stroke width bumped for selected/hovered emphasis. Selected wins over hovered. */
export function emphasizedStrokeWidth(base: number, { selected, hovered }: Emphasis): number {
  return base + (selected ? 1 : hovered ? 0.5 : 0);
}

export type StyleOverrides = Record<string, Partial<LabelStyle>>;

/**
 * Merge a style patch into the override map without mutating the input.
 * Patches accumulate: setting `fillColor` then `strokeWidth` keeps both.
 * Overrides are isolated per `campaign:label` key.
 */
export function setStyleOverride(
  overrides: StyleOverrides,
  campaignId: number,
  labelId: number,
  patch: Partial<LabelStyle>
): StyleOverrides {
  const key = styleKey(campaignId, labelId);
  return { ...overrides, [key]: { ...overrides[key], ...patch } };
}

/** Remove a single label's override without mutating the input. */
export function clearStyleOverride(
  overrides: StyleOverrides,
  campaignId: number,
  labelId: number
): StyleOverrides {
  const key = styleKey(campaignId, labelId);
  if (!(key in overrides)) return overrides;
  const next = { ...overrides };
  delete next[key];
  return next;
}

// ---------------------------------------------------------------------------
// StyleSpec projection (platform-free; shape matches src/platform/map/types.ts)
// ---------------------------------------------------------------------------

export interface StyleSpec {
  stroke?: { color: string; width: number; dash?: number[] };
  fill?: { color: string };
  circle?: { radius: number; stroke?: { color: string; width: number }; fill?: { color: string } };
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Style for a saved/selectable annotation feature, with selected/hovered
 *  emphasis applied. */
export function toStyleSpec(style: LabelStyle, emphasis: Emphasis = {}): StyleSpec {
  const fillOpacity = emphasizedFillOpacity(style.fillOpacity, emphasis);
  const strokeWidth = emphasizedStrokeWidth(style.strokeWidth, emphasis);
  const radius = emphasis.selected ? 8 : emphasis.hovered ? 7 : 6;
  const fill = { color: hexToRgba(style.fillColor, fillOpacity) };
  const stroke = { color: hexToRgba(style.strokeColor, style.strokeOpacity), width: strokeWidth };
  return { fill, stroke, circle: { radius, fill, stroke } };
}

/** Style for a not-yet-saved sketch preview: dashed outline, a fixed small
 *  point radius, and fill opacity capped so the imagery underneath a large
 *  polygon stays legible while drawing. */
export function toDraftStyleSpec(style: LabelStyle): StyleSpec {
  const stroke = {
    color: hexToRgba(style.strokeColor, style.strokeOpacity),
    width: style.strokeWidth,
  };
  return {
    fill: { color: hexToRgba(style.fillColor, Math.min(style.fillOpacity, 0.15)) },
    stroke: { ...stroke, dash: [6, 4] },
    circle: { radius: 5, fill: { color: hexToRgba(style.fillColor, style.fillOpacity) }, stroke },
  };
}
