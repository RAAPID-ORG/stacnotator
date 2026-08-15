import { useEffect, useRef, useState } from 'react';
import { IconClose, IconExternalLink } from '~/shared/ui/Icons';

/** Where a card can be sent: a screen already open, the main window it came
 *  from, or one opened for it. */
export type ScreenTarget = number | 'new' | 'main';

export interface SendToScreenButtonProps {
  panelId: string;
  label: string;
  screenIds: number[];
  /** The screen this card sits on. Set means the card is on a secondary
   *  screen: that screen is not offered back to itself, and the main window is. */
  currentScreen?: number;
  onSend: (target: ScreenTarget) => void;
  darkBg?: boolean;
}

/** Panel-header control that moves a panel between screens. With nowhere to go
 *  but a new screen a click opens one directly; otherwise it offers the main
 *  window, the other open screens, and "New screen". */
export function SendToScreenButton({
  panelId,
  label,
  screenIds,
  currentScreen,
  onSend,
  darkBg,
}: SendToScreenButtonProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // A card sitting on a screen renders in the popout's document, not the
    // opener's - listening on the wrong one leaves the menu stuck open.
    const doc = wrapRef.current?.ownerDocument ?? document;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    doc.addEventListener('mousedown', onDown);
    return () => doc.removeEventListener('mousedown', onDown);
  }, [open]);

  const send = (target: ScreenTarget) => {
    setOpen(false);
    onSend(target);
  };

  const otherScreens = screenIds.filter((id) => id !== currentScreen);
  const onScreen = currentScreen != null;
  const moveHint = onScreen
    ? `Move ${label} back to the main window or to another screen`
    : `Move ${label} to another screen`;

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        // The header is the drag handle and has its own onClick; without this
        // a send click also fires the header's activate action.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (!onScreen && otherScreens.length === 0) send('new');
          else setOpen((o) => !o);
        }}
        title={moveHint}
        aria-label={moveHint}
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
          {onScreen && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                send('main');
              }}
              data-testid={`send-to-screen-${panelId}-main`}
              className="block w-full border-b border-neutral-100 px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-50"
            >
              Main window
            </button>
          )}
          {otherScreens.map((id) => (
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
  /** Puts the chip away without forgetting the split - it is offered again on
   *  the next visit, until a layout is saved that uses no extra screen. */
  onHide: () => void;
}

export function RestoreScreensToast({ count, onRestore, onHide }: RestoreScreensToastProps) {
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
        onClick={onHide}
        data-testid="hide-restore-screens"
        aria-label="Hide for now"
        title="Hide for now - your screen split stays saved"
        className="grid h-6 w-6 place-items-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
      >
        <IconClose className="h-3 w-3" />
      </button>
    </div>
  );
}
