import { describe, expect, it } from 'vitest';
import { projectSections } from './projectSections';

describe('projectSections', () => {
  it('shows a visitor only the public sections', () => {
    expect(projectSections({ is_admin: false, is_member: false })).toEqual([
      'campaigns',
      'visualizers',
    ]);
  });

  it('adds the members to a member', () => {
    expect(projectSections({ is_member: true })).toEqual(['campaigns', 'visualizers', 'members']);
  });

  it('gives an admin every section', () => {
    expect(projectSections({ is_admin: true })).toEqual([
      'campaigns',
      'visualizers',
      'members',
      'settings',
    ]);
  });
});
