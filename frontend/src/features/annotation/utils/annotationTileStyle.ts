/**
 * Pure builder for the WebGL flat style of the annotation vector-tile display
 * layer. Kept free of OpenLayers runtime imports so it can be unit-tested.
 *
 * The style colours each tile feature by its `labelId` and renders the single
 * feature currently being edited transparent, so the editable canvas layer owns
 * its appearance while it is open (see the hide-by-`editingId` case below).
 */
import type { FlatStyle } from 'ol/style/flat';

export interface TileLabelStyle {
  id: number;
  /** Resolved fill paint, e.g. 'rgba(255,0,0,0.2)'. */
  fillColor: string;
  /** Resolved stroke paint. */
  strokeColor: string;
  strokeWidth: number;
}

/** Style-variable name holding the annotation id currently open for editing. */
export const EDITING_ID_VAR = 'editingId';

/** Sentinel for the editing-id variable when nothing is being edited. */
export const NO_EDITING_ID = -1;

const TRANSPARENT = 'rgba(0,0,0,0)';
const DEFAULT_FILL = 'rgba(120,120,120,0.2)';
const DEFAULT_STROKE = 'rgba(120,120,120,1)';
const DEFAULT_STROKE_WIDTH = 2;

type Expr = unknown[];

/** `['match', ['get','labelId'], id, value, ..., fallback]`, or just the
 * fallback when there are no labels (OpenLayers' match needs >= 1 case). */
function matchByLabel(
  labels: TileLabelStyle[],
  value: (l: TileLabelStyle) => unknown,
  fallback: unknown
) {
  if (labels.length === 0) return fallback;
  const cases: unknown[] = [];
  for (const label of labels) {
    cases.push(label.id, value(label));
  }
  return ['match', ['get', 'labelId'], ...cases, fallback];
}

/** Render the edited feature transparent, otherwise the label-driven paint. */
function hideWhenEditing(paint: unknown): Expr {
  return ['case', ['==', ['get', 'annotationId'], ['var', EDITING_ID_VAR]], TRANSPARENT, paint];
}

export function buildAnnotationTileFlatStyle(labels: TileLabelStyle[]): FlatStyle {
  return {
    'fill-color': hideWhenEditing(matchByLabel(labels, (l) => l.fillColor, DEFAULT_FILL)),
    'stroke-color': hideWhenEditing(matchByLabel(labels, (l) => l.strokeColor, DEFAULT_STROKE)),
    'stroke-width': matchByLabel(labels, (l) => l.strokeWidth, DEFAULT_STROKE_WIDTH),
  } as FlatStyle;
}
