import { create } from 'zustand';

export type AlertType = 'success' | 'error' | 'info' | 'warning';

export interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface UIStore {
  // Alert state
  alertMessage: string | null;
  alertType: AlertType;

  // Loading overlay state
  loadingOverlayVisible: boolean;
  loadingOverlayText: string;

  // Breadcrumbs state
  breadcrumbs: BreadcrumbItem[];

  // Keyboard help state
  showKeyboardHelp: boolean;

  // Fullscreen state
  isFullscreen: boolean;

  // Actions
  showAlert: (message: string, type?: AlertType) => void;
  hideAlert: () => void;
  showLoadingOverlay: (text?: string) => void;
  hideLoadingOverlay: () => void;
  setBreadcrumbs: (items: BreadcrumbItem[]) => void;
  clearBreadcrumbs: () => void;
  toggleKeyboardHelp: () => void;
  setShowKeyboardHelp: (show: boolean) => void;
  toggleFullscreen: () => void;
  setIsFullscreen: (isFullscreen: boolean) => void;
}

/**
 * Global UI store for managing cross-cutting UI concerns
 * Handles alerts, loading overlays, and breadcrumbs across the entire app
 */
export const useUIStore = create<UIStore>((set) => {
  // Set up fullscreen change listener to sync state with browser
  if (typeof document !== 'undefined') {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!document.fullscreenElement;
      set({ isFullscreen: isCurrentlyFullscreen });
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    // Cleanup not possible in Zustand create, but fullscreen listener is global and shouldn't cause issues
  }

  return {
    // Initial state
    alertMessage: null,
    alertType: 'info',
    loadingOverlayVisible: false,
    loadingOverlayText: 'Loading...',
    breadcrumbs: [],
    showKeyboardHelp: false,
    isFullscreen: false,

    // Alert actions
    showAlert: (message, type = 'info') => set({ alertMessage: message, alertType: type }),

    hideAlert: () => set({ alertMessage: null }),

    // Loading overlay actions
    showLoadingOverlay: (text = 'Loading...') =>
      set({ loadingOverlayVisible: true, loadingOverlayText: text }),

    hideLoadingOverlay: () => set({ loadingOverlayVisible: false }),

    // Breadcrumb actions
    setBreadcrumbs: (items) => set({ breadcrumbs: items }),

    clearBreadcrumbs: () => set({ breadcrumbs: [] }),

    // Keyboard help actions
    toggleKeyboardHelp: () => set((state) => ({ showKeyboardHelp: !state.showKeyboardHelp })),

    setShowKeyboardHelp: (show) => set({ showKeyboardHelp: show }),

    // Fullscreen actions
    toggleFullscreen: () => {
      set((state) => {
        const newFullscreenState = !state.isFullscreen;

        if (newFullscreenState) {
          // Enter fullscreen
          document.documentElement.requestFullscreen?.().catch((err) => {
            console.error('Error attempting to enable fullscreen:', err);
            // Revert state if fullscreen request fails
            set({ isFullscreen: false });
          });
        } else {
          // Exit fullscreen
          if (document.fullscreenElement) {
            document.exitFullscreen?.().catch((err) => {
              console.error('Error attempting to exit fullscreen:', err);
              // Keep state as true if exit fails
              set({ isFullscreen: true });
            });
          }
        }

        return { isFullscreen: newFullscreenState };
      });
    },

    setIsFullscreen: (isFullscreen) => set({ isFullscreen }),
  };
});
