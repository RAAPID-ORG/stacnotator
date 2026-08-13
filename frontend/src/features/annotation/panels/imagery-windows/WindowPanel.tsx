import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ImageryCollectionOut } from '~/api/client';
import { extendedLabels } from '~/features/annotation/core/annotation';
import {
  addressAtSlice,
  restoreSnapshot,
  type Catalog,
  type SliceAddress,
} from '~/features/annotation/core/catalog';
import { useImageryStore, usePrefsStore, type ImageryState } from '~/features/annotation/stores';
import { useAnnotationVersion } from '~/features/annotation/shared/annotationVersion';
import { cameraFor, mainCamera, releaseCamera } from '~/features/annotation/shared/cameras';
import { useMapFocus } from '~/features/annotation/shared/mapFocus';
import { setForegroundMapLoading } from '~/features/annotation/shared/foregroundTileLoads';
import {
  composeLayers,
  type AnnotationTileState,
  type ComposeState,
} from '~/features/annotation/shared/composeLayers';
import { MapView } from '~/features/annotation/engine/map';
import type { ComposeCtx } from '../../composition';
import { healingEnabled, shouldHeal, useEmptyHealing } from './useEmptyHealing';

// ---------------------------------------------------------------------------
// Address resolution + activation, shared by the header and body.
// ---------------------------------------------------------------------------

/** The address this window shows: the shared one when it is the active
 *  collection, else its own remembered slice (falling back to the
 *  collection's cover) over the collection's default source/visualization. */
export function windowAddress(
  catalog: Catalog,
  imagery: Pick<ImageryState, 'address' | 'windowSlices'>,
  collectionId: number
): SliceAddress | null {
  if (imagery.address?.collectionId === collectionId) return imagery.address;
  const base = restoreSnapshot(catalog, undefined, collectionId).address;
  if (!base) return null;
  const remembered = imagery.windowSlices[collectionId]?.selected;
  return addressAtSlice(catalog, base, remembered ?? base.sliceIndex);
}

/** Header/body click (or a healed/picked slice): makes this window the
 *  active collection at its own current address, preserving whatever slice
 *  it was remembered to be on rather than resetting to the cover. */
export function activateWindow(
  catalog: Catalog,
  imagery: Pick<ImageryState, 'address' | 'windowSlices' | 'setAddress' | 'setShowBasemap'>,
  collectionId: number
): void {
  const address = windowAddress(catalog, imagery, collectionId);
  if (!address) return;
  imagery.setAddress(address);
  imagery.setShowBasemap(false);
}

/** Remember the pick and activate that exact address. The passed imagery is a
 * Zustand snapshot, so reading it again after rememberWindowSlice would still
 * see the old selection; derive the picked address before either store write. */
export function selectWindowSlice(
  catalog: Catalog,
  imagery: Pick<
    ImageryState,
    'address' | 'windowSlices' | 'setAddress' | 'setShowBasemap' | 'rememberWindowSlice'
  >,
  collectionId: number,
  sliceIndex: number
): void {
  const current = windowAddress(catalog, imagery, collectionId);
  if (!current) return;
  const selected = addressAtSlice(catalog, current, sliceIndex);
  imagery.rememberWindowSlice(collectionId, sliceIndex, true);
  imagery.setAddress(selected);
  imagery.setShowBasemap(false);
}

function commitHealedSlice(
  catalog: Catalog,
  imagery: ImageryState,
  collectionId: number,
  sliceIndex: number
): void {
  imagery.rememberWindowSlice(collectionId, sliceIndex);
  if (imagery.address?.collectionId === collectionId) {
    imagery.setAddress(addressAtSlice(catalog, imagery.address, sliceIndex));
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
  const windowSlice = imagery.windowSlices[collection.id];

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
      setForegroundMapLoading(`window:${collection.id}`, false);
      releaseCamera(collection.id);
    },
    [collection.id]
  );

  const address = windowAddress(catalog, imagery, collection.id);
  // Coverage probing must not become a fifth foreground request alongside
  // this small map's four-slot OL queue. Key the last completed paint to both
  // location and imagery: a task/date change disables healing until that exact
  // panel load ends, at which point its probe normally reuses the warm tile.
  const coverageKey =
    address && focus
      ? `${focus.center[0]}:${focus.center[1]}:${address.sourceId}:${address.collectionId}:${address.sliceIndex}:${address.vizId}`
      : null;
  const [loadedCoverageKey, setLoadedCoverageKey] = useState<string | null>(null);

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

  const source = address ? catalog.sources.get(address.sourceId) : undefined;
  const healing = useEmptyHealing({
    catalog,
    collection,
    address,
    enabled:
      ctx.mode === 'tasks' &&
      coverageKey !== null &&
      loadedCoverageKey === coverageKey &&
      healingEnabled({
        viewSync: imagery.viewSync,
        isActive,
        sliceIndex: address?.sliceIndex ?? null,
        userPickedIndex: windowSlice?.userPicked ?? null,
      }),
    // Empty coverage is about the task point, not wherever an unlinked window
    // happened to be panned. Explore has no task point and is gated off above.
    getPoint: () => focus?.center ?? camera.getState().center,
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
          maxTilesLoading={4}
          onModifierHint={onModifierHint}
          onLoadStateChange={(loading) => {
            setForegroundMapLoading(`window:${collection.id}`, loading);
            if (!loading) setLoadedCoverageKey(coverageKey);
          }}
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
