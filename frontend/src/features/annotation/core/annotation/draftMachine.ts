import type { FormField } from '~/features/annotation/core/apiTypes';
import { validateForm } from './validate';

export type DraftState =
  | { phase: 'idle' }
  | { phase: 'sketching'; labelId: number }
  | { phase: 'draft'; labelId: number; geometry: GeoJSON.Geometry }
  | { phase: 'committing'; labelId: number; geometry: GeoJSON.Geometry };

export const idleDraft: DraftState = { phase: 'idle' };

/** Start drawing for a label. Always lands in `sketching` regardless of the
 *  prior phase - resolve any open draft first via `close` if one exists. */
export function beginSketch(labelId: number): DraftState {
  return { phase: 'sketching', labelId };
}

/**
 * A shape finished drawing. With no custom fields there is nothing to ask,
 * so the caller is told to save immediately rather than open a draft; the
 * machine returns straight to idle since
 * nothing is left to track. With fields, the geometry becomes a draft
 * awaiting answers. No-op (state unchanged) unless called from `sketching`.
 */
export function drawEnd(
  state: DraftState,
  geometry: GeoJSON.Geometry,
  fields: FormField[]
): { next: DraftState; action: 'draft' | 'save' } {
  if (state.phase !== 'sketching') return { next: state, action: 'draft' };
  if (fields.length === 0) return { next: { phase: 'idle' }, action: 'save' };
  return { next: { phase: 'draft', labelId: state.labelId, geometry }, action: 'draft' };
}

/** Update the geometry of an open draft (e.g. a vertex drag before saving).
 *  No-op outside `draft`. */
export function edit(state: DraftState, geometry: GeoJSON.Geometry): DraftState {
  if (state.phase !== 'draft') return state;
  return { phase: 'draft', labelId: state.labelId, geometry };
}

/** Move to `committing`. No-op unless a draft is open, which is what makes
 *  a second, concurrent commit request harmless. */
export function commitRequested(state: DraftState): DraftState {
  if (state.phase !== 'draft') return state;
  return { phase: 'committing', labelId: state.labelId, geometry: state.geometry };
}

/** The in-flight commit finished. Success clears the draft; failure returns
 *  to `draft` with the same geometry so the same answers can be retried.
 *  No-op outside `committing`. */
export function commitResolved(state: DraftState, outcome: 'success' | 'failure'): DraftState {
  if (state.phase !== 'committing') return state;
  if (outcome === 'success') return { phase: 'idle' };
  return { phase: 'draft', labelId: state.labelId, geometry: state.geometry };
}

/**
 * Resolve an open draft the way leaving the annotate tool or hitting Escape
 * does: a draft with every required
 * field answered saves, an incomplete one is thrown away rather than left
 * half-filled - an open-mode annotation can't be saved incomplete. No-op
 * (nothing to save) outside `draft`.
 */
export function close(
  state: DraftState,
  fields: FormField[],
  values: Record<string, unknown>
): { next: DraftState; action: 'save' | 'discard' } {
  if (state.phase !== 'draft') return { next: state, action: 'discard' };
  const { ok } = validateForm(fields, values);
  return { next: { phase: 'idle' }, action: ok ? 'save' : 'discard' };
}
