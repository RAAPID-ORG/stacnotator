import { lazy, Suspense, useEffect } from 'react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  type LoaderFunctionArgs,
  redirect,
  Route,
  RouterProvider,
} from 'react-router-dom';
import { getCampaign } from '~/api/client';
import { HomePage } from 'src/features/home/pages/HomePage';
import { ProjectsPage } from 'src/features/projects/pages/ProjectsPage';
import { AppLayout } from '~/app/AppLayout';
import { campaignPath, projectsPath } from '~/app/routes';
import { Delayed } from '~/shared/ui/Delayed';
import { SkeletonForm, SkeletonPage } from '~/shared/ui/Skeleton';
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
  prefetchCampaignChunks,
} from './routeChunks';

// Heavy routes are code-split so the initial bundle (Home + Projects list)
// doesn't include OpenLayers, Chart.js, react-markdown, etc.
const CreateCampaignPage = lazy(() =>
  importCreateCampaign().then((m) => ({ default: m.CreateCampaignPage }))
);
const AnnotationPage = lazy(() => importAnnotation().then((m) => ({ default: m.AnnotationPage })));
const CampaignOverviewPage = lazy(() =>
  importCampaignOverview().then((m) => ({ default: m.CampaignOverviewPage }))
);
const CampaignSettingsPage = lazy(() =>
  importCampaignSettings().then((m) => ({ default: m.CampaignSettingsPage }))
);
const CampaignTasksPage = lazy(() =>
  importCampaignTasks().then((m) => ({ default: m.CampaignTasksPage }))
);
const ReviewPage = lazy(() => importReview().then((m) => ({ default: m.ReviewPage })));
const SettingsPage = lazy(() => importSettings().then((m) => ({ default: m.SettingsPage })));
const SdkAuthPage = lazy(() => importSdkAuth().then((m) => ({ default: m.SdkAuthPage })));
const NewProjectPage = lazy(() => importNewProject().then((m) => ({ default: m.NewProjectPage })));
const ProjectPage = lazy(() => importProject().then((m) => ({ default: m.ProjectPage })));
const NewOrganizationPage = lazy(() =>
  importNewOrganization().then((m) => ({ default: m.NewOrganizationPage }))
);
const OrganizationPage = lazy(() =>
  importOrganization().then((m) => ({ default: m.OrganizationPage }))
);

const RouteFallback = () => (
  <Delayed>
    <SkeletonPage>
      <SkeletonForm sections={3} />
    </SkeletonPage>
  </Delayed>
);

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

// The API client is configured with throwOnError, so an unreadable campaign
// (gone, or not visible to this user) has to be turned back into "no project".
const resolveProjectId = async (campaignId: number) => {
  try {
    const res = await getCampaign({ path: { campaign_id: campaignId } });
    return res.data?.project_id;
  } catch {
    return undefined;
  }
};

// Campaign URLs used to be project-less. Resolve the owning project from the
// API and forward, so old links and bookmarks keep working.
async function redirectLegacyCampaign({ params, request }: LoaderFunctionArgs) {
  const campaignId = Number(params.campaignId);
  if (!Number.isInteger(campaignId) || campaignId <= 0) throw redirect(projectsPath());
  const projectId = await resolveProjectId(campaignId);
  if (!projectId) throw redirect(projectsPath());
  const sub = params['*'] ? `/${params['*']}` : '';
  const search = new URL(request.url).search;
  throw redirect(`${campaignPath(projectId, campaignId)}${sub}${search}`);
}

// A data router (createBrowserRouter) rather than <BrowserRouter> so navigation
// can be intercepted via useBlocker - see useUnsavedChangesGuard.
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<AppLayout />} errorElement={<RouteErrorBoundary />}>
      <Route index element={<HomePage />} />
      <Route path="projects">
        <Route index element={<ProjectsPage />} />
        <Route
          path="new"
          element={
            <Suspense fallback={<RouteFallback />}>
              <NewProjectPage />
            </Suspense>
          }
        />
        <Route path=":projectId" loader={requireProjectId}>
          <Route
            index
            element={
              <Suspense fallback={<RouteFallback />}>
                <ProjectPage />
              </Suspense>
            }
          />
          <Route
            path="campaigns/new"
            element={
              <Suspense fallback={<RouteFallback />}>
                <CreateCampaignPage />
              </Suspense>
            }
          />
          <Route path="campaigns/:campaignId" loader={requireCampaignId}>
            <Route
              index
              element={
                <Suspense fallback={<RouteFallback />}>
                  <CampaignOverviewPage />
                </Suspense>
              }
            />
            <Route
              path="annotate"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <AnnotationPage />
                </Suspense>
              }
            />
            <Route
              path="settings"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <CampaignSettingsPage />
                </Suspense>
              }
            />
            <Route
              path="tasks"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <CampaignTasksPage />
                </Suspense>
              }
            />
            <Route
              path="annotations"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <ReviewPage />
                </Suspense>
              }
            />
          </Route>
        </Route>
      </Route>
      <Route
        path="organizations/new"
        element={
          <Suspense fallback={<RouteFallback />}>
            <NewOrganizationPage />
          </Suspense>
        }
      />
      <Route
        path="organizations/:orgId"
        loader={requireOrgId}
        element={
          <Suspense fallback={<RouteFallback />}>
            <OrganizationPage />
          </Suspense>
        }
      />
      <Route path="campaigns" loader={() => redirect(projectsPath())} />
      <Route path="campaigns/new" loader={() => redirect(projectsPath())} />
      <Route path="campaigns/:campaignId/*" loader={redirectLegacyCampaign} />
      <Route
        path="settings"
        element={
          <Suspense fallback={<RouteFallback />}>
            <SettingsPage />
          </Suspense>
        }
      />
      <Route
        path="sdk-auth"
        element={
          <Suspense fallback={<RouteFallback />}>
            <SdkAuthPage />
          </Suspense>
        }
      />
      {/* Unmatched paths render a friendly 404 within the layout. */}
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  )
);

export const Router = () => {
  useEffect(() => onIdle(prefetchCampaignChunks), []);
  return <RouterProvider router={router} />;
};
