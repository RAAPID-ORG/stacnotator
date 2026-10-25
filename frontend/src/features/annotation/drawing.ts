import { useCallback, useMemo } from 'react';
import {
  batchCreateAnnotations,
  batchDeleteAnnotations,
  createAnnotation,
  deleteAnnotation,
  getAnnotationIdsInBbox,
  updateAnnotation,
  type AnnotationCreate,
} from '~/api/client';
import i18n from '~/shared/i18n';
import { useLayoutStore as useGlobalLayoutStore } from '~/shared/stores/layout.store';
import { extractErrorMessage, handleError } from '~/shared/utils/errorHandler';
import {
  featureDedupeKey,
  geometryToWkt,
  newAnnotationBody,
  validateForm,
  type ExtendedLabel,
  type FormValues,
  type GeometryType,
} from './campaign/annotation';
import { resolveLabelStyle, toDraftStyleSpec } from './campaign/labelStyle';
import { isAnnotationLayer, PROBE_LAYER_ID, probeIndexOf, vectorLayerId } from './map/compose';
import type { Bbox, BoxHit, DrawShape, InteractionSpec, MapClickEvent } from '~/shared/map/types';
import {
  campaignState,
  formFields,
  mayModifyAnnotation,
  originTaskId,
  useCanModifyAnnotation,
  useDrawsShapes,
  useLabels,
  viewedSliceId,
} from './stores/campaign';
import { useImageryStore } from './stores/imagery';
import { usePrefsStore } from './stores/prefs';
import { currentTask } from './stores/tasks';
import { useWorkStore, type TaskLink } from './stores/work';

const t = i18n.getFixedT(null, 'annotation');

const DRAW_SHAPES: Record<GeometryType, DrawShape> = {
  point: 'Point',
  line: 'LineString',
  polygon: 'Polygon',
};

const alert = (message: string, kind: 'error' | 'success') =>
  useGlobalLayoutStore.getState().showAlert(message, kind);

// ---------------------------------------------------------------------------
// Labelling reference vector features
// ---------------------------------------------------------------------------

type LabelOutcome =
  | { kind: 'saved'; count: number }
  | { kind: 'blocked'; missing: string[] }
  | { kind: 'error'; message: string }
  | { kind: 'noop' };

/** The task a new shape belongs to: in Tasks the draw task it answers, in
 *  Explore the task it was found near. */
function shapeTaskLink(): TaskLink {
  if (campaignState().workMode === 'tasks') return { output_of_task_id: currentTask()?.id };
  return { origin_task_id: originTaskId() };
}

/** One geometry per feature: MVT ids repeat across the tiles a shape crosses,
 *  and are only unique within their own layer. */
export function dedupeHits(hits: BoxHit[]): GeoJSON.Geometry[] {
  const seen = new Set<string>();
  const geometries: GeoJSON.Geometry[] = [];
  for (const { layerId, feature } of hits) {
    const key = featureDedupeKey(layerId, feature.id, feature.geometry);
    if (seen.has(key)) continue;
    seen.add(key);
    geometries.push(feature.geometry);
  }
  return geometries;
}

export async function labelGeometries(geometries: GeoJSON.Geometry[]): Promise<LabelOutcome> {
  if (geometries.length === 0) return { kind: 'noop' };
  const work = useWorkStore.getState();
  const labelId = work.selectedLabelId;
  if (labelId === null) return { kind: 'noop' };

  const { ok, missing } = validateForm(formFields(), work.formValues);
  if (!ok) return { kind: 'blocked', missing };

  const campaignId = campaignState().campaign.id;
  const link = shapeTaskLink();
  const details = { formValues: work.formValues, imagerySliceId: viewedSliceId() };
  const bodies = geometries.map((geometry) => newAnnotationBody(geometry, labelId, details, link));
  try {
    let count = 1;
    let ids: number[] = [];
    if (bodies.length === 1) {
      const result = await createAnnotation({ path: { campaign_id: campaignId }, body: bodies[0] });
      ids = result.data ? [result.data.id] : [];
    } else {
      // One request and one transaction for the set: labelling hundreds of
      // vector features must not be hundreds of round trips.
      const result = await batchCreateAnnotations({
        path: { campaign_id: campaignId },
        body: { annotations: bodies },
      });
      count = result.data?.created_count ?? bodies.length;
    }
    work.noteDrawn(link, ids);
    return { kind: 'saved', count };
  } catch (error) {
    return { kind: 'error', message: extractErrorMessage(error) };
  }
}

function reportLabelOutcome(outcome: LabelOutcome): void {
  if (outcome.kind === 'blocked')
    alert(t('missingRequired', { fields: outcome.missing.join(', ') }), 'error');
  else if (outcome.kind === 'error')
    alert(t('drawing.labelFailed', { message: outcome.message }), 'error');
  else if (outcome.kind === 'saved') {
    // A batch reports how many it stored, not which ids: nothing to draw over
    // the tiles with, so the tiles are what catches up.
    useWorkStore.getState().refreshTiles();
    alert(t('drawing.labeled', { count: outcome.count }), 'success');
  }
}

// ---------------------------------------------------------------------------
// Editing saved annotations
// ---------------------------------------------------------------------------

/** Save the dragged geometry, and nothing else: an update leaves out what it
 *  does not change, so a detail edit saved a moment ago cannot be overwritten. */
export async function commitEdit(): Promise<boolean> {
  const work = useWorkStore.getState();
  const edit = work.edit;
  if (!edit || !edit.pending || edit.busy) return false;

  work.setEditBusy(true);
  try {
    const result = await updateAnnotation({
      path: { campaign_id: campaignState().campaign.id, annotation_id: edit.annotation.id },
      body: { geometry_wkt: geometryToWkt(edit.pending), imagery_slice_id: viewedSliceId() },
    });
    if (result.data) work.setEditAnnotation(result.data);
    work.recordWrites([
      {
        id: edit.annotation.id,
        labelId: edit.annotation.label_id,
        geometry: edit.pending,
        origin: 'local',
      },
    ]);
    work.clearEdit();
    alert(t('drawing.updated'), 'success');
    return true;
  } catch (error) {
    useWorkStore.getState().setEditBusy(false);
    handleError(error, t('drawing.geometryFailed'));
    return false;
  }
}

/** Delete the selection - one annotation, or the whole box selection in a
 *  single request. Cleared before the request goes out so a second Delete
 *  cannot fire the same delete twice. */
export async function deleteSelection(): Promise<number> {
  const work = useWorkStore.getState();
  const ids = work.selection;
  if (ids.length === 0) return 0;
  work.clearEdit();

  const campaignId = campaignState().campaign.id;
  try {
    if (ids.length === 1) {
      await deleteAnnotation({ path: { campaign_id: campaignId, annotation_id: ids[0] } });
    } else {
      await batchDeleteAnnotations({
        path: { campaign_id: campaignId },
        body: { annotation_ids: ids },
      });
    }
    work.recordDeletes(ids);
    alert(t('drawing.deleted', { count: ids.length }), 'success');
    return ids.length;
  } catch (error) {
    handleError(error, t('drawing.deleteFailed'));
    return 0;
  }
}

/** Shift+drag with the edit tool. The ids come from the server because the
 *  geometry never leaves it; the map highlights them from the selection. */
async function selectInBox(bbox: Bbox): Promise<void> {
  try {
    const result = await getAnnotationIdsInBbox({
      path: { campaign_id: campaignState().campaign.id },
      query: {
        bbox: bbox.join(','),
        include_tasks: useImageryStore.getState().showTaskAnnotations,
      },
    });
    const work = useWorkStore.getState();
    work.clearEdit();
    // The box's own top-right is the only geometry a bulk selection has: the
    // ids come from the server, the shapes never leave it.
    work.setSelection((result.data ?? []).map(Number).filter(Number.isFinite), [bbox[2], bbox[3]]);
  } catch (error) {
    handleError(error, t('drawing.boxFailed'));
  }
}

// ---------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------

/** A finished sketch. One draft at a time, so an open one is resolved first;
 *  when that save fails the draft is parked for a retry and this shape is not
 *  started, rather than silently replacing what could not be saved. */
async function handleDrawEnd(geometry: GeoJSON.Geometry): Promise<void> {
  const work = useWorkStore.getState();
  const labelId = work.selectedLabelId;
  if (labelId === null) return;

  if (work.draft.phase === 'draft' && (await work.closeDraft()) === 'save-failed') {
    alert(t('drawing.previousUnsaved'), 'error');
    return;
  }

  useWorkStore.getState().beginDraft(labelId, shapeTaskLink());
  if ((await useWorkStore.getState().drawEnd(geometry)) === 'save-failed') {
    alert(t('drawing.saveFailed'), 'error');
  }
}

/**
 * A click while the timeseries tool is armed. Empty map moves the active probe
 * (or drops the first one); a click on a marker picks that probe up, and a
 * second click on the one already active takes it off the chart. Adding
 * another is the + control's job, so comparing places never depends on
 * clicking in exactly the right order.
 */
export function handleProbeClick(event: MapClickEvent): void {
  const work = useWorkStore.getState();
  const hit = event.layerId === PROBE_LAYER_ID ? probeIndexOf(event.featureId) : null;
  if (hit === null) work.probeAt(event.lonLat);
  else if (hit === work.activeProbe) work.removeProbePoint(hit);
  else work.selectProbePoint(hit);
}

/** A click on the map, routed by tool. */
export async function handleMapClick(event: MapClickEvent): Promise<void> {
  // Shift belongs to the box gestures; a click that ends one is not a click.
  if (event.shiftKey) return;
  const work = useWorkStore.getState();

  if (work.tool === 'timeseries') {
    handleProbeClick(event);
    return;
  }

  // Pan opens an annotation for reading: the details panel fills in, and the
  // on-map controls come with it, but no vertex handles - editing is the edit
  // tool's.
  if (work.tool === 'pan') {
    const clicked =
      isAnnotationLayer(event.layerId) && event.featureId != null ? Number(event.featureId) : null;
    if (clicked === null) work.clearEdit();
    else if (clicked !== work.edit?.annotation.id) await work.openEdit(clicked);
    return;
  }

  if (work.tool === 'edit') {
    const editingId = work.edit?.annotation.id ?? null;
    if (isAnnotationLayer(event.layerId) && event.featureId != null) {
      const clicked = Number(event.featureId);
      if (clicked !== editingId) {
        await work.openEdit(clicked);
        const opened = useWorkStore.getState().edit?.annotation;
        // It opens for reading either way; saying so is what stops the click
        // looking like it did nothing.
        if (opened && !mayModifyAnnotation(opened)) {
          alert(t('drawing.notAuthorized'), 'error');
        }
      }
      return;
    }
    // A click that hit nothing. While an annotation is open that is the common
    // case - its tile copy is transparent so it does not hit-test, and the
    // sketch layer carrying the handles is not a declared layer, so dragging a
    // vertex reports no feature at all. Ending the edit on that would throw
    // away the drag; Escape and Cancel are what end it.
    if (editingId === null) work.clearEdit();
    return;
  }

  if (work.tool === 'labelVector') {
    const { vector } = useImageryStore.getState();
    if (work.selectedLabelId === null || !event.featureGeometry) return;
    if (vector.id === null || event.layerId !== vectorLayerId(vector.id)) return;
    reportLabelOutcome(await labelGeometries([event.featureGeometry]));
  }
}

async function handleBox(bbox: Bbox, hits: BoxHit[]): Promise<void> {
  const { tool } = useWorkStore.getState();
  if (tool === 'edit') {
    await selectInBox(bbox);
    return;
  }
  if (tool === 'labelVector') reportLabelOutcome(await labelGeometries(dedupeHits(hits)));
}

/**
 * The annotation the edit interaction draws itself, with vertex handles, or
 * null. Someone else's annotation opens for reading, never with handles: the
 * geometry save would only be refused.
 *
 * The map hides exactly this one in the tiles, so "who draws it" has a single
 * answer - hiding one nothing then draws is how an outline disappears.
 */
export function useEditDrawnId(): number | null {
  const tool = useWorkStore((s) => s.tool);
  const edit = useWorkStore((s) => s.edit);
  const canModify = useCanModifyAnnotation();
  if (tool !== 'edit' || !edit || !canModify(edit.annotation)) return null;
  return edit.annotation.id;
}

/** The map's draw/edit/box-select wiring for the active tool, and the click
 *  handler that goes with it. Mounted by the map it configures. */
export function useDrawingInteractions(): {
  interactions: InteractionSpec | undefined;
  onMapClick: ((e: MapClickEvent) => void) | undefined;
} {
  const drawsShapes = useDrawsShapes();
  const tool = useWorkStore((s) => s.tool);
  const selectedLabelId = useWorkStore((s) => s.selectedLabelId);
  const edit = useWorkStore((s) => s.edit);
  const labelStyles = usePrefsStore((s) => s.labelStyles);
  const vector = useImageryStore((s) => s.vector);
  const labels = useLabels();
  const editDrawnId = useEditDrawnId();
  const editable = editDrawnId !== null;

  const byId = (id: number | null): ExtendedLabel | undefined =>
    id === null ? undefined : labels.find((l) => l.id === id);

  const label = byId(selectedLabelId);
  const sketchStyle = useMemo(
    () =>
      label
        ? toDraftStyleSpec(
            resolveLabelStyle(label.color, label.geometry_type, labelStyles[label.id])
          )
        : null,
    [label, labelStyles]
  );

  // The feature under the edit handles is painted in its own label's colours,
  // dashed like a sketch - it is being worked on, not saved as it stands.
  const editLabelId = edit?.annotation.label_id ?? null;
  const editStyle = useMemo(() => {
    const editLabel = byId(editLabelId);
    return toDraftStyleSpec(
      resolveLabelStyle(
        editLabel?.color ?? '#3b82f6',
        editLabel?.geometry_type ?? 'polygon',
        editLabelId === null ? undefined : labelStyles[editLabelId]
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels, editLabelId, labelStyles]);

  const onMapClick = useCallback((event: MapClickEvent) => void handleMapClick(event), []);

  const spec = useMemo<InteractionSpec | undefined>(() => {
    // Classify tasks have no drawing tools: their map is the task's.
    if (!drawsShapes) return undefined;

    if (tool === 'annotate') {
      if (!label || !sketchStyle) return undefined;
      return {
        draw: {
          shape: DRAW_SHAPES[label.geometry_type],
          sketchStyle,
          onDrawEnd: (geometry) => void handleDrawEnd(geometry),
        },
        snap: true,
      };
    }
    if (tool === 'edit') {
      const boxSelect = { onBox: (bbox: Bbox) => void handleBox(bbox, []) };
      if (!edit || !editable) return { boxSelect };
      return {
        edit: {
          feature: { id: edit.annotation.id, geometry: edit.geometry },
          style: editStyle,
          onGeometryChange: useWorkStore.getState().setPendingGeometry,
        },
        boxSelect,
        snap: true,
      };
    }
    if (tool === 'labelVector') {
      return {
        boxSelect: {
          onBox: (bbox, hits) => void handleBox(bbox, hits),
          hitLayerIds: vector.id != null && vector.visible ? [vectorLayerId(vector.id)] : [],
        },
      };
    }
    return undefined;
    // `edit.geometry` is the identity that matters: rebuilding the spec on a
    // pending drag would tear the interaction down mid-gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    drawsShapes,
    tool,
    label,
    sketchStyle,
    edit?.annotation.id,
    edit?.geometry,
    editable,
    editStyle,
    vector,
  ]);

  return { interactions: spec, onMapClick: drawsShapes ? onMapClick : undefined };
}
