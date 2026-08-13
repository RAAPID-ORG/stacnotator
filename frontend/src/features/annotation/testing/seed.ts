import { buildCatalog } from '../domain/catalog';
import { layoutForView } from '../canvas/grid';
import { useCampaignStore, type WorkMode } from '../stores/campaign';
import { useImageryStore } from '../stores/imagery';
import { useLayoutStore } from '../stores/layout';
import { useTasksStore } from '../stores/tasks';
import { useWorkStore } from '../stores/work';
import type { AnnotationTaskOut, CampaignOutFull, TaskSetOut } from '~/api/client';
import type { TaskFilter } from '../domain/tasks';
import type { Catalog } from '../domain/catalog';

const DEFAULT_FILTER: TaskFilter = {
  assignedTo: [],
  statuses: ['pending'],
  selectedConfidences: [],
  flaggedOnly: false,
  taskSetId: null,
};

export interface SeedOptions {
  mode?: WorkMode;
  currentUserId?: string | null;
  tasks?: AnnotationTaskOut[];
  taskSets?: TaskSetOut[];
  filter?: TaskFilter;
  now?: number;
}

/**
 * Put the stores in the state a real load would leave them, so a unit test can
 * exercise anything that reads the campaign without going through the network.
 * Mirrors `loadCampaign`; keep the two in step.
 */
export function seedCampaign(campaign: CampaignOutFull, options: SeedOptions = {}): Catalog {
  const catalog = buildCatalog(campaign);
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
  useTasksStore.getState().initialize({
    tasks: options.tasks ?? [],
    taskSets: options.taskSets ?? [],
    filter: options.filter ?? DEFAULT_FILTER,
    catalog,
    now: options.now ?? 0,
  });
  return catalog;
}
