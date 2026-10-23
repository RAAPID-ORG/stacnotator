import type { CampaignSubpage } from '~/app/routes';

/** A page of a campaign; `null` is its overview. */
export type CampaignSection = CampaignSubpage | null;

type CampaignAccess = { viewer_is_admin?: boolean | null; viewer_is_member?: boolean | null };

/** The campaign pages this viewer may open, in the order the sidebar lists them. */
export const campaignSections = (campaign: CampaignAccess): CampaignSection[] => {
  const isAdmin = campaign.viewer_is_admin ?? false;
  const isMember = isAdmin || (campaign.viewer_is_member ?? false);
  return [
    null,
    'annotate',
    'tasks',
    'annotations',
    ...(isMember ? (['agents'] as const) : []),
    ...(isAdmin ? (['settings'] as const) : []),
  ];
};
