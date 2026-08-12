import { useMemo } from 'react';
import { extendedLabels } from '~/features/annotation/core/annotation';
import { collectionsInView } from '~/features/annotation/core/catalog';
import {
  useImageryStore,
  usePrefsStore,
  useWorkStore,
  useWorkspaceStore,
} from '~/features/annotation/stores';
import { mainCamera } from '~/features/annotation/shared/cameras';
import { useContainerSize } from '~/features/annotation/engine/canvas';
import {
  MapView,
  type LayerId,
  type MapClickEvent,
  type TileStats,
} from '~/features/annotation/engine/map';
import type { ComposeCtx } from '../../composition';
import { fitAnnotations, recenter, useFocusCamera, useMapFocus } from './cameraBus';
import { useAnnotationVersion } from '../../shared/annotationVersion';
import {
  composeLayers,
  emptySliceFrom,
  type AnnotationTileState,
  type ComposeState,
} from '../../shared/composeLayers';
import { setProbePoint, useInteractionSpec } from '../../shared/interactionSpec';
import { CollectionPicker } from './header/CollectionPicker';
import { CustomMapControls } from './header/CustomMapControls';
import { CustomMapLegend } from './header/CustomMapLegend';
import { LayerSelector } from './header/LayerSelector';
import { PreloadMenu } from './header/PreloadMenu';
import { SlicePicker } from './header/SlicePicker';
import { VectorLayerControls } from './header/VectorLayerControls';
import { ViewControls } from './header/ViewControls';
import { hotkeyTip, mainMapBindings } from './hotkeys';
import { TimelineSidebar } from './TimelineSidebar';
import { usePreloading } from './usePreloading';

export interface MainMapProps {
  ctx: ComposeCtx;
}

export function MainMapHeader({ ctx }: { ctx: ComposeCtx }) {
  const { catalog, mode } = ctx;
  const isTaskMode = mode === 'tasks';
  const sourceIds = ctx.view?.source_ids ?? [];
  const windows = useWorkspaceStore((s) => s.currentLayout.view.windows);
  const bindings = useMemo(() => mainMapBindings(ctx), [ctx]);

  // View sync only means something with more than one window to keep in step.
  const windowCount = collectionsInView(catalog, { source_ids: sourceIds }).filter(
    (c) => windows[c.id] !== undefined
  ).length;

  return (
    <div className="flex min-w-0 items-center gap-1" data-tour="map-controls">
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
      {!isTaskMode && (
        <VectorLayerControls catalog={catalog} toggleTitle={hotkeyTip(bindings, 'v')} />
      )}
      <ViewControls
        isTaskMode={isTaskMode}
        onFocus={() => {
          if (isTaskMode) recenter();
          else void fitAnnotations(catalog.campaignId);
        }}
        focusTitle={hotkeyTip(bindings, ' ')}
        crosshairTitle={hotkeyTip(bindings, 'x')}
        showViewSync={windowCount > 1}
        viewSyncTitle={hotkeyTip(bindings, 'l')}
      />
      {isTaskMode && <PreloadMenu />}
    </div>
  );
}

/**
 * A click on the task map. Tasks mode ships no drawing tools - the shape is the
 * task's - so the pointer is always the pan tool and a plain click means the one
 * thing left: probe this point's time series, which the charts read back
 * through the shared probe point. Shift belongs to
 * the box gestures, so a click that carries it is not a click.
 */
export function taskProbeClick(event: MapClickEvent): void {
  if (event.shiftKey) return;
  setProbePoint(event.lonLat);
}

export function MainMapBody({ ctx }: MainMapProps) {
  const { campaign, catalog, mode } = ctx;
  const imagery = useImageryStore();
  const legendOverrides = usePrefsStore((s) => s.legendOverrides);
  const draft = useWorkStore((s) => s.draft);
  const selection = useWorkStore((s) => s.selection);
  const editingId = useWorkStore((s) => s.editingId);
  // Draw/edit/box-select and the probe marker are the drawing feature's, and
  // reach the map through the shared handoff rather than a prop nobody could
  // pass (features do not mount one another).
  const interactions = useInteractionSpec((s) => s.spec);
  const drawingClick = useInteractionSpec((s) => s.onMapClick);
  const onMapClick = mode === 'tasks' ? taskProbeClick : drawingClick;
  const probePoint = useInteractionSpec((s) => (s.probeMarkerHidden ? null : s.probePoint));
  const writes = useAnnotationVersion();
  const focus = useMapFocus();
  const { containerRef, width, height } = useContainerSize();

  const annotations = useMemo<AnnotationTileState>(
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
    return composeLayers(ctx, state);
  }, [ctx, imagery, annotations, legendOverrides, focus, draftFeatures, draft, probePoint]);

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

  usePreloading(ctx, {
    enabled: mode === 'tasks',
    focus: focus?.center ?? null,
    // The tasks the user is about to reach, so their imagery is warm by the
    // time they get there - the whole point of the upcoming tier.
    upcoming: focus?.upcoming,
    viewportPx,
  });

  const trackedRasterId = layers.find((l) => l.kind === 'raster' && l.trackStats)?.id;
  const markEmpty = imagery.markEmpty;

  const handleTileStats = (layerId: LayerId, stats: TileStats) => {
    // The main map records empty imagery itself rather than relying on a window
    // happening to be open on the same slice; the empty is a catalog
    // fact every map and the slice picker read.
    const empty = emptySliceFrom(layerId, trackedRasterId, stats, address);
    if (empty) markEmpty(empty);
  };

  return (
    <div className="flex h-full w-full">
      <TimelineSidebar ctx={ctx} />
      <div ref={containerRef} className="relative h-full min-w-0 flex-1">
        <MapView
          camera={mainCamera}
          layers={layers}
          interactions={interactions}
          onClick={onMapClick}
          onTileStats={handleTileStats}
        />
        <CustomMapLegend catalog={catalog} />
      </div>
    </div>
  );
}
