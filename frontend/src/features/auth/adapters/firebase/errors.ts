/** Firebase's error codes stay in this folder - the UI asks for a message, not a code. */

function authErrorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return '';
}

const SHARED_ERRORS: Record<string, string> = {
  'auth/email-already-in-use': 'An account with this email already exists. Try signing in instead.',
  'auth/weak-password': 'Password is too weak. Please use a stronger password.',
  'auth/password-does-not-meet-requirements':
    'Password does not meet the requirements for this project.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/operation-not-allowed': 'Email sign-up is disabled for this project.',
  'auth/admin-restricted-operation': 'Sign-up is restricted. Ask an admin for an invite.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/network-request-failed': 'Network error. Please check your connection and try again.',
};

export const SIGN_IN_ERRORS = SHARED_ERRORS;

/** Reauthentication blames a different field than sign-in does: the old password, not the login. */
export const CHANGE_PASSWORD_ERRORS: Record<string, string> = {
  ...SHARED_ERRORS,
  'auth/wrong-password': 'Current password is incorrect.',
  'auth/invalid-credential': 'Current password is incorrect.',
  'auth/weak-password': 'New password is too weak.',
};

export function authErrorMessage(
  err: unknown,
  messages: Record<string, string>,
  fallback: string
): string {
  return messages[authErrorCode(err)] ?? fallback;
}

/** True when no account can exist for the address, so callers can avoid confirming either way. */
export function isUnknownAccountError(err: unknown): boolean {
  const code = authErrorCode(err);
  return code === 'auth/user-not-found' || code === 'auth/invalid-email';
}
