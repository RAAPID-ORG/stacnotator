import { create } from 'zustand';
import type {
  AnnotationOut,
  CampaignOutFull,
  ImageryViewOut,
  PlanetSceneSliceOut,
} from '~/api/client';
import {
  buildImageryCatalog,
  collectionStartDate,
  collectionsInView,
  withSceneLayers,
  withSceneSearch,
  type ImageryCatalog,
} from '../campaign/imagery';
import {
  canModifyAnnotation,
  extendedLabels,
  type ExtendedLabel,
  type FormField,
} from '../campaign/annotation';
import type { PolicyContext } from '~/features/campaigns/utils/labellingPolicy';
import { viewWindows, type LayoutItem } from '../canvas/grid';
import { useImageryStore } from './imagery';
import { useLayoutStore } from './layout';
import { usePrefsStore } from './prefs';

export type WorkMode = 'tasks' | 'explore';

/**
 * What the whole page is currently pointed at. Everything else - the panels,
 * the hotkeys, the layer composition - reads the campaign from here rather
 * than being handed it, which is why no context object is threaded through
 * the tree.
 */
interface CampaignState {
  campaign: CampaignOutFull | null;
  catalog: ImageryCatalog | null;
  view: ImageryViewOut | null;
  workMode: WorkMode;
  isReviewMode: boolean;
  isMobile: boolean;
  currentUserId: string | null;
  /** Resolved start collection for task navigation in the selected view. */
  taskStartCollectionId: number | null;

  setCampaign: (campaign: CampaignOutFull) => void;
  setWorkMode: (mode: WorkMode) => void;
  setReviewMode: (isReviewMode: boolean) => void;
  setMobile: (isMobile: boolean) => void;
  setTaskStartCollection: (collectionId: number) => void;
  /** What a viewport search found for a scene source: which dates hold imagery
   *  here, and the covers that are already drawable. */
  applySceneSearch: (sourceId: number, vizName: string, found: PlanetSceneSliceOut[]) => void;
  /** Layers minted for dates that were already found, as they are opened. */
  applySceneLayers: (sourceId: number, vizName: string, minted: PlanetSceneSliceOut[]) => void;
  /** Make `view` the selected one. Its imagery nav state and its canvas
   *  windows both come with it, so the whole page belongs to one view. */
  selectView: (view: ImageryViewOut) => void;
}

/**
 * Which collection a view opens on: the chronologically first one that has a
 * window, else the first browsable one - so the map keeps imagery even when
 * every window is hidden. A pinned start wins inside whichever pool applies.
 */
export function startCollectionFor(
  catalog: ImageryCatalog,
  view: ImageryViewOut | null,
  windows: Record<number, LayoutItem>
): number | null {
  const entries = [...collectionsInView(catalog, view)].sort((a, b) =>
    collectionStartDate(a).localeCompare(collectionStartDate(b))
  );
  const windowed = entries.filter((c) => windows[c.id] !== undefined);
  const pool = windowed.length > 0 ? windowed : entries;
  const pinned = view ? usePrefsStore.getState().pinnedStart[view.id] : undefined;
  if (pinned != null && pool.some((c) => c.id === pinned)) return pinned;
  return pool[0]?.id ?? null;
}

export const useCampaignStore = create<CampaignState>((set, get) => ({
  campaign: null,
  catalog: null,
  view: null,
  workMode: 'explore',
  isReviewMode: false,
  isMobile: false,
  currentUserId: null,
  taskStartCollectionId: null,

  setCampaign: (campaign) => {
    const catalog = buildImageryCatalog(campaign);
    const current = get().view;
    const kept = campaign.imagery_views.find((v) => v.id === current?.id) ?? null;
    set({ campaign, catalog, view: kept ?? current });
    // The selected view is gone (an admin deleted it). Moving to the
    // replacement is a real view switch - the imagery address and the canvas
    // windows still belong to the view that went - so it goes through
    // selectView rather than being quietly repointed here.
    if (!kept) {
      const replacement = campaign.imagery_views[0] ?? null;
      if (replacement) get().selectView(replacement);
      else set({ view: null });
    }
  },

  setWorkMode: (workMode) => {
    // Review is a Tasks-only concept; carrying it into Explore would trap the
    // UI in it with no way back short of a reload.
    set((s) => ({ workMode, isReviewMode: workMode === 'explore' ? false : s.isReviewMode }));
    const imagery = useImageryStore.getState();
    // Crosshair on for Tasks (point placement), off for Explore (free drawing).
    imagery.setCrosshair(workMode === 'tasks');
    // Task-scoped no-data observations mean nothing once the mode changes.
    imagery.setEmptyScope(null);
  },

  applySceneSearch: (sourceId, vizName, found) => {
    const catalog = get().catalog;
    if (catalog) set({ catalog: withSceneSearch(catalog, sourceId, vizName, found) });
  },

  applySceneLayers: (sourceId, vizName, minted) => {
    const catalog = get().catalog;
    if (catalog) set({ catalog: withSceneLayers(catalog, sourceId, vizName, minted) });
  },

  setReviewMode: (isReviewMode) => set({ isReviewMode }),
  setMobile: (isMobile) => set({ isMobile }),
  setTaskStartCollection: (taskStartCollectionId) => set({ taskStartCollectionId }),

  selectView: (view) => {
    const { catalog, view: previous } = get();
    if (!catalog) return;
    const start = startCollectionFor(catalog, view, viewWindows(view));
    useImageryStore.getState().switchView(catalog, previous?.id ?? null, view.id, start);
    useLayoutStore.getState().loadViewLayout(view);
    set({ view, taskStartCollectionId: start });
  },
}));

/** The loaded campaign. The page gates on the load, so every panel below it
 *  can treat this as present. */
export function useCampaign(): CampaignOutFull {
  const campaign = useCampaignStore((s) => s.campaign);
  if (!campaign) throw new Error('useCampaign: no campaign loaded');
  return campaign;
}

export function useCatalog(): ImageryCatalog {
  const catalog = useCampaignStore((s) => s.catalog);
  if (!catalog) throw new Error('useCatalog: no campaign loaded');
  return catalog;
}

/** Imperative twin of the hooks above, for hotkeys and event handlers. */
export function campaignState() {
  const { campaign, catalog, view, workMode, isMobile } = useCampaignStore.getState();
  if (!campaign || !catalog) throw new Error('campaignState: no campaign loaded');
  return { campaign, catalog, view, workMode, isMobile };
}

/** The same answer inside React, re-rendered when the campaign or the viewer
 *  changes. */
export function useCanModifyAnnotation(): (
  annotation: Pick<AnnotationOut, 'created_by_user_id'>
) => boolean {
  const campaign = useCampaignStore((s) => s.campaign);
  const userId = useCampaignStore((s) => s.currentUserId);
  return (annotation) =>
    canModifyAnnotation(
      annotation,
      toPolicyContext(campaign, userId),
      campaign?.settings.labelling_policy?.modify_others
    );
}

export function useLabels(): ExtendedLabel[] {
  return extendedLabels(useCampaignStore((s) => s.campaign));
}

export function formFields(): FormField[] {
  return useCampaignStore.getState().campaign?.settings.form_fields ?? [];
}

export function toPolicyContext(
  campaign: CampaignOutFull | null,
  userId: string | null
): PolicyContext {
  return {
    userId,
    isAdmin: campaign?.viewer_is_admin ?? false,
    isAuthoritative: campaign?.viewer_is_authoritative_reviewer ?? false,
    isMember: campaign?.viewer_is_member ?? false,
  };
}

export function usePolicy(): PolicyContext {
  const campaign = useCampaignStore((s) => s.campaign);
  const userId = useCampaignStore((s) => s.currentUserId);
  return toPolicyContext(campaign, userId);
}

/** Whether the viewer may change or remove this annotation, by the campaign's
 *  own rule. Outside React, for the click and key handlers. */
export function mayModifyAnnotation(
  annotation: Pick<AnnotationOut, 'created_by_user_id'>
): boolean {
  const { campaign, currentUserId } = useCampaignStore.getState();
  return canModifyAnnotation(
    annotation,
    toPolicyContext(campaign, currentUserId),
    campaign?.settings.labelling_policy?.modify_others
  );
}
