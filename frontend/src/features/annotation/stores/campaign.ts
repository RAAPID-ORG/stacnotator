import { create } from 'zustand';
import type { CampaignOutFull, ImageryViewOut } from '~/api/client';
import {
  buildImageryCatalog,
  collectionStartDate,
  collectionsInView,
  type ImageryCatalog,
} from '../campaign/imagery';
import {
  extendedLabels,
  type ExtendedLabel,
  type FormField,
  type PolicyContext,
} from '../campaign/annotation';
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

export function useLabels(): ExtendedLabel[] {
  return extendedLabels(useCampaignStore((s) => s.campaign));
}

export function formFields(): FormField[] {
  return useCampaignStore.getState().campaign?.settings.form_fields ?? [];
}

export function usePolicy(): PolicyContext {
  const campaign = useCampaignStore((s) => s.campaign);
  const userId = useCampaignStore((s) => s.currentUserId);
  return {
    userId,
    isAdmin: campaign?.viewer_is_admin ?? false,
    isAuthoritative: campaign?.viewer_is_authoritative_reviewer ?? false,
    isMember: campaign?.viewer_is_member ?? false,
  };
}
