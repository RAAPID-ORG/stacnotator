import { useCallback } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  AnnotationListItemOut,
  TaskOut,
  ListAnnotationsForCampaignData,
  TaskSetOut,
} from '~/api/client';
import {
  listTasksOptions,
  listTasksQueryKey,
  getCampaignOptions,
  getCampaignSummaryOptions,
  getCampaignQueryKey,
  getCampaignSummaryQueryKey,
  getAnnotationFacetsOptions,
  getCampaignStatisticsOptions,
  listAnnotationsForCampaignOptions,
  listTaskSetsOptions,
  listTaskSetsQueryKey,
} from '~/api/queries';
import { SHARED_WORK, RUN_POLL_MS } from '~/api/queryClient';

/**
 * How a campaign and the work inside it are read, in one place, because the
 * admin tabs each need a different slice of the same thing and must not
 * disagree about it.
 *
 * The split that matters is freshness. A campaign's own settings only change
 * when an admin changes them, so they follow the default staleness. Its tasks,
 * task sets, annotations and statistics move continuously while annotators
 * work, so they carry `SHARED_WORK`.
 *
 * A read lives here once more than one surface needs it; a page's own one-off
 * read stays a `useQuery` in the page. Either way the hooks hand back the thing
 * they are named for plus the state their callers render, not the query object,
 * which is the shape `useOrganizations` already uses.
 */

/** How often to re-ask while mosaic registration or embedding is still running.
 *  Long enough that a slow setup does not hammer the API, short enough that the
 *  page stops saying "initializing" soon after it finishes. */
type MaybeRegistering = { registration_status?: string; embedding_status?: string } | undefined;

export const isRegistering = (campaign: MaybeRegistering) =>
  campaign?.registration_status === 'registering' || campaign?.embedding_status === 'registering';

const NO_TASKS: TaskOut[] = [];
const NO_TASK_SETS: TaskSetOut[] = [];
const NO_ANNOTATIONS: AnnotationListItemOut[] = [];

/**
 * The campaign without its imagery.
 *
 * What the overview, tasks and annotations pages read. `useCampaign` loads sources,
 * collections, slices, tile URLs and time series with it - roughly 22 sequential round
 * trips - which none of those pages render. Use that one only where the imagery is
 * actually needed: the settings editor and the annotation page.
 */
export const useCampaignSummary = (campaignId: number | null) => {
  const { t } = useTranslation('campaigns');
  // The sidebar asks on every route, so the hook stays unconditional and only
  // runs once there is a campaign to read.
  const { data, isPending } = useQuery({
    ...getCampaignSummaryOptions({ path: { campaign_id: campaignId ?? 0 } }),
    enabled: campaignId !== null,
    meta: { errorMessage: t('errors.loadCampaign') },
    // These pages are reachable during setup, so what they say about it has to
    // stop being true on its own. Stops as soon as setup finishes.
    refetchInterval: (query) => (isRegistering(query.state.data) ? RUN_POLL_MS : false),
  });
  return { campaign: data, loading: campaignId !== null && isPending };
};

/** The whole campaign, imagery included. Only the settings editor and the annotation
 *  page need that; everything else wants `useCampaignSummary`.
 *
 *  `pollWhileRegistering` keeps re-reading while background setup runs; the campaign's
 *  own status fields are what say when to stop. */
export const useCampaign = (campaignId: number, options?: { pollWhileRegistering?: boolean }) => {
  const { t } = useTranslation('campaigns');
  const { data, isPending } = useQuery({
    ...getCampaignOptions({ path: { campaign_id: campaignId } }),
    meta: { errorMessage: t('errors.loadCampaign') },
    refetchInterval: (query) =>
      options?.pollWhileRegistering && isRegistering(query.state.data) ? RUN_POLL_MS : false,
  });
  return { campaign: data, loading: isPending };
};

/** Every task in the campaign. `enabled: false` is for the review table when a
 *  page hands it a scoped list of its own instead. */
export const useCampaignTasks = (campaignId: number, options?: { enabled?: boolean }) => {
  const { t } = useTranslation('campaigns');
  const enabled = options?.enabled ?? true;
  const { data, isPending } = useQuery({
    ...listTasksOptions({ path: { campaign_id: campaignId } }),
    ...SHARED_WORK,
    enabled,
    meta: { errorMessage: t('errors.loadTasks') },
  });
  return { tasks: data?.tasks ?? NO_TASKS, loading: enabled && isPending };
};

/** The campaign's task sets, whose labelled/total counters move as annotators
 *  submit, which is why they are shared work rather than settings. */
export const useCampaignTaskSets = (campaignId: number, options?: { enabled?: boolean }) => {
  const { t } = useTranslation('campaigns');
  const enabled = options?.enabled ?? true;
  const { data, isPending } = useQuery({
    ...listTaskSetsOptions({ path: { campaign_id: campaignId } }),
    ...SHARED_WORK,
    enabled,
    meta: { errorMessage: t('errors.loadTaskSets') },
  });
  return { taskSets: data ?? NO_TASK_SETS, loading: enabled && isPending };
};

/** The agreement figures. The panel shows its own failure line, so no toast.
 *  `taskSetId` scopes them to one set; omitted means the whole campaign. */
export const useCampaignStatistics = (campaignId: number, taskSetId?: number) => {
  const { t } = useTranslation('campaigns');
  const { data, isPending, error } = useQuery({
    ...getCampaignStatisticsOptions({
      path: { campaign_id: campaignId },
      query: { task_set_id: taskSetId },
    }),
    ...SHARED_WORK,
    meta: { errorMessage: t('errors.loadStatistics'), showUser: false },
  });
  return { statistics: data, loading: isPending, error };
};

/** After a write to the campaign: both reads of it, so the sidebar and the summary
 *  pages show the change as well as the settings editor. */
export const useRefreshCampaign = (campaignId: number) => {
  const queryClient = useQueryClient();
  return useCallback(() => {
    const path = { campaign_id: campaignId };
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: getCampaignQueryKey({ path }) }),
      queryClient.invalidateQueries({ queryKey: getCampaignSummaryQueryKey({ path }) }),
    ]);
  }, [queryClient, campaignId]);
};

export const useRefreshCampaignTasks = (campaignId: number) => {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: listTasksQueryKey({ path: { campaign_id: campaignId } }),
      }),
    [queryClient, campaignId]
  );
};

export const useRefreshCampaignTaskSets = (campaignId: number) => {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: listTaskSetsQueryKey({ path: { campaign_id: campaignId } }),
      }),
    [queryClient, campaignId]
  );
};

/** Both, for anything that moves tasks between sets or in and out of the
 *  campaign: a set's counters change whenever its tasks do. */
export const useRefreshCampaignWork = (campaignId: number) => {
  const refreshTasks = useRefreshCampaignTasks(campaignId);
  const refreshTaskSets = useRefreshCampaignTaskSets(campaignId);
  return useCallback(
    () => Promise.all([refreshTasks(), refreshTaskSets()]),
    [refreshTasks, refreshTaskSets]
  );
};

/**
 * One page of a campaign's annotations, filtered and sorted by the server.
 *
 * `query` carries the paging, filters and sort, and it is part of the cache key - so
 * paging back to a page already seen is instant, and the browser's own back button
 * lands on cached data. `keepPreviousData` is what keeps the current rows on screen
 * while the next page loads: without it every filter change unmounts the table, the
 * page height collapses, and the scroll position jumps twice.
 */
export const useAnnotationsPage = (
  campaignId: number,
  query: ListAnnotationsForCampaignData['query']
) => {
  const { t } = useTranslation('campaigns');
  const { data, isPending, isPlaceholderData } = useQuery({
    ...listAnnotationsForCampaignOptions({ path: { campaign_id: campaignId }, query }),
    ...SHARED_WORK,
    placeholderData: keepPreviousData,
    meta: { errorMessage: t('errors.loadAnnotations') },
  });
  return {
    items: data?.items ?? NO_ANNOTATIONS,
    total: data?.total ?? 0,
    /** Before the first page has ever arrived. A refetch is `refreshing`, not this. */
    loading: isPending,
    /** Showing the previous page while the next one loads. */
    refreshing: isPlaceholderData,
  };
};

/**
 * Campaign-wide counts for the annotations page's filters, legend and totals.
 *
 * Separate from the page because it does not change as the reader pages, and because
 * deriving it in the browser would mean holding every annotation - which is the cost
 * the paged endpoint exists to avoid.
 */
export const useAnnotationFacets = (campaignId: number) => {
  const { t } = useTranslation('campaigns');
  const { data } = useQuery({
    ...getAnnotationFacetsOptions({ path: { campaign_id: campaignId } }),
    ...SHARED_WORK,
    meta: { errorMessage: t('errors.loadAnnotationCounts'), showUser: false },
  });
  return data ?? null;
};
