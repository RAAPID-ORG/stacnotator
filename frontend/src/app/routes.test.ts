import { describe, it, expect } from 'vitest';
import {
  projectsPath,
  newProjectPath,
  projectPath,
  newCampaignPath,
  campaignPath,
  newOrganizationPath,
  organizationPath,
  ANNOTATION_ROUTE,
} from './routes';

describe('project path builders', () => {
  it('builds the projects list and creation paths', () => {
    expect(projectsPath()).toBe('/projects');
    expect(newProjectPath()).toBe('/projects/new');
  });

  it('builds a project detail path', () => {
    expect(projectPath(7)).toBe('/projects/7');
  });

  it('builds a campaign creation path scoped to a project', () => {
    expect(newCampaignPath(7)).toBe('/projects/7/campaigns/new');
  });
});

describe('campaignPath', () => {
  it('builds the campaign root without a subpage', () => {
    expect(campaignPath(3, 42)).toBe('/projects/3/campaigns/42');
  });

  it('appends each known subpage', () => {
    expect(campaignPath(3, 42, 'annotate')).toBe('/projects/3/campaigns/42/annotate');
    expect(campaignPath(3, 42, 'settings')).toBe('/projects/3/campaigns/42/settings');
    expect(campaignPath(3, 42, 'tasks')).toBe('/projects/3/campaigns/42/tasks');
    expect(campaignPath(3, 42, 'annotations')).toBe('/projects/3/campaigns/42/annotations');
  });
});

describe('organization path builders', () => {
  it('builds the organization creation and detail paths', () => {
    expect(newOrganizationPath()).toBe('/organizations/new');
    expect(organizationPath(12)).toBe('/organizations/12');
  });
});

describe('ANNOTATION_ROUTE', () => {
  it('matches an annotation route', () => {
    expect(ANNOTATION_ROUTE.test('/projects/3/campaigns/42/annotate')).toBe(true);
  });

  it('matches nested annotation routes', () => {
    expect(ANNOTATION_ROUTE.test('/projects/3/campaigns/42/annotate/1')).toBe(true);
  });

  it('rejects other campaign subpages', () => {
    expect(ANNOTATION_ROUTE.test('/projects/3/campaigns/42/settings')).toBe(false);
    expect(ANNOTATION_ROUTE.test('/projects/3/campaigns/42')).toBe(false);
  });

  it('rejects the pre-projects campaign route', () => {
    expect(ANNOTATION_ROUTE.test('/campaigns/42/annotate')).toBe(false);
  });
});
