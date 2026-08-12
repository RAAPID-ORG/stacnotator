import { useCallback, useEffect, useMemo } from 'react';
import {
  batchDeleteAnnotations,
  deleteAnnotation,
  getAnnotationIdsInBbox,
  updateAnnotationOpenmode,
} from '~/api/client';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import {
  extendedLabels,
  geometryToWkt,
  resolveLabelStyle,
  toDraftStyleSpec,
  toStyleSpec,
  type ExtendedLabel,
  type GeometryType,
} from '~/features/annotation/core/annotation';
import { useImageryStore, usePrefsStore, useWorkStore } from '~/features/annotation/stores';
import type {
  Bbox,
  BoxHit,
  DrawShape,
  InteractionSpec,
  MapClickEvent,
} from '~/features/annotation/engine/map';
import type { ComposeCtx } from '../registry';
import { bumpAnnotationVersion } from '../shared/annotationVersion';
import { ANNOTATION_LAYER_ID, vectorLayerId } from '../shared/composeLayers';
import {
  clearEditSession,
  getEditSession,
  openEdit,
  setEditAnnotation,
  setEditBusy,
  setPendingGeometry,
  useEditSession,
} from '../shared/editSession';
import { setInteractions, setProbePoint } from '../shared/interactionSpec';
import { getActiveTool, useActiveTool } from '../shared/toolState';
import { labelFeature, labelFeaturesInBox, type LabelOutcome } from './vectorLabel';

const DRAW_SHAPES: Record<GeometryType, DrawShape> = {
  point: 'Point',
  line: 'LineString',
  polygon: 'Polygon',
};

/**
 * Save the dragged geometry. Label, comment and answers come from the shared
 * session, so a detail edit saved a moment ago is not written back stale. The
 * answers are only sent when the annotation has some: `null` is a write value
 * (clear them), and this is a geometry edit.
 */
export async function commitEdit(campaignId: number): Promise<boolean> {
  const { annotation, pending, busy } = getEditSession();
  if (!annotation || !pending || busy) return false;

  setEditBusy(true);
  try {
    const answers = annotation.form_values ?? {};
    const result = await updateAnnotationOpenmode({
      path: { campaign_id: campaignId, annotation_id: annotation.id },
      body: {
        label_id: annotation.label_id,
        comment: annotation.comment ?? null,
        geometry_wkt: geometryToWkt(pending),
        is_authoritative: null,
        ...(Object.keys(answers).length ? { form_values: answers } : {}),
      },
    });
    if (result.data) setEditAnnotation(result.data);
    bumpAnnotationVersion();
    clearEditSession();
    useLayoutStore.getState().showAlert('Annotation updated successfully', 'success');
    return true;
  } catch (error) {
    setEditBusy(false);
    handleError(error, 'Could not save the geometry');
    return false;
  }
}

/**
 * Delete whatever is selected: one annotation, or the whole box selection in a
 * single request. The selection is dropped before the request goes out, so a
 * second Delete cannot fire the same delete twice (old
 * DrawingLayer.tsx:663-674 cleared first for the same reason).
 */
export async function deleteSelection(campaignId: number): Promise<number> {
  const ids = useWorkStore.getState().selection;
  if (ids.length === 0) return 0;
  clearEditSession();

  try {
    if (ids.length === 1) {
      await deleteAnnotation({ path: { campaign_id: campaignId, annotation_id: ids[0] } });
    } else {
      await batchDeleteAnnotations({
        path: { campaign_id: campaignId },
        body: { annotation_ids: ids },
      });
    }
    bumpAnnotationVersion();
    const { showAlert } = useLayoutStore.getState();
    showAlert(
      ids.length === 1 ? 'Annotation deleted' : `Deleted ${ids.length} annotations`,
      'success'
    );
    return ids.length;
  } catch (error) {
    handleError(error, 'Could not delete');
    return 0;
  }
}

/** Shift+drag with the edit tool: the ids come from the server because the
 *  geometry never leaves it; main-map highlights them from the selection. */
async function selectInBox(campaignId: number, bbox: Bbox): Promise<void> {
  try {
    const result = await getAnnotationIdsInBbox({
      path: { campaign_id: campaignId },
      query: { bbox: bbox.join(',') },
    });
    const ids = (result.data ?? []).map(Number).filter(Number.isFinite);
    clearEditSession();
    useWorkStore.getState().setSelection(ids);
  } catch (error) {
    handleError(error, 'Box selection failed');
  }
}

function reportLabelOutcome(outcome: LabelOutcome): void {
  const { showAlert } = useLayoutStore.getState();
  if (outcome.kind === 'blocked')
    showAlert(`Missing required: ${outcome.missing.join(', ')}`, 'error');
  else if (outcome.kind === 'error')
    showAlert(`Failed to label features: ${outcome.message}`, 'error');
  else if (outcome.kind === 'saved') {
    bumpAnnotationVersion();
    showAlert(`Labeled ${outcome.count} feature(s)`, 'success');
  }
}

/**
 * A finished sketch. One draft at a time, so an open one is resolved first
 * handoff); a failed save parks that draft for a retry and this shape is not
 * started, rather than silently replacing what could not be saved.
 */
async function handleDrawEnd(ctx: ComposeCtx, geometry: GeoJSON.Geometry): Promise<void> {
  const fields = ctx.campaign.settings.form_fields ?? [];
  const campaignId = ctx.campaign.id;
  const work = useWorkStore.getState();
  const labelId = work.selectedLabelId;
  if (labelId === null) return;

  if (work.draft.phase === 'draft') {
    const closed = await work.closeDraft(campaignId, fields);
    if (closed === 'save-failed') {
      const { showAlert } = useLayoutStore.getState();
      showAlert('The previous annotation could not be saved - retry or discard it first.', 'error');
      return;
    }
    if (closed === 'saved') bumpAnnotationVersion();
  }

  useWorkStore.getState().beginDraft(labelId);
  const outcome = await useWorkStore.getState().drawEnd(campaignId, geometry, fields);
  if (outcome === 'saved') bumpAnnotationVersion();
  if (outcome === 'save-failed') {
    const { showAlert } = useLayoutStore.getState();
    showAlert('Could not save the annotation - retry or discard it in the panel.', 'error');
  }
}

/**
 * A click on the map, routed by tool. Exported for its own test: what an edit
 * click must *not* do (drop an open edit) is the interesting half.
 */
export async function handleMapClick(ctx: ComposeCtx, event: MapClickEvent): Promise<void> {
  // Shift belongs to the box gestures; a click that ends one is not a click.
  if (event.shiftKey) return;
  const tool = getActiveTool();
  const campaignId = ctx.campaign.id;

  if (tool === 'timeseries') {
    setProbePoint(event.lonLat);
    return;
  }

  if (tool === 'edit') {
    const editingId = useWorkStore.getState().editingId;
    if (event.layerId === ANNOTATION_LAYER_ID && event.featureId != null) {
      const clicked = Number(event.featureId);
      if (clicked !== editingId) await openEdit(campaignId, clicked);
      return;
    }
    // A click that hit nothing. While an annotation is open for editing that
    // is the common case - its tile copy is rendered transparent (and so does
    // not hit-test) and the sketch layer carrying the handles is not a
    // declared layer, so dragging a vertex or clicking inside the shape
    // reports no feature at all. Ending the edit on that would throw away the
    // drag; Escape and Cancel are what end it.
    if (editingId === null) clearEditSession();
    return;
  }

  if (tool === 'labelVector') {
    const work = useWorkStore.getState();
    const { vector } = useImageryStore.getState();
    if (work.selectedLabelId === null || !event.featureGeometry) return;
    if (vector.id === null || event.layerId !== vectorLayerId(vector.id)) return;
    reportLabelOutcome(
      await labelFeature({
        campaignId,
        geometry: event.featureGeometry,
        labelId: work.selectedLabelId,
        fields: ctx.campaign.settings.form_fields ?? [],
        formValues: work.formValues,
      })
    );
  }
}

async function handleBox(ctx: ComposeCtx, bbox: Bbox, hits: BoxHit[]): Promise<void> {
  const tool = getActiveTool();
  if (tool === 'edit') {
    await selectInBox(ctx.campaign.id, bbox);
    return;
  }
  if (tool !== 'labelVector') return;
  const work = useWorkStore.getState();
  if (work.selectedLabelId === null) return;
  reportLabelOutcome(
    await labelFeaturesInBox({
      campaignId: ctx.campaign.id,
      hits,
      labelId: work.selectedLabelId,
      fields: ctx.campaign.settings.form_fields ?? [],
      formValues: work.formValues,
    })
  );
}

function labelById(ctx: ComposeCtx, labelId: number | null): ExtendedLabel | null {
  if (labelId === null) return null;
  return extendedLabels(ctx.campaign).find((l) => l.id === labelId) ?? null;
}

/**
 * Publishes the InteractionSpec for the active tool. Mounted once, by the
 * drawing feature's EditOverlayControls.
 */
export function useDrawingInteractions(ctx: ComposeCtx): void {
  const isExplore = ctx.mode === 'explore';
  const tool = useActiveTool();
  const selectedLabelId = useWorkStore((s) => s.selectedLabelId);
  const labelStyles = usePrefsStore((s) => s.labelStyles);
  const vector = useImageryStore((s) => s.vector);
  const editGeometry = useEditSession((s) => s.geometry);
  const editLabelId = useEditSession((s) => s.annotation?.label_id ?? null);
  const editingId = useWorkStore((s) => s.editingId);

  const label = useMemo(() => labelById(ctx, selectedLabelId), [ctx, selectedLabelId]);
  const style = useMemo(
    () =>
      label ? resolveLabelStyle(label.color, label.geometry_type, labelStyles[label.id]) : null,
    [label, labelStyles]
  );
  // The feature under the edit handles is painted in its own label's colours,
  // emphasised the way a selected annotation is.
  const editStyle = useMemo(() => {
    const editLabel = labelById(ctx, editLabelId);
    const resolved = resolveLabelStyle(
      editLabel?.color ?? '#3b82f6',
      editLabel?.geometry_type ?? 'polygon',
      editLabelId === null ? undefined : labelStyles[editLabelId]
    );
    return toStyleSpec(resolved, { selected: true });
  }, [ctx, editLabelId, labelStyles]);

  const onMapClick = useCallback(
    (event: MapClickEvent) => {
      void handleMapClick(ctx, event);
    },
    [ctx]
  );

  const spec = useMemo<InteractionSpec | undefined>(() => {
    // Tasks mode has no drawing tools: its map is the task's, and the tool
    // state is Explore's.
    if (!isExplore) return undefined;

    if (tool === 'annotate') {
      if (!label || !style) return undefined;
      return {
        draw: {
          shape: DRAW_SHAPES[label.geometry_type],
          sketchStyle: toDraftStyleSpec(style),
          onDrawEnd: (geometry) => void handleDrawEnd(ctx, geometry),
        },
        snap: true,
      };
    }
    if (tool === 'edit') {
      const boxSelect = { onBox: (bbox: Bbox) => void handleBox(ctx, bbox, []) };
      if (!editGeometry || editingId === null) return { boxSelect };
      return {
        edit: {
          feature: { id: editingId, geometry: editGeometry },
          style: editStyle,
          onGeometryChange: setPendingGeometry,
        },
        boxSelect,
        snap: true,
      };
    }
    if (tool === 'labelVector') {
      const layerIds = vector.id != null && vector.visible ? [vectorLayerId(vector.id)] : [];
      return {
        boxSelect: {
          onBox: (bbox, hits) => void handleBox(ctx, bbox, hits),
          hitLayerIds: layerIds,
        },
      };
    }
    return undefined;
  }, [ctx, isExplore, tool, label, style, editGeometry, editingId, editStyle, vector]);

  useEffect(() => {
    setInteractions(spec, isExplore ? onMapClick : undefined);
  }, [spec, onMapClick, isExplore]);

  // Leaving the edit tool ends the edit: an unsaved drag would otherwise stay
  // hidden in the tiles with nothing on screen to confirm or cancel it.
  useEffect(() => {
    if (tool !== 'edit') clearEditSession();
  }, [tool]);

  useEffect(() => () => setInteractions(undefined, undefined), []);
}
