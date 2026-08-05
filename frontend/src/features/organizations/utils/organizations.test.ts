import { describe, expect, it } from 'vitest';
import { reconcileActiveOrgId } from './organizations';

const approved = (id: number) => ({ id, status: 'approved' });
const pending = (id: number) => ({ id, status: 'pending' });

describe('reconcileActiveOrgId', () => {
  it('keeps an id that is still in the list', () => {
    expect(reconcileActiveOrgId([approved(1), approved(2), approved(3)], 2)).toBe(2);
  });

  it('keeps a pending org the viewer picked deliberately', () => {
    expect(reconcileActiveOrgId([approved(1), pending(2)], 2)).toBe(2);
  });

  it('falls back to the first approved org when the persisted id is stale', () => {
    expect(reconcileActiveOrgId([approved(4), approved(5)], 2)).toBe(4);
  });

  it('skips pending orgs when picking the fallback', () => {
    expect(reconcileActiveOrgId([pending(4), approved(5)], 2)).toBe(5);
  });

  it('clears a stale id when no org is approved yet', () => {
    expect(reconcileActiveOrgId([pending(4)], 2)).toBeNull();
  });

  it('clears a stale id when the viewer has no orgs', () => {
    expect(reconcileActiveOrgId([], 2)).toBeNull();
  });

  it('leaves an explicit no-organization choice alone', () => {
    expect(reconcileActiveOrgId([approved(1), approved(2)], null)).toBeNull();
  });
});
