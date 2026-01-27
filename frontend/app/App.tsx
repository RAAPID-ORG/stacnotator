import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '~/components/shared/Layout';
import { CampaignsPage } from '~/pages/CampaignsPage';
import { HomePage } from '~/pages/HomePage';
import { AnnotationPage } from '~/pages/AnnotationPage';
import { CampaignSettingsPage } from '~/pages/CampaignSettingsPage';
import { SettingsPage } from '~/pages/SettingsPage';
import { ViewAnnotationsPage } from '~/pages/ViewAnnotationsPage';

export const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="campaigns/:campaignId/annotate" element={<AnnotationPage />} />
        <Route path="campaigns/:campaignId/settings" element={<CampaignSettingsPage />} />
        <Route path="campaigns/:campaignId/annotations" element={<ViewAnnotationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  </BrowserRouter>
);
