import { useParams } from 'react-router-dom';

/**
 * The campaign id from the route. The `requireCampaignId` route loader validates
 * the param before these pages render, so the value is always a real id.
 */
export function useCampaignIdParam(): number {
  const { campaignId } = useParams<{ campaignId: string }>();
  return Number(campaignId);
}
