import { useCallback } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AnnotationListItemOut,
  AnnotationTaskOut,
  ListAnnotationsForCampaignData,
  TaskSetOut,
} from '~/api/client';
import {
  getAllAnnotationTasksOptions,
  getAllAnnotationTasksQueryKey,
  getCampaignOptions,
  getCampaignSummaryOptions,
  getCampaignQueryKey,
  getAnnotationFacetsOptions,
  getCampaignStatisticsEndpointOptions,
  listAnnotationsForCampaignOptions,
  listTaskSetsOptions,
  listTaskSetsQueryKey,
} from '~/api/queries';
import { SHARED_WORK } from '~/api/queryClient';

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
const REGISTRATION_POLL_MS = 5000;

type MaybeRegistering = { registration_status?: string; embedding_status?: string } | undefined;

export const isRegistering = (campaign: MaybeRegistering) =>
  campaign?.registration_status === 'registering' || campaign?.embedding_status === 'registering';

const NO_TASKS: AnnotationTaskOut[] = [];
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
export const useCampaignSummary = (campaignId: number) => {
  const { data, isPending } = useQuery({
    ...getCampaignSummaryOptions({ path: { campaign_id: campaignId } }),
    meta: { errorMessage: 'Failed to load campaign' },
    // These pages are reachable during setup, so what they say about it has to
    // stop being true on its own. Stops as soon as setup finishes.
    refetchInterval: (query) => (isRegistering(query.state.data) ? REGISTRATION_POLL_MS : false),
  });
  return { campaign: data, loading: isPending };
};

/** The whole campaign, imagery included. Only the settings editor and the annotation
 *  page need that; everything else wants `useCampaignSummary`.
 *
 *  `pollWhileRegistering` keeps re-reading while background setup runs; the campaign's
 *  own status fields are what say when to stop. */
export const useCampaign = (campaignId: number, options?: { pollWhileRegistering?: boolean }) => {
  const { data, isPending } = useQuery({
    ...getCampaignOptions({ path: { campaign_id: campaignId } }),
    meta: { errorMessage: 'Failed to load campaign' },
    refetchInterval: (query) =>
      options?.pollWhileRegistering && isRegistering(query.state.data)
        ? REGISTRATION_POLL_MS
        : false,
  });
  return { campaign: data, loading: isPending };
};

/** Every task in the campaign. `enabled: false` is for the review table when a
 *  page hands it a scoped list of its own instead. */
export const useCampaignTasks = (campaignId: number, options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true;
  const { data, isPending } = useQuery({
    ...getAllAnnotationTasksOptions({ path: { campaign_id: campaignId } }),
    ...SHARED_WORK,
    enabled,
    meta: { errorMessage: 'Failed to load tasks' },
  });
  return { tasks: data?.tasks ?? NO_TASKS, loading: enabled && isPending };
};

/** The campaign's task sets, whose labelled/total counters move as annotators
 *  submit, which is why they are shared work rather than settings. */
export const useCampaignTaskSets = (campaignId: number, options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true;
  const { data, isPending } = useQuery({
    ...listTaskSetsOptions({ path: { campaign_id: campaignId } }),
    ...SHARED_WORK,
    enabled,
    meta: { errorMessage: 'Failed to load task sets' },
  });
  return { taskSets: data ?? NO_TASK_SETS, loading: enabled && isPending };
};

/** The agreement figures. The panel shows its own failure line, so no toast.
 *  `taskSetId` scopes them to one set; omitted means the whole campaign. */
export const useCampaignStatistics = (campaignId: number, taskSetId?: number) => {
  const { data, isPending, error } = useQuery({
    ...getCampaignStatisticsEndpointOptions({
      path: { campaign_id: campaignId },
      query: { task_set_id: taskSetId },
    }),
    ...SHARED_WORK,
    meta: { errorMessage: 'Failed to load statistics', showUser: false },
  });
  return { statistics: data, loading: isPending, error };
};

export const useRefreshCampaign = (campaignId: number) => {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: getCampaignQueryKey({ path: { campaign_id: campaignId } }),
      }),
    [queryClient, campaignId]
  );
};

export const useRefreshCampaignTasks = (campaignId: number) => {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: getAllAnnotationTasksQueryKey({ path: { campaign_id: campaignId } }),
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
  const { data, isPending, isPlaceholderData } = useQuery({
    ...listAnnotationsForCampaignOptions({ path: { campaign_id: campaignId }, query }),
    ...SHARED_WORK,
    placeholderData: keepPreviousData,
    meta: { errorMessage: 'Failed to load annotations' },
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
  const { data } = useQuery({
    ...getAnnotationFacetsOptions({ path: { campaign_id: campaignId } }),
    ...SHARED_WORK,
    meta: { errorMessage: 'Failed to load annotation counts', showUser: false },
  });
  return data ?? null;
};
