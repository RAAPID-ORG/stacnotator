import {
  getAllAnnotationTasks,
  getCampaignWithImageryWindows,
  listTaskSets,
  type ImageryViewOut,
} from '~/api/client';
import {
  buildCatalog,
  collectionStartDate,
  collectionsInView,
  type Catalog,
} from '../domain/catalog';
import { restoreSnapshot } from '../domain/imageryNav';
import { layoutForView, type WorkspaceLayout } from '../canvas/grid';
import { seedFilter } from '../domain/tasks';
import { useCampaignStore, type WorkMode } from './campaign';
import { useImageryStore } from './imagery';
import { useLayoutStore } from './layout';
import { usePrefsStore } from './prefs';
import { useTasksStore } from './tasks';
import { useWorkStore } from './work';

export interface LoadOptions {
  now: number;
  currentUserId: string | null;
  isReviewMode?: boolean;
  workMode?: WorkMode;
  taskSetId?: number;
  preferTaskId?: number;
  /** Deep-linked annotation, meaningful only in Explore. Returned rather than
   *  opened here: opening it belongs to the map's edit tool. */
  annotationId?: number;
}

/**
 * Chronologically first collection that has a window, else the first
 * browsable one - so the main map keeps imagery even when every window is
 * hidden. A still-valid pinned start wins over both.
 */
function defaultCollectionId(
  cat: Catalog,
  view: ImageryViewOut | null,
  layout: WorkspaceLayout,
  pinned: number | undefined
): number | null {
  const entries = [...collectionsInView(cat, view)].sort((a, b) =>
    collectionStartDate(a).localeCompare(collectionStartDate(b))
  );
  const windowed = entries.filter((c) => layout.windows[c.id] !== undefined);
  const pool = windowed.length > 0 ? windowed : entries;
  if (pinned != null && pool.some((c) => c.id === pinned)) return pinned;
  return pool[0]?.id ?? null;
}

/**
 * Load a campaign and re-seed every store from it. This is the one seam that
 * guarantees nothing survives a change of campaign, so each store is written
 * here rather than left to whichever caller remembers.
 *
 * Returns the deep-linked annotation to open, if any.
 */
export async function loadCampaign(
  campaignId: number,
  options: LoadOptions
): Promise<{ annotationId: number | null }> {
  const [campaignRes, tasksRes, setsRes] = await Promise.all([
    getCampaignWithImageryWindows({ path: { campaign_id: campaignId } }),
    getAllAnnotationTasks({ path: { campaign_id: campaignId } }),
    listTaskSets({ path: { campaign_id: campaignId } }),
  ]);

  const campaign = campaignRes.data;
  if (!campaign) throw new Error(`loadCampaign: no data for ${campaignId}`);
  const tasks = tasksRes.data?.tasks ?? [];
  const taskSets = setsRes.data ?? [];
  const catalog = buildCatalog(campaign);
  const view = campaign.imagery_views[0] ?? null;

  const filter = seedFilter(tasks, taskSets, options.currentUserId, options.now, {
    taskSetId: options.taskSetId,
    isPublic: campaign.is_public,
  });

  // A campaign with no tasks has nothing to claim, so it opens in Explore
  // unless a deep link asked for a mode.
  const workMode: WorkMode =
    options.workMode ?? (campaign.mode === 'open' || tasks.length === 0 ? 'explore' : 'tasks');

  const layout = layoutForView(campaign, view);
  const pinned = view ? usePrefsStore.getState().pinnedStart[view.id] : undefined;
  const startCollectionId = defaultCollectionId(catalog, view, layout, pinned);

  useWorkStore.getState().resetAll();
  useCampaignStore.setState({
    campaign,
    catalog,
    view,
    workMode,
    // Mirrors setWorkMode's rule: Explore never carries a review flag.
    isReviewMode: workMode === 'explore' ? false : (options.isReviewMode ?? false),
    currentUserId: options.currentUserId,
    taskStartCollectionId: startCollectionId,
  });
  useLayoutStore.setState({ currentLayout: layout, savedLayout: layout, editing: false });
  useImageryStore.getState().reset({
    address:
      startCollectionId != null
        ? restoreSnapshot(catalog, undefined, startCollectionId).address
        : null,
    crosshair: workMode === 'tasks',
  });
  useTasksStore.getState().initialize({
    tasks,
    taskSets,
    filter,
    catalog,
    now: options.now,
    preferTaskId: options.preferTaskId,
  });

  return {
    annotationId: workMode === 'explore' ? (options.annotationId ?? null) : null,
  };
}
