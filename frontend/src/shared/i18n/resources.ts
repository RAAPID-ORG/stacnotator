import common from './locales/en/common.json';
import auth from './locales/en/auth.json';
import settings from './locales/en/settings.json';
import organizations from './locales/en/organizations.json';
import projects from './locales/en/projects.json';
import campaigns from './locales/en/campaigns.json';
import imagery from './locales/en/imagery.json';
import review from './locales/en/review.json';
import annotation from './locales/en/annotation.json';
import panels from './locales/en/panels.json';
import areaEstimation from './locales/en/areaEstimation.json';
import visualizers from './locales/en/visualizers.json';
import esCommon from './locales/es/common.json';
import esAuth from './locales/es/auth.json';
import esSettings from './locales/es/settings.json';
import esOrganizations from './locales/es/organizations.json';
import esProjects from './locales/es/projects.json';
import esCampaigns from './locales/es/campaigns.json';
import esImagery from './locales/es/imagery.json';
import esReview from './locales/es/review.json';
import esAnnotation from './locales/es/annotation.json';
import esPanels from './locales/es/panels.json';
import esAreaEstimation from './locales/es/areaEstimation.json';
import esVisualizers from './locales/es/visualizers.json';

export const resources = {
  en: {
    common,
    auth,
    settings,
    organizations,
    projects,
    campaigns,
    imagery,
    review,
    annotation,
    panels,
    areaEstimation,
    visualizers,
  },
  es: {
    common: esCommon,
    auth: esAuth,
    settings: esSettings,
    organizations: esOrganizations,
    projects: esProjects,
    campaigns: esCampaigns,
    imagery: esImagery,
    review: esReview,
    annotation: esAnnotation,
    panels: esPanels,
    areaEstimation: esAreaEstimation,
    visualizers: esVisualizers,
  },
} as const;
