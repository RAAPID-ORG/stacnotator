import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ImageryCollectionOut } from '~/api/client';
import { extendedLabels } from '~/features/annotation/core/annotation';
import {
  restoreSnapshot,
  type Catalog,
  type SliceAddress,
} from '~/features/annotation/core/catalog';
import { useImageryStore, usePrefsStore, type ImageryState } from '~/features/annotation/stores';
import { useAnnotationVersion } from '~/features/annotation/panels/shared/annotationVersion';
import { cameraFor, mainCamera, releaseCamera } from '~/features/annotation/panels/shared/cameras';
import { useMapFocus } from '~/features/annotation/panels/shared/mapFocus';
import {
  composeLayers,
  emptySliceFrom,
  type AnnotationTileState,
  type ComposeState,
} from '~/features/annotation/panels/shared/composeLayers';
import { MapView, type LayerId, type TileStats } from '~/features/annotation/engine/map';
import type { ComposeCtx } from '../registry';
import { healingEnabled, shouldHeal, useEmptyHealing } from './useEmptyHealing';

// Per-window slice memory: survives remounts so a window keeps the slice the
// user picked for it while panels are shuffled around the canvas.

const windowSliceOverrides = new Map<number, number>();
/** The subset of the above the user chose by hand, rather than healing having
 *  landed on it. Empty-healing must leave these alone (see `healingEnabled`). */
const userPickedSlices = new Map<number, number>();
const sliceListeners = new Set<() => void>();

function notifySliceListeners(): void {
  for (const listener of sliceListeners) listener();
}

export function getWindowSlice(collectionId: number): number | undefined {
  return windowSliceOverrides.get(collectionId);
}

export function getUserPickedSlice(collectionId: number): number | undefined {
  return userPickedSlices.get(collectionId);
}

function setWindowSlice(collectionId: number, sliceIndex: number, byUser = false): void {
  windowSliceOverrides.set(collectionId, sliceIndex);
  if (byUser) userPickedSlices.set(collectionId, sliceIndex);
  notifySliceListeners();
}

/** Test/teardown seam. These remember one campaign's collection ids; a new
 *  campaign's collection could reuse an id and inherit a slice pick made
 *  against a completely different time series. */
export function resetWindowSlices(): void {
  windowSliceOverrides.clear();
  userPickedSlices.clear();
  notifySliceListeners();
}

export function useWindowSlice(collectionId: number): number | undefined {
  return useSyncExternalStore(
    (onChange) => {
      sliceListeners.add(onChange);
      return () => sliceListeners.delete(onChange);
    },
    () => getWindowSlice(collectionId)
  );
}

// ---------------------------------------------------------------------------
// Address resolution + activation, shared by the header and body.
// ---------------------------------------------------------------------------

/** The address this window shows: the shared one when it is the active
 *  collection, else its own remembered slice (falling back to the
 *  collection's cover) over the collection's default source/visualization. */
export function windowAddress(
  catalog: Catalog,
  imagery: Pick<ImageryState, 'address'>,
  collectionId: number
): SliceAddress | null {
  if (imagery.address?.collectionId === collectionId) return imagery.address;
  const base = restoreSnapshot(catalog, undefined, collectionId).address;
  if (!base) return null;
  const remembered = getWindowSlice(collectionId);
  return remembered != null ? { ...base, sliceIndex: remembered } : base;
}

/** Header/body click (or a healed/picked slice): makes this window the
 *  active collection at its own current address, preserving whatever slice
 *  it was remembered to be on rather than resetting to the cover. */
export function activateWindow(
  catalog: Catalog,
  imagery: Pick<ImageryState, 'address' | 'setAddress' | 'setShowBasemap'>,
  collectionId: number
): void {
  const address = windowAddress(catalog, imagery, collectionId);
  if (!address) return;
  imagery.setAddress(address);
  imagery.setShowBasemap(false);
}

/** Remember the pick, then activate. An already-active window changes only
 *  its slice, keeping
 *  its current source/visualization - windowAddress's active-collection
 *  short-circuit means routing this through activateWindow alone would
 *  return the *old*, pre-pick address unchanged. */
export function selectWindowSlice(
  catalog: Catalog,
  imagery: Pick<ImageryState, 'address' | 'setAddress' | 'setShowBasemap'>,
  collectionId: number,
  sliceIndex: number
): void {
  setWindowSlice(collectionId, sliceIndex, true);
  if (imagery.address?.collectionId === collectionId) {
    imagery.setAddress({ ...imagery.address, sliceIndex });
    imagery.setShowBasemap(false);
    return;
  }
  activateWindow(catalog, imagery, collectionId);
}

function commitHealedSlice(
  catalog: Catalog,
  imagery: ImageryState,
  collectionId: number,
  sliceIndex: number
): void {
  setWindowSlice(collectionId, sliceIndex);
  if (imagery.address?.collectionId === collectionId) {
    imagery.setAddress({ ...imagery.address, sliceIndex });
  }
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

export interface WindowProps {
  ctx: ComposeCtx;
  collection: ImageryCollectionOut;
}

const MODIFIER_HINT_MS = 1200;

function NoImageryOverlay() {
  return (
    <div
      className="absolute inset-0 flex select-none items-center justify-center overflow-hidden bg-neutral-50"
      style={{
        backgroundImage:
          'repeating-linear-gradient(45deg, #d4d4d4 0, #d4d4d4 1px, transparent 1px, transparent 12px)',
      }}
    >
      <span className="rounded bg-neutral-50/80 px-2 py-0.5 text-[10px] font-medium text-neutral-400">
        No imagery
      </span>
    </div>
  );
}

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute bottom-1.5 left-1/2 z-[1000] -translate-x-1/2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
      {children}
    </div>
  );
}

export function WindowBody({ ctx, collection }: WindowProps) {
  const { catalog } = ctx;
  const imagery = useImageryStore();
  const legendOverrides = usePrefsStore((s) => s.legendOverrides);
  const camera = cameraFor(collection.id);
  // Re-render on this window's own remembered-slice changes even while it
  // is not the active collection (otherwise a healed/picked slice would not
  // repaint until something else happened to re-render this component).
  useWindowSlice(collection.id);

  const focus = useMapFocus();

  const isActive = imagery.address?.collectionId === collection.id;
  // Same predicate empty-healing gates on below: "is this window actually
  // tracking the main camera" - a window that fails it neither follows nor
  // is a trustworthy place to probe.
  const isTracking = shouldHeal(imagery.viewSync, isActive);
  useEffect(() => {
    if (!isTracking) return;
    return camera.follow(mainCamera);
  }, [camera, isTracking]);

  useEffect(
    () => () => {
      releaseCamera(collection.id);
    },
    [collection.id]
  );

  const address = windowAddress(catalog, imagery, collection.id);

  // Windows draw the same annotation tiles as the main map, so they bust the
  // same cache on every write the user makes after load.
  const writes = useAnnotationVersion();
  const annotations = useMemo<AnnotationTileState>(
    () => ({
      version: (ctx.campaign.annotations_version ?? 0) + writes,
      labels: extendedLabels(ctx.campaign),
    }),
    [ctx.campaign, writes]
  );

  const layers = useMemo(() => {
    if (!address) return [];
    const state: ComposeState = {
      ...imagery,
      target: 'window',
      address,
      annotations,
      legendOverrides,
      // The task footprint and the crosshair belong to what the page is
      // pointed at, not to one map: a window showing another date of the same
      // place must show the same task outline and the same X-toggled crosshair
      // the main map does - one composition, narrowed, not forked.
      focusExtent: focus?.extent ?? null,
      crosshairPoint: focus?.center ?? null,
      crosshairColor: focus?.crosshairColor ?? null,
    };
    return composeLayers(ctx, state);
  }, [ctx, imagery, address, annotations, legendOverrides, focus]);

  const trackedRasterId = layers.find((l) => l.kind === 'raster' && l.trackStats)?.id;
  const handleTileStats = (layerId: LayerId, stats: TileStats) => {
    const empty = emptySliceFrom(layerId, trackedRasterId, stats, address);
    if (empty) imagery.markEmpty(empty);
  };

  const source = address ? catalog.sources.get(address.sourceId) : undefined;
  const healing = useEmptyHealing({
    catalog,
    collection,
    address,
    enabled: healingEnabled({
      viewSync: imagery.viewSync,
      isActive,
      sliceIndex: address?.sliceIndex ?? null,
      userPickedIndex: getUserPickedSlice(collection.id) ?? null,
    }),
    getPoint: () => camera.getState().center,
    zoom: source?.default_zoom ?? 10,
    empties: imagery.empties,
    markEmpty: imagery.markEmpty,
    onResolved: (sliceIndex) => commitHealedSlice(catalog, imagery, collection.id, sliceIndex),
  });

  const [showHint, setShowHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    []
  );
  const onModifierHint = () => {
    setShowHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setShowHint(false), MODIFIER_HINT_MS);
  };

  return (
    <div className="relative h-full w-full overflow-hidden select-none bg-neutral-200">
      {address && (
        <MapView
          camera={camera}
          layers={layers}
          wheelZoom="modifier"
          onModifierHint={onModifierHint}
          onTileStats={handleTileStats}
        />
      )}
      {showHint && <StatusPill>Hold Ctrl/Cmd to zoom</StatusPill>}
      {healing.searchingLabel && (
        <StatusPill>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 animate-spin rounded-full border border-white/40 border-t-white align-middle" />
          Searching imagery... {healing.searchingLabel}
        </StatusPill>
      )}
      {(!address || healing.noImagery) && <NoImageryOverlay />}
    </div>
  );
}
