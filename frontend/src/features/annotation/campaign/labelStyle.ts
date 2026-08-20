import type { GeometryType } from './annotation';

export interface LabelStyle {
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
}

/** Paint description the map layer translates into an OpenLayers style. */
export interface StyleSpec {
  stroke?: { color: string; width: number; dash?: number[] };
  fill?: { color: string };
  circle?: { radius: number; stroke?: { color: string; width: number }; fill?: { color: string } };
  /** Two crossing lines spanning `size` pixels, centred on the point. */
  cross?: { size: number; stroke: { color: string; width: number } };
  text?: { label: string; color: string; haloColor?: string };
}

export interface Emphasis {
  selected?: boolean;
  hovered?: boolean;
}

export const DEFAULT_FILL_OPACITY = 0.2;
export const DEFAULT_STROKE_OPACITY = 1;
export const defaultStrokeWidth = (geometryType: GeometryType) => (geometryType === 'line' ? 3 : 2);

/** Layers a partial user override over the label's assigned colour; anything
 *  unset keeps the default look. */
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

/** Selected wins over hovered. */
export function emphasizedFillOpacity(base: number, { selected, hovered }: Emphasis): number {
  return Math.min(1, base + (selected ? 0.15 : hovered ? 0.05 : 0));
}

export function emphasizedStrokeWidth(base: number, { selected, hovered }: Emphasis): number {
  return base + (selected ? 1 : hovered ? 0.5 : 0);
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const byte = (i: number) => parseInt(clean.substring(i, i + 2), 16);
  return `rgba(${byte(0)},${byte(2)},${byte(4)},${alpha})`;
}

export function toStyleSpec(style: LabelStyle, emphasis: Emphasis = {}): StyleSpec {
  const fill = {
    color: hexToRgba(style.fillColor, emphasizedFillOpacity(style.fillOpacity, emphasis)),
  };
  const stroke = {
    color: hexToRgba(style.strokeColor, style.strokeOpacity),
    width: emphasizedStrokeWidth(style.strokeWidth, emphasis),
  };
  const radius = emphasis.selected ? 8 : emphasis.hovered ? 7 : 6;
  return { fill, stroke, circle: { radius, fill, stroke } };
}

/** Not-yet-saved sketch: dashed, with fill capped so the imagery under a large
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

/** Dotted, so an annotation someone else just made is legible as the label it
 *  is while still reading as new - and is not mistaken for the dashed shape
 *  being drawn. */
const REMOTE_DASH = [2, 3];

/** Another annotator's work, picked up by the poll and only in this session's
 *  overlay: it looks like this until the tiles carry it. */
export function toRemoteStyleSpec(style: LabelStyle, emphasis: Emphasis = {}): StyleSpec {
  const { fill, stroke, circle } = toStyleSpec(style, emphasis);
  return { fill, circle, stroke: stroke && { ...stroke, dash: REMOTE_DASH } };
}
