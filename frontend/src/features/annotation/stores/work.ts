import { create } from 'zustand';
import { createAnnotationOpenmode } from '~/api/client';
import type { FormField, FormValues } from '~/features/annotation/core/apiTypes';
import {
  beginSketch,
  close as closeDraftMachine,
  commitRequested,
  commitResolved,
  drawEnd as drawEndMachine,
  edit as editDraftMachine,
  geometryToWkt,
  idleDraft,
  type DraftState,
} from '~/features/annotation/core/annotation';

type OpenDraft = Extract<DraftState, { phase: 'draft' }>;

/** Outcome of drawEnd: 'drafted' when fields need answers, 'saved'/
 *  'save-failed' for the immediate-save (no fields) case, 'noop' when
 *  called outside the 'sketching' phase. */
export type DrawEndOutcome = 'drafted' | 'saved' | 'save-failed' | 'noop';
/** Outcome of closeDraft: 'nothing' when there was no open draft,
 *  'discarded' for an incomplete draft, 'saved'/'save-failed' for a
 *  complete one. */
export type CloseDraftOutcome = 'nothing' | 'discarded' | 'saved' | 'save-failed';

export interface WorkState {
  selectedLabelId: number | null;
  comment: string;
  confidence: number | null;
  flagged: boolean;
  flagComment: string;
  formValues: FormValues;
  activeFieldIndex: number | null;
  draft: DraftState;
  selection: number[];
  editingId: number | null;

  setSelectedLabelId: (id: number | null) => void;
  setComment: (comment: string) => void;
  setConfidence: (confidence: number | null) => void;
  setFlagged: (flagged: boolean) => void;
  setFlagComment: (comment: string) => void;
  setFormValues: (values: FormValues) => void;
  setActiveFieldIndex: (index: number | null) => void;
  setSelection: (ids: number[]) => void;
  setEditingId: (id: number | null) => void;
  resetForm: () => void;
  /** Everything this store holds, back to first-load state. Unlike
   *  `resetForm` this also drops the open draft, the selection and the
   *  annotation being edited - they name records in one campaign, so
   *  carrying them into another one would commit a shape drawn on the last
   *  campaign's map, or edit an id that means something else now. */
  resetAll: () => void;

  /** Arm the draft machine for a new sketch (label chosen, drawing started). */
  beginDraft: (labelId: number) => void;
  /** The sketch finished drawing. With required fields, opens a draft
   *  awaiting answers. With none, there is nothing to ask, so this commits
   *  immediately through the same revert-on-failure path as commitDraft -
   *  a failed save leaves the shape as a retryable 'draft' rather than
   *  dropping it (draftMachine's own `next` for this case is idle; that
   *  transition is not applied here for exactly that reason). */
  drawEnd: (
    campaignId: number,
    geometry: GeoJSON.Geometry,
    fields: FormField[]
  ) => Promise<DrawEndOutcome>;
  /** Update an open draft's geometry (e.g. a vertex drag before saving). */
  editDraftGeometry: (geometry: GeoJSON.Geometry) => void;
  /** Commit the open draft. No-op (returns false) outside the 'draft' phase -
   *  including a second call made while the first is still 'committing',
   *  which is how concurrent commits are ignored. On failure, reverts to
   *  'draft' with the same labelId/geometry so the caller can retry. */
  commitDraft: (campaignId: number) => Promise<boolean>;
  /** Resolve an open draft the way leaving the tool / Escape does: save when
   *  every required field is answered, discard otherwise. 'nothing' when
   *  there is nothing open. A failed save reverts to 'draft' (same as
   *  commitDraft) rather than discarding - close()'s own idle transition is
   *  not applied on that path for exactly that reason. */
  closeDraft: (campaignId: number, fields: FormField[]) => Promise<CloseDraftOutcome>;
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

export const useWorkStore = create<WorkState>((set, get) => {
  /** Builds the same AnnotationCreate body from whatever the form fields
   *  currently hold and calls createAnnotationOpenmode. Never throws. */
  const persistDraft = async (
    campaignId: number,
    labelId: number,
    geometry: GeoJSON.Geometry
  ): Promise<boolean> => {
    const { comment, confidence, flagged, flagComment, formValues } = get();
    try {
      await createAnnotationOpenmode({
        path: { campaign_id: campaignId },
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

  /** The one commit path every persisting action shares: move `open` to
   *  'committing', persist, then resolve - success clears the answers and the
   *  draft; failure reverts to 'draft' with the same labelId/geometry
   *  (commitResolved's own failure behaviour) so nothing is lost. */
  const commitFrom = async (campaignId: number, open: OpenDraft): Promise<boolean> => {
    const committing = commitRequested(open);
    set({ draft: committing });
    const ok = await persistDraft(campaignId, open.labelId, open.geometry);
    set((s) => {
      // A save takes a network round trip, and the user can draw the next
      // shape inside it. Whatever they have started since is theirs: resolving
      // onto it would wipe the new draft's answers (on success) or replace it
      if (s.draft !== committing) return {};
      return {
        draft: commitResolved(s.draft, ok ? 'success' : 'failure'),
        // answers and the field focus. The label, comment, confidence and flags
        // are the annotator's current settings, not this shape's - clearing them
        // would disarm the drawing tool after every single shape.
        ...(ok ? { formValues: {}, activeFieldIndex: null } : {}),
      };
    });
    return ok;
  };

  return {
    ...emptyForm,
    draft: idleDraft,
    selection: [],
    editingId: null,

    setSelectedLabelId: (id) => set({ selectedLabelId: id }),
    setComment: (comment) => set({ comment }),
    setConfidence: (confidence) => set({ confidence }),
    setFlagged: (flagged) => set((s) => ({ flagged, flagComment: flagged ? s.flagComment : '' })),
    setFlagComment: (flagComment) => set({ flagComment }),
    setFormValues: (formValues) => set({ formValues }),
    setActiveFieldIndex: (activeFieldIndex) => set({ activeFieldIndex }),
    setSelection: (selection) => set({ selection }),
    setEditingId: (editingId) => set({ editingId }),
    resetForm: () => set({ ...emptyForm }),
    resetAll: () => set({ ...emptyForm, draft: idleDraft, selection: [], editingId: null }),

    beginDraft: (labelId) =>
      set({ draft: beginSketch(labelId), ...emptyForm, selectedLabelId: labelId }),

    drawEnd: async (campaignId, geometry, fields) => {
      const { draft } = get();
      const { next, action } = drawEndMachine(draft, geometry, fields);
      if (next === draft) return 'noop';
      if (action === 'draft') {
        set({ draft: next, activeFieldIndex: fields[0]?.required ? 0 : null });
        return 'drafted';
      }
      // action === 'save': no fields to answer. Commit through commitFrom
      // rather than applying `next` (idle) directly, so a failed persist
      // reverts to a retryable 'draft' instead of silently dropping the shape.
      const labelId = (draft as Extract<DraftState, { phase: 'sketching' }>).labelId;
      const ok = await commitFrom(campaignId, { phase: 'draft', labelId, geometry });
      return ok ? 'saved' : 'save-failed';
    },

    editDraftGeometry: (geometry) => set((s) => ({ draft: editDraftMachine(s.draft, geometry) })),

    commitDraft: async (campaignId) => {
      const { draft } = get();
      if (draft.phase !== 'draft') return false; // not open, or already 'committing'
      return commitFrom(campaignId, draft);
    },

    closeDraft: async (campaignId, fields) => {
      const { draft, formValues } = get();
      const { next, action } = closeDraftMachine(draft, fields, formValues);
      if (next === draft) return 'nothing';
      if (action === 'discard') {
        set({ draft: next, formValues: {}, activeFieldIndex: null });
        return 'discarded';
      }
      // action === 'save': close() confirmed every required field is
      // answered. Commit through commitFrom rather than applying `next`
      // (idle) directly, so a failed persist reverts to a retryable 'draft'
      // instead of discarding the annotation.
      const { labelId, geometry } = draft as Extract<DraftState, { phase: 'draft' }>;
      const ok = await commitFrom(campaignId, { phase: 'draft', labelId, geometry });
      return ok ? 'saved' : 'save-failed';
    },
  };
});
