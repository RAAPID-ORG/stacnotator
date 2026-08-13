import { create } from 'zustand';
import { getAnnotation, updateAnnotationOpenmode, type AnnotationOut } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';
import { wktToGeometry } from '~/features/annotation/core/annotation';
import { useWorkStore } from '~/features/annotation/stores';

export interface EditSessionState {
  annotation: AnnotationOut | null;
  /** The saved geometry, i.e. what the edit interaction starts from. Kept
   *  stable while dragging: feeding a moving geometry back as interaction
   *  config would tear the interaction down mid-drag. */
  geometry: GeoJSON.Geometry | null;
  /** Where the user has dragged it, awaiting confirmation. */
  pending: GeoJSON.Geometry | null;
  busy: boolean;
}

const empty: EditSessionState = { annotation: null, geometry: null, pending: null, busy: false };

export const useEditSession = create<EditSessionState>(() => empty);

export function getEditSession(): EditSessionState {
  return useEditSession.getState();
}

/** Drops the session and the ids other features read it by. */
export function clearEditSession(): void {
  useEditSession.setState(empty, true);
  const work = useWorkStore.getState();
  work.setEditingId(null);
  work.setSelection([]);
}

/**
 * Open one annotation for editing. Its full-resolution geometry only exists on
 * the server (the map shows tiles), so the record is fetched once here and
 * both features read it from this store afterwards.
 */
export async function openEdit(campaignId: number, annotationId: number): Promise<void> {
  try {
    const result = await getAnnotation({
      path: { campaign_id: campaignId, annotation_id: annotationId },
    });
    const annotation = result.data;
    if (!annotation) return;
    useEditSession.setState(
      {
        annotation,
        geometry: wktToGeometry(annotation.geometry.geometry),
        pending: null,
        busy: false,
      },
      true
    );
    const work = useWorkStore.getState();
    work.setEditingId(annotationId);
    work.setSelection([annotationId]);
  } catch (error) {
    handleError(error, 'Could not open the annotation for editing');
  }
}

/** The record after a write, so the next write does not send stale fields. */
export function setEditAnnotation(annotation: AnnotationOut): void {
  useEditSession.setState({ annotation });
}

export function setPendingGeometry(geometry: GeoJSON.Geometry | null): void {
  useEditSession.setState({ pending: geometry });
}

export function setEditBusy(busy: boolean): void {
  useEditSession.setState({ busy });
}

/**
 * Flag (or unflag) the open annotation for review. Saves immediately - both
 * the checkbox in the panel and the F hotkey call this, so there is one
 * request shape and one refreshed record.
 */
export async function saveAnnotationFlag(
  campaignId: number,
  flagged: boolean,
  comment: string | null
): Promise<void> {
  const { annotation } = getEditSession();
  if (!annotation) return;

  // Optimistic: the checkbox must not lag the click.
  setEditAnnotation({
    ...annotation,
    flagged_for_review: flagged,
    flag_comment: flagged ? comment : null,
  });
  try {
    const result = await updateAnnotationOpenmode({
      path: { campaign_id: campaignId, annotation_id: annotation.id },
      body: {
        label_id: annotation.label_id,
        comment: annotation.comment ?? null,
        geometry_wkt: null,
        is_authoritative: null,
        flagged_for_review: flagged,
        flag_comment: flagged ? comment : null,
      },
    });
    if (result.data) setEditAnnotation(result.data);
  } catch (error) {
    setEditAnnotation(annotation);
    handleError(error, 'Could not update the flag');
  }
}
