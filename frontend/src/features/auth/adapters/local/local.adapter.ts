import type { AuthAdapter } from '../../core/authAdapter';

/**
 * Local auth adapter for single-user local mode.
 *
 * Always reports authenticated - no Firebase dependency.
 * The backend's LocalAuthProvider ignores the token value.
 */
export class LocalAdapter implements AuthAdapter {
  readonly id = 'local';

  login = async (): Promise<string> => 'local-token';

  logout = async (): Promise<void> => {};

  isAuthenticated = (): boolean => true;

  getIdToken = async (): Promise<string> => 'local-token';

  onAuthStateChanged = (callback: (loggedIn: boolean) => void): (() => void) => {
    // Fire async to match Firebase's behavior and ensure React has subscribed
    setTimeout(() => callback(true), 0);
    return () => {};
  };
}
