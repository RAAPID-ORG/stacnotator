import {
  getAllAnnotationTasks,
  getCampaignWithImageryWindows,
  listTaskSets,
  type AnnotationTaskOut,
  type CampaignOutFull,
  type CanvasLayoutItem,
  type ImageryViewOut,
  type TaskSetOut,
} from '~/api/client';
import {
  buildCatalog,
  collectionStartDate,
  collectionsInView,
  restoreSnapshot,
  type Catalog,
} from '~/features/annotation/core/catalog';
import { seedFilter, type TaskFilter } from '~/features/annotation/core/tasks';
import { fromGridLayout, type WorkspaceLayout } from '~/features/annotation/core/workspace';
import { useImageryStore } from './imagery';
import { usePrefsStore } from './prefs';
import { useSessionStore, type WorkMode } from './session';
import { useWorkStore } from './work';
import { EMPTY_WORKSPACE_LAYOUT, useWorkspaceStore } from './workspace';

export interface LoadCampaignOptions {
  now: number;
  /** Who's asking - drives seedFilter's "my pending work" fallback level.
   *  No store among the five surfaces tracks the current user. */
  currentUserId: string | null | undefined;
  isReviewMode?: boolean;
  initialWorkMode?: WorkMode;
  initialTaskSetId?: number;
  /** Deep-linked annotation id (annotations page "View"), meaningful only in
   *  Explore. Staged in the result for the map's edit tool to consume once
   *  its interactions exist - domain stores hold no map-tool state. */
  deepLinkAnnotationId?: number;
}

export interface LoadCampaignResult {
  campaign: CampaignOutFull;
  catalog: Catalog;
  tasks: AnnotationTaskOut[];
  taskSets: TaskSetOut[];
  taskFilter: TaskFilter;
  view: ImageryViewOut | null;
  deepLinkEditAnnotationId: number | null;
}

/**
 * Chronologically-first collection with a window in the layout, else the
 * first browsable collection - so the main map keeps an imagery source even
 * when every window is hidden. A still-valid pinned start wins over both.
 * Composition glue over Catalog + WorkspaceLayout; it belongs here, not in
 * either module, since it depends on both.
 */
function defaultActiveCollectionId(
  cat: Catalog,
  view: ImageryViewOut | null,
  layout: WorkspaceLayout,
  pinned: number | undefined
): number | null {
  const entries = [...collectionsInView(cat, view ?? { source_ids: [] })].sort((a, b) =>
    collectionStartDate(a).localeCompare(collectionStartDate(b))
  );
  const windowed = entries.filter((c) => layout.view.windows[c.id] !== undefined);
  const pool = windowed.length > 0 ? windowed : entries;
  if (pinned != null && pool.some((c) => c.id === pinned)) return pinned;
  return pool[0]?.id ?? null;
}

/** The one 60-column grid the canvas renders: page chrome plus the selected
 *  view's windows, merging the personal layout over the default one. */
function mergedLayoutItems(
  campaign: CampaignOutFull,
  view: ImageryViewOut | null
): CanvasLayoutItem[] {
  const main =
    campaign.personal_main_canvas_layout?.layout_data ??
    campaign.default_main_canvas_layout?.layout_data ??
    [];
  const viewItems =
    view?.personal_canvas_layout?.layout_data ?? view?.default_canvas_layout?.layout_data ?? [];
  return [...main, ...viewItems];
}

export async function loadCampaign(
  campaignId: number,
  options: LoadCampaignOptions
): Promise<LoadCampaignResult> {
  const [campaignRes, tasksRes, setsRes] = await Promise.all([
    getCampaignWithImageryWindows({ path: { campaign_id: campaignId } }),
    getAllAnnotationTasks({ path: { campaign_id: campaignId } }),
    listTaskSets({ path: { campaign_id: campaignId } }),
  ]);

  const campaign = campaignRes.data;
  if (!campaign) throw new Error(`loadCampaign: no campaign data for ${campaignId}`);
  const tasks = tasksRes.data?.tasks ?? [];
  const taskSets = setsRes.data ?? [];
  const catalog = buildCatalog(campaign);

  // Nothing survives a change of campaign. This is the seam that guarantees
  // it: every one of the five store surfaces is re-seeded below, so the work
  // store - the one holding a half-drawn annotation and a half-filled form -
  // has to be cleared here too, not left to whichever caller remembers.
  useWorkStore.getState().resetAll();

  const view = campaign.imagery_views[0] ?? null;
  const selectedViewId = view?.id ?? null;

  const taskFilter = seedFilter(tasks, taskSets, options.currentUserId, options.now, {
    taskSetId: options.initialTaskSetId,
    isPublic: campaign.is_public,
  });

  // Zero-task campaigns have nothing to claim in Tasks mode - seed straight
  // into Explore instead, unless the caller (deep link/session restore)
  // explicitly asked for a mode.
  const seededWorkMode: WorkMode =
    options.initialWorkMode ?? (campaign.mode === 'open' ? 'explore' : 'tasks');
  const workMode: WorkMode =
    options.initialWorkMode === undefined && tasks.length === 0 ? 'explore' : seededWorkMode;

  useSessionStore.setState({
    workMode,
    // Mirrors setWorkMode's own rule: Explore never carries a review flag.
    isReviewMode: workMode === 'explore' ? false : (options.isReviewMode ?? false),
    selectedViewId,
  });

  const layout = fromGridLayout(mergedLayoutItems(campaign, view), EMPTY_WORKSPACE_LAYOUT);
  useWorkspaceStore.setState({ currentLayout: layout, savedLayout: layout, editing: false });

  const pinned =
    selectedViewId != null ? usePrefsStore.getState().pinnedStart[selectedViewId] : undefined;
  const fallbackCollectionId = defaultActiveCollectionId(catalog, view, layout, pinned);
  const address =
    fallbackCollectionId != null
      ? restoreSnapshot(catalog, undefined, fallbackCollectionId).address
      : null;

  useImageryStore.setState({
    address,
    showBasemap: false,
    selectedBasemapId: null,
    overlay: { id: null, visible: true },
    overlayOpacity: 1,
    vector: { id: null, visible: true },
    empties: {},
    viewSnapshots: {},
    // Crosshair on for Tasks (point placement), off for Explore, same rule
    // setWorkMode applies later when the user switches modes by hand.
    crosshair: workMode === 'tasks',
  });

  const deepLinkEditAnnotationId =
    workMode === 'explore' && options.deepLinkAnnotationId !== undefined
      ? options.deepLinkAnnotationId
      : null;

  return { campaign, catalog, tasks, taskSets, taskFilter, view, deepLinkEditAnnotationId };
}
