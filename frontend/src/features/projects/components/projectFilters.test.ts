import { describe, it, expect } from 'vitest';
import type { ProjectOut } from '~/api/client';
import { filterProjects } from './projectFilters';

const project = (overrides: Partial<ProjectOut> & Pick<ProjectOut, 'id'>): ProjectOut => ({
  organization_id: 1,
  name: `project-${overrides.id}`,
  is_public: false,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const memberInOrg1 = project({ id: 1, organization_id: 1, is_member: true });
const memberInOrg2 = project({ id: 2, organization_id: 2, is_member: true });
const publicInOrg1 = project({ id: 3, organization_id: 1, is_public: true });
const listedInOrg2 = project({ id: 4, organization_id: 2 });

const all = [memberInOrg1, memberInOrg2, publicInOrg1, listedInOrg2];

const ids = (projects: ProjectOut[]) => projects.map((p) => p.id);

describe('filterProjects', () => {
  it('scopes "mine" to memberships in the active organization', () => {
    expect(ids(filterProjects(all, { filter: 'mine', activeOrgId: 1 }))).toEqual([1]);
  });

  it('falls back to every membership when no organization is active', () => {
    expect(ids(filterProjects(all, { filter: 'mine', activeOrgId: null }))).toEqual([1, 2]);
  });

  it('scopes "organization" to the active organization regardless of membership', () => {
    expect(ids(filterProjects(all, { filter: 'organization', activeOrgId: 2 }))).toEqual([2, 4]);
  });

  it('yields nothing for "organization" without an active organization', () => {
    expect(filterProjects(all, { filter: 'organization', activeOrgId: null })).toEqual([]);
  });

  it('keeps only public projects for "public"', () => {
    expect(ids(filterProjects(all, { filter: 'public', activeOrgId: 1 }))).toEqual([3]);
  });

  it('keeps everything for "all", including cross-organization rows', () => {
    expect(ids(filterProjects(all, { filter: 'all', activeOrgId: 1 }))).toEqual([1, 2, 3, 4]);
  });

  it('matches the name query case-insensitively on top of the filter', () => {
    const named = [project({ id: 5, name: 'Maize Yield' }), project({ id: 6, name: 'Rice' })];
    expect(
      ids(filterProjects(named, { filter: 'all', activeOrgId: null, query: '  maize ' }))
    ).toEqual([5]);
  });
});
