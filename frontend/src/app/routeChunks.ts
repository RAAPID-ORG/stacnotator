// Central definitions of the code-split route chunks, plus helpers to warm them
// ahead of navigation.

export const importCreateCampaign = () => import('~/features/campaigns/pages/CreateCampaignPage');
export const importAnnotation = () => import('~/features/annotation/pages/AnnotationPage');
export const importCampaignOverview = () =>
  import('~/features/campaigns/pages/CampaignOverviewPage');
export const importCampaignSettings = () =>
  import('~/features/campaigns/pages/CampaignSettingsPage');
export const importCampaignTasks = () => import('~/features/campaigns/pages/CampaignTasksPage');
export const importReview = () => import('~/features/campaigns/pages/ReviewPage');
export const importSettings = () => import('~/features/settings/pages/SettingsPage');
export const importSdkAuth = () => import('~/features/auth/pages/SdkAuthPage');

/** Warm the campaign-cluster chunks (New campaign, overview, settings, tasks,
 *  review). These are the common next hops from the home/campaigns pages and are
 *  light, so they're prefetched together once the app is idle.*/
export function prefetchCampaignChunks(): void {
  void importCreateCampaign();
  void importCampaignOverview();
  void importCampaignSettings();
  void importCampaignTasks();
  void importReview();
}

/** Warm the annotation chunk (OpenLayers, Chart.js). */
export function prefetchAnnotationChunk(): void {
  void importAnnotation();
}
