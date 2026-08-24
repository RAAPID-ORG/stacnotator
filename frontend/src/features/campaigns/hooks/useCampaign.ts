import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCampaignOptions, getCampaignQueryKey } from '~/api/queries';

/** How often to re-ask while mosaic registration or embedding is still running.
 *  Long enough that a slow setup does not hammer the API, short enough that the
 *  page stops saying "initializing" soon after it finishes. */
const REGISTRATION_POLL_MS = 5000;

/** The campaign behind every one of its admin tabs - overview, tasks, settings,
 *  annotations - out of one cache entry, so moving between them is instant and
 *  an edit on any of them is visible on the rest.
 *
 *  `pollWhileRegistering` keeps re-reading while background setup runs; the
 *  campaign's own status fields are what say when to stop. */
export const useCampaign = (campaignId: number, options?: { pollWhileRegistering?: boolean }) =>
  useQuery({
    ...getCampaignOptions({ path: { campaign_id: campaignId } }),
    meta: { errorMessage: 'Failed to load campaign' },
    refetchInterval: (query) => {
      if (!options?.pollWhileRegistering) return false;
      const campaign = query.state.data;
      const registering =
        campaign?.registration_status === 'registering' ||
        campaign?.embedding_status === 'registering';
      return registering ? REGISTRATION_POLL_MS : false;
    },
  });

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
