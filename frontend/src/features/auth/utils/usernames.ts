import i18n from '~/shared/i18n';

/** Username rules, mirroring backend/src/auth/usernames.py so the form can say
 *  what is wrong before asking. The backend stays the authority - it owns
 *  uniqueness, which no client can know. */
const MIN_LENGTH = 3;
const MAX_LENGTH = 30;
const PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export const usernameRules = () => i18n.t('auth:username.rules');

export const usernameError = (username: string): string | null => {
  const value = username.trim();
  if (value.length < MIN_LENGTH) return i18n.t('auth:username.tooShort', { min: MIN_LENGTH });
  if (value.length > MAX_LENGTH) return i18n.t('auth:username.tooLong', { max: MAX_LENGTH });
  if (!PATTERN.test(value)) return usernameRules();
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
