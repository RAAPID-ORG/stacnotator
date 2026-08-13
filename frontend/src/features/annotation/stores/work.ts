import { create } from 'zustand';
import {
  createAnnotationOpenmode,
  getAnnotation,
  updateAnnotationOpenmode,
  type AnnotationOut,
} from '~/api/client';
import { useLayoutStore as useGlobalLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import { geometryToWkt, validateForm, wktToGeometry, type FormValues } from '../domain/annotation';
import type { InteractionSpec, LonLat, MapClickEvent } from '../map/types';
import { campaignState, formFields, useCampaignStore } from './campaign';

export type Tool = 'pan' | 'annotate' | 'edit' | 'labelVector' | 'timeseries';

/**
 * A shape being drawn. `sketching` means the tool is armed, `draft` means the
 * shape exists but its answers are outstanding, `committing` means a save is
 * in flight - which is also what makes a second, concurrent commit a no-op.
 */
export type Draft =
  | { phase: 'idle' }
  | { phase: 'sketching'; labelId: number }
  | { phase: 'draft'; labelId: number; geometry: GeoJSON.Geometry }
  | { phase: 'committing'; labelId: number; geometry: GeoJSON.Geometry };

/** One annotation opened for editing. Its full-resolution geometry only
 *  exists on the server (the map shows tiles), so the record is fetched once
 *  and read from here afterwards. */
export interface EditSession {
  annotation: AnnotationOut;
  /** The saved geometry the edit interaction starts from. Held stable during
   *  a drag: feeding a moving geometry back as config would tear the
   *  interaction down mid-drag. */
  geometry: GeoJSON.Geometry;
  /** Where the user has dragged it, awaiting confirmation. */
  pending: GeoJSON.Geometry | null;
  busy: boolean;
}

/** `drafted` = the shape is waiting on answers; `nothing` = there was no draft. */
export type SaveOutcome = 'saved' | 'save-failed' | 'drafted' | 'discarded' | 'nothing';

interface WorkState {
  tool: Tool;
  selectedLabelId: number | null;
  comment: string;
  confidence: number | null;
  flagged: boolean;
  flagComment: string;
  formValues: FormValues;
  activeFieldIndex: number | null;

  draft: Draft;
  selection: number[];
  edit: EditSession | null;

  /** Bumped after every write so the annotation tiles are refetched. */
  version: number;
  /** Draw/edit/box-select config the map applies, published by the tool. */
  interactions: InteractionSpec | undefined;
  onMapClick: ((e: MapClickEvent) => void) | undefined;
  /** Where the timeseries tool last probed, drawn as the probe marker. */
  probePoint: LonLat | null;
  /** The chart legend hid every series for the probe point, so its on-map
   *  marker is meaningless and comes off too. */
  probeMarkerHidden: boolean;

  setSelectedLabelId: (id: number | null) => void;
  setComment: (comment: string) => void;
  setConfidence: (confidence: number | null) => void;
  setFlagged: (flagged: boolean) => void;
  setFlagComment: (comment: string) => void;
  setFormValues: (values: FormValues) => void;
  setActiveFieldIndex: (index: number | null) => void;
  setSelection: (ids: number[]) => void;
  setInteractions: (
    spec: InteractionSpec | undefined,
    onMapClick?: (e: MapClickEvent) => void
  ) => void;
  setProbePoint: (point: LonLat | null) => void;
  setProbeMarkerHidden: (hidden: boolean) => void;
  setPendingGeometry: (geometry: GeoJSON.Geometry | null) => void;
  setEditAnnotation: (annotation: AnnotationOut) => void;
  setEditBusy: (busy: boolean) => void;
  bumpVersion: () => void;
  resetForm: () => void;
  /** Back to first-load state. Drops the open draft, the selection and the
   *  edit too: they name records in one campaign, so carrying them into
   *  another would commit a shape drawn on the last campaign's map. */
  resetAll: () => void;

  /** Pick the label the next gesture applies. Picking one is how drawing
   *  starts, so it arms the annotate tool - except in label-vector mode,
   *  where the label applies to the features being clicked. */
  selectLabel: (labelId: number) => void;
  selectTool: (tool: Tool) => Promise<void>;
  /** Tasks mode has no tool palette to switch away with, so the probe button
   *  and its key toggle rather than latch. */
  toggleProbeTool: () => void;
  /** Finish the one-shot probe without clearing the point it just produced:
   *  the chart and the marker must stay visible after the cursor returns to
   *  navigation. */
  completeProbe: () => void;

  beginDraft: (labelId: number) => void;
  /** A shape finished drawing. With no fields there is nothing to ask, so it
   *  saves immediately; with fields it becomes a draft awaiting answers. */
  drawEnd: (geometry: GeoJSON.Geometry) => Promise<SaveOutcome>;
  editDraftGeometry: (geometry: GeoJSON.Geometry) => void;
  /** Save the open draft. Refuses outside the `draft` phase and while a
   *  required field is unanswered, so saving cannot store less than closing. */
  commitDraft: () => Promise<boolean>;
  /** Resolve the draft the way leaving the tool or Escape does: save when
   *  complete, discard when not. */
  closeDraft: () => Promise<SaveOutcome>;

  openEdit: (annotationId: number) => Promise<void>;
  clearEdit: () => void;
  /** Flag or unflag the open annotation, saving immediately so the checkbox
   *  and the F key share one request shape. */
  saveEditFlag: (flagged: boolean, comment: string | null) => Promise<void>;
}

const emptyForm = {
  selectedLabelId: null as number | null,
  comment: '',
  confidence: null as number | null,
  flagged: false,
  flagComment: '',
  formValues: {} as FormValues,
  activeFieldIndex: null as number | null,
};

const alert = (message: string, kind: 'error' | 'success') =>
  useGlobalLayoutStore.getState().showAlert(message, kind);

export const useWorkStore = create<WorkState>((set, get) => {
  /** Never throws: the caller decides what a failed save means. */
  const persist = async (labelId: number, geometry: GeoJSON.Geometry): Promise<boolean> => {
    const { comment, confidence, flagged, flagComment, formValues } = get();
    try {
      await createAnnotationOpenmode({
        path: { campaign_id: campaignState().campaign.id },
        body: {
          label_id: labelId,
          comment: comment || null,
          geometry_wkt: geometryToWkt(geometry),
          confidence,
          form_values: Object.keys(formValues).length ? formValues : null,
          flagged_for_review: flagged,
          flag_comment: flagged ? flagComment || null : null,
        },
      });
      return true;
    } catch {
      return false;
    }
  };

  /** The one commit path. A failure leaves the shape as a retryable `draft`
   *  rather than dropping it. */
  const commit = async (labelId: number, geometry: GeoJSON.Geometry): Promise<boolean> => {
    const committing: Draft = { phase: 'committing', labelId, geometry };
    set({ draft: committing });
    const ok = await persist(labelId, geometry);
    set((s) => {
      // A save takes a round trip and the user can draw the next shape inside
      // it. Whatever they started since is theirs; resolving onto it would
      // wipe the new draft.
      if (s.draft !== committing) return {};
      return {
        draft: ok ? { phase: 'idle' } : { phase: 'draft', labelId, geometry },
        // Only the answers clear. Label, comment, confidence and flags are the
        // annotator's current settings, not this shape's - clearing them would
        // disarm the tool after every shape.
        ...(ok ? { formValues: {}, activeFieldIndex: null } : {}),
      };
    });
    if (ok) get().bumpVersion();
    return ok;
  };

  return {
    ...emptyForm,
    tool: 'pan',
    draft: { phase: 'idle' },
    selection: [],
    edit: null,
    version: 0,
    interactions: undefined,
    onMapClick: undefined,
    probePoint: null,
    probeMarkerHidden: false,

    setSelectedLabelId: (selectedLabelId) => set({ selectedLabelId }),
    setComment: (comment) => set({ comment }),
    setConfidence: (confidence) => set({ confidence }),
    setFlagged: (flagged) => set((s) => ({ flagged, flagComment: flagged ? s.flagComment : '' })),
    setFlagComment: (flagComment) => set({ flagComment }),
    setFormValues: (formValues) => set({ formValues }),
    setActiveFieldIndex: (activeFieldIndex) => set({ activeFieldIndex }),
    setSelection: (selection) => set({ selection }),
    setInteractions: (interactions, onMapClick) => set({ interactions, onMapClick }),
    setProbePoint: (probePoint) => set({ probePoint }),
    setProbeMarkerHidden: (probeMarkerHidden) => set({ probeMarkerHidden }),
    setPendingGeometry: (pending) => set((s) => (s.edit ? { edit: { ...s.edit, pending } } : {})),
    setEditAnnotation: (annotation) =>
      set((s) => (s.edit ? { edit: { ...s.edit, annotation } } : {})),
    setEditBusy: (busy) => set((s) => (s.edit ? { edit: { ...s.edit, busy } } : {})),
    bumpVersion: () => set((s) => ({ version: s.version + 1 })),
    resetForm: () => set({ ...emptyForm }),

    resetAll: () =>
      set({
        ...emptyForm,
        tool: 'pan',
        draft: { phase: 'idle' },
        selection: [],
        edit: null,
        version: 0,
        interactions: undefined,
        onMapClick: undefined,
        probePoint: null,
        probeMarkerHidden: false,
      }),

    selectLabel: (labelId) => {
      set({ selectedLabelId: labelId });
      const { tool } = get();
      if (tool !== 'annotate' && tool !== 'labelVector') void get().selectTool('annotate');
    },

    selectTool: async (tool) => {
      const draftWasOpen = get().draft.phase === 'draft';
      // The tool changes first: the pointer must not lag a click behind the
      // button. Resolving the draft afterwards is what Escape does too.
      set({ tool });

      // Dropping the label on pan is Explore's "stop drawing". In Tasks the
      // selected label is the answer waiting to be submitted, not a draw arm.
      if (tool === 'pan' && campaignState().workMode === 'explore') set({ selectedLabelId: null });
      if (tool !== 'timeseries') set({ probePoint: null });
      // An unsaved drag would otherwise stay hidden in the tiles with nothing
      // on screen to confirm or cancel it.
      if (tool !== 'edit') get().clearEdit();

      if (tool !== 'annotate' && draftWasOpen) {
        // Parking the draft is only half the recovery: without a word the user
        // sees the tool change and assumes the annotation went with it.
        if ((await get().closeDraft()) === 'save-failed') {
          alert(
            'Could not save the open annotation - it is still in the panel, retry there.',
            'error'
          );
        }
      }
    },

    toggleProbeTool: () =>
      void get().selectTool(get().tool === 'timeseries' ? 'pan' : 'timeseries'),

    completeProbe: () => {
      if (get().tool !== 'timeseries') return;
      set({ tool: 'pan' });
      if (campaignState().workMode === 'explore') set({ selectedLabelId: null });
    },

    beginDraft: (labelId) =>
      set({ ...emptyForm, draft: { phase: 'sketching', labelId }, selectedLabelId: labelId }),

    drawEnd: async (geometry) => {
      const { draft } = get();
      if (draft.phase !== 'sketching') return 'nothing';
      const fields = formFields();
      if (fields.length > 0) {
        set({
          draft: { phase: 'draft', labelId: draft.labelId, geometry },
          activeFieldIndex: fields[0]?.required ? 0 : null,
        });
        return 'drafted';
      }
      return (await commit(draft.labelId, geometry)) ? 'saved' : 'save-failed';
    },

    editDraftGeometry: (geometry) =>
      set((s) => (s.draft.phase === 'draft' ? { draft: { ...s.draft, geometry } } : {})),

    commitDraft: async () => {
      const { draft, formValues } = get();
      if (draft.phase !== 'draft') return false;
      if (!validateForm(formFields(), formValues).ok) return false;
      return commit(draft.labelId, draft.geometry);
    },

    closeDraft: async () => {
      const { draft, formValues } = get();
      if (draft.phase !== 'draft') return 'nothing';
      // An open-mode annotation cannot be stored incomplete, so an unanswered
      // draft is thrown away rather than left half-filled.
      if (!validateForm(formFields(), formValues).ok) {
        set({ draft: { phase: 'idle' }, formValues: {}, activeFieldIndex: null });
        return 'discarded';
      }
      return (await commit(draft.labelId, draft.geometry)) ? 'saved' : 'save-failed';
    },

    openEdit: async (annotationId) => {
      try {
        const result = await getAnnotation({
          path: { campaign_id: campaignState().campaign.id, annotation_id: annotationId },
        });
        const annotation = result.data;
        if (!annotation) return;
        set({
          edit: {
            annotation,
            geometry: wktToGeometry(annotation.geometry.geometry),
            pending: null,
            busy: false,
          },
          selection: [annotationId],
        });
      } catch (error) {
        handleError(error, 'Could not open the annotation for editing');
      }
    },

    clearEdit: () => set({ edit: null, selection: [] }),

    saveEditFlag: async (flagged, comment) => {
      const { edit } = get();
      if (!edit) return;
      const { annotation } = edit;

      // Optimistic: the checkbox must not lag the click.
      get().setEditAnnotation({
        ...annotation,
        flagged_for_review: flagged,
        flag_comment: flagged ? comment : null,
      });
      try {
        const result = await updateAnnotationOpenmode({
          path: { campaign_id: campaignState().campaign.id, annotation_id: annotation.id },
          body: {
            label_id: annotation.label_id,
            comment: annotation.comment ?? null,
            geometry_wkt: null,
            is_authoritative: null,
            flagged_for_review: flagged,
            flag_comment: flagged ? comment : null,
          },
        });
        if (result.data) get().setEditAnnotation(result.data);
      } catch (error) {
        get().setEditAnnotation(annotation);
        handleError(error, 'Could not update the flag');
      }
    },
  };
});

/** The annotation being edited, which is also the one drawn locally instead of
 *  from the tiles. */
export const useEditingId = (): number | null => useWorkStore((s) => s.edit?.annotation.id ?? null);

/** Tile cache buster: the campaign's stored version plus this session's writes. */
export function useTileVersion(): number {
  const stored = useCampaignStore((s) => s.campaign?.annotations_version ?? 0);
  return stored + useWorkStore((s) => s.version);
}
