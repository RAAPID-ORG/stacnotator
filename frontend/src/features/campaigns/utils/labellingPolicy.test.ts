import { describe, expect, it } from 'vitest';
import type { LabellingPolicy, PolicyAudience } from '~/api/client';
import {
  DEFAULT_LABELLING_POLICY,
  isAudienceMember,
  withAnyoneSeeded,
  type PolicyContext,
} from './labellingPolicy';

const USER = 'user-1';
const OTHER = 'user-2';

const ctx = (overrides: Partial<PolicyContext> = {}): PolicyContext => ({
  userId: USER,
  isAdmin: false,
  isAuthoritative: false,
  isMember: false,
  ...overrides,
});

const audience = (overrides: Partial<PolicyAudience> = {}): PolicyAudience => ({
  kinds: [],
  user_ids: [],
  ...overrides,
});

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

describe('isAudienceMember', () => {
  it('undefined audience means no one', () => {
    expect(isAudienceMember(undefined, ctx({ isAdmin: true, isMember: true }))).toBe(false);
  });

  it('empty kinds and user_ids means no one', () => {
    expect(isAudienceMember(audience(), ctx({ isAdmin: true, isMember: true }))).toBe(false);
  });

  it("'anyone' always matches, even a visitor with no roles", () => {
    const a = audience({ kinds: ['anyone'] });
    expect(isAudienceMember(a, ctx({ userId: null }))).toBe(true);
  });

  it("'members' matches only when ctx.isMember", () => {
    const a = audience({ kinds: ['members'] });
    expect(isAudienceMember(a, ctx({ isMember: true }))).toBe(true);
    expect(isAudienceMember(a, ctx({ isMember: false }))).toBe(false);
  });

  it("'admins' matches only when ctx.isAdmin", () => {
    const a = audience({ kinds: ['admins'] });
    expect(isAudienceMember(a, ctx({ isAdmin: true }))).toBe(true);
    expect(isAudienceMember(a, ctx({ isAdmin: false }))).toBe(false);
  });

  it("'authoritative' matches only when ctx.isAuthoritative", () => {
    const a = audience({ kinds: ['authoritative'] });
    expect(isAudienceMember(a, ctx({ isAuthoritative: true }))).toBe(true);
    expect(isAudienceMember(a, ctx({ isAuthoritative: false }))).toBe(false);
  });

  it("'assignees' does not match when isAssigned is omitted or false", () => {
    // Task-independent call sites (e.g. explore) never pass isAssigned, so a
    // ctx without it must fall through to the user_ids check.
    const a = audience({ kinds: ['assignees'] });
    expect(isAudienceMember(a, ctx({ isAdmin: true, isAuthoritative: true, isMember: true }))).toBe(
      false
    );
    expect(isAudienceMember(a, ctx({ isAssigned: false }))).toBe(false);
  });

  it("'assignees' matches only when ctx.isAssigned", () => {
    const a = audience({ kinds: ['assignees'] });
    expect(isAudienceMember(a, ctx({ isAssigned: true }))).toBe(true);
    expect(isAudienceMember(a, ctx({ isAssigned: false }))).toBe(false);
  });

  it('user_ids is additive: an explicit id matches regardless of kinds', () => {
    const a = audience({ kinds: [], user_ids: [USER] });
    expect(isAudienceMember(a, ctx({ userId: USER }))).toBe(true);
    expect(isAudienceMember(a, ctx({ userId: OTHER }))).toBe(false);
  });

  it('a null userId never matches user_ids', () => {
    const a = audience({ user_ids: [USER] });
    expect(isAudienceMember(a, ctx({ userId: null }))).toBe(false);
  });

  it('multiple kinds are OR-ed together', () => {
    const a = audience({ kinds: ['admins', 'authoritative'] });
    expect(isAudienceMember(a, ctx({ isAdmin: false, isAuthoritative: true }))).toBe(true);
    expect(isAudienceMember(a, ctx({ isAdmin: false, isAuthoritative: false }))).toBe(false);
  });

  it('kinds and user_ids combine additively', () => {
    const a = audience({ kinds: ['admins'], user_ids: [OTHER] });
    expect(isAudienceMember(a, ctx({ userId: USER, isAdmin: true }))).toBe(true);
    expect(isAudienceMember(a, ctx({ userId: OTHER, isAdmin: false }))).toBe(true);
    expect(isAudienceMember(a, ctx({ userId: 'user-3', isAdmin: false }))).toBe(false);
  });
});
