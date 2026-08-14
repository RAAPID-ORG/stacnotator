import { useCallback, useEffect, useMemo } from 'react';
import {
  batchCreateAnnotations,
  batchDeleteAnnotations,
  createAnnotationOpenmode,
  deleteAnnotation,
  getAnnotationIdsInBbox,
  updateAnnotationOpenmode,
  type AnnotationCreate,
} from '~/api/client';
import { useLayoutStore as useGlobalLayoutStore } from '~/shared/stores/layout.store';
import { extractErrorMessage, handleError } from '~/shared/utils/errorHandler';
import {
  featureDedupeKey,
  geometryToWkt,
  validateForm,
  type ExtendedLabel,
  type FormValues,
  type GeometryType,
} from './campaign/annotation';
import { resolveLabelStyle, toDraftStyleSpec, toStyleSpec } from './campaign/labelStyle';
import { ANNOTATION_LAYER_ID, vectorLayerId } from './map/compose';
import type { Bbox, BoxHit, DrawShape, InteractionSpec, MapClickEvent } from './map/types';
import { campaignState, formFields, useCampaignStore, useLabels } from './stores/campaign';
import { useImageryStore } from './stores/imagery';
import { usePrefsStore } from './stores/prefs';
import { useWorkStore } from './stores/work';

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

export function annotationBody(
  geometry: GeoJSON.Geometry,
  labelId: number,
  formValues: FormValues
): AnnotationCreate {
  return {
    label_id: labelId,
    comment: null,
    geometry_wkt: geometryToWkt(geometry),
    confidence: null,
    // An empty answer set is "no answers given", not "all answers cleared".
    form_values: Object.keys(formValues).length ? formValues : null,
  };
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
  const bodies = geometries.map((geometry) => annotationBody(geometry, labelId, work.formValues));
  try {
    if (bodies.length === 1) {
      await createAnnotationOpenmode({ path: { campaign_id: campaignId }, body: bodies[0] });
      return { kind: 'saved', count: 1 };
    }
    // One request and one transaction for the set: labelling hundreds of
    // vector features must not be hundreds of round trips.
    const result = await batchCreateAnnotations({
      path: { campaign_id: campaignId },
      body: { annotations: bodies },
    });
    return { kind: 'saved', count: result.data?.created_count ?? bodies.length };
  } catch (error) {
    return { kind: 'error', message: extractErrorMessage(error) };
  }
}

function reportLabelOutcome(outcome: LabelOutcome): void {
  if (outcome.kind === 'blocked') alert(`Missing required: ${outcome.missing.join(', ')}`, 'error');
  else if (outcome.kind === 'error') alert(`Failed to label features: ${outcome.message}`, 'error');
  else if (outcome.kind === 'saved') {
    useWorkStore.getState().bumpVersion();
    alert(`Labeled ${outcome.count} feature(s)`, 'success');
  }
}

// ---------------------------------------------------------------------------
// Editing saved annotations
// ---------------------------------------------------------------------------

/** Save the dragged geometry. Label, comment and answers come from the open
 *  session so a detail edit saved a moment ago is not written back stale. The
 *  answers are only sent when there are some: `null` is a write value (clear
 *  them), and this is a geometry edit. */
export async function commitEdit(): Promise<boolean> {
  const work = useWorkStore.getState();
  const edit = work.edit;
  if (!edit || !edit.pending || edit.busy) return false;

  work.setEditBusy(true);
  try {
    const answers = edit.annotation.form_values ?? {};
    const result = await updateAnnotationOpenmode({
      path: { campaign_id: campaignState().campaign.id, annotation_id: edit.annotation.id },
      body: {
        label_id: edit.annotation.label_id,
        comment: edit.annotation.comment ?? null,
        geometry_wkt: geometryToWkt(edit.pending),
        is_authoritative: null,
        ...(Object.keys(answers).length ? { form_values: answers } : {}),
      },
    });
    if (result.data) work.setEditAnnotation(result.data);
    work.bumpVersion();
    work.clearEdit();
    alert('Annotation updated successfully', 'success');
    return true;
  } catch (error) {
    useWorkStore.getState().setEditBusy(false);
    handleError(error, 'Could not save the geometry');
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
    work.bumpVersion();
    alert(ids.length === 1 ? 'Annotation deleted' : `Deleted ${ids.length} annotations`, 'success');
    return ids.length;
  } catch (error) {
    handleError(error, 'Could not delete');
    return 0;
  }
}

/** Shift+drag with the edit tool. The ids come from the server because the
 *  geometry never leaves it; the map highlights them from the selection. */
async function selectInBox(bbox: Bbox): Promise<void> {
  try {
    const result = await getAnnotationIdsInBbox({
      path: { campaign_id: campaignState().campaign.id },
      query: { bbox: bbox.join(',') },
    });
    const work = useWorkStore.getState();
    work.clearEdit();
    work.setSelection((result.data ?? []).map(Number).filter(Number.isFinite));
  } catch (error) {
    handleError(error, 'Box selection failed');
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
    alert('The previous annotation could not be saved - retry or discard it first.', 'error');
    return;
  }

  useWorkStore.getState().beginDraft(labelId);
  if ((await useWorkStore.getState().drawEnd(geometry)) === 'save-failed') {
    alert('Could not save the annotation - retry or discard it in the panel.', 'error');
  }
}

/** A click on the map, routed by tool. */
export async function handleMapClick(event: MapClickEvent): Promise<void> {
  // Shift belongs to the box gestures; a click that ends one is not a click.
  if (event.shiftKey) return;
  const work = useWorkStore.getState();

  if (work.tool === 'timeseries') {
    work.setProbePoint(event.lonLat);
    work.completeProbe();
    return;
  }

  if (work.tool === 'edit') {
    const editingId = work.edit?.annotation.id ?? null;
    if (event.layerId === ANNOTATION_LAYER_ID && event.featureId != null) {
      const clicked = Number(event.featureId);
      if (clicked !== editingId) await work.openEdit(clicked);
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

/** Publishes the interaction spec for the active tool. Mounted once. */
export function useDrawingInteractions(): void {
  const isExplore = useCampaignStore((s) => s.workMode === 'explore');
  const tool = useWorkStore((s) => s.tool);
  const selectedLabelId = useWorkStore((s) => s.selectedLabelId);
  const edit = useWorkStore((s) => s.edit);
  const setInteractions = useWorkStore((s) => s.setInteractions);
  const labelStyles = usePrefsStore((s) => s.labelStyles);
  const vector = useImageryStore((s) => s.vector);
  const labels = useLabels();

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
  // emphasised the way a selected annotation is.
  const editLabelId = edit?.annotation.label_id ?? null;
  const editStyle = useMemo(() => {
    const editLabel = byId(editLabelId);
    return toStyleSpec(
      resolveLabelStyle(
        editLabel?.color ?? '#3b82f6',
        editLabel?.geometry_type ?? 'polygon',
        editLabelId === null ? undefined : labelStyles[editLabelId]
      ),
      { selected: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels, editLabelId, labelStyles]);

  const onMapClick = useCallback((event: MapClickEvent) => void handleMapClick(event), []);

  const spec = useMemo<InteractionSpec | undefined>(() => {
    // Tasks mode has no drawing tools: its map is the task's.
    if (!isExplore) return undefined;

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
      if (!edit) return { boxSelect };
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
  }, [isExplore, tool, label, sketchStyle, edit?.annotation.id, edit?.geometry, editStyle, vector]);

  useEffect(() => {
    setInteractions(spec, isExplore ? onMapClick : undefined);
  }, [spec, onMapClick, isExplore, setInteractions]);

  useEffect(() => () => useWorkStore.getState().setInteractions(undefined, undefined), []);
}
