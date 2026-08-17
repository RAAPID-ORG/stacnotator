import { describe, it, expect } from 'vitest';
import type { AnnotationTaskOut } from '~/api/client';
import { CLAIM_TTL_MS, UNASSIGNED, claimedByLabel, getActiveClaim, isClaimable } from './tasks';

const NOW = 1_700_000_000_000;
const fresh = () => new Date(NOW - 60_000).toISOString(); // 1 min ago: an active claim
const stale = () => new Date(NOW - CLAIM_TTL_MS - 1_000).toISOString(); // just past TTL

/** A claim lives on the task itself: it is a lease, not an assignment row. */
const task = (
  claim: { by?: string; at?: string | null; name?: string | null } = {},
  { assignments = [], annotations = [] }: { assignments?: unknown[]; annotations?: unknown[] } = {}
) =>
  ({
    id: 1,
    task_status: 'pending',
    assignments,
    annotations,
    claimed_by_user_id: claim.by ?? null,
    claimed_at: claim.at ?? null,
    claimed_by_display_name: claim.name ?? null,
  }) as unknown as AnnotationTaskOut;

describe('UNASSIGNED sentinel', () => {
  it('is a stable, non-empty string distinct from any real user id', () => {
    expect(UNASSIGNED).toBe('__unassigned__');
  });
});

describe('isClaimable', () => {
  it('is claimable when nobody is assigned, has worked it, or holds it', () => {
    expect(isClaimable(task(), NOW)).toBe(true);
  });

  it('is not claimable once someone has annotated it', () => {
    expect(isClaimable(task({}, { annotations: [{ id: 1 }] }), NOW)).toBe(false);
  });

  it('is not claimable once an admin has assigned it', () => {
    expect(isClaimable(task({}, { assignments: [{ user_id: 'u1' }] }), NOW)).toBe(false);
  });

  it('is claimable again once the holder`s lease has expired', () => {
    expect(isClaimable(task({ by: 'u1', at: stale() }), NOW)).toBe(true);
  });

  it('is not claimable while somebody holds a live lease', () => {
    expect(isClaimable(task({ by: 'u1', at: fresh() }), NOW)).toBe(false);
  });
});

describe('getActiveClaim', () => {
  it('returns the holder of a live lease', () => {
    const claim = getActiveClaim(task({ by: 'u1', at: fresh(), name: 'Ada' }), NOW);
    expect(claim).toEqual({ userId: 'u1', displayName: 'Ada', heldForMs: 60_000 });
  });

  it('returns null once the claim has passed the TTL', () => {
    expect(getActiveClaim(task({ by: 'u1', at: stale() }), NOW)).toBeNull();
  });

  it('returns null when there is no claim at all', () => {
    expect(getActiveClaim(task(), NOW)).toBeNull();
  });
});

describe('claimedByLabel', () => {
  it('returns null when nobody currently holds the task', () => {
    expect(claimedByLabel(task(), 'me', NOW)).toBeNull();
  });

  it('says "Claimed by you" when the current user holds the active claim', () => {
    expect(claimedByLabel(task({ by: 'me', at: fresh() }), 'me', NOW)).toBe('Claimed by you');
  });

  it('names the other holder, since the point is to say who to go ask', () => {
    const t = task({ by: 'other', at: fresh(), name: 'Ada' });
    expect(claimedByLabel(t, 'me', NOW)).toBe('Ada is working on this');
  });

  it('falls back to a generic holder when the name is missing', () => {
    const t = task({ by: 'other', at: fresh() });
    expect(claimedByLabel(t, 'me', NOW)).toBe('Someone else is working on this');
  });
});
