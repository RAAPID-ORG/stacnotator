import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import {
  createAnnotationOpenmode,
  getAnnotation,
  getAnnotationChanges,
  updateAnnotationOpenmode,
  type AnnotationOut,
} from '~/api/client';
import { useLayoutStore as useGlobalLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import {
  extendedLabels,
  geometryToWkt,
  geometryTopRight,
  validateForm,
  wktToGeometry,
  type FormValues,
} from '../campaign/annotation';
import {
  deltaIds,
  deltaWrites,
  emptyDelta,
  pendingCount,
  rotate,
  TILE_REFRESH_AFTER,
  withDeletes,
  withWrites,
  type AnnotationDelta,
  type DeltaWrite,
} from '../campaign/annotationDelta';
import type { SliceAddress } from '../campaign/imageryNav';
import {
  listNotes,
  toNotes,
  withNote,
  type SliceComment,
  type SliceNotes,
} from '../campaign/sliceComments';
import type { SavedAnnotations } from '../map/compose';
import type { LonLat } from '~/shared/map/types';
import { campaignState, formFields, useCampaignStore } from './campaign';
import { useImageryStore } from './imagery';
import { usePrefsStore } from './prefs';

export type Tool = 'pan' | 'annotate' | 'edit' | 'labelVector' | 'timeseries';

/**
 * A shape being drawn. `sketching` means the tool is armed, `draft` means the
 * shape exists but its answers are outstanding, `committing` means a save is
 * in flight - which is also what makes a second, concurrent commit a no-op.
 *
 * `savedId` is the annotation a draft was already stored as: with nothing
 * required outstanding the shape is written the moment it is drawn, so it
 * cannot be lost, and the answers reach it as an update.
 */
export type Draft =
  | { phase: 'idle' }
  | { phase: 'sketching'; labelId: number }
  | { phase: 'draft'; labelId: number; geometry: GeoJSON.Geometry; savedId: number | null }
  | { phase: 'committing'; labelId: number; geometry: GeoJSON.Geometry; savedId: number | null };

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

/** Beyond a handful the chart is unreadable and every probe costs a fetch
 *  per series. */
export const MAX_PROBES = 6;

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
  /** Per-slice notes drafted onto the next save. An annotation opened for
   *  editing keeps its own instead - see `useSliceNotes`. */
  sliceNotes: SliceNotes;
  /** The slice whose note dialog is open, or null. */
  commenting: SliceAddress | null;

  draft: Draft;
  selection: number[];
  /** Where the selection's on-map controls sit: the top-right of the geometry
   *  being edited, or of the box that selected many. */
  selectionAnchor: LonLat | null;
  edit: EditSession | null;

  /** Tile refreshes this session, added to the campaign's stored version to
   *  make the tile URL: changing that URL is what a refresh is. */
  tileRefreshes: number;
  /** Writes the tiles do not show yet: this session's, and other annotators'
   *  as the poll picks them up. */
  delta: AnnotationDelta;
  /** Database clock the next poll asks for changes since, from the last one. */
  syncCursor: string | null;
  /** Everywhere the timeseries tool has probed, drawn as numbered markers and
   *  charted side by side. Ordered oldest first, capped at MAX_PROBES so the
   *  chart stays readable and one click cannot fan out into a dozen fetches. */
  probePoints: LonLat[];
  /** The probe a map click moves. Comparing places means dropping a few and
   *  then adjusting one of them, so moving is the default and adding is the
   *  deliberate act. */
  activeProbe: number | null;
  /** The next map click drops a new probe instead of moving the active one.
   *  One-shot: armed from the + control, spent on the click after it. */
  probeAddArmed: boolean;
  /** The chart legend hid every probe series, so the on-map markers are
   *  meaningless and come off too. */
  probeMarkerHidden: boolean;

  setSelectedLabelId: (id: number | null) => void;
  setComment: (comment: string) => void;
  setConfidence: (confidence: number | null) => void;
  setFlagged: (flagged: boolean) => void;
  setFlagComment: (comment: string) => void;
  setFormValues: (values: FormValues) => void;
  setActiveFieldIndex: (index: number | null) => void;
  setSliceNotes: (notes: SliceNotes) => void;
  openSliceComment: (address: SliceAddress) => void;
  closeSliceComment: () => void;
  /** Store one slice's note. Saves straight away while an annotation is open
   *  for editing - it has nothing else pending to ride along with - and drafts
   *  it onto the next save otherwise. */
  saveSliceComment: (comment: SliceComment) => Promise<void>;
  setSelection: (ids: number[], anchor: LonLat | null) => void;
  /** A click on the map: move the active probe there, or drop a new one when
   *  there is none yet or the + control armed it. */
  probeAt: (point: LonLat) => void;
  /** Arm (or disarm) "the next click adds a probe", arming the tool with it so
   *  the + control is one press rather than two. */
  armAddProbe: (armed: boolean) => void;
  /** Make this probe the one a map click moves. */
  selectProbePoint: (index: number) => void;
  /** Takes that comparison back off the chart. */
  removeProbePoint: (index: number) => void;
  clearProbePoints: () => void;
  setProbeMarkerHidden: (hidden: boolean) => void;
  setPendingGeometry: (geometry: GeoJSON.Geometry | null) => void;
  setEditAnnotation: (annotation: AnnotationOut) => void;
  setEditBusy: (busy: boolean) => void;
  /** Refresh the annotation tiles, retiring the delta they now carry. The
   *  answer to a write whose id we never learned, and to the delta growing
   *  past what an overlay should draw. */
  refreshTiles: () => void;
  /** Draw these over the tiles until the tiles carry them. */
  recordWrites: (writes: DeltaWrite[]) => void;
  /** Stop drawing these: gone from the database, still in the tiles. */
  recordDeletes: (ids: number[]) => void;
  /** Pick up what other annotators have done since the last poll. */
  syncRemoteAnnotations: () => Promise<void>;
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

  beginDraft: (labelId: number) => void;
  /** A shape finished drawing. Only an unanswered required question holds it
   *  back as a draft; otherwise it is stored right away, with its optional
   *  questions still open for answers. */
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
  sliceNotes: {} as SliceNotes,
};

const alert = (message: string, kind: 'error' | 'success') =>
  useGlobalLayoutStore.getState().showAlert(message, kind);

/**
 * How often other annotators' work is picked up.
 *
 * Sized against the deployment: one backend replica (4 workers, pool 10+10)
 * over a 2-vCore Postgres. A hundred annotators at this interval is 20 polls a
 * second, and a poll that finds nothing costs the database around 0.04 ms - an
 * index seek straight to the window on `(campaign_id, updated_at)` and another
 * on `(campaign_id, deleted_at)`. The request handling around it (auth, the
 * campaign access check) costs more than the query does, and 20 requests a
 * second of that sits far below what the replica serves alongside tiles.
 *
 * Shorter would still be affordable but buys little: at five seconds two people
 * working the same area already see each other before they collide.
 */
const REMOTE_POLL_MS = 5_000;

export const useWorkStore = create<WorkState>((set, get) => {
  /** Record a change the tiles do not have yet, refreshing them instead once
   *  the delta has grown past what an overlay should be drawing. */
  const applyDelta = (change: (delta: AnnotationDelta) => AnnotationDelta) =>
    set((s) => {
      const delta = change(s.delta);
      return pendingCount(delta) >= TILE_REFRESH_AFTER
        ? { delta: rotate(delta), tileRefreshes: s.tileRefreshes + 1 }
        : { delta };
    });

  const recordLocal = (id: number, labelId: number | null, geometry: GeoJSON.Geometry) =>
    applyDelta((d) => withWrites(d, [{ id, labelId, geometry, origin: 'local' }]));

  /** Never throws: the caller decides what a failed save means. */
  const createShape = async (
    labelId: number,
    geometry: GeoJSON.Geometry
  ): Promise<number | null> => {
    const { comment, confidence, flagged, flagComment, formValues, sliceNotes } = get();
    try {
      const result = await createAnnotationOpenmode({
        path: { campaign_id: campaignState().campaign.id },
        body: {
          label_id: labelId,
          comment: comment || null,
          geometry_wkt: geometryToWkt(geometry),
          confidence,
          form_values: Object.keys(formValues).length ? formValues : null,
          flagged_for_review: flagged,
          flag_comment: flagged ? flagComment || null : null,
          slice_comments: listNotes(sliceNotes),
        },
      });
      const id = result.data?.id ?? null;
      if (id !== null) recordLocal(id, labelId, geometry);
      return id;
    } catch {
      return null;
    }
  };

  /** Everything a shape stored on draw gained since. Never throws either. */
  const updateShape = async (
    annotationId: number,
    labelId: number,
    geometry: GeoJSON.Geometry
  ): Promise<boolean> => {
    const { comment, formValues, sliceNotes } = get();
    try {
      await updateAnnotationOpenmode({
        path: { campaign_id: campaignState().campaign.id, annotation_id: annotationId },
        body: {
          label_id: labelId,
          comment: comment || null,
          geometry_wkt: geometryToWkt(geometry),
          is_authoritative: null,
          form_values: formValues,
          slice_comments: listNotes(sliceNotes),
        },
      });
      recordLocal(annotationId, labelId, geometry);
      return true;
    } catch {
      return false;
    }
  };

  /** The one commit path, for a shape being stored and for one already stored.
   *  A failure leaves it as a retryable `draft` rather than dropping it. */
  const commit = async (
    labelId: number,
    geometry: GeoJSON.Geometry,
    savedId: number | null
  ): Promise<boolean> => {
    const committing: Draft = { phase: 'committing', labelId, geometry, savedId };
    set({ draft: committing });
    const ok =
      savedId === null
        ? (await createShape(labelId, geometry)) !== null
        : await updateShape(savedId, labelId, geometry);
    set((s) => {
      // A save takes a round trip and the user can draw the next shape inside
      // it. Whatever they started since is theirs; resolving onto it would
      // wipe the new draft.
      if (s.draft !== committing) return {};
      return {
        draft: ok ? { phase: 'idle' } : { phase: 'draft', labelId, geometry, savedId },
        // Only what this shape said clears - its answers and its slice notes.
        // Label, comment, confidence and flags are the annotator's current
        // settings, not this shape's: clearing them would disarm the tool
        // after every shape.
        ...(ok ? { formValues: {}, activeFieldIndex: null, sliceNotes: {} } : {}),
      };
    });
    return ok;
  };

  /** Store the shape now and keep its questions open. */
  const storeOnDraw = async (labelId: number, geometry: GeoJSON.Geometry): Promise<SaveOutcome> => {
    const committing: Draft = { phase: 'committing', labelId, geometry, savedId: null };
    set({ draft: committing });
    const savedId = await createShape(labelId, geometry);
    set((s) =>
      s.draft === committing ? { draft: { phase: 'draft', labelId, geometry, savedId } } : {}
    );
    if (savedId === null) return 'save-failed';
    return 'saved';
  };

  return {
    ...emptyForm,
    tool: 'pan',
    commenting: null,
    draft: { phase: 'idle' },
    selection: [],
    selectionAnchor: null,
    edit: null,
    tileRefreshes: 0,
    delta: emptyDelta(),
    syncCursor: null,
    probePoints: [],
    activeProbe: null,
    probeAddArmed: false,
    probeMarkerHidden: false,

    setSelectedLabelId: (selectedLabelId) => set({ selectedLabelId }),
    setComment: (comment) => set({ comment }),
    setConfidence: (confidence) => set({ confidence }),
    setFlagged: (flagged) => set((s) => ({ flagged, flagComment: flagged ? s.flagComment : '' })),
    setFlagComment: (flagComment) => set({ flagComment }),
    setFormValues: (formValues) => set({ formValues }),
    setActiveFieldIndex: (activeFieldIndex) => set({ activeFieldIndex }),
    setSliceNotes: (sliceNotes) => set({ sliceNotes }),
    openSliceComment: (commenting) => set({ commenting }),
    closeSliceComment: () => set({ commenting: null }),
    setSelection: (selection, selectionAnchor) => set({ selection, selectionAnchor }),
    // At the cap the oldest probe gives way, so the tool keeps working rather
    // than silently doing nothing.
    probeAt: (point) =>
      set((s) => {
        const adding = s.probeAddArmed || s.probePoints.length === 0 || s.activeProbe === null;
        if (!adding) {
          const probePoints = s.probePoints.map((p, i) => (i === s.activeProbe ? point : p));
          return { probePoints };
        }
        const probePoints = [...s.probePoints, point].slice(-MAX_PROBES);
        return { probePoints, activeProbe: probePoints.length - 1, probeAddArmed: false };
      }),

    armAddProbe: (armed) => {
      set({ probeAddArmed: armed });
      if (armed && get().tool !== 'timeseries') void get().selectTool('timeseries');
    },

    selectProbePoint: (index) =>
      set((s) => (s.probePoints[index] ? { activeProbe: index, probeAddArmed: false } : {})),

    // The active probe follows the list: removing one before it would leave
    // the marker ring on someone else's point.
    removeProbePoint: (index) =>
      set((s) => {
        const probePoints = s.probePoints.filter((_, i) => i !== index);
        if (probePoints.length === 0) return { probePoints, activeProbe: null };
        const active = s.activeProbe ?? probePoints.length - 1;
        return {
          probePoints,
          activeProbe: Math.min(active > index ? active - 1 : active, probePoints.length - 1),
        };
      }),

    clearProbePoints: () => set({ probePoints: [], activeProbe: null, probeAddArmed: false }),
    setProbeMarkerHidden: (probeMarkerHidden) => set({ probeMarkerHidden }),
    setPendingGeometry: (pending) =>
      set((s) =>
        s.edit
          ? {
              edit: { ...s.edit, pending },
              selectionAnchor: pending ? geometryTopRight(pending) : s.selectionAnchor,
            }
          : {}
      ),
    setEditAnnotation: (annotation) =>
      set((s) => (s.edit ? { edit: { ...s.edit, annotation } } : {})),
    setEditBusy: (busy) => set((s) => (s.edit ? { edit: { ...s.edit, busy } } : {})),
    refreshTiles: () =>
      set((s) => ({ tileRefreshes: s.tileRefreshes + 1, delta: rotate(s.delta) })),
    recordWrites: (writes) => applyDelta((d) => withWrites(d, writes)),
    recordDeletes: (ids) => applyDelta((d) => withDeletes(d, ids)),

    syncRemoteAnnotations: async () => {
      try {
        const result = await getAnnotationChanges({
          path: { campaign_id: campaignState().campaign.id },
          query: {
            since: get().syncCursor,
            include_tasks: useImageryStore.getState().showTaskAnnotations,
          },
        });
        const data = result.data;
        if (!data) return;
        set({ syncCursor: data.server_time });
        // More changed than an overlay should carry: the tiles are the cheaper
        // way to catch up on that much work.
        if (data.truncated) {
          get().refreshTiles();
          return;
        }
        const mine = useCampaignStore.getState().currentUserId;
        get().recordWrites(
          data.changes.map((change) => ({
            id: change.id,
            labelId: change.label_id ?? null,
            geometry: wktToGeometry(change.geometry_wkt),
            origin: change.created_by_user_id === mine ? 'local' : 'remote',
          }))
        );
        // After the writes: an annotation created and then deleted inside one
        // poll window arrives as both, and the delete is the later word.
        get().recordDeletes(data.deleted ?? []);
      } catch {
        // A missed poll - or a campaign that unloaded under it - is picked up
        // by the next one.
      }
    },
    resetForm: () => set({ ...emptyForm }),

    resetAll: () =>
      set({
        ...emptyForm,
        tool: 'pan',
        commenting: null,
        draft: { phase: 'idle' },
        selection: [],
        selectionAnchor: null,
        edit: null,
        tileRefreshes: 0,
        delta: emptyDelta(),
        syncCursor: null,
        probePoints: [],
        activeProbe: null,
        probeAddArmed: false,
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

    // Slice notes survive the reset: noticing something about an image and
    // then drawing what it is about is one gesture, and the note belongs to
    // the shape that follows it.
    beginDraft: (labelId) =>
      set((s) => ({
        ...emptyForm,
        sliceNotes: s.sliceNotes,
        draft: { phase: 'sketching', labelId },
        selectedLabelId: labelId,
      })),

    drawEnd: async (geometry) => {
      const { draft } = get();
      if (draft.phase !== 'sketching') return 'nothing';
      const fields = formFields();
      if (fields.length === 0) {
        return (await commit(draft.labelId, geometry, null)) ? 'saved' : 'save-failed';
      }
      // A required question is the only reason to hold a shape back: it cannot
      // be stored without one. Everything else is stored as drawn, so a shape
      // whose optional questions are never answered is not lost.
      if (fields.some((f) => f.required)) {
        set({
          draft: { phase: 'draft', labelId: draft.labelId, geometry, savedId: null },
          activeFieldIndex: fields[0]?.required ? 0 : null,
        });
        return 'drafted';
      }
      return storeOnDraw(draft.labelId, geometry);
    },

    editDraftGeometry: (geometry) =>
      set((s) => (s.draft.phase === 'draft' ? { draft: { ...s.draft, geometry } } : {})),

    commitDraft: async () => {
      const { draft, formValues } = get();
      if (draft.phase !== 'draft') return false;
      if (!validateForm(formFields(), formValues).ok) return false;
      return commit(draft.labelId, draft.geometry, draft.savedId);
    },

    closeDraft: async () => {
      const { draft, formValues, sliceNotes } = get();
      if (draft.phase !== 'draft') return 'nothing';
      if (draft.savedId !== null) {
        // Already stored; only what was answered since is still outstanding.
        if (!Object.keys(formValues).length && !listNotes(sliceNotes).length) {
          set({ draft: { phase: 'idle' }, activeFieldIndex: null });
          return 'saved';
        }
        return (await commit(draft.labelId, draft.geometry, draft.savedId))
          ? 'saved'
          : 'save-failed';
      }
      // An open-mode annotation cannot be stored incomplete, so an unanswered
      // draft is thrown away rather than left half-filled.
      if (!validateForm(formFields(), formValues).ok) {
        set({ draft: { phase: 'idle' }, formValues: {}, activeFieldIndex: null });
        return 'discarded';
      }
      return (await commit(draft.labelId, draft.geometry, null)) ? 'saved' : 'save-failed';
    },

    openEdit: async (annotationId) => {
      try {
        const result = await getAnnotation({
          path: { campaign_id: campaignState().campaign.id, annotation_id: annotationId },
        });
        const annotation = result.data;
        if (!annotation) {
          // Someone deleted it between our last poll and this click. The click
          // is how we found out, so it is also where we stop drawing it.
          if (result.response.status === 404) get().recordDeletes([annotationId]);
          return;
        }
        const geometry = wktToGeometry(annotation.geometry.geometry);
        set({
          edit: { annotation, geometry, pending: null, busy: false },
          selection: [annotationId],
          selectionAnchor: geometryTopRight(geometry),
        });
      } catch (error) {
        handleError(error, 'Could not open the annotation for editing');
      }
    },

    // A click on empty map clears whether or not anything was open, so this
    // stays a no-op when there is nothing to clear rather than handing every
    // subscriber a fresh empty selection.
    clearEdit: () =>
      set((s) =>
        s.edit || s.selection.length > 0 ? { edit: null, selection: [], selectionAnchor: null } : {}
      ),

    saveSliceComment: async (comment) => {
      const { edit } = get();
      if (!edit) {
        set((s) => ({ sliceNotes: withNote(s.sliceNotes, comment) }));
        return;
      }

      const { annotation } = edit;
      const next = listNotes(withNote(toNotes(annotation.slice_comments), comment));
      get().setEditAnnotation({ ...annotation, slice_comments: next });
      try {
        const result = await updateAnnotationOpenmode({
          path: { campaign_id: campaignState().campaign.id, annotation_id: annotation.id },
          body: {
            label_id: annotation.label_id,
            comment: annotation.comment ?? null,
            geometry_wkt: null,
            is_authoritative: null,
            slice_comments: next,
          },
        });
        if (result.data) get().setEditAnnotation(result.data);
      } catch (error) {
        get().setEditAnnotation(annotation);
        handleError(error, 'Could not save the slice comment');
      }
    },

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

/** The slice notes on screen. An annotation opened for editing shows and
 *  saves its own; everything else is drafting them onto the next save. */
export function useSliceNotes(): SliceNotes {
  const edit = useWorkStore((s) => s.edit);
  const drafted = useWorkStore((s) => s.sliceNotes);
  return useMemo(() => (edit ? toNotes(edit.annotation.slice_comments) : drafted), [edit, drafted]);
}

/**
 * Everything the annotation layers draw: the tiles' version and paint, and the
 * overlay of what those tiles do not carry yet. Both the main map and the
 * imagery windows draw the same annotations, so they assemble them here rather
 * than each building their own.
 *
 * Memoized as one object: a feature layer compares its features by identity,
 * and the tile style function is cached on the labels array, so fresh values
 * per render would rebuild the overlay and re-style every tile.
 */
export function useSavedAnnotations(
  hiddenIds?: ReadonlySet<number>,
  highlightIds?: ReadonlySet<number>
): SavedAnnotations {
  const campaign = useCampaignStore((s) => s.campaign);
  const labelStyles = usePrefsStore((s) => s.labelStyles);
  const tileRefreshes = useWorkStore((s) => s.tileRefreshes);
  const delta = useWorkStore((s) => s.delta);

  return useMemo(
    () => ({
      version: (campaign?.annotations_version ?? 0) + tileRefreshes,
      labels: extendedLabels(campaign),
      labelStyles,
      hiddenIds,
      highlightIds,
      delta: {
        features: deltaWrites(delta).map((write) => ({
          id: write.id,
          geometry: write.geometry,
          properties: { label_id: write.labelId },
        })),
        markers: deltaWrites(delta)
          .filter((write) => write.origin === 'remote')
          .map((write) => ({
            id: write.id,
            geometry: { type: 'Point', coordinates: geometryTopRight(write.geometry) },
            properties: { label_id: write.labelId },
          })),
        ids: deltaIds(delta),
      },
    }),
    [campaign, labelStyles, tileRefreshes, delta, hiddenIds, highlightIds]
  );
}

/** Pick up other annotators' work while this campaign is open. Null in task
 *  mode, which draws no saved annotations to be out of date about; the id is
 *  what restarts the poll when the page moves to another campaign. */
export function useAnnotationSync(campaignId: number | null): void {
  useEffect(() => {
    if (campaignId === null) return;
    // Straight away, so the cursor starts where the campaign load left off
    // rather than one interval later.
    void useWorkStore.getState().syncRemoteAnnotations();
    const timer = setInterval(() => {
      // A tab nobody is looking at catches up when it comes back: the cursor
      // stays where it was, and the poll that resumes covers the whole gap.
      if (document.hidden) return;
      void useWorkStore.getState().syncRemoteAnnotations();
    }, REMOTE_POLL_MS);
    return () => clearInterval(timer);
  }, [campaignId]);
}
