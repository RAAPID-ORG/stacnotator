import { buildImageryCatalog } from '../campaign/imagery';
import { layoutForView } from '../canvas/grid';
import { useCampaignStore, type WorkMode } from '../stores/campaign';
import { useImageryStore } from '../stores/imagery';
import { useLayoutStore } from '../stores/layout';
import { useTasksStore } from '../stores/tasks';
import { taskRowFromTaskOut } from '~/shared/utils/taskSummary';
import { useWorkStore } from '../stores/work';
import type { TaskOut, CampaignOutFull, TaskSetOut } from '~/api/client';
import type { TaskFilter } from '../campaign/tasks';
import type { ImageryCatalog } from '../campaign/imagery';

const DEFAULT_FILTER: TaskFilter = {
  assignedTo: [],
  statuses: ['pending'],
  selectedLabelIds: [],
  selectedConfidences: [],
  flaggedOnly: false,
  taskSetId: null,
};

export interface SeedOptions {
  mode?: WorkMode;
  currentUserId?: string | null;
  tasks?: TaskOut[];
  taskSets?: TaskSetOut[];
  filter?: TaskFilter;
  now?: number;
}

/**
 * Put the stores in the state a real load would leave them, so a unit test can
 * exercise anything that reads the campaign without going through the network.
 * Mirrors `loadCampaign`; keep the two in step.
 */
export function seedCampaign(campaign: CampaignOutFull, options: SeedOptions = {}): ImageryCatalog {
  const catalog = buildImageryCatalog(campaign);
  const view = campaign.imagery_views[0] ?? null;
  const layout = layoutForView(campaign, view);

  useWorkStore.getState().resetAll();
  useCampaignStore.setState({
    campaign,
    catalog,
    view,
    workMode: options.mode ?? 'explore',
    isReviewMode: false,
    isMobile: false,
    currentUserId: options.currentUserId ?? 'u1',
    taskStartCollectionId: null,
  });
  useLayoutStore.setState({ currentLayout: layout, savedLayout: layout, editing: false });
  useImageryStore.getState().reset({});
  const tasks = options.tasks ?? [];
  useTasksStore.getState().initialize({
    tasks: tasks.map(taskRowFromTaskOut),
    taskSets: options.taskSets ?? [],
    syncCursor: null,
    filter: options.filter ?? DEFAULT_FILTER,
    catalog,
    now: options.now ?? 0,
  });
  // As if the current task's details had already arrived.
  const { visibleTasks, currentIndex } = useTasksStore.getState();
  const details = tasks.find((task) => task.id === visibleTasks[currentIndex]?.id) ?? null;
  useTasksStore.setState({ currentDetails: details });
  return catalog;
}
