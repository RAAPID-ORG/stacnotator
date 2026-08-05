import { describe, expect, it } from 'vitest';
import { reconcileActiveOrgId } from './organizations';

describe('reconcileActiveOrgId', () => {
  it('keeps an id that is still in the list', () => {
    expect(reconcileActiveOrgId([1, 2, 3], 2)).toBe(2);
  });

  it('falls back to the first org when the persisted id is stale', () => {
    expect(reconcileActiveOrgId([4, 5], 2)).toBe(4);
  });

  it('clears a stale id when the viewer has no orgs', () => {
    expect(reconcileActiveOrgId([], 2)).toBeNull();
  });

  it('leaves an explicit no-organization choice alone', () => {
    expect(reconcileActiveOrgId([1, 2], null)).toBeNull();
  });
});
