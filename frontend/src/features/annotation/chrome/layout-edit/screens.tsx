import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconClose, IconExternalLink } from '~/shared/ui/Icons';
import {
  closeScreen,
  EMPTY_SCREENS,
  openScreen,
  rememberScreenBounds,
  restoreScreens,
  returnPanelFromScreen,
  scaleWidthToScreen,
  sendToScreen,
  serializeScreens,
  withoutKeys,
  type LayoutItem,
  type ScreenBounds,
  type ScreensState,
} from '~/features/annotation/engine/canvas';

/** Initial OS-window size for a newly opened screen. */
export const SCREEN_DEFAULT_BOUNDS: ScreenBounds = { width: 1280, height: 860, left: 80, top: 60 };
/** Rough horizontal overhead of a screen window (scrollbar + canvas padding),
 *  used to estimate its canvas width before the window has reported one. */
const SCREEN_CHROME_PX = 40;

function storageKeyFor(scope: string): string {
  return `annotation:screens:${scope}`;
}

function readSaved(scope: string | null): ScreensState | null {
  if (!scope) return null;
  try {
    const raw = localStorage.getItem(storageKeyFor(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScreensState;
    return Array.isArray(parsed.screens) && parsed.assignment ? parsed : null;
  } catch {
    return null;
  }
}

export interface ScreensApi {
  state: ScreensState;
  /** Panel ids currently living in a screen window, withheld from the main grid. */
  popped: ReadonlySet<string>;
  /** How many screens the remembered split would reopen, 0 when there is
   *  nothing to offer. */
  restorable: number;
  send: (
    panelId: string,
    target: number | 'new',
    item: LayoutItem | undefined,
    canvasPx: number
  ) => void;
  returnPanel: (panelId: string) => void;
  close: (id: number) => void;
  setScreenLayout: (id: number, layout: LayoutItem[]) => void;
  rememberBounds: (id: number, bounds: ScreenBounds) => void;
  restoreSaved: () => void;
  dismissSaved: () => void;
  /** Return any panel that no longer exists on the page (a view switch dropped
   *  its collection, settings dropped a time series). */
  pruneTo: (validPanelIds: ReadonlySet<string>) => void;
}

/**
 * @param scope `${userId}:${campaignId}`, or null while either is unknown -
 *   the split is per user and per campaign, never shared between them.
 */
export function useScreens(scope: string | null): ScreensApi {
  const [state, setState] = useState<ScreensState>(EMPTY_SCREENS);
  const [saved, setSaved] = useState<ScreensState | null>(null);

  /** Whether this hook has changed the split since the scope was picked up.
   *  Without it the "no screens" state a fresh scope starts in would overwrite
   *  that scope's remembered split before the user did anything. */
  const dirty = useRef(false);

  // A scope change is a different campaign or user: drop the live windows and
  // pick up that scope's remembered split instead.
  useEffect(() => {
    dirty.current = false;
    setState(EMPTY_SCREENS);
    setSaved(readSaved(scope));
  }, [scope]);

  // Persisting is a side effect, so it runs off the committed state rather
  // than inside the updater (which has to stay pure). Writing unconditionally
  // matters: closing the last screen has to clear the remembered split, or the
  // restore toast comes straight back offering the split the user just closed.
  useEffect(() => {
    if (!scope || !dirty.current) return;
    try {
      if (state.screens.length === 0) localStorage.removeItem(storageKeyFor(scope));
      else localStorage.setItem(storageKeyFor(scope), JSON.stringify(serializeScreens(state)));
    } catch {
      // private mode / quota: the split just won't survive a reload
    }
    // Closing the last screen is the user saying they are done with the split;
    // re-offering the one they just dismantled would be noise.
    if (state.screens.length === 0) setSaved(null);
  }, [scope, state]);

  const update = useCallback((next: (current: ScreensState) => ScreensState) => {
    dirty.current = true;
    setState(next);
  }, []);

  const popped = useMemo(() => new Set(Object.keys(state.assignment)), [state.assignment]);

  const send: ScreensApi['send'] = useCallback(
    (panelId, target, item, canvasPx) => {
      update((current) => {
        const opened = target === 'new' ? openScreen(current) : { state: current, id: target };
        // A new screen is seeded with the bounds it will actually be opened at,
        // so the width the panel is scaled against is the real one.
        const seeded =
          target === 'new'
            ? rememberScreenBounds(opened.state, opened.id, SCREEN_DEFAULT_BOUNDS)
            : opened.state;
        const screen = seeded.screens.find((s) => s.id === opened.id);
        const screenPx = (screen?.bounds?.width ?? SCREEN_DEFAULT_BOUNDS.width) - SCREEN_CHROME_PX;
        // Keep the panel's pixel size across the move: rows are fixed height so
        // h transfers as-is, but a grid column is narrower in a screen window.
        const size = item
          ? { w: scaleWidthToScreen(item.w, canvasPx, screenPx), h: item.h }
          : { w: 20, h: 12 };
        return sendToScreen(seeded, panelId, opened.id, size);
      });
    },
    [update]
  );

  const returnPanel = useCallback(
    (panelId: string) => update((c) => returnPanelFromScreen(c, panelId)),
    [update]
  );
  const close = useCallback((id: number) => update((c) => closeScreen(c, id)), [update]);
  const rememberBounds = useCallback(
    (id: number, bounds: ScreenBounds) => update((c) => rememberScreenBounds(c, id, bounds)),
    [update]
  );

  const setScreenLayout = useCallback(
    (id: number, layout: LayoutItem[]) =>
      update((c) => ({
        ...c,
        screens: c.screens.map((s) => (s.id === id ? { ...s, layout } : s)),
      })),
    [update]
  );

  const pruneTo = useCallback(
    (valid: ReadonlySet<string>) => {
      const stale = Object.keys(state.assignment).filter((id) => !valid.has(id));
      if (stale.length === 0) return;
      update((current) => stale.reduce((acc, id) => returnPanelFromScreen(acc, id), current));
    },
    [state.assignment, update]
  );

  const restoreSaved = useCallback(() => {
    if (!saved) return;
    dirty.current = true;
    setState(restoreScreens(saved));
  }, [saved]);

  const dismissSaved = useCallback(() => {
    setSaved(null);
    if (!scope) return;
    try {
      localStorage.removeItem(storageKeyFor(scope));
    } catch {
      // ignore storage failures
    }
  }, [scope]);

  const restorable =
    state.screens.length === 0 && saved && Object.keys(saved.assignment).length > 0
      ? saved.screens.length
      : 0;

  // Stable identity: callers memoize panel decoration and layout arrays
  // against this object, and a fresh one every render would rebuild the whole
  // grid on every keystroke elsewhere on the page.
  return useMemo(
    () => ({
      state,
      popped,
      restorable,
      send,
      returnPanel,
      close,
      setScreenLayout,
      rememberBounds,
      restoreSaved,
      dismissSaved,
      pruneTo,
    }),
    [
      state,
      popped,
      restorable,
      send,
      returnPanel,
      close,
      setScreenLayout,
      rememberBounds,
      restoreSaved,
      dismissSaved,
      pruneTo,
    ]
  );
}

/** The main grid's layout with the sent-away panels withheld. */
export function layoutWithoutPopped(
  layout: LayoutItem[],
  popped: ReadonlySet<string>
): LayoutItem[] {
  return withoutKeys(layout, popped);
}

export interface SendToScreenButtonProps {
  panelId: string;
  label: string;
  screenIds: number[];
  onSend: (target: number | 'new') => void;
  darkBg?: boolean;
}

/** Panel-header control that sends a panel to a secondary screen. With no
 *  screen open a click opens the first one directly; with screens open it
 *  offers the existing ones plus "New screen". */
export function SendToScreenButton({
  panelId,
  label,
  screenIds,
  onSend,
  darkBg,
}: SendToScreenButtonProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const send = (target: number | 'new') => {
    setOpen(false);
    onSend(target);
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        // The header is the drag handle and has its own onClick; without this
        // a send click also fires the header's activate action.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (screenIds.length === 0) send('new');
          else setOpen((o) => !o);
        }}
        title={`Move ${label} to another screen`}
        aria-label={`Move ${label} to another screen`}
        data-testid={`send-to-screen-${panelId}`}
        className={`grid h-5 w-5 place-items-center rounded transition-colors ${
          darkBg
            ? 'text-white/70 hover:bg-white/10'
            : 'text-neutral-400 hover:bg-neutral-100 hover:text-brand-600'
        }`}
      >
        <IconExternalLink className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-[1001] w-36 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
          {screenIds.map((id) => (
            <button
              key={id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                send(id);
              }}
              data-testid={`send-to-screen-${panelId}-${id}`}
              className="block w-full px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-50"
            >
              Screen {id}
            </button>
          ))}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              send('new');
            }}
            data-testid={`send-to-screen-${panelId}-new`}
            className="block w-full border-t border-neutral-100 px-3 py-1.5 text-left text-xs font-medium text-brand-700 hover:bg-brand-50"
          >
            New screen
          </button>
        </div>
      )}
    </div>
  );
}

export interface RestoreScreensToastProps {
  count: number;
  onRestore: () => void;
  onDismiss: () => void;
}

export function RestoreScreensToast({ count, onRestore, onDismiss }: RestoreScreensToastProps) {
  if (count === 0) return null;
  return (
    <div className="fixed bottom-3 right-3 z-[1002] flex items-center gap-1 rounded-full border border-neutral-200 bg-white/95 py-1 pl-1 pr-1.5 shadow-lg">
      <button
        type="button"
        onClick={onRestore}
        data-testid="restore-screens"
        title="Reopen your saved screens with their panels"
        className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
      >
        <IconExternalLink className="h-3.5 w-3.5 text-brand-600" />
        Restore {count === 1 ? 'screen' : `${count} screens`}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        data-testid="dismiss-saved-screens"
        aria-label="Forget saved screens"
        title="Forget the saved screen split"
        className="grid h-6 w-6 place-items-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
      >
        <IconClose className="h-3 w-3" />
      </button>
    </div>
  );
}
