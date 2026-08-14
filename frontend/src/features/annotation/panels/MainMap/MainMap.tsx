import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { allBindings } from '../../bindings';
import { useContainerSize } from '../../canvas/useContainerSize';
import { hotkeyTip } from '../../hotkeys';
import { extendedLabels } from '../../campaign/annotation';
import { collectionsInView } from '../../campaign/imagery';
import { computeTaskProgress } from '../../campaign/tasks';
import { applyCameraTarget, fitAnnotations, focusCameraTarget, mainCamera } from '../../map/camera';
import { composeLayers, type AnnotationTiles, type ComposeState } from '../../map/compose';
import { MapView } from '../../map/MapView';
import { setForegroundMapLoading, useForegroundLoading } from '../../map/tileLoading';
import type { MapClickEvent } from '../../map/types';
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
import { usePreloading } from './usePreloading';

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

function ProbeToggle({ title }: { title: string }) {
  const active = useWorkStore((s) => s.tool === 'timeseries');

  return (
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
  const isTaskMode = mode === 'tasks';
  const sourceIds = view?.source_ids ?? [];
  const windows = useLayoutStore((s) => s.currentLayout.windows);
  // allBindings() reads the stores directly; these are the inputs that should
  // rebuild the table, not what the closure literally names.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bindings = useMemo(() => allBindings(), [campaign, catalog, mode, view]);

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
        <CustomMapControls catalog={catalog} toggleTitle={hotkeyTip(bindings, 'o')} />
        <VectorLayerControls catalog={catalog} toggleTitle={hotkeyTip(bindings, 'v')} />
        <ViewControls
          isTaskMode={isTaskMode}
          onFocus={() => {
            if (isTaskMode) {
              const focus = useTasksStore.getState().focus;
              if (focus) mainCamera.moveTo({ center: focus.center });
            } else void fitAnnotations(catalog.campaignId);
          }}
          focusTitle={hotkeyTip(bindings, ' ')}
          crosshairTitle={hotkeyTip(bindings, 'x')}
          showViewSync={windowCount > 1}
          viewSyncTitle={hotkeyTip(bindings, 'l')}
        />
        {isTaskMode && campaign.time_series.length > 0 && (
          <ProbeToggle title={hotkeyTip(bindings, 't')} />
        )}
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
  work.setProbePoint(event.lonLat);
  work.completeProbe();
}

export function MainMapBody() {
  const campaign = useCampaign();
  const catalog = useCatalog();
  const mode = useCampaignStore((s) => s.workMode);
  const imagery = useImageryStore();
  const legendOverrides = usePrefsStore((s) => s.legendOverrides);
  const draft = useWorkStore((s) => s.draft);
  const selection = useWorkStore((s) => s.selection);
  const editingId = useWorkStore((s) => s.edit?.annotation.id ?? null);
  // Draw/edit/box-select and the probe marker are the drawing feature's, and
  // reach the map through the shared handoff rather than a prop nobody could
  // pass (features do not mount one another).
  const interactions = useWorkStore((s) => s.interactions);
  const drawingClick = useWorkStore((s) => s.onMapClick);
  const onMapClick = mode === 'tasks' ? taskProbeClick : drawingClick;
  const probePoint = useWorkStore((s) => (s.probeMarkerHidden ? null : s.probePoint));
  const writes = useTileVersion();
  const focus = useMapFocus();
  const { containerRef, width, height } = useContainerSize();
  const [mapLoading, setMapLoading] = useState(false);
  const foregroundLoading = useForegroundLoading();
  const windowLayout = useLayoutStore((s) => s.currentLayout.windows);
  const visibleCollectionIds = useMemo(() => Object.keys(windowLayout).map(Number), [windowLayout]);
  useEffect(() => () => setForegroundMapLoading('main', false), []);

  const annotations = useMemo<AnnotationTiles>(
    () => ({
      // Every write the user makes after load has to bust the tile cache too.
      version: (campaign.annotations_version ?? 0) + writes,
      labels: extendedLabels(campaign),
      // The feature being edited is drawn by the edit interaction instead, so
      // the tile copy underneath it is hidden rather than doubled.
      hiddenIds: editingId != null ? [editingId] : undefined,
      highlightIds: selection.length > 0 ? selection : undefined,
    }),
    [campaign, writes, editingId, selection]
  );

  const draftFeatures = useMemo(
    () =>
      draft.phase === 'draft' || draft.phase === 'committing'
        ? [{ id: 'draft', geometry: draft.geometry }]
        : [],
    [draft]
  );

  const layers = useMemo(() => {
    const state: ComposeState = {
      ...imagery,
      annotations,
      legendOverrides,
      focusExtent: focus?.extent ?? null,
      crosshairPoint: focus?.center ?? null,
      crosshairColor: focus?.crosshairColor ?? null,
      draftFeatures,
      draftLabelId: draft.phase === 'idle' ? null : draft.labelId,
      probePoint,
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
    probePoint,
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

  return (
    <div className="flex h-full w-full">
      <TimelineSidebar />
      <div
        ref={containerRef}
        data-crosshair-lon={focus?.center?.[0]}
        data-crosshair-lat={focus?.center?.[1]}
        data-probe-lon={probePoint?.[0]}
        data-probe-lat={probePoint?.[1]}
        data-map-loading={mapLoading}
        className="relative h-full min-w-0 flex-1"
      >
        <MapView
          camera={mainCamera}
          layers={layers}
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
