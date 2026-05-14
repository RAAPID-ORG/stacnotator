import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { CampaignsPage } from 'src/features/campaigns/pages/CampaignsOverviewPage';
import { HomePage } from 'src/features/home/pages/HomePage';
import { AppLayout } from '~/features/layout/components/AppLayout';

// Heavy routes are code-split so the initial bundle (Home + Campaigns list)
// doesn't include OpenLayers, Chart.js, react-markdown, etc.
const CreateCampaignPage = lazy(() =>
  import('~/features/campaigns/pages/CreateCampaignPage').then((m) => ({
    default: m.CreateCampaignPage,
  }))
);
const AnnotationPage = lazy(() =>
  import('src/features/annotation/pages/AnnotationPage').then((m) => ({
    default: m.AnnotationPage,
  }))
);
const CampaignSettingsPage = lazy(() =>
  import('~/features/campaigns/pages/CampaignSettingsPage').then((m) => ({
    default: m.CampaignSettingsPage,
  }))
);
const ReviewPage = lazy(() =>
  import('~/features/campaigns/pages/ReviewPage').then((m) => ({ default: m.ReviewPage }))
);
const SettingsPage = lazy(() =>
  import('src/features/settings/pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);

// Inline, calm fallback - sits within the AppLayout outlet so the sidebar
// and breadcrumbs stay visible. A small spinner is less jarring than a
// fullscreen takeover while a chunk fetches.
const RouteFallback = () => (
  <div className="flex-1 flex items-center justify-center py-16">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-brand-600" />
  </div>
);

export const Router = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<AppLayout />}>
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
        <Route
          path="campaigns/:campaignId/annotate"
          element={
            <Suspense fallback={<RouteFallback />}>
              <AnnotationPage />
            </Suspense>
          }
        />
        <Route
          path="campaigns/:campaignId/settings"
          element={
            <Suspense fallback={<RouteFallback />}>
              <CampaignSettingsPage />
            </Suspense>
          }
        />
        <Route
          path="campaigns/:campaignId/annotations"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ReviewPage />
            </Suspense>
          }
        />
        <Route
          path="settings"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SettingsPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  </BrowserRouter>
);
