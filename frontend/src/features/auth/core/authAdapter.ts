export interface AuthAdapter {
  /** Stable provider ID, e.g. "google", "email" */
  readonly id: string;

  /** Starts a login flow and returns an ID token once signed in. */
  login(email?: string, password?: string): Promise<string>;

  /** Logs out from the active session (if any). */
  logout(): Promise<void>;

  /** Returns true if a session is currently available (persisted sessions included). */
  isAuthenticated(): boolean;

  /** Returns an ID token for the current session. */
  getIdToken(forceRefresh?: boolean): Promise<string>;

  /** Subscribe to auth state changes. Returns an unsubscribe function. */
  onAuthStateChanged(callback: (loggedIn: boolean) => void): () => void;

  /** Optional: register a new user (email/password). */
  register?(email: string, password: string): Promise<string>;

  /** Optional: send a password-reset email. */
  sendPasswordResetEmail?(email: string): Promise<void>;

  /** Optional: change the current user's password (requires recent auth). */
  changePassword?(currentPassword: string, newPassword: string): Promise<void>;
}
