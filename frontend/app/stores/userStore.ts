import { create } from 'zustand';
import { me, type UserOutDetailed } from '~/api/client';
import { handleApiError } from '~/utils/errorHandler';

interface UserState {
  currentUser: UserOutDetailed | null;
  isLoading: boolean;
  fetchPromise: Promise<UserOutDetailed | null> | null;

  // Actions
  getCurrentUser: () => Promise<UserOutDetailed | null>;
  getCurrentUserId: () => string | null;
  updateCurrentUser: (user: UserOutDetailed) => void;
  clearUser: () => void;
}

/**
 * User store
 * Manages current user state and caching
 */
export const useUserStore = create<UserState>((set, get) => ({
  currentUser: null,
  isLoading: false,
  fetchPromise: null,

  /**
   * Get current user info from backend API
   * Uses caching to avoid repeated API calls
   */
  getCurrentUser: async () => {
    const state = get();

    // Return cached user if available
    if (state.currentUser) {
      return state.currentUser;
    }

    // Return existing fetch promise to avoid duplicate requests
    if (state.fetchPromise) {
      return state.fetchPromise;
    }

    // Create new fetch promise
    const fetchPromise = (async () => {
      set({ isLoading: true });

      try {
        const response = await me();
        const user = response.data || null;
        set({ currentUser: user, isLoading: false, fetchPromise: null });
        return user;
      } catch (error) {
        handleApiError(error, 'Error fetching current user', {
          showUser: false, // Don't show alert for user fetch errors
          defaultMessage: 'Failed to fetch user information',
        });
        set({ isLoading: false, fetchPromise: null });
        return null;
      }
    })();

    set({ fetchPromise });
    return fetchPromise;
  },

  /**
   * Get current user ID (synchronous, returns cached value)
   * Returns null if user hasn't been fetched yet
   */
  getCurrentUserId: () => {
    return get().currentUser?.id || null;
  },

  /**
   * Update the current user (e.g., after editing profile)
   */
  updateCurrentUser: (user: UserOutDetailed) => {
    set({ currentUser: user });
  },

  /**
   * Clear the user cache (e.g., on logout)
   */
  clearUser: () => {
    set({ currentUser: null, isLoading: false, fetchPromise: null });
  },
}));
