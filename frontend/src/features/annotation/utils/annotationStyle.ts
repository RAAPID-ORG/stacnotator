import type { GeometryType } from './labelMetadata';

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
