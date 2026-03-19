import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { CampaignsPage } from 'src/features/campaigns/pages/CampaignsOverviewPage';
import { CreateCampaignPage } from '~/features/campaigns/pages/CreateCampaignPage';
import { HomePage } from 'src/features/home/pages/HomePage';
import { AnnotationPage } from 'src/features/annotation/pages/AnnotationPage';
import { SettingsPage } from 'src/features/settings/pages/SettingsPage';
import { CampaignSettingsPage } from '~/features/campaigns/pages/CampaignSettingsPage';
import { ReviewPage } from '~/features/campaigns/pages/ReviewPage';
import { AppLayout } from '~/features/layout/components/AppLayout';

export const Router = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="campaigns/new" element={<CreateCampaignPage />} />
        <Route path="campaigns/:campaignId/annotate" element={<AnnotationPage />} />
        <Route path="campaigns/:campaignId/settings" element={<CampaignSettingsPage />} />
        <Route path="campaigns/:campaignId/annotations" element={<ReviewPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  </BrowserRouter>
);
