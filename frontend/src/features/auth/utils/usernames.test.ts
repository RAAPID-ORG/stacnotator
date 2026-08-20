import { describe, expect, it } from 'vitest';
import { suggestUsername, usernameError } from './usernames';

describe('usernameError', () => {
  it('accepts the shapes people actually type', () => {
    for (const name of ['ada', 'ada.lovelace', 'ada_lovelace', 'ada-1']) {
      expect(usernameError(name)).toBeNull();
    }
  });

  it('rejects spaces, punctuation and a leading separator', () => {
    for (const name of ['ada lovelace', 'ada@home', '.ada']) {
      expect(usernameError(name)).not.toBeNull();
    }
  });

  it('rejects names that are too short or too long', () => {
    expect(usernameError('ab')).toContain('at least');
    expect(usernameError('a'.repeat(31))).toContain('at most');
  });
});

describe('suggestUsername', () => {
  it('takes the email local part', () => {
    expect(suggestUsername('ada.lovelace@example.com')).toBe('ada.lovelace');
  });

  it('drops characters a username cannot carry', () => {
    expect(suggestUsername('ada+news@example.com')).toBe('adanews');
  });

  it('suggests nothing when what is left would not be valid', () => {
    expect(suggestUsername('a@example.com')).toBe('');
    expect(suggestUsername(null)).toBe('');
  });
});
