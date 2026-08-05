export const projectsPath = () => '/projects';
export const newProjectPath = () => '/projects/new';
export const projectPath = (projectId: number) => `/projects/${projectId}`;
export const newCampaignPath = (projectId: number) => `/projects/${projectId}/campaigns/new`;

export type CampaignSubpage = 'annotate' | 'settings' | 'tasks' | 'annotations';
export const campaignPath = (projectId: number, campaignId: number, sub?: CampaignSubpage) =>
  `/projects/${projectId}/campaigns/${campaignId}${sub ? `/${sub}` : ''}`;

export const newOrganizationPath = () => '/organizations/new';
export const organizationPath = (orgId: number) => `/organizations/${orgId}`;

export const ANNOTATION_ROUTE = /^\/projects\/\d+\/campaigns\/\d+\/annotate/;
