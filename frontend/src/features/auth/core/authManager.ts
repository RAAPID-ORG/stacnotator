import type { AuthAdapter } from './authAdapter';

/**
 * AuthManager: orchestrator for multiple auth adapters.
 *
 * - Registers providers (google/email/etc).
 * - Tracks the active provider for logout/token retrieval.
 *
 */
class AuthManager implements AuthAdapter {
  readonly id = 'manager';

  private providers: Map<string, AuthAdapter> = new Map();
  private activeProvider: AuthAdapter | null = null;

  registerProvider(provider: AuthAdapter): void {
    this.providers.set(provider.id, provider);
  }

  getProvider(id: string): AuthAdapter | undefined {
    return this.providers.get(id);
  }

  getActiveProviderId(): string | null {
    return this.activeProvider?.id ?? null;
  }

  setActiveProvider(id: string): void {
    const provider = this.providers.get(id);
    if (provider) this.activeProvider = provider;
  }

  login = async (): Promise<string> => {
    throw new Error('Use getProvider(id).login() instead');
  };

  register = async (): Promise<string> => {
    throw new Error('Use getProvider(id).register() instead');
  };

  logout = async (): Promise<void> => {
    if (this.activeProvider) {
      await this.activeProvider.logout();
      this.activeProvider = null;
    }
  };

  isAuthenticated = (): boolean => {
    // Check all providers; one might have a persisted session.
    for (const provider of this.providers.values()) {
      if (provider.isAuthenticated()) {
        this.activeProvider = provider;
        return true;
      }
    }
    return false;
  };

  getIdToken = async (forceRefresh?: boolean): Promise<string> => {
    // Ensure an active provider exists (e.g. after page refresh).
    if (!this.activeProvider) {
      for (const provider of this.providers.values()) {
        if (provider.isAuthenticated()) {
          this.activeProvider = provider;
          break;
        }
      }
    }
    if (!this.activeProvider) throw new Error('Not authenticated');
    return this.activeProvider.getIdToken(forceRefresh);
  };

  onAuthStateChanged = (callback: (loggedIn: boolean) => void): (() => void) => {
    const unsubscribes: (() => void)[] = [];

    for (const provider of this.providers.values()) {
      const unsub = provider.onAuthStateChanged((loggedIn) => {
        if (loggedIn) this.activeProvider = provider;
        else if (this.activeProvider === provider) this.activeProvider = null;
        callback(loggedIn);
      });
      unsubscribes.push(unsub);
    }

    return () => unsubscribes.forEach((u) => u());
  };
}

export const authManager = new AuthManager();
