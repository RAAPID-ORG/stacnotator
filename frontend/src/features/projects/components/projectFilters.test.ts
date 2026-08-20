import { describe, it, expect } from 'vitest';
import type { ProjectOut } from '~/api/client';
import { defaultProjectFilter, filterProjects } from './projectFilters';

const project = (overrides: Partial<ProjectOut> & Pick<ProjectOut, 'id'>): ProjectOut => ({
  organization_id: 1,
  name: `project-${overrides.id}`,
  visibility: 'private',
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const memberInOrg1 = project({ id: 1, organization_id: 1, is_member: true, has_access: true });
const memberInOrg2 = project({ id: 2, organization_id: 2, is_member: true, has_access: true });
const publicInOrg1 = project({ id: 3, organization_id: 1, visibility: 'public', has_access: true });
const listedInOrg2 = project({ id: 4, organization_id: 2 });
const orgPublicInOrg1 = project({
  id: 5,
  organization_id: 1,
  visibility: 'organization',
  has_access: true,
});

const all = [memberInOrg1, memberInOrg2, publicInOrg1, listedInOrg2, orgPublicInOrg1];

const ids = (projects: ProjectOut[]) => projects.map((p) => p.id);

const withOrg = { activeOrgId: 1, belongsToAnyOrg: true };
const noOrgButMemberships = { activeOrgId: null, belongsToAnyOrg: true };
const noOrgAtAll = { activeOrgId: null, belongsToAnyOrg: false };

describe('defaultProjectFilter', () => {
  it('starts on "mine" with an active organization', () => {
    expect(defaultProjectFilter(1, false)).toBe('mine');
  });

  it('starts on "mine" without an active organization once the viewer is in a project', () => {
    expect(defaultProjectFilter(null, true)).toBe('mine');
  });

  it('starts on "public" for a viewer with no organization and no project', () => {
    expect(defaultProjectFilter(null, false)).toBe('public');
  });
});

describe('filterProjects with an active organization', () => {
  it('scopes "mine" to memberships in the active organization', () => {
    expect(ids(filterProjects(all, { ...withOrg, filter: 'mine' }))).toEqual([1]);
  });

  it('shows every active-org project for "organization", including org-public rows', () => {
    expect(ids(filterProjects(all, { ...withOrg, filter: 'organization' }))).toEqual([1, 3, 5]);
  });

  it('keeps only platform-public projects for "public"', () => {
    expect(ids(filterProjects(all, { ...withOrg, filter: 'public' }))).toEqual([3]);
  });

  it('unions active-org, public, and cross-org memberships for "all"', () => {
    expect(ids(filterProjects(all, { ...withOrg, filter: 'all' }))).toEqual([1, 2, 3, 5]);
  });
});

describe('filterProjects without an active organization', () => {
  it('shows only platform-public projects when the viewer has organizations', () => {
    expect(ids(filterProjects(all, { ...noOrgButMemberships, filter: 'all' }))).toEqual([3]);
    expect(ids(filterProjects(all, { ...noOrgButMemberships, filter: 'public' }))).toEqual([3]);
    expect(filterProjects(all, { ...noOrgButMemberships, filter: 'mine' })).toEqual([]);
  });

  it('keeps explicit memberships visible for viewers in no organization', () => {
    expect(ids(filterProjects(all, { ...noOrgAtAll, filter: 'all' }))).toEqual([1, 2, 3]);
    expect(ids(filterProjects(all, { ...noOrgAtAll, filter: 'mine' }))).toEqual([1, 2]);
    expect(ids(filterProjects(all, { ...noOrgAtAll, filter: 'public' }))).toEqual([3]);
  });

  it('yields nothing for "organization"', () => {
    expect(filterProjects(all, { ...noOrgAtAll, filter: 'organization' })).toEqual([]);
  });
});

describe('filterProjects query', () => {
  it('matches the name query case-insensitively on top of the filter', () => {
    const named = [
      project({ id: 6, name: 'Maize Yield', visibility: 'public' }),
      project({ id: 7, name: 'Rice', visibility: 'public' }),
    ];
    expect(ids(filterProjects(named, { ...noOrgAtAll, filter: 'all', query: '  maize ' }))).toEqual(
      [6]
    );
  });
});
