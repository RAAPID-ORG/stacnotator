import { useEffect } from 'react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  type LoaderFunctionArgs,
  redirect,
  Route,
  RouterProvider,
} from 'react-router-dom';
import { HomePage } from 'src/features/home/pages/HomePage';
import { ProjectsPage } from 'src/features/projects/pages/ProjectsPage';
import { AppLayout } from '~/app/AppLayout';
import { projectsPath } from '~/app/routes';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { onIdle } from '~/shared/utils/idle';
import { NotFoundPage, RouteErrorBoundary } from './RouteError';
import {
  importAnnotation,
  importCreateCampaign,
  importCampaignOverview,
  importCampaignSettings,
  importCampaignTasks,
  importNewOrganization,
  importNewProject,
  importOrganization,
  importProject,
  importReview,
  importSdkAuth,
  importSettings,
  prefetchAnnotationChunk,
  prefetchCampaignChunks,
  prefetchWorkspaceChunks,
} from './routeChunks';

// Heavy routes are code-split so the initial bundle (Home + Projects list)
// doesn't include OpenLayers, Chart.js, react-markdown, etc. They load via
// route.lazy rather than React.lazy + <Suspense>: the router resolves the
// chunk during navigation, so the previous page stays visible instead of a
// committed fallback that React throttles for ~300ms even when the chunk is
// already prefetched.
const lazyCreateCampaign = async () => ({
  Component: (await importCreateCampaign()).CreateCampaignPage,
});
const lazyAnnotation = async () => ({ Component: (await importAnnotation()).AnnotationPage });
const lazyCampaignOverview = async () => ({
  Component: (await importCampaignOverview()).CampaignOverviewPage,
});
const lazyCampaignSettings = async () => ({
  Component: (await importCampaignSettings()).CampaignSettingsPage,
});
const lazyCampaignTasks = async () => ({
  Component: (await importCampaignTasks()).CampaignTasksPage,
});
const lazyReview = async () => ({ Component: (await importReview()).ReviewPage });
const lazySettings = async () => ({ Component: (await importSettings()).SettingsPage });
const lazySdkAuth = async () => ({ Component: (await importSdkAuth()).SdkAuthPage });
const lazyNewProject = async () => ({ Component: (await importNewProject()).NewProjectPage });
const lazyProject = async () => ({ Component: (await importProject()).ProjectPage });
const lazyNewOrganization = async () => ({
  Component: (await importNewOrganization()).NewOrganizationPage,
});
const lazyOrganization = async () => ({ Component: (await importOrganization()).OrganizationPage });

// The id segments come from the (untrusted) URL. Validate them once here so
// every page can read a real id - an absent/non-numeric param is treated as
// not-found and redirected to the projects list.
const requireId = (raw: string | undefined) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw redirect(projectsPath());
  return null;
};

const requireCampaignId = ({ params }: LoaderFunctionArgs) => requireId(params.campaignId);
const requireProjectId = ({ params }: LoaderFunctionArgs) => requireId(params.projectId);
const requireOrgId = ({ params }: LoaderFunctionArgs) => requireId(params.orgId);

// A data router (createBrowserRouter) rather than <BrowserRouter> so navigation
// can be intercepted via useBlocker - see useUnsavedChangesGuard.
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route
      path="/"
      element={<AppLayout />}
      errorElement={<RouteErrorBoundary />}
      // Shown only on a direct load of a lazy route, while its chunk downloads.
      hydrateFallbackElement={<LoadingSpinner fullScreen text="Loading…" />}
    >
      <Route index element={<HomePage />} />
      <Route path="projects">
        <Route index element={<ProjectsPage />} />
        <Route path="new" lazy={lazyNewProject} />
        <Route path=":projectId" loader={requireProjectId}>
          <Route index lazy={lazyProject} />
          <Route path="campaigns/new" lazy={lazyCreateCampaign} />
          <Route path="campaigns/:campaignId" loader={requireCampaignId}>
            <Route index lazy={lazyCampaignOverview} />
            <Route path="annotate" lazy={lazyAnnotation} />
            <Route path="settings" lazy={lazyCampaignSettings} />
            <Route path="tasks" lazy={lazyCampaignTasks} />
            <Route path="annotations" lazy={lazyReview} />
          </Route>
        </Route>
      </Route>
      <Route path="organizations/new" lazy={lazyNewOrganization} />
      <Route path="organizations/:orgId" loader={requireOrgId} lazy={lazyOrganization} />
      <Route path="settings" lazy={lazySettings} />
      <Route path="sdk-auth" lazy={lazySdkAuth} />
      {/* Unmatched paths render a friendly 404 within the layout. */}
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  )
);

export const Router = () => {
  useEffect(
    () =>
      onIdle(() => {
        // Light chunks first so they win the bandwidth race; the heavy
        // annotation chunk (OpenLayers, Chart.js) warms last.
        prefetchWorkspaceChunks();
        prefetchCampaignChunks();
        prefetchAnnotationChunk();
      }),
    []
  );
  return <RouterProvider router={router} />;
};
