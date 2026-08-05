import { describe, expect, it } from 'vitest';
import type { LabellingPolicy } from '~/api/client';
import { DEFAULT_LABELLING_POLICY, withAnyoneSeeded } from './labellingPolicy';

describe('withAnyoneSeeded', () => {
  it('opens the default policy to non-members on every axis that accepts it', () => {
    const seeded = withAnyoneSeeded(DEFAULT_LABELLING_POLICY);

    expect(seeded.explore?.kinds).toContain('anyone');
    expect(seeded.unassigned_tasks?.kinds).toContain('anyone');
    expect(seeded.assigned_tasks?.kinds).toContain('anyone');
  });

  it('leaves complete_assigned alone - anyone is rejected there', () => {
    const seeded = withAnyoneSeeded(DEFAULT_LABELLING_POLICY);

    expect(seeded.complete_assigned).toEqual(DEFAULT_LABELLING_POLICY.complete_assigned);
  });

  it('keeps the kinds and user_ids already on an axis', () => {
    const policy: LabellingPolicy = {
      explore: { kinds: ['admins'], user_ids: ['user-1'] },
      unassigned_tasks: { kinds: [], user_ids: [] },
      assigned_tasks: { kinds: [], user_ids: [] },
      complete_assigned: { kinds: ['assignees'], user_ids: [] },
    };

    const seeded = withAnyoneSeeded(policy);

    expect(seeded.explore?.kinds).toEqual(['admins', 'anyone']);
    expect(seeded.explore?.user_ids).toEqual(['user-1']);
  });

  it('does not duplicate anyone when it is already set, and does not mutate the input', () => {
    const policy: LabellingPolicy = {
      explore: { kinds: ['anyone'], user_ids: [] },
      unassigned_tasks: { kinds: [], user_ids: [] },
      assigned_tasks: { kinds: [], user_ids: [] },
      complete_assigned: { kinds: [], user_ids: [] },
    };

    const seeded = withAnyoneSeeded(policy);

    expect(seeded.explore?.kinds).toEqual(['anyone']);
    expect(policy.unassigned_tasks?.kinds).toEqual([]);
  });
});
