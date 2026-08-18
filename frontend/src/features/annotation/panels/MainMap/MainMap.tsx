import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { pageKeymap } from '../../keymap';
import { SliceCommentButton } from '../../chrome/SliceComments';
import { useContainerSize } from '../../canvas/useContainerSize';
import { hotkeyTip } from '../../hotkeys';
import { extendedLabels } from '../../campaign/annotation';
import { collectionsInView } from '../../campaign/imagery';
import { computeTaskProgress } from '../../campaign/tasks';
import { useDrawingInteractions } from '../../drawing';
import { applyCameraTarget, fitAnnotations, focusCameraTarget, mainCamera } from '../../map/camera';
import {
  composeLayers,
  PROBE_LAYER_ID,
  probeIndexOf,
  type AnnotationTiles,
  type ComposeState,
} from '../../map/compose';
import { MapView, type MapAnchor } from '../../map/MapView';
import { setForegroundMapLoading, useForegroundLoading } from '../../map/tileLoading';
import type { LonLat, MapClickEvent } from '../../map/types';
import { useCampaign, useCampaignStore, useCatalog, type WorkMode } from '../../stores/campaign';
import { useImageryStore } from '../../stores/imagery';
import { useLayoutStore } from '../../stores/layout';
import { usePrefsStore } from '../../stores/prefs';
import { useMapFocus, useTasksStore } from '../../stores/tasks';
import { useTileVersion, useWorkStore } from '../../stores/work';
import { CollectionPicker } from './controls/CollectionPicker';
import { CustomMapControls } from './controls/CustomMapControls';
import { CustomMapLegend } from './controls/CustomMapLegend';
import { LayerSelector } from './controls/LayerSelector';
import { PreloadMenu } from './controls/PreloadMenu';
import { SlicePicker } from './controls/SlicePicker';
import { VectorLayerControls } from './controls/VectorLayerControls';
import { ViewControls } from './controls/ViewControls';
import { TimelineSidebar } from './TimelineSidebar';
import { SelectionControls } from './SelectionControls';
import { usePreloading } from './usePreloading';

/** Stable empty array: a fresh [] each render would recompose the layers. */
const EMPTY_PROBES: LonLat[] = [];

/** Keeps the leader camera on the shared focus. Working zoom is read at move
 *  time so cycling imagery never yanks a camera the user just positioned. */
function useFocusCamera(mode: WorkMode, workingZoom: number | null): void {
  const focus = useMapFocus();
  const lon = focus?.center[0];
  const lat = focus?.center[1];
  const zoomRef = useRef(workingZoom);
  zoomRef.current = workingZoom;

  useEffect(() => {
    if (lon === undefined || lat === undefined) return;
    applyCameraTarget(
      focusCameraTarget({ mode, center: [lon, lat], workingZoom: zoomRef.current })
    );
  }, [mode, lon, lat]);
}

/** Both modes can drop probes - Explore arms the tool from its palette - so
 *  the way back off the map lives in the header both share. */
function ClearProbes() {
  const probeCount = useWorkStore((s) => s.probePoints.length);
  if (probeCount === 0) return null;

  return (
    <button
      type="button"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => useWorkStore.getState().clearProbePoints()}
      title={`Clear ${probeCount} probe${probeCount > 1 ? 's' : ''}`}
      aria-label="Clear probes"
      data-testid="clear-probes"
      className="flex h-5 items-center gap-0.5 rounded px-1 text-[10px] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 cursor-pointer"
    >
      <span className="tabular-nums">{probeCount}</span>
      <span aria-hidden="true">×</span>
    </button>
  );
}

function ProbeToggle({ title }: { title: string }) {
  const active = useWorkStore((s) => s.tool === 'timeseries');

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => useWorkStore.getState().toggleProbeTool()}
        aria-pressed={active}
        aria-label={title}
        title={title}
        data-testid="probe-toggle"
        className={`flex h-6 w-6 items-center justify-center rounded-md cursor-pointer ${
          active
            ? 'bg-brand-600 text-white hover:bg-brand-700'
            : 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500'
        }`}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M2 15l4-6 4 3 4-7" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="16" cy="16" r="4" />
          <path d="m19 19 3 3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** Assignment-scoped "N of M done" - the current filter's assignedTo, which
 *  defaults to the viewer, so completion follows their own share of the work
 *  rather than the whole campaign's. */
function TaskProgressCounter() {
  const { allTasks, filter } = useTasksStore(
    useShallow((state) => ({ allTasks: state.allTasks, filter: state.filter }))
  );
  const { total, completed } = computeTaskProgress(allTasks, filter.assignedTo);

  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="text-[11px] text-neutral-500">
        <span className="font-semibold text-neutral-900 tabular-nums">{completed}</span> of{' '}
        <span className="tabular-nums">{total}</span> done
      </span>
    </div>
  );
}

export function MainMapHeader() {
  const campaign = useCampaign();
  const catalog = useCatalog();
  const mode = useCampaignStore((s) => s.workMode);
  const view = useCampaignStore((s) => s.view);
  const address = useImageryStore((s) => s.address);
  const isTaskMode = mode === 'tasks';
  const sourceIds = view?.source_ids ?? [];
  const windows = useLayoutStore((s) => s.currentLayout.windows);
  // pageKeymap() reads the stores directly; these are the inputs that should
  // rebuild the table, not what the closure literally names.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bindings = useMemo(() => pageKeymap(), [campaign, catalog, mode, view]);

  // View sync only means something with more than one window to keep in step.
  const windowCount = collectionsInView(catalog, { source_ids: sourceIds }).filter(
    (c) => windows[c.id] !== undefined
  ).length;

  return (
    <div
      className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center"
      data-tour="map-controls"
    >
      <div className="col-start-2 flex min-w-0 items-center justify-center gap-1">
        <LayerSelector
          catalog={catalog}
          sourceIds={sourceIds}
          title={`Select layer - ${hotkeyTip(bindings, 'i')}, ${hotkeyTip(bindings, 'shift+i')}`}
        />
        <CollectionPicker
          catalog={catalog}
          sourceIds={sourceIds}
          isTaskMode={isTaskMode}
          title={`Select collection - ${hotkeyTip(bindings, 'shift+d', 'Next collection')}`}
        />
        <SlicePicker
          catalog={catalog}
          title={`Select time slice - ${hotkeyTip(bindings, 'd', 'Next slice')}`}
        />
        <SliceCommentButton address={address} hint={hotkeyTip(bindings, 'shift+c')} />
        <CustomMapControls catalog={catalog} toggleTitle={hotkeyTip(bindings, 'o')} />
        <VectorLayerControls catalog={catalog} toggleTitle={hotkeyTip(bindings, 'v')} />
        <ViewControls
          isTaskMode={isTaskMode}
          onFocus={() => {
            if (isTaskMode) {
              const focus = useTasksStore.getState().focus;
              if (focus) mainCamera.moveTo({ center: focus.center });
            } else
              void fitAnnotations(
                catalog.campaignId,
                useImageryStore.getState().showTaskAnnotations
              );
          }}
          focusTitle={hotkeyTip(bindings, ' ')}
          crosshairTitle={hotkeyTip(bindings, 'x')}
          showViewSync={windowCount > 1}
          viewSyncTitle={hotkeyTip(bindings, 'l')}
        />
        {isTaskMode && campaign.time_series.length > 0 && (
          <ProbeToggle title={hotkeyTip(bindings, 't')} />
        )}
        <ClearProbes />
        {isTaskMode && <PreloadMenu />}
      </div>
      {isTaskMode && (
        <div className="col-start-3 justify-self-end">
          <TaskProgressCounter />
        </div>
      )}
    </div>
  );
}

/**
 * A click on the task map, which probes that point's time series only while the
 * probe tool is armed - a bare click has to stay free to mean nothing, or every
 * attempt to look around moves the marker and refetches. The charts read the
 * point back through the shared probe point. Shift belongs to the box gestures,
 * so a click that carries it is not a click.
 */
export function taskProbeClick(event: MapClickEvent): void {
  const work = useWorkStore.getState();
  if (event.shiftKey || work.tool !== 'timeseries') return;
  const hit = event.layerId === PROBE_LAYER_ID ? probeIndexOf(event.featureId) : null;
  if (hit !== null) work.removeProbePoint(hit);
  else work.addProbePoint(event.lonLat);
  work.completeProbe();
}

export function MainMapBody() {
  const campaign = useCampaign();
  const catalog = useCatalog();
  const mode = useCampaignStore((s) => s.workMode);
  const imagery = useImageryStore();
  const legendOverrides = usePrefsStore((s) => s.legendOverrides);
  const draft = useWorkStore((s) => s.draft);
  const tool = useWorkStore((s) => s.tool);
  const selection = useWorkStore((s) => s.selection);
  const selectionAnchor = useWorkStore((s) => s.selectionAnchor);
  const editingId = useWorkStore((s) => s.edit?.annotation.id ?? null);
  // Draw/edit/box-select belong to the map they act on, so this is where the
  // drawing feature's wiring is mounted.
  const { interactions, onMapClick: drawingClick } = useDrawingInteractions();
  const onMapClick = mode === 'tasks' ? taskProbeClick : drawingClick;
  const probePoints = useWorkStore((s) => (s.probeMarkerHidden ? EMPTY_PROBES : s.probePoints));
  const writes = useTileVersion();
  const focus = useMapFocus();
  const { containerRef, width, height } = useContainerSize();
  const [mapLoading, setMapLoading] = useState(false);
  const foregroundLoading = useForegroundLoading();
  const windowLayout = useLayoutStore((s) => s.currentLayout.windows);
  const visibleCollectionIds = useMemo(() => Object.keys(windowLayout).map(Number), [windowLayout]);
  useEffect(() => () => setForegroundMapLoading('main', false), []);

  const draftOpen = draft.phase === 'draft' || draft.phase === 'committing';
  // A shape stored the moment it was drawn is still drawn by the draft layer
  // while its questions are open, so its tile copy would double it.
  const draftSavedId = draftOpen ? draft.savedId : null;

  const annotations = useMemo<AnnotationTiles>(() => {
    // The feature being edited is drawn by the edit interaction instead, so
    // the tile copy underneath it is hidden rather than doubled. Only the edit
    // tool draws one: a selection made in Pan is inspected, not redrawn, and
    // hiding its tile copy would make the annotation disappear.
    const editDrawn = tool === 'edit' ? editingId : null;
    const hidden = [editDrawn, draftSavedId].filter((id) => id != null);
    return {
      // Every write the user makes after load has to bust the tile cache too.
      version: (campaign.annotations_version ?? 0) + writes,
      labels: extendedLabels(campaign),
      hiddenIds: hidden.length > 0 ? hidden : undefined,
      highlightIds: selection.length > 0 ? selection : undefined,
    };
  }, [campaign, writes, tool, editingId, draftSavedId, selection]);

  const draftFeatures = useMemo(
    () => (draftOpen ? [{ id: 'draft', geometry: draft.geometry }] : []),
    [draftOpen, draft]
  );

  const layers = useMemo(() => {
    const state: ComposeState = {
      ...imagery,
      tileSkeleton: true,
      annotations,
      legendOverrides,
      focusExtent: focus?.extent ?? null,
      crosshairPoint: focus?.center ?? null,
      crosshairColor: focus?.crosshairColor ?? null,
      draftFeatures,
      draftLabelId: draft.phase === 'idle' ? null : draft.labelId,
      probePoints,
    };
    return composeLayers({ catalog, mode }, state);
  }, [
    catalog,
    mode,
    imagery,
    annotations,
    legendOverrides,
    focus,
    draftFeatures,
    draft,
    probePoints,
  ]);

  // A fresh tuple each render would restart preloading forever (its enqueue
  // effect keys on it), so the size crosses as the two scalars it really is.
  const viewportPx = useMemo<[number, number] | null>(
    () => (width > 0 ? [width, height] : null),
    [width, height]
  );

  const address = imagery.address;
  const workingZoom = address
    ? (catalog.sources.get(address.sourceId)?.default_zoom ?? null)
    : null;

  // Nothing else moves the leader camera off state: task navigation changes the
  // focus, and this is what turns that into a camera move.
  useFocusCamera(mode, workingZoom);

  usePreloading({
    enabled: mode === 'tasks',
    activeLoading: foregroundLoading,
    focus: focus?.center ?? null,
    // The tasks the user is about to reach, so their imagery is warm by the
    // time they get there - the whole point of the upcoming tier.
    upcoming: focus?.upcoming,
    viewportPx,
    visibleCollectionIds,
  });

  // Confirm/delete ride on the geometry they act on rather than in a corner of
  // the page, which is what makes them findable on a big map.
  const anchor: MapAnchor | null =
    mode === 'explore' && selection.length > 0 && selectionAnchor
      ? { at: selectionAnchor, content: <SelectionControls />, offset: [10, -5] }
      : null;

  return (
    <div className="flex h-full w-full">
      <TimelineSidebar />
      <div
        ref={containerRef}
        data-crosshair-lon={focus?.center?.[0]}
        data-crosshair-lat={focus?.center?.[1]}
        data-probe-lon={probePoints.at(-1)?.[0]}
        data-probe-lat={probePoints.at(-1)?.[1]}
        data-probe-count={probePoints.length}
        data-map-loading={mapLoading}
        className="relative h-full min-w-0 flex-1"
      >
        <MapView
          camera={mainCamera}
          layers={layers}
          anchor={anchor}
          interactions={interactions}
          onClick={onMapClick}
          onLoadStateChange={(loading) => {
            setMapLoading(loading);
            setForegroundMapLoading('main', loading);
          }}
        />
        <CustomMapLegend catalog={catalog} />
      </div>
    </div>
  );
}
