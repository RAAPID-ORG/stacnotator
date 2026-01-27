import type { AuthProvider } from '~/auth/providers/authProvider';

/**
 * AuthManager - A unified authentication manager that handles multiple providers.
 * It tracks which provider was used to login and delegates all operations to that provider.
 */
class AuthManager implements AuthProvider {
  readonly id = 'manager';
  
  private providers: Map<string, AuthProvider> = new Map();
  private activeProvider: AuthProvider | null = null;

  /**
   * Register a provider with the manager
   */
  registerProvider(provider: AuthProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Get a specific provider by id (for login/register which need specific provider)
   */
  getProvider(id: string): AuthProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Set the active provider (called after successful login)
   */
  setActiveProvider(id: string): void {
    const provider = this.providers.get(id);
    if (provider) {
      this.activeProvider = provider;
    }
  }

  /**
   * Login is not directly called on manager - use getProvider() then login
   */
  login = async (_email?: string, _password?: string): Promise<string> => {
    throw new Error('Use getProvider(id).login() instead');
  };

  /**
   * Register is not directly called on manager - use getProvider() then register
   */
  register = async (_email: string, _password: string): Promise<string> => {
    throw new Error('Use getProvider(id).register() instead');
  };

  logout = async (): Promise<void> => {
    if (this.activeProvider) {
      await this.activeProvider.logout();
      this.activeProvider = null;
    }
  };

  isAuthenticated = (): boolean => {
    // Check all providers - one of them might have a persisted session
    for (const provider of this.providers.values()) {
      if (provider.isAuthenticated()) {
        this.activeProvider = provider;
        return true;
      }
    }
    return false;
  };

  getIdToken = async (forceRefresh?: boolean): Promise<string> => {
    // Try to find active provider if not set
    if (!this.activeProvider) {
      for (const provider of this.providers.values()) {
        if (provider.isAuthenticated()) {
          this.activeProvider = provider;
          break;
        }
      }
    }
    
    if (!this.activeProvider) {
      throw new Error('Not authenticated');
    }
    return this.activeProvider.getIdToken(forceRefresh);
  };

  onAuthStateChanged = (callback: (loggedIn: boolean) => void): (() => void) => {
    // Subscribe to all providers and call callback if any changes
    const unsubscribes: (() => void)[] = [];
    
    for (const provider of this.providers.values()) {
      const unsub = provider.onAuthStateChanged((loggedIn) => {
        if (loggedIn) {
          this.activeProvider = provider;
        } else if (this.activeProvider === provider) {
          this.activeProvider = null;
        }
        callback(loggedIn);
      });
      unsubscribes.push(unsub);
    }

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  };
}

export const authManager = new AuthManager();
