import type { ImageryViewOut } from '~/api/client';
import type { Catalog } from './catalog';
import type { SliceAddress } from './types';

/**
 * Source cycling (I), visualization cycling (Shift+I), built around
 * SliceAddress: an address already names its source, collection, and
 * visualization directly, so the cycling ring is simply "one entry per view
 * source, plus one per basemap". Per-source last visited address is the
 * caller-owned `lastBySource` parameter; cycleSource
 * itself is pure and does not record anything (the caller already holds the
 * outgoing `addr` and can save it before switching).
 */

export interface CycleBasemapState {
  showBasemap: boolean;
  selectedBasemapId: string | null;
}

export type CycleSourceResult =
  | { kind: 'basemap'; basemapId: string }
  | { kind: 'source'; address: SliceAddress };

export function cycleSource(
  cat: Catalog,
  view: Pick<ImageryViewOut, 'source_ids'>,
  addr: SliceAddress | null,
  basemap: CycleBasemapState,
  dir: 1 | -1,
  lastBySource: Record<number, SliceAddress>
): CycleSourceResult | null {
  const sourceIds = view.source_ids.filter((id) => cat.sources.has(id));
  const basemapIds = [...cat.basemaps.keys()].map((id) => `basemap-${id}`);
  const ringLength = sourceIds.length + basemapIds.length;
  if (ringLength <= 1) return null;

  let currentIdx: number;
  if (basemap.showBasemap) {
    const bmIdx = basemapIds.indexOf(basemap.selectedBasemapId ?? '');
    currentIdx = sourceIds.length + Math.max(0, bmIdx);
  } else if (addr) {
    const idx = sourceIds.indexOf(addr.sourceId);
    currentIdx = idx === -1 ? 0 : idx;
  } else {
    currentIdx = 0;
  }

  const nextIdx = (currentIdx + dir + ringLength) % ringLength;

  if (nextIdx >= sourceIds.length) {
    return { kind: 'basemap', basemapId: basemapIds[nextIdx - sourceIds.length] };
  }

  const targetSource = cat.sources.get(sourceIds[nextIdx]);
  if (!targetSource) return null;

  const remembered = lastBySource[targetSource.id];
  const rememberedValid =
    !!remembered && targetSource.collections.some((c) => c.id === remembered.collectionId);
  if (rememberedValid) return { kind: 'source', address: remembered };

  const firstCollection = targetSource.collections[0];
  if (!firstCollection) return null;

  return {
    kind: 'source',
    address: {
      sourceId: targetSource.id,
      collectionId: firstCollection.id,
      sliceIndex: firstCollection.cover_slice_index ?? 0,
      vizId: String(targetSource.visualizations[0]?.id ?? ''),
    },
  };
}

/** Advances the visualization within the current source, wrapping around.
 *  Null when there's no current address (basemap active) or the source has
 *  at most one visualization to cycle through. */
export function cycleViz(
  cat: Catalog,
  addr: SliceAddress | null,
  dir: 1 | -1
): SliceAddress | null {
  if (!addr) return null;
  const source = cat.sources.get(addr.sourceId);
  if (!source || source.visualizations.length <= 1) return null;

  const idx = source.visualizations.findIndex((v) => String(v.id) === addr.vizId);
  const pos = idx === -1 ? 0 : idx;
  const nextPos = (pos + dir + source.visualizations.length) % source.visualizations.length;
  const next = source.visualizations[nextPos];
  if (String(next.id) === addr.vizId) return null;

  return { ...addr, vizId: String(next.id) };
}

// ---------------------------------------------------------------------------
// toggleCycle - one rule for overlays and vector layers alike: a single
// overlay-style selection {id, visible} toggled or advanced through a list of
// {id}-bearing items.
// ---------------------------------------------------------------------------

export interface OverlaySelection {
  id: number | null;
  visible: boolean;
}

export type OverlayAction = 'toggle' | 'cycle' | 'deselect';

export function toggleCycle<T extends { id: number }>(
  items: T[],
  sel: OverlaySelection,
  action: OverlayAction
): OverlaySelection {
  // "No overlay" is a third state, not "hidden": the toggle deliberately
  // keeps the last id so re-enabling returns to it, so clearing the pick
  // needs its own action rather than a hide. Independent of `items` - a
  // selection can be cleared even after its layer disappeared.
  if (action === 'deselect') return sel.id == null ? sel : { id: null, visible: false };

  if (items.length === 0) return sel;

  if (action === 'toggle') {
    if (sel.id != null && sel.visible) return { id: sel.id, visible: false };
    if (sel.id == null || !items.some((i) => i.id === sel.id)) {
      return { id: items[0].id, visible: true };
    }
    return { id: sel.id, visible: true };
  }

  const idx = items.findIndex((i) => i.id === sel.id);
  const next = items[(idx + 1) % items.length];
  return { id: next.id, visible: true };
}
