import { IconProbe } from '~/shared/ui/Icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { pageKeymap } from '../../keymap';
import { SliceCommentButton } from '../../chrome/SliceComments';
import { useContainerSize } from '~/shared/hooks/useContainerSize';
import { hotkeyTip } from '../../hotkeys';
import { collectionsInView } from '../../campaign/imagery';
import { computeTaskProgress } from '../../campaign/tasks';
import { handleProbeClick, useDrawingInteractions, useEditDrawnId } from '../../drawing';
import { geometryTopRight, missingRequiredFields } from '../../campaign/annotation';
import { useCameraZoom } from '~/shared/map/Camera';
import { applyCameraTarget, fitAnnotations, focusCameraTarget, mainCamera } from '../../map/camera';
import { annotationsVisibleAt, composeLayers, type ComposeState } from '../../map/compose';
import { MapView, type MapAnchor } from '~/shared/map/MapView';
import { CenterCrosshair } from '../../components/CenterCrosshair';
import { StatusPill } from '../../components/StatusPill';
import { setForegroundMapLoading, useForegroundLoading } from '~/shared/map/tileLoading';
import type { LonLat, MapClickEvent } from '~/shared/map/types';
import { useCampaign, useCampaignStore, useCatalog, type WorkMode } from '../../stores/campaign';
import { useImageryStore } from '../../stores/imagery';
import { useLayoutStore } from '../../stores/layout';
import { usePrefsStore } from '../../stores/prefs';
import { useMapFocus, useTasksStore } from '../../stores/tasks';
import { MAX_PROBES, useSavedAnnotations, useWorkStore } from '../../stores/work';
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

/**
 * Arm the probe tool, and add probes to it. The tool alone moves the probe you
 * picked up - which is what comparing a place across dates needs - so dropping
 * another one is its own control rather than a side effect of clicking again.
 */
function ProbeToggle({ title, addTitle }: { title: string; addTitle: string }) {
  const active = useWorkStore((s) => s.tool === 'timeseries');
  const armed = useWorkStore((s) => s.probeAddArmed);
  const atCap = useWorkStore((s) => s.probePoints.length >= MAX_PROBES);

  const segment = 'flex h-6 items-center justify-center rounded-md cursor-pointer';
  const off = 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500';

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
        className={`${segment} w-6 ${active ? 'bg-brand-600 text-white hover:bg-brand-700' : off}`}
      >
        <IconProbe className="h-[13px] w-[13px]" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => useWorkStore.getState().armAddProbe(!armed)}
        aria-pressed={armed}
        disabled={atCap}
        aria-label={addTitle}
        title={atCap ? `At most ${MAX_PROBES} probes at once` : addTitle}
        data-testid="probe-add"
        className={`${segment} w-4 text-[13px] font-semibold leading-none disabled:cursor-not-allowed disabled:opacity-40 ${
          armed ? 'bg-brand-600 text-white hover:bg-brand-700' : off
        }`}
      >
        +
      </button>
    </div>
  );
}

/** Filter-scoped "N of M done" - the task set being worked, and the current
 *  filter's assignedTo, which defaults to the viewer. Completion follows the
 *  share of the work the user is actually looking at rather than the whole
 *  campaign's. */
function TaskProgressCounter() {
  const { allTasks, filter } = useTasksStore(
    useShallow((state) => ({ allTasks: state.allTasks, filter: state.filter }))
  );
  const setId = filter.taskSetId;
  const inScope = useMemo(
    () => (setId === null ? allTasks : allTasks.filter((t) => t.task_set_id === setId)),
    [allTasks, setId]
  );
  const { total, completed } = computeTaskProgress(inScope, filter.assignedTo);

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
        {/* Tasks only: there the probe is a detour from the task, so it is
            reached from the map. Explore keeps every probe control in its
            tools panel, beside the tool that drops them. */}
        {isTaskMode && campaign.time_series.length > 0 && (
          <ProbeToggle
            title={hotkeyTip(bindings, 't')}
            addTitle={hotkeyTip(bindings, 'shift+t', 'Add another probe')}
          />
        )}
        {isTaskMode && <ClearProbes />}
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
 * A click on the task map, which probes only while the probe tool is armed - a
 * bare click has to stay free to mean nothing, or every attempt to look around
 * moves the marker and refetches. Shift belongs to the box gestures, so a
 * click that carries it is not a click.
 */
export function taskProbeClick(event: MapClickEvent): void {
  if (event.shiftKey || useWorkStore.getState().tool !== 'timeseries') return;
  handleProbeClick(event);
}

/**
 * The annotation tiles are empty below their zoom floor, by design: a
 * continental view of a dense campaign is a query nobody wants. Unexplained,
 * that reads as a campaign nobody has worked on, so it is explained.
 */
function AnnotationZoomNotice() {
  const mode = useCampaignStore((s) => s.workMode);
  const showAnnotations = useImageryStore((s) => s.showAnnotations);
  const zoom = useCameraZoom(mainCamera);

  if (mode !== 'explore' || !showAnnotations || annotationsVisibleAt(zoom)) return null;
  return <StatusPill>Zoom in to see annotations</StatusPill>;
}

/** Why a just-drawn shape is not saved yet, and how to finish it. */
function DraftQuestionsHint({ missing }: { missing: string[] }) {
  return (
    <div
      data-testid="draft-questions-hint"
      className="max-w-56 rounded-md border border-amber-300 bg-amber-50/95 px-2 py-1.5 text-[11px] leading-snug text-amber-900 shadow-sm"
    >
      <p className="font-medium">Answer to save: {missing.join(', ')}</p>
      <p className="mt-0.5 text-amber-700">Tab moves between questions, Enter saves.</p>
    </div>
  );
}

/**
 * The annotate tool draws nothing until a label is chosen, which from the map
 * looks like a broken tool. One pill in the same slot as the zoom notice, so
 * the two can never stack.
 */
function MapNotice() {
  const mode = useCampaignStore((s) => s.workMode);
  const needsLabel = useWorkStore((s) => s.tool === 'annotate' && s.selectedLabelId === null);

  if (mode === 'explore' && needsLabel) {
    return (
      <StatusPill>
        <span data-testid="pick-label-notice">
          Pick a label in the controls panel (or press its number) to start drawing
        </span>
      </StatusPill>
    );
  }
  return <AnnotationZoomNotice />;
}

export function MainMapBody() {
  const campaign = useCampaign();
  const catalog = useCatalog();
  const mode = useCampaignStore((s) => s.workMode);
  const imagery = useImageryStore();
  const legendOverrides = usePrefsStore((s) => s.legendOverrides);
  const draft = useWorkStore((s) => s.draft);
  const formValues = useWorkStore((s) => s.formValues);
  const selection = useWorkStore((s) => s.selection);
  const selectionAnchor = useWorkStore((s) => s.selectionAnchor);
  // Draw/edit/box-select belong to the map they act on, so this is where the
  // drawing feature's wiring is mounted.
  const { interactions, onMapClick: drawingClick } = useDrawingInteractions();
  const onMapClick = mode === 'tasks' ? taskProbeClick : drawingClick;
  const probePoints = useWorkStore((s) => (s.probeMarkerHidden ? EMPTY_PROBES : s.probePoints));
  const activeProbe = useWorkStore((s) => s.activeProbe);
  const focus = useMapFocus();
  const { containerRef, width, height } = useContainerSize();
  const [mapLoading, setMapLoading] = useState(false);
  const foregroundLoading = useForegroundLoading();
  const windowLayout = useLayoutStore((s) => s.currentLayout.windows);
  const visibleCollectionIds = useMemo(() => Object.keys(windowLayout).map(Number), [windowLayout]);
  useEffect(() => () => setForegroundMapLoading('main', false), []);

  // A shape is a sketch only until it is stored. Stored the moment it was
  // drawn - which is what happens when nothing required is outstanding - it is
  // a saved annotation with its questions still open, and the overlay draws it
  // in its label's own colours rather than leaving it looking unsaved.
  const unsaved =
    (draft.phase === 'draft' || draft.phase === 'committing') && draft.savedId === null;

  // Hidden because something else draws them: the edit interaction draws the
  // feature under its handles, and the sketch layer draws a draft that was
  // stored the moment it was drawn. Nothing else is hidden - hiding a feature
  // nothing then draws is how an annotation disappears.
  const editDrawnId = useEditDrawnId();
  const hiddenIds = useMemo(
    () => (editDrawnId === null ? undefined : new Set([editDrawnId])),
    [editDrawnId]
  );

  const highlightIds = useMemo(
    () => (selection.length > 0 ? new Set(selection) : undefined),
    [selection]
  );

  const annotations = useSavedAnnotations(hiddenIds, highlightIds);

  const draftFeatures = useMemo(
    () => (unsaved ? [{ id: 'draft', geometry: draft.geometry }] : []),
    [unsaved, draft]
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
      activeProbe,
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
    activeProbe,
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

  // A held-back shape is not stored yet, and nothing on the map says why. The
  // reason rides on the shape itself, listing what is outstanding.
  const missing =
    draft.phase === 'draft'
      ? missingRequiredFields(campaign.settings.form_fields ?? [], formValues)
      : [];

  // Confirm/delete ride on the geometry they act on rather than in a corner of
  // the page, which is what makes them findable on a big map. A draft outranks
  // a selection: it is the thing the user just did.
  const anchor: MapAnchor | null =
    mode !== 'explore'
      ? null
      : draft.phase === 'draft' && missing.length > 0
        ? {
            at: geometryTopRight(draft.geometry),
            content: <DraftQuestionsHint missing={missing.map((f) => f.title)} />,
            offset: [10, -5],
          }
        : selection.length > 0 && selectionAnchor
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
        // How many annotations this map is drawing itself because the tiles do
        // not carry them yet, and the version of the tiles it is drawing.
        data-annotation-delta={annotations.delta?.ids.size ?? 0}
        data-annotation-tiles-version={annotations.version}
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
        <CenterCrosshair />
        <MapNotice />
      </div>
    </div>
  );
}
