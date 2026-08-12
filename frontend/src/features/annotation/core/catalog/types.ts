export interface SliceAddress {
  sourceId: number;
  collectionId: number;
  sliceIndex: number;
  vizId: string;
}

/** Key identifying a (collection, slice) pair known to render no imagery. */
export type EmptyKey = string;

export function emptyKey(collectionId: number, sliceIndex: number): EmptyKey {
  return `${collectionId}:${sliceIndex}`;
}

/** Pure updater: marks one slice empty, returning the same reference when
 *  it was already marked (so a store can skip a redundant notification). */
export function markEmpty(empties: Record<EmptyKey, true>, key: EmptyKey): Record<EmptyKey, true> {
  if (empties[key]) return empties;
  return { ...empties, [key]: true };
}

/** Structural stand-in for the imagery store's state - enough shape for
 *  `ViewSnapshot` to be derived from it via `Pick`. `crosshair`/
 *  `showAnnotations`/`viewSync` are deliberately NOT in SNAPSHOT_FIELDS
 *  below (they're app-wide toggles, not per-view state) - they exist here to
 *  make that a real exclusion rather than a vacuous one. */
export interface ImageryNavState {
  address: SliceAddress | null;
  showBasemap: boolean;
  selectedBasemapId: string | null;
  overlay: { id: number | null; visible: boolean };
  /** Overlay opacity, 0..1. Per view, like the overlay selection itself. */
  overlayOpacity: number;
  vector: { id: number | null; visible: boolean };
  empties: Record<EmptyKey, true>;
  crosshair: boolean;
  showAnnotations: boolean;
  viewSync: boolean;
}

/** Single source of truth for what a per-view snapshot carries: every field
 *  of `ImageryNavState` maps to `true` (snapshotted) or `false` (not). The
 *  `satisfies Record<keyof ImageryNavState, boolean>` below requires EVERY
 *  key of ImageryNavState to appear here - unlike a plain array of field
 *  names, an omission cannot compile silently - a field silently excluded
 *  from view snapshots would be a bug nothing catches.
 *
 *  Concretely: adding a field to ImageryNavState without adding it here
 *  fails compilation with something like:
 *    Property 'newField' is missing in type '{ address: true; ...}' but
 *    required in type 'Record<keyof ImageryNavState, boolean>'.
 *  (A plain `readonly (keyof ImageryNavState)[]` field list, which this
 *  replaces, only checks that *listed* keys are valid - it does not notice a
 *  key that was never listed.) */
const SNAPSHOT_FIELD_MAP = {
  address: true,
  showBasemap: true,
  selectedBasemapId: true,
  overlay: true,
  overlayOpacity: true,
  vector: true,
  empties: true,
  // App-wide toggles, not per-view state - explicitly excluded, not omitted.
  crosshair: false,
  showAnnotations: false,
  viewSync: false,
} satisfies Record<keyof ImageryNavState, boolean>;

type SnapshotFieldName = {
  [K in keyof typeof SNAPSHOT_FIELD_MAP]: (typeof SNAPSHOT_FIELD_MAP)[K] extends true ? K : never;
}[keyof typeof SNAPSHOT_FIELD_MAP];

export const SNAPSHOT_FIELDS = (
  Object.keys(SNAPSHOT_FIELD_MAP) as (keyof ImageryNavState)[]
).filter((field) => SNAPSHOT_FIELD_MAP[field]) as readonly SnapshotFieldName[];

export type ViewSnapshot = Pick<ImageryNavState, SnapshotFieldName>;
