import { create } from 'zustand';
import { toast } from 'sonner';

export type AlertType = 'success' | 'error' | 'info' | 'warning';

export interface BreadcrumbItem {
  label: string;
  path?: string;
}

export interface ConfirmDialogOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
  showDontAskAgain?: boolean;
  onDontAskAgain?: () => void;
}

interface LayoutStore {
  // Loading overlay state
  loadingOverlayVisible: boolean;
  loadingOverlayText: string;

  // Breadcrumbs state
  breadcrumbs: BreadcrumbItem[];

  // Keyboard help state
  showKeyboardHelp: boolean;

  // Campaign guide state
  showGuide: boolean;

  // Guided tour state
  showGuidedTour: boolean;

  // Fullscreen state
  isFullscreen: boolean;

  // Sidebar state
  sidebarCollapsed: boolean;

  // Confirm dialog state
  confirmDialog: (ConfirmDialogOptions & { resolve: (value: boolean) => void }) | null;

  // Actions
  showAlert: (message: string, type?: AlertType) => void;
  showLoadingOverlay: (text?: string) => void;
  hideLoadingOverlay: () => void;
  setBreadcrumbs: (items: BreadcrumbItem[]) => void;
  clearBreadcrumbs: () => void;
  toggleKeyboardHelp: () => void;
  setShowKeyboardHelp: (show: boolean) => void;
  toggleGuide: () => void;
  setShowGuidedTour: (show: boolean) => void;
  toggleFullscreen: () => void;
  setIsFullscreen: (isFullscreen: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  showConfirmDialog: (options: ConfirmDialogOptions) => Promise<boolean>;
  resolveConfirmDialog: (value: boolean) => void;
}

/**
 * Global UI store for managing cross-cutting UI concerns
 * Handles alerts, loading overlays, and breadcrumbs across the entire app
 */
export const useLayoutStore = create<LayoutStore>((set) => {
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
    loadingOverlayVisible: false,
    loadingOverlayText: 'Loading...',
    breadcrumbs: [],
    showKeyboardHelp: false,
    showGuide: false,
    showGuidedTour: false,
    isFullscreen: false,
    sidebarCollapsed: false,
    confirmDialog: null,

    // Alert actions - delegated to sonner so multiple errors queue instead of clobbering.
    showAlert: (message, type = 'info') => {
      if (type === 'error') toast.error(message);
      else if (type === 'success') toast.success(message);
      else if (type === 'warning') toast.warning(message);
      else toast.info(message);
    },

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

    toggleGuide: () => set((state) => ({ showGuide: !state.showGuide })),

    setShowGuidedTour: (show) => set({ showGuidedTour: show }),

    // Fullscreen actions
    toggleFullscreen: () => {
      set((state) => {
        const newFullscreenState = !state.isFullscreen;

        if (newFullscreenState) {
          document.documentElement.requestFullscreen?.().catch(() => {
            set({ isFullscreen: false });
          });
        } else if (document.fullscreenElement) {
          document.exitFullscreen?.().catch(() => {
            set({ isFullscreen: true });
          });
        }

        return { isFullscreen: newFullscreenState };
      });
    },

    setIsFullscreen: (isFullscreen) => set({ isFullscreen }),

    // Sidebar actions
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

    toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

    // Confirm dialog actions
    showConfirmDialog: (options) =>
      new Promise<boolean>((resolve) => {
        set({ confirmDialog: { ...options, resolve } });
      }),

    resolveConfirmDialog: (value) => {
      const dialog = useLayoutStore.getState().confirmDialog;
      if (dialog) {
        dialog.resolve(value);
        set({ confirmDialog: null });
      }
    },
  };
});
