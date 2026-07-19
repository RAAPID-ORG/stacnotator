// Central definitions of the code-split route chunks, plus helpers to warm them
// ahead of navigation. Kept out of router.tsx so a page can trigger a prefetch
// without importing the router module (which would be an import cycle).
//
// Each thunk is the same dynamic import router.tsx passes to lazy(), so calling
// it early just primes the ESM/browser cache - the chunk is fetched once and the
// later navigation resolves instantly instead of showing a Suspense spinner.

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
 *  light, so they're prefetched together once the app is idle. The heavy
 *  annotation chunk is warmed separately, on intent - see prefetchAnnotationChunk. */
export function prefetchCampaignChunks(): void {
  void importCreateCampaign();
  void importCampaignOverview();
  void importCampaignSettings();
  void importCampaignTasks();
  void importReview();
}

/** Warm the annotation chunk (OpenLayers, Chart.js) - the largest one, and the
 *  worst spinner. Called from the campaign overview, where the next action is
 *  almost always to open the annotator. */
export function prefetchAnnotationChunk(): void {
  void importAnnotation();
}
