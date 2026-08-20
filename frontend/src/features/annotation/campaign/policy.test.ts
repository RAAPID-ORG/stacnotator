import { describe, it, expect } from 'vitest';
import type { PolicyAudience } from '~/api/client';
import type { PolicyContext } from '~/features/campaigns/utils/labellingPolicy';
import { canModifyAnnotation } from './annotation';

const USER = 'user-1';
const OTHER = 'user-2';

const ctx = (overrides: Partial<PolicyContext> = {}): PolicyContext => ({
  userId: USER,
  isAdmin: false,
  isAuthoritative: false,
  isMember: false,
  ...overrides,
});

/** What a campaign that never touched the setting has. */
const ADMINS: PolicyAudience = { kinds: ['admins'], user_ids: [] };
const MEMBERS: PolicyAudience = { kinds: ['members'], user_ids: [] };

describe('canModifyAnnotation', () => {
  const mine = { created_by_user_id: USER };
  const theirs = { created_by_user_id: OTHER };

  it('lets an author change their own annotation, whatever the campaign says', () => {
    expect(canModifyAnnotation(mine, ctx(), { kinds: [], user_ids: [] })).toBe(true);
  });

  it("keeps a plain member off someone else's annotation by default", () => {
    expect(canModifyAnnotation(theirs, ctx({ isMember: true }), ADMINS)).toBe(false);
  });

  it("lets a campaign admin change anyone's", () => {
    expect(canModifyAnnotation(theirs, ctx({ isAdmin: true }), ADMINS)).toBe(true);
  });

  // A campaign that wants a shared canvas says so, and then members may.
  it('opens other people’s annotations to members when the campaign does', () => {
    expect(canModifyAnnotation(theirs, ctx({ isMember: true }), MEMBERS)).toBe(true);
  });

  it('treats a viewer with no identity as nobody', () => {
    expect(canModifyAnnotation(theirs, ctx({ userId: null }), ADMINS)).toBe(false);
  });

  // A campaign whose stored policy predates the axis reads as undefined here.
  it('falls back to nobody but the author when the campaign has no rule', () => {
    expect(canModifyAnnotation(theirs, ctx({ isAdmin: true }), undefined)).toBe(false);
  });
});
