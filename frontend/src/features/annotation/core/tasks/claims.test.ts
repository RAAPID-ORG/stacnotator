import { describe, it, expect } from 'vitest';
import type { AnnotationTaskOut } from '~/api/client';
import { CLAIM_TTL_MS, UNASSIGNED, claimedByLabel, getActiveClaim, isClaimable } from './claims';

const NOW = 1_700_000_000_000;
const fresh = () => new Date(NOW - 60_000).toISOString(); // 1 min ago: an active claim
const stale = () => new Date(NOW - CLAIM_TTL_MS - 1_000).toISOString(); // just past TTL

const task = (assignments: unknown[], annotations: unknown[] = []) =>
  ({ id: 1, task_status: 'pending', assignments, annotations }) as unknown as AnnotationTaskOut;

describe('UNASSIGNED sentinel', () => {
  it('is a stable, non-empty string distinct from any real user id', () => {
    expect(UNASSIGNED).toBe('__unassigned__');
  });
});

describe('isClaimable', () => {
  it('is claimable when there are no annotations and no assignments at all', () => {
    expect(isClaimable(task([]), NOW)).toBe(true);
  });

  it('is not claimable once someone has annotated it', () => {
    expect(isClaimable(task([], [{ id: 1 }]), NOW)).toBe(false);
  });

  it('is claimable when every assignment is a stale soft claim', () => {
    const t = task([{ user_id: 'u1', status: 'pending', claimed_at: stale() }]);
    expect(isClaimable(t, NOW)).toBe(true);
  });

  it('is not claimable while an assignment holds a fresh soft claim', () => {
    const t = task([{ user_id: 'u1', status: 'pending', claimed_at: fresh() }]);
    expect(isClaimable(t, NOW)).toBe(false);
  });

  it('is not claimable once a hard assignment (claimed_at null) exists', () => {
    const t = task([{ user_id: 'u1', status: 'pending', claimed_at: null }]);
    expect(isClaimable(t, NOW)).toBe(false);
  });
});

describe('getActiveClaim', () => {
  it('returns the assignment holding a fresh soft claim', () => {
    const claim = { user_id: 'u1', status: 'pending', claimed_at: fresh() };
    const t = task([claim]);
    expect(getActiveClaim(t, NOW)).toEqual(claim);
  });

  it('returns null once the claim has passed the TTL', () => {
    const t = task([{ user_id: 'u1', status: 'pending', claimed_at: stale() }]);
    expect(getActiveClaim(t, NOW)).toBeNull();
  });

  it('returns null when there is no claim at all', () => {
    expect(getActiveClaim(task([]), NOW)).toBeNull();
  });
});

describe('claimedByLabel', () => {
  it('returns null when nobody currently holds the task', () => {
    expect(claimedByLabel(task([]), 'me', NOW)).toBeNull();
  });

  it('says "Claimed by you" when the current user holds the active claim', () => {
    const t = task([{ user_id: 'me', status: 'pending', claimed_at: fresh() }]);
    expect(claimedByLabel(t, 'me', NOW)).toBe('Claimed by you');
  });

  it('names another claimant by display name when someone else holds it', () => {
    const t = task([
      { user_id: 'other', status: 'pending', claimed_at: fresh(), user_display_name: 'Ada' },
    ]);
    expect(claimedByLabel(t, 'me', NOW)).toBe('Claimed by Ada');
  });

  it('falls back to email, then "another user", when display name is missing', () => {
    const withEmail = task([
      { user_id: 'other', status: 'pending', claimed_at: fresh(), user_email: 'a@b.com' },
    ]);
    expect(claimedByLabel(withEmail, 'me', NOW)).toBe('Claimed by a@b.com');

    const withNeither = task([{ user_id: 'other', status: 'pending', claimed_at: fresh() }]);
    expect(claimedByLabel(withNeither, 'me', NOW)).toBe('Claimed by another user');
  });
});
