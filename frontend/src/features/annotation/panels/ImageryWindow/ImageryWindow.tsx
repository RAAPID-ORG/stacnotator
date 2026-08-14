import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImageryCollectionOut } from '~/api/client';
import { extendedLabels } from '../../campaign/annotation';
import { type ImageryCatalog } from '../../campaign/imagery';
import { type SliceAddress } from '../../campaign/imageryNav';
import { addressAtSlice, collectionAddress } from '../../campaign/imageryNav';
import { useCampaign, useCampaignStore, useCatalog } from '../../stores/campaign';
import { useImageryStore, type ImageryState } from '../../stores/imagery';
import { usePrefsStore } from '../../stores/prefs';
import { useTileVersion } from '../../stores/work';
import { cameraFor, mainCamera, releaseCamera } from '../../map/camera';
import { useMapFocus } from '../../stores/tasks';
import { setForegroundMapLoading } from '../../map/tileLoading';
import { composeLayers, type AnnotationTiles, type ComposeState } from '../../map/compose';
import { MapView } from '../../map/MapView';
import { PillSpinner, StatusPill } from '../../components/StatusPill';
import { healingEnabled, shouldHeal, useEmptyHealing } from './useEmptyHealing';

// ---------------------------------------------------------------------------
// Address resolution + slice selection, shared by the header and body.
// ---------------------------------------------------------------------------

/** The address this window shows: the shared one when it is the active
 *  collection, else its own remembered slice (falling back to the
 *  collection's cover) over the collection's default source/visualization. */
export function windowAddress(
  catalog: ImageryCatalog,
  imagery: Pick<ImageryState, 'address' | 'windowSlices'>,
  collectionId: number
): SliceAddress | null {
  if (imagery.address?.collectionId === collectionId) return imagery.address;
  const remembered = imagery.windowSlices[collectionId]?.selected;
  return collectionAddress(catalog, collectionId, null, remembered);
}

/** Remember the pick and activate that exact address. The passed imagery is a
 * Zustand snapshot, so reading it again after rememberWindowSlice would still
 * see the old selection; derive the picked address before either store write. */
export function selectWindowSlice(
  catalog: ImageryCatalog,
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
  catalog: ImageryCatalog,
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

export interface ImageryWindowProps {
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

export function ImageryWindowBody({ collection }: ImageryWindowProps) {
  const campaign = useCampaign();
  const catalog = useCatalog();
  const mode = useCampaignStore((s) => s.workMode);
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
  const writes = useTileVersion();
  const annotations = useMemo<AnnotationTiles>(
    () => ({
      version: (campaign.annotations_version ?? 0) + writes,
      labels: extendedLabels(campaign),
    }),
    [campaign, writes]
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
    return composeLayers({ catalog, mode }, state);
  }, [catalog, mode, imagery, address, annotations, legendOverrides, focus]);

  const source = address ? catalog.sources.get(address.sourceId) : undefined;
  const healing = useEmptyHealing({
    catalog,
    collection,
    address,
    enabled:
      mode === 'tasks' &&
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
          <PillSpinner />
          Searching imagery... {healing.searchingLabel}
        </StatusPill>
      )}
      {(!address || healing.noImagery) && <NoImageryOverlay />}
    </div>
  );
}
