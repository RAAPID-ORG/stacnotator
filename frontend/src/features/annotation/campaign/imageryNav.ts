import type { ImageryCollectionOut, ImageryViewOut } from '~/api/client';
import { collectionStartDate, type ImageryCatalog } from './imagery';

/** Where the maps are pointed: a slice of one collection of one source, drawn
 *  with one of that source's visualizations. */
export interface SliceAddress {
  sourceId: number;
  collectionId: number;
  sliceIndex: number;
  vizId: string;
}

/** Slices known to render nothing at the current location, keyed `<collection>:<slice>`. */
export type Empties = Record<string, true>;

export const emptyKey = (collectionId: number, sliceIndex: number): string =>
  `${collectionId}:${sliceIndex}`;

export interface OverlaySelection {
  id: number | null;
  visible: boolean;
}

/** What the maps draw, beyond the imagery itself. */
export interface ImageryNavState {
  address: SliceAddress | null;
  showBasemap: boolean;
  selectedBasemapId: string | null;
  overlay: OverlaySelection;
  overlayOpacity: number;
  vector: OverlaySelection;
  empties: Empties;
  crosshair: boolean;
  showAnnotations: boolean;
  /** Explore only: whether annotations made from a task join the ones drawn
   *  free-hand. Off by default - task work is reviewed in Task mode. */
  showTaskAnnotations: boolean;
  viewSync: boolean;
}

/** The slice of nav state that is remembered per imagery view. The toggles are
 *  left out on purpose: they are app-wide, not per-view. */
export type ViewSnapshot = Pick<
  ImageryNavState,
  'address' | 'showBasemap' | 'selectedBasemapId' | 'overlay' | 'overlayOpacity' | 'vector'
>;

export function snapshotForView(state: ImageryNavState): ViewSnapshot {
  const { address, showBasemap, selectedBasemapId, overlay, overlayOpacity, vector } = state;
  return { address, showBasemap, selectedBasemapId, overlay, overlayOpacity, vector };
}

/**
 * Slice/collection stepping (A/D, Shift+A/D) and source/visualization cycling
 * (I, Shift+I). Two related collection fields drive the cover rules:
 * `cover_slice_index` is shown first, and `has_dedicated_cover` marks it an
 * out-of-band composite that regular navigation skips.
 */

const coverIndex = (collection: Pick<ImageryCollectionOut, 'cover_slice_index'>): number =>
  collection.cover_slice_index ?? 0;

/** Keep the preferred visualization when the target slice publishes it,
 *  otherwise fall back to the first one it does. */
function compatibleVizId(
  source: { visualizations: { id: number; name: string }[] },
  slice: { tile_urls: { visualization_name: string }[] } | undefined,
  preferredVizId: string
): string {
  const publishes = (name: string) =>
    slice?.tile_urls.some((tile) => tile.visualization_name === name) ?? false;
  const preferred = source.visualizations.find((viz) => String(viz.id) === preferredVizId);
  if (preferred && publishes(preferred.name)) return preferredVizId;
  const fallback = source.visualizations.find((viz) => publishes(viz.name));
  return String(fallback?.id ?? source.visualizations[0]?.id ?? '');
}

function landOn(
  cat: ImageryCatalog,
  sourceId: number,
  collectionId: number,
  sliceIndex: number,
  preferredVizId: string
): SliceAddress {
  const source = cat.sources.get(sourceId);
  const slice = cat.collections.get(collectionId)?.slices[sliceIndex];
  return {
    sourceId,
    collectionId,
    sliceIndex,
    vizId: source ? compatibleVizId(source, slice, preferredVizId) : preferredVizId,
  };
}

/** A date-picker selection. Uses the same compatible-visualization rule as
 *  keyboard navigation rather than moving the slice out from under a
 *  visualization the target date does not publish. */
export function addressAtSlice(cat: ImageryCatalog, current: SliceAddress, sliceIndex: number) {
  return landOn(cat, current.sourceId, current.collectionId, sliceIndex, current.vizId);
}

/** The caller's visualization as this source spells it: the same id within one
 *  source, and across sources the one publishing the same name - "False Color"
 *  is a way of looking rather than a property of one sensor, so choosing it
 *  once holds everywhere it exists. Empty when the target has no such name. */
function carriedVizId(cat: ImageryCatalog, sourceId: number, current: SliceAddress | null): string {
  if (!current) return '';
  if (current.sourceId === sourceId) return current.vizId;
  const name = cat.sources
    .get(current.sourceId)
    ?.visualizations.find((viz) => String(viz.id) === current.vizId)?.name;
  const match = cat.sources.get(sourceId)?.visualizations.find((viz) => viz.name === name);
  return match ? String(match.id) : '';
}

/** Resolve an address in another collection. The caller owns the landing
 *  policy: a remembered slice resumes that collection's window, omitting it
 *  selects the cover. */
export function collectionAddress(
  cat: ImageryCatalog,
  collectionId: number,
  current: SliceAddress | null,
  rememberedSliceIndex?: number
): SliceAddress | null {
  const collection = cat.collections.get(collectionId);
  const sourceId = cat.sourceOf.get(collectionId);
  if (!collection || sourceId === undefined) return null;
  return landOn(
    cat,
    sourceId,
    collectionId,
    rememberedSliceIndex ?? coverIndex(collection),
    carriedVizId(cat, sourceId, current)
  );
}

/** Every index, for the date dropdown - the dedicated cover included. */
export function slicePickerIndices(collection: Pick<ImageryCollectionOut, 'slices'>): number[] {
  return collection.slices.map((_, i) => i);
}

/** Indices a/d steps through: regular slices that are neither a dedicated
 *  cover nor known to be empty here. */
export function sliceNavIndices(collection: ImageryCollectionOut, empties: Empties): number[] {
  const cover = coverIndex(collection);
  const out: number[] = [];
  for (let i = 0; i < collection.slices.length; i++) {
    if (collection.has_dedicated_cover && i === cover) continue;
    if (empties[emptyKey(collection.id, i)]) continue;
    out.push(i);
  }
  return out;
}

function chronological(cat: ImageryCatalog, sourceId: number): ImageryCollectionOut[] {
  const source = cat.sources.get(sourceId);
  if (!source) return [];
  return [...source.collections].sort((a, b) =>
    collectionStartDate(a).localeCompare(collectionStartDate(b))
  );
}

function neighbor(
  cat: ImageryCatalog,
  addr: SliceAddress,
  dir: 1 | -1
): ImageryCollectionOut | null {
  const ordered = chronological(cat, addr.sourceId);
  const idx = ordered.findIndex((c) => c.id === addr.collectionId);
  return idx === -1 ? null : (ordered[idx + dir] ?? null);
}

/** The neighbouring collection id, chronologically. Deliberately does not pick
 *  a slice: the store knows whether this is within-task navigation (resume the
 *  window) or a new task (use the cover). */
export function stepCollectionId(
  cat: ImageryCatalog,
  addr: SliceAddress,
  dir: 1 | -1
): number | null {
  return neighbor(cat, addr, dir)?.id ?? null;
}

/** Next/prev non-empty slice, wrapping into the neighbouring collection at a
 *  boundary and landing on its first (or last) navigable slice. */
export function stepSlice(
  cat: ImageryCatalog,
  addr: SliceAddress,
  dir: 1 | -1,
  empties: Empties
): SliceAddress | null {
  const collection = cat.collections.get(addr.collectionId);
  if (!collection) return null;

  const nav = sliceNavIndices(collection, empties);
  const next =
    dir === 1
      ? nav.find((i) => i > addr.sliceIndex)
      : [...nav].reverse().find((i) => i < addr.sliceIndex);
  if (next !== undefined) return landOn(cat, addr.sourceId, addr.collectionId, next, addr.vizId);

  const target = neighbor(cat, addr, dir);
  if (!target) return null;
  const navigable = sliceNavIndices(target, empties);
  const landing =
    navigable.length === 0
      ? coverIndex(target)
      : dir === 1
        ? navigable[0]
        : navigable[navigable.length - 1];
  return landOn(cat, addr.sourceId, target.id, landing, addr.vizId);
}

// ---------------------------------------------------------------------------
// Source / visualization cycling
// ---------------------------------------------------------------------------

export type CycleSourceResult =
  | { kind: 'basemap'; basemapId: string }
  | { kind: 'source'; address: SliceAddress };

/** The cycling ring is one entry per view source plus one per basemap.
 *  `lastBySource` is the caller's memory of where each source was left. */
export function cycleSource(
  cat: ImageryCatalog,
  view: Pick<ImageryViewOut, 'source_ids'>,
  addr: SliceAddress | null,
  basemap: { showBasemap: boolean; selectedBasemapId: string | null },
  dir: 1 | -1,
  lastBySource: Record<number, SliceAddress>
): CycleSourceResult | null {
  const sourceIds = view.source_ids.filter((id) => cat.sources.has(id));
  const basemapIds = [...cat.basemaps.keys()].map((id) => `basemap-${id}`);
  const ring = sourceIds.length + basemapIds.length;
  if (ring <= 1) return null;

  let current: number;
  if (basemap.showBasemap) {
    current = sourceIds.length + Math.max(0, basemapIds.indexOf(basemap.selectedBasemapId ?? ''));
  } else {
    current = addr ? Math.max(0, sourceIds.indexOf(addr.sourceId)) : 0;
  }

  const nextIdx = (current + dir + ring) % ring;
  if (nextIdx >= sourceIds.length) {
    return { kind: 'basemap', basemapId: basemapIds[nextIdx - sourceIds.length] };
  }

  const target = cat.sources.get(sourceIds[nextIdx]);
  if (!target) return null;

  const remembered = lastBySource[target.id];
  if (remembered && target.collections.some((c) => c.id === remembered.collectionId)) {
    return { kind: 'source', address: remembered };
  }

  const first = target.collections[0];
  if (!first) return null;
  return {
    kind: 'source',
    address: {
      sourceId: target.id,
      collectionId: first.id,
      sliceIndex: first.cover_slice_index ?? 0,
      vizId: String(target.visualizations[0]?.id ?? ''),
    },
  };
}

/** Records where a source was last looked at so cycling back returns there
 *  instead of resetting to its first collection. */
export function rememberAddress(
  lastBySource: Record<number, SliceAddress>,
  addr: SliceAddress | null
): Record<number, SliceAddress> {
  return addr ? { ...lastBySource, [addr.sourceId]: addr } : lastBySource;
}

/** Next visualization within the current source, wrapping. Null when the
 *  basemap is active or the source has only one. */
export function cycleViz(cat: ImageryCatalog, addr: SliceAddress | null, dir: 1 | -1) {
  if (!addr) return null;
  const source = cat.sources.get(addr.sourceId);
  if (!source || source.visualizations.length <= 1) return null;

  const idx = Math.max(
    0,
    source.visualizations.findIndex((v) => String(v.id) === addr.vizId)
  );
  const next =
    source.visualizations[
      (idx + dir + source.visualizations.length) % source.visualizations.length
    ];
  return String(next.id) === addr.vizId ? null : { ...addr, vizId: String(next.id) };
}

// ---------------------------------------------------------------------------
// Overlay / vector layer selection - one rule for both
// ---------------------------------------------------------------------------

export type OverlayAction = 'toggle' | 'cycle' | 'deselect';

export function toggleCycle<T extends { id: number }>(
  items: T[],
  sel: OverlaySelection,
  action: OverlayAction
): OverlaySelection {
  // "No overlay" is a third state, not "hidden": toggling keeps the last id so
  // re-enabling returns to it, which is why clearing needs its own action.
  if (action === 'deselect') return sel.id == null ? sel : { id: null, visible: false };
  if (items.length === 0) return sel;

  if (action === 'toggle') {
    if (sel.id != null && sel.visible) return { id: sel.id, visible: false };
    if (sel.id == null || !items.some((i) => i.id === sel.id))
      return { id: items[0].id, visible: true };
    return { id: sel.id, visible: true };
  }

  const idx = items.findIndex((i) => i.id === sel.id);
  return { id: items[(idx + 1) % items.length].id, visible: true };
}

// ---------------------------------------------------------------------------
// Nearest slice to a clicked timeline date
// ---------------------------------------------------------------------------

interface SliceSearchSource {
  collections: {
    id: number;
    cover_slice_index?: number | null;
    has_dedicated_cover?: boolean | null;
    slices: { start_date?: string | null; end_date?: string | null }[];
  }[];
}

export function findNearestSlice(
  sources: SliceSearchSource[],
  clickedTime: number,
  activeCollectionId: number | null
): { collectionId: number; sliceIndex: number } | null {
  // Active source first, plus the strict `<` below, makes ties prefer it.
  const ordered = [...sources].sort((a, b) => {
    const rank = (s: SliceSearchSource) =>
      s.collections.some((c) => c.id === activeCollectionId) ? 0 : 1;
    return rank(a) - rank(b);
  });

  let best: { collectionId: number; sliceIndex: number; dist: number } | null = null;
  for (const source of ordered) {
    for (const col of source.collections) {
      const dedicatedCover = col.has_dedicated_cover ? (col.cover_slice_index ?? 0) : -1;
      for (let i = 0; i < col.slices.length; i++) {
        if (i === dedicatedCover) continue;
        const { start_date, end_date } = col.slices[i];
        if (!start_date || !end_date) continue;
        const mid = (new Date(start_date).getTime() + new Date(end_date).getTime()) / 2;
        const dist = Math.abs(mid - clickedTime);
        if (Number.isNaN(dist)) continue;
        if (!best || dist < best.dist) best = { collectionId: col.id, sliceIndex: i, dist };
      }
    }
  }
  return best ? { collectionId: best.collectionId, sliceIndex: best.sliceIndex } : null;
}

/** Catalog-level wrapper: resolves back to a full address, keeping the
 *  caller's visualization where the target source has it. */
export function nearestSlice(
  cat: ImageryCatalog,
  epochMs: number,
  addr: SliceAddress | null
): SliceAddress | null {
  const best = findNearestSlice([...cat.sources.values()], epochMs, addr?.collectionId ?? null);
  if (!best) return null;

  const sourceId = cat.sourceOf.get(best.collectionId);
  const source = sourceId === undefined ? undefined : cat.sources.get(sourceId);
  if (sourceId === undefined || !source) return null;

  return {
    sourceId,
    collectionId: best.collectionId,
    sliceIndex: best.sliceIndex,
    vizId: addr?.vizId ?? String(source.visualizations[0]?.id ?? ''),
  };
}

/** Saved snapshot when there is one, else a default at the fallback
 *  collection's cover. */
export function restoreSnapshot(
  cat: ImageryCatalog,
  saved: ViewSnapshot | undefined,
  fallbackCollectionId: number | null
): ViewSnapshot {
  if (saved) return saved;
  return {
    address:
      fallbackCollectionId != null ? collectionAddress(cat, fallbackCollectionId, null) : null,
    showBasemap: false,
    selectedBasemapId: null,
    overlay: { id: null, visible: true },
    overlayOpacity: 1,
    vector: { id: null, visible: true },
  };
}
