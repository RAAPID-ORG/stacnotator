/** Username rules, mirroring backend/src/auth/usernames.py so the form can say
 *  what is wrong before asking. The backend stays the authority - it owns
 *  uniqueness, which no client can know. */
const MIN_LENGTH = 3;
const MAX_LENGTH = 30;
const PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export const USERNAME_RULES =
  'Letters, digits, dots, underscores or hyphens - 3 to 30 characters, starting with a letter or digit.';

export const usernameError = (username: string): string | null => {
  const value = username.trim();
  if (value.length < MIN_LENGTH) return `Username must be at least ${MIN_LENGTH} characters`;
  if (value.length > MAX_LENGTH) return `Username must be at most ${MAX_LENGTH} characters`;
  if (!PATTERN.test(value)) return USERNAME_RULES;
  return null;
};

/** A starting point built from what the identity provider gave us, so most
 *  people only have to press Continue. */
export const suggestUsername = (email: string | null | undefined): string => {
  const local = (email ?? '').split('@')[0];
  const cleaned = local
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/^[._-]+/, '')
    .slice(0, MAX_LENGTH);
  return usernameError(cleaned) === null ? cleaned : '';
};
