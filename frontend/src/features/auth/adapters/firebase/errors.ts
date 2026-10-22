import i18n from '~/shared/i18n';

/** Firebase's error codes stay in this folder - the UI asks for a message, not a code. */

function authErrorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return '';
}

type AuthErrorKey =
  | 'emailInUse'
  | 'weakPassword'
  | 'passwordRequirements'
  | 'invalidEmail'
  | 'signUpDisabled'
  | 'signUpRestricted'
  | 'tooManyRequests'
  | 'network'
  | 'currentPasswordIncorrect'
  | 'newPasswordWeak';

const SHARED_ERRORS: Record<string, AuthErrorKey> = {
  'auth/email-already-in-use': 'emailInUse',
  'auth/weak-password': 'weakPassword',
  'auth/password-does-not-meet-requirements': 'passwordRequirements',
  'auth/invalid-email': 'invalidEmail',
  'auth/operation-not-allowed': 'signUpDisabled',
  'auth/admin-restricted-operation': 'signUpRestricted',
  'auth/too-many-requests': 'tooManyRequests',
  'auth/network-request-failed': 'network',
};

export const SIGN_IN_ERRORS = SHARED_ERRORS;

/** Reauthentication blames a different field than sign-in does: the old password, not the login. */
export const CHANGE_PASSWORD_ERRORS: Record<string, AuthErrorKey> = {
  ...SHARED_ERRORS,
  'auth/wrong-password': 'currentPasswordIncorrect',
  'auth/invalid-credential': 'currentPasswordIncorrect',
  'auth/weak-password': 'newPasswordWeak',
};

export function authErrorMessage(
  err: unknown,
  messages: Record<string, AuthErrorKey>,
  fallback: string
): string {
  const key = messages[authErrorCode(err)];
  return key ? i18n.t(`auth:errors.${key}`) : fallback;
}

/** True when no account can exist for the address, so callers can avoid confirming either way. */
export function isUnknownAccountError(err: unknown): boolean {
  const code = authErrorCode(err);
  return code === 'auth/user-not-found' || code === 'auth/invalid-email';
}
