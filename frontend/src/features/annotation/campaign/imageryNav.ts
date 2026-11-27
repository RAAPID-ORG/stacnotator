import type { ImageryCollectionOut, ImageryViewOut } from '~/api/client';
import { collectionStartDate, sliceHasImagery, type ImageryCatalog } from './imagery';

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
  source: { visualizations: { id: number }[] },
  slice: { tiles: { visualization_id: number }[] } | undefined,
  preferredVizId: string
): string {
  const publishes = (id: number) => slice?.tiles.some((tile) => tile.visualization_id === id);
  if (publishes(Number(preferredVizId))) return preferredVizId;
  const fallback = source.visualizations.find((viz) => publishes(viz.id));
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

/**
 * A source's starting collection: its starred one while that is still among
 * the collections it shows, otherwise its earliest shown collection. When the
 * layout hides all of them, they all count as shown.
 */
export function sourceStartCollectionId(
  cat: ImageryCatalog,
  sourceId: number,
  pinnedStart: Record<number, number>,
  hidden: readonly number[]
): number | null {
  const collections = cat.sources.get(sourceId)?.collections ?? [];
  const shown = collections.filter((c) => !hidden.includes(c.id));
  const pool = shown.length > 0 ? shown : collections;
  const pinned = pinnedStart[sourceId];
  if (pinned != null && pool.some((c) => c.id === pinned)) return pinned;
  return (
    [...pool].sort((a, b) => collectionStartDate(a).localeCompare(collectionStartDate(b)))[0]?.id ??
    null
  );
}

/**
 * The collection a task transition lands on: the view's start (its first
 * source, at that source's starred collection), and only without one does the
 * task inherit wherever the user happens to be. Shared so what preloading
 * warms is what the next task will actually show - the two drifting apart is
 * what made the preload bar move when the user merely changed date.
 */
export function taskLandingCollectionId(
  configuredStart: number | null,
  currentCollectionId: number | null
): number | null {
  return configuredStart ?? currentCollectionId ?? null;
}

/** Every index, for the date dropdown - the dedicated cover included. */
export function slicePickerIndices(
  cat: ImageryCatalog,
  collection: Pick<ImageryCollectionOut, 'slices'>
): number[] {
  return collection.slices.flatMap((slice, i) => (sliceHasImagery(cat, slice) ? [i] : []));
}

/** Indices a/d steps through: regular slices that are neither a dedicated
 *  cover nor known to be empty here. */
export function sliceNavIndices(
  cat: ImageryCatalog,
  collection: ImageryCollectionOut,
  empties: Empties
): number[] {
  const cover = coverIndex(collection);
  const out: number[] = [];
  for (let i = 0; i < collection.slices.length; i++) {
    if (collection.has_dedicated_cover && i === cover) continue;
    if (empties[emptyKey(collection.id, i)]) continue;
    if (!sliceHasImagery(cat, collection.slices[i])) continue;
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

  const nav = sliceNavIndices(cat, collection, empties);
  const next =
    dir === 1
      ? nav.find((i) => i > addr.sliceIndex)
      : [...nav].reverse().find((i) => i < addr.sliceIndex);
  if (next !== undefined) return landOn(cat, addr.sourceId, addr.collectionId, next, addr.vizId);

  const target = neighbor(cat, addr, dir);
  if (!target) return null;
  const navigable = sliceNavIndices(cat, target, empties);
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
 *  `lastBySource` is the caller's memory of where each source was left; only
 *  its visualization is reused. */
export function cycleSource(
  cat: ImageryCatalog,
  view: Pick<ImageryViewOut, 'source_ids'>,
  addr: SliceAddress | null,
  basemap: { showBasemap: boolean; selectedBasemapId: string | null },
  dir: 1 | -1,
  lastBySource: Record<number, SliceAddress>,
  pinnedStart: Record<number, number> = {},
  hidden: readonly number[] = [],
  empties: Empties = {}
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

  const rememberedViz = lastBySource[target.id]?.vizId;
  const address = sourceAddress(cat, target.id, addr, undefined, pinnedStart, hidden, empties);
  if (!address) return null;
  const slice = cat.collections.get(address.collectionId)?.slices[address.sliceIndex];
  const remember =
    target.visualizations.some((v) => String(v.id) === rememberedViz) &&
    (!slice?.tiles.length || slice.tiles.some((t) => String(t.visualization_id) === rememberedViz));
  return { kind: 'source', address: remember ? { ...address, vizId: rememberedViz } : address };
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
  activeCollectionId: number | null,
  {
    eligible = () => true,
    endTime = clickedTime,
    includeCovers = false,
    preferred = new Set<number>(),
  }: {
    eligible?: (collectionId: number, index: number) => boolean;
    endTime?: number;
    includeCovers?: boolean;
    preferred?: ReadonlySet<number>;
  } = {}
): { collectionId: number; sliceIndex: number } | null {
  // Active source first, plus the strict `<` below, makes ties prefer it.
  const ordered = [...sources].sort((a, b) => {
    const rank = (s: SliceSearchSource) =>
      s.collections.some((c) => c.id === activeCollectionId) ? 0 : 1;
    return rank(a) - rank(b);
  });

  let best: { collectionId: number; sliceIndex: number; dist: number; center: number } | null =
    null;
  for (const source of ordered) {
    for (const col of source.collections) {
      const dedicatedCover = col.has_dedicated_cover ? (col.cover_slice_index ?? 0) : -1;
      for (let i = 0; i < col.slices.length; i++) {
        if ((!includeCovers && i === dedicatedCover) || !eligible(col.id, i)) continue;
        const { start_date, end_date } = col.slices[i];
        const start = Date.parse(start_date || end_date || '');
        const end = Date.parse(end_date || start_date || '');
        const dist = Math.max(0, start - endTime, clickedTime - end);
        const center = Math.abs(start + end - clickedTime - endTime);
        if (!Number.isFinite(dist)) continue;
        const preference = best
          ? Number(preferred.has(col.id)) - Number(preferred.has(best.collectionId))
          : 0;
        if (
          !best ||
          dist < best.dist ||
          (dist === best.dist && (preference > 0 || (preference === 0 && center < best.center)))
        )
          best = { collectionId: col.id, sliceIndex: i, dist, center };
      }
    }
  }
  return best ? { collectionId: best.collectionId, sliceIndex: best.sliceIndex } : null;
}

/** Catalog-level wrapper: resolves back to a full address, keeping the
 *  caller's visualization where the target source has it.
 *
 *  Scoped to the view's sources, as window composition and source cycling are.
 *  The catalog holds every source the campaign has, and landing on one the view
 *  does not show strands the address: there is no window for it, `i` cannot
 *  reach it, and a/d only walk the collections of whatever source the address
 *  names - so the keys go quiet with nothing on screen to say why. */
export function nearestSlice(
  cat: ImageryCatalog,
  epochMs: number,
  addr: SliceAddress | null,
  view: Pick<ImageryViewOut, 'source_ids'> | null,
  options: {
    hidden?: readonly number[];
    empties?: Empties;
    sensor?: string;
    endTime?: number;
    includeCovers?: boolean;
    vizId?: string;
  } = {}
): SliceAddress | null {
  const sources = view
    ? view.source_ids.flatMap((id) => {
        const source = cat.sources.get(id);
        return source ? [source] : [];
      })
    : [...cat.sources.values()];
  const hidden = sources.some((s) => s.collections.some((c) => !options.hidden?.includes(c.id)))
    ? options.hidden
    : [];
  const preferred = new Set<number>();
  const sensor = options.sensor?.toLowerCase();
  if (sensor) {
    for (const source of sources) {
      for (const col of source.collections) {
        const identity = (col.search?.stac_collection_id ?? source.name)
          .toLowerCase()
          .replace(/[-_ ]/g, '');
        if (identity.startsWith(sensor) || (sensor === 'sentinel2' && identity === 's2'))
          preferred.add(col.id);
      }
    }
  }
  const best = findNearestSlice(sources, epochMs, addr?.collectionId ?? null, {
    ...options,
    preferred,
    eligible: (id, i) => {
      const col = cat.collections.get(id)!;
      const slice = col.slices[i];
      return (
        !hidden?.includes(id) &&
        !options.empties?.[emptyKey(id, i)] &&
        sliceHasImagery(cat, slice) &&
        (!options.vizId ||
          !slice.tiles.length ||
          slice.tiles.some((t) => String(t.visualization_id) === options.vizId))
      );
    },
  });
  if (!best) return null;

  return collectionAddress(cat, best.collectionId, addr, best.sliceIndex);
}

export function sourceAddress(
  cat: ImageryCatalog,
  sourceId: number,
  current: SliceAddress | null,
  vizId: string | undefined,
  pinnedStart: Record<number, number>,
  hidden: readonly number[],
  empties: Empties
): SliceAddress | null {
  const source = cat.sources.get(sourceId);
  if (!source) return null;
  const preferred = source.visualizations.find((v) => String(v.id) === vizId);
  if (current?.sourceId === sourceId)
    return { ...current, vizId: preferred ? String(preferred.id) : current.vizId };
  const slice = current && cat.collections.get(current.collectionId)?.slices[current.sliceIndex];
  const start = Date.parse(slice?.start_date || slice?.end_date || '');
  if (Number.isFinite(start)) {
    const options = {
      hidden,
      empties,
      endTime: Date.parse(slice?.end_date || slice?.start_date || ''),
      vizId: preferred && String(preferred.id),
    };
    const view = { source_ids: [sourceId] };
    const nearest =
      nearestSlice(cat, start, current, view, options) ??
      nearestSlice(cat, start, current, view, { ...options, includeCovers: true });
    if (nearest) return { ...nearest, vizId: options.vizId ?? nearest.vizId };
  }
  const id = sourceStartCollectionId(cat, sourceId, pinnedStart, hidden);
  const fallback = id != null && collectionAddress(cat, id, current);
  return fallback
    ? { ...fallback, vizId: preferred ? String(preferred.id) : fallback.vizId }
    : null;
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
