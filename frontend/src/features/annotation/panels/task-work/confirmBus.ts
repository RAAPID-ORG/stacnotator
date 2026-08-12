import { useSyncExternalStore } from 'react';

export interface ConfirmRequest {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
  /** Skip's "don't ask again" checkbox; omitted for every other confirm. */
  showDontAskAgain?: boolean;
}

export interface ConfirmDialogState extends ConfirmRequest {
  open: boolean;
}

const CLOSED: ConfirmDialogState = { open: false, title: '' };

let state: ConfirmDialogState = CLOSED;
let resolveCurrent: ((confirmed: boolean) => void) | null = null;
const listeners = new Set<() => void>();

function set(next: ConfirmDialogState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function getConfirmDialogState(): ConfirmDialogState {
  return state;
}

export function useConfirmDialogState(): ConfirmDialogState {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getConfirmDialogState,
    getConfirmDialogState
  );
}

/** Opens the dialog and resolves once the user answers. A second request
 *  before the first resolves auto-cancels the first (there is only one
 *  dialog slot), which can't happen in practice here since every caller
 *  awaits its own confirm before starting another. */
export function requestConfirm(request: ConfirmRequest): Promise<boolean> {
  resolveCurrent?.(false);
  return new Promise((resolve) => {
    resolveCurrent = resolve;
    set({ ...request, open: true });
  });
}

export function resolveConfirm(confirmed: boolean): void {
  resolveCurrent?.(confirmed);
  resolveCurrent = null;
  set(CLOSED);
}

// --- Skip's "don't ask again" preference -----------------------------------
// No slot for this on usePrefsStore (preloadTier/pinnedStart/toursSeen/
// labelStyles/legendOverrides - nothing boolean-and-global fits), so it's a
// small local preference persisted to localStorage directly rather than
// growing another store surface.

const SKIP_CONFIRM_STORAGE_KEY = 'taskWork.skipConfirmDisabled';

export function isSkipConfirmDisabled(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' && localStorage.getItem(SKIP_CONFIRM_STORAGE_KEY) === '1'
    );
  } catch {
    return false;
  }
}

export function setSkipConfirmDisabled(disabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (disabled) localStorage.setItem(SKIP_CONFIRM_STORAGE_KEY, '1');
    else localStorage.removeItem(SKIP_CONFIRM_STORAGE_KEY);
  } catch {
    // Best-effort: a private-browsing tab or disabled storage just re-asks every time.
  }
}
