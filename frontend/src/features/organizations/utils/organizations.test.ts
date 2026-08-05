import { describe, expect, it } from 'vitest';
import { parseEmailList, reconcileActiveOrgId } from './organizations';

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

describe('parseEmailList', () => {
  it('splits on commas, semicolons, and whitespace', () => {
    expect(parseEmailList('a@x.io, b@x.io;c@x.io\nd@x.io').emails).toEqual([
      'a@x.io',
      'b@x.io',
      'c@x.io',
      'd@x.io',
    ]);
  });

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(parseEmailList('A@x.io a@x.io').emails).toEqual(['A@x.io']);
  });

  it('separates entries that cannot be an address', () => {
    const { emails, invalid } = parseEmailList('ok@x.io nope, also@bad');
    expect(emails).toEqual(['ok@x.io']);
    expect(invalid).toEqual(['nope', 'also@bad']);
  });

  it('ignores empty input', () => {
    expect(parseEmailList('  \n ')).toEqual({ emails: [], invalid: [] });
  });
});
