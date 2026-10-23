import { describe, expect, it } from 'vitest';
import { campaignSections } from './campaignSections';

describe('campaignSections', () => {
  it('keeps agents and settings from a viewer who is neither member nor admin', () => {
    expect(campaignSections({})).toEqual([null, 'annotate', 'tasks', 'annotations']);
  });

  it('shows a member the labelling agents', () => {
    expect(campaignSections({ viewer_is_member: true })).toContain('agents');
    expect(campaignSections({ viewer_is_member: true })).not.toContain('settings');
  });

  it('gives an admin the campaign settings', () => {
    expect(campaignSections({ viewer_is_admin: true })).toEqual([
      null,
      'annotate',
      'tasks',
      'annotations',
      'agents',
      'settings',
    ]);
  });
});
