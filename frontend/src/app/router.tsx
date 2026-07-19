import { lazy, Suspense, useEffect } from 'react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  type LoaderFunctionArgs,
  redirect,
  Route,
  RouterProvider,
} from 'react-router-dom';
import { CampaignsPage } from 'src/features/campaigns/pages/CampaignsOverviewPage';
import { HomePage } from 'src/features/home/pages/HomePage';
import { AppLayout } from '~/features/layout/components/AppLayout';
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
  importReview,
  importSdkAuth,
  importSettings,
  prefetchCampaignChunks,
} from './routeChunks';

// Heavy routes are code-split so the initial bundle (Home + Campaigns list)
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

const RouteFallback = () => (
  <Delayed>
    <SkeletonPage>
      <SkeletonForm sections={3} />
    </SkeletonPage>
  </Delayed>
);

// The :campaignId segment comes from the (untrusted) URL. Validate it once here
// so every campaign page can read a real id - an absent/non-numeric param is
// treated as not-found and redirected to the list.
const requireCampaignId = ({ params }: LoaderFunctionArgs) => {
  const id = Number(params.campaignId);
  if (!Number.isInteger(id) || id <= 0) throw redirect('/campaigns');
  return null;
};

// A data router (createBrowserRouter) rather than <BrowserRouter> so navigation
// can be intercepted via useBlocker - see useUnsavedChangesGuard.
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<AppLayout />} errorElement={<RouteErrorBoundary />}>
      <Route index element={<HomePage />} />
      <Route path="campaigns" element={<CampaignsPage />} />
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
