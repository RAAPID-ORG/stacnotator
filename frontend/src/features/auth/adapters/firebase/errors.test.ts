import { describe, expect, it } from 'vitest';
import {
  authErrorMessage,
  isUnknownAccountError,
  CHANGE_PASSWORD_ERRORS,
  SIGN_IN_ERRORS,
} from './errors';

const firebaseError = (code: string) => Object.assign(new Error(`Firebase: (${code}).`), { code });

describe('authErrorMessage', () => {
  it('names the cause for a known code', () => {
    expect(
      authErrorMessage(firebaseError('auth/email-already-in-use'), SIGN_IN_ERRORS, 'nope')
    ).toBe(SIGN_IN_ERRORS['auth/email-already-in-use']);
  });

  it('falls back for unknown codes and non-Firebase throws', () => {
    expect(authErrorMessage(firebaseError('auth/internal-error'), SIGN_IN_ERRORS, 'nope')).toBe(
      'nope'
    );
    expect(authErrorMessage(new Error('boom'), SIGN_IN_ERRORS, 'nope')).toBe('nope');
  });

  it('blames the current password only when changing it', () => {
    const wrongPassword = firebaseError('auth/invalid-credential');
    expect(authErrorMessage(wrongPassword, CHANGE_PASSWORD_ERRORS, 'nope')).toBe(
      'Current password is incorrect.'
    );
    expect(authErrorMessage(wrongPassword, SIGN_IN_ERRORS, 'Invalid email or password.')).toBe(
      'Invalid email or password.'
    );
  });
});

describe('isUnknownAccountError', () => {
  it('covers the codes that must not confirm an address', () => {
    expect(isUnknownAccountError(firebaseError('auth/user-not-found'))).toBe(true);
    expect(isUnknownAccountError(firebaseError('auth/invalid-email'))).toBe(true);
    expect(isUnknownAccountError(firebaseError('auth/too-many-requests'))).toBe(false);
  });
});
