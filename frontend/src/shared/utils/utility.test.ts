import { describe, expect, it } from 'vitest';
import { searchUsers } from './utility';

const user = (display_name: string, email: string) => ({ display_name, email });

describe('searchUsers', () => {
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
