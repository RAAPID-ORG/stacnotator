import { describe, expect, it } from 'vitest';
import { pendingAdminActions, reconcileActiveOrgId } from './organizations';

const approved = (id: number) => ({ id, status: 'approved' });
const pending = (id: number) => ({ id, status: 'pending' });

describe('reconcileActiveOrgId', () => {
  it('keeps an id that is still in the list', () => {
    expect(reconcileActiveOrgId([approved(1), approved(2), approved(3)], 2, true)).toBe(2);
  });

  it('keeps a pending org the viewer picked deliberately', () => {
    expect(reconcileActiveOrgId([approved(1), pending(2)], 2, true)).toBe(2);
  });

  it('falls back to the first approved org when the persisted id is stale', () => {
    expect(reconcileActiveOrgId([approved(4), approved(5)], 2, true)).toBe(4);
  });

  it('skips pending orgs when picking the fallback', () => {
    expect(reconcileActiveOrgId([pending(4), approved(5)], 2, true)).toBe(5);
  });

  it('clears a stale id when no org is approved yet', () => {
    expect(reconcileActiveOrgId([pending(4)], 2, true)).toBeNull();
  });

  it('clears a stale id when the viewer has no orgs', () => {
    expect(reconcileActiveOrgId([], 2, true)).toBeNull();
  });

  it('defaults a session that never chose to the first approved org', () => {
    expect(reconcileActiveOrgId([pending(1), approved(2), approved(3)], null, false)).toBe(2);
  });

  it('leaves a never-chosen session without selection when nothing is approved', () => {
    expect(reconcileActiveOrgId([pending(1)], null, false)).toBeNull();
    expect(reconcileActiveOrgId([], null, false)).toBeNull();
  });

  it('leaves an explicit no-organization choice alone', () => {
    expect(reconcileActiveOrgId([approved(1), approved(2)], null, true)).toBeNull();
  });
});

describe('pendingAdminActions', () => {
  const orgs = [
    { status: 'approved', is_admin: true, pending_access_requests: 2 },
    { status: 'approved', is_admin: true, pending_access_requests: 1 },
    { status: 'pending', is_admin: false },
  ];

  it('adds up the access requests waiting on the viewer', () => {
    expect(pendingAdminActions(orgs, false)).toEqual({
      accessRequests: 3,
      organizationApprovals: 0,
      total: 3,
    });
  });

  it('counts organizations waiting for approval only for platform admins', () => {
    expect(pendingAdminActions(orgs, true)).toEqual({
      accessRequests: 3,
      organizationApprovals: 1,
      total: 4,
    });
  });

  it('is zero when nothing is waiting', () => {
    expect(pendingAdminActions([{ status: 'approved' }], true).total).toBe(0);
  });
});
