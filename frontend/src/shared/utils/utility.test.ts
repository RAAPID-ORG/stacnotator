import { describe, expect, it } from 'vitest';

import { formatSliceLabel, formatWindowLabel, searchUsers } from './utility';

describe('formatSliceLabel', () => {
  it('labels a weekly slice with its inclusive start and end days', () => {
    expect(formatSliceLabel('2026-05-01', '2026-05-07', 'weeks', 0)).toBe('May 1-7');
  });

  it('labels a weekly slice spanning a month boundary', () => {
    expect(formatSliceLabel('2026-05-29', '2026-06-04', 'weeks', 0)).toBe('May 29 - Jun 4');
  });

  it('labels a monthly slice by its month', () => {
    expect(formatSliceLabel('2026-05-01', '2026-05-31', 'months', 0)).toBe('May');
  });

  it('labels a single-day slice', () => {
    expect(formatSliceLabel('2026-05-01', '2026-05-01', 'days', 0)).toBe('May 1');
  });

  it('accepts the compact YYYYMMDD form', () => {
    expect(formatSliceLabel('20260501', '20260507', 'weeks', 0)).toBe('May 1-7');
  });
});

describe('formatWindowLabel', () => {
  it('labels a monthly window by month and year', () => {
    expect(formatWindowLabel('2026-05-01', '2026-05-31', 'months')).toBe('May 2026');
  });

  it('labels a weekly window with its inclusive day range', () => {
    expect(formatWindowLabel('2026-05-01', '2026-05-07', 'weeks')).toBe('May 1-7, 2026');
  });

  it('labels a window spanning several months of one year', () => {
    expect(formatWindowLabel('2026-05-01', '2026-07-31', 'months')).toBe('May-Jul 2026');
  });
});

describe('searchUsers', () => {
  const user = (display_name: string, email: string) => ({ display_name, email });

  it('ranks prefix matches before substring matches', () => {
    const users = [user('jwagner', 'jwagner@example.com'), user('wagnerj', 'wagnerj@example.com')];

    const result = searchUsers(users, (u) => u, 'wag');

    expect(result.map((u) => u.display_name)).toEqual(['wagnerj', 'jwagner']);
  });

  it('ranks word-prefix matches in the name between full-prefix and substring matches', () => {
    const users = [
      user('awagstaff', 'awagstaff@example.com'),
      user('Jonas Wagner', 'jwagner@example.com'),
      user('wagnerj', 'wagnerj@example.com'),
    ];

    const result = searchUsers(users, (u) => u, 'wag');

    expect(result.map((u) => u.display_name)).toEqual(['wagnerj', 'Jonas Wagner', 'awagstaff']);
  });

  it('keeps the incoming order within a rank tier', () => {
    const users = [user('wagner-a', 'a@example.com'), user('wagner-b', 'b@example.com')];

    const result = searchUsers(users, (u) => u, 'wagner');

    expect(result.map((u) => u.display_name)).toEqual(['wagner-a', 'wagner-b']);
  });

  it('matches case-insensitively against name and email', () => {
    const users = [user('Alice', 'alice@example.com'), user('Bob', 'wagner@example.com')];

    expect(searchUsers(users, (u) => u, 'WAG').map((u) => u.display_name)).toEqual(['Bob']);
  });

  it('drops non-matching users', () => {
    const users = [user('Alice', 'alice@example.com')];

    expect(searchUsers(users, (u) => u, 'zzz')).toEqual([]);
  });

  it('returns everyone unchanged for an empty or whitespace query', () => {
    const users = [user('Bob', 'bob@example.com'), user('Alice', 'alice@example.com')];

    expect(searchUsers(users, (u) => u, '')).toEqual(users);
    expect(searchUsers(users, (u) => u, '   ')).toEqual(users);
  });

  it('reads the user through the accessor', () => {
    const items = [
      { user: user('jwagner', 'jwagner@example.com') },
      { user: user('wagnerj', 'wagnerj@example.com') },
    ];

    const result = searchUsers(items, (item) => item.user, 'wag');

    expect(result.map((item) => item.user.display_name)).toEqual(['wagnerj', 'jwagner']);
  });
});
