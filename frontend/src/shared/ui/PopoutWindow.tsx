import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from './Icons';

export interface PopoutBounds {
  width: number;
  height: number;
  left?: number;
  top?: number;
}

interface PopoutWindowProps {
  title: string;
  /** Requested window size/position. Position is best effort - browsers may
   *  clamp coordinates to the screen the opener is on. */
  bounds: PopoutBounds;
  /** The popout is gone: the user closed the window, clicked "Return to
   *  canvas", or the popup never opened. The owner unmounts this component. */
  onUserClose: () => void;
  /** Last observed window bounds, reported whenever the popout closes. */
  onBounds?: (bounds: PopoutBounds) => void;
  /** The browser blocked the popup. `onUserClose` still follows. */
  onBlocked?: () => void;
  children: React.ReactNode;
}

const POPOUT_STYLE_ATTR = 'data-popout-style';

/** Mirror the opener's stylesheets into the popout document. Tailwind and
 *  Vite (HMR) inject styles at runtime, so this runs again on every mutation
 *  of the opener's head; full replace keeps ordering identical. */
function copyStyles(sourceDoc: Document, targetDoc: Document) {
  targetDoc.head.querySelectorAll(`[${POPOUT_STYLE_ATTR}]`).forEach((node) => node.remove());
  sourceDoc.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    const clone = targetDoc.importNode(node, true);
    clone.setAttribute(POPOUT_STYLE_ATTR, '');
    targetDoc.head.appendChild(clone);
  });
}

/** Cross-realm safe: elements of the popout document are not instances of the
 *  opener realm's HTMLElement, so feature-detect instead of `instanceof`. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !('tagName' in target)) return false;
  const tag = String(target.tagName).toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return 'isContentEditable' in target && target.isContentEditable === true;
}

/** Renders children into a separate OS-level browser window (same JS context,
 *  so stores/hooks/maps keep working) that the user can drag to any monitor. */
export const PopoutWindow = ({
  title,
  bounds,
  onUserClose,
  onBounds,
  onBlocked,
  children,
}: PopoutWindowProps) => {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const childRef = useRef<Window | null>(null);

  // Latest-callback refs so the open/close effect can run exactly once per
  // mount without re-opening the window when a callback identity changes.
  const onUserCloseRef = useRef(onUserClose);
  const onBoundsRef = useRef(onBounds);
  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onUserCloseRef.current = onUserClose;
    onBoundsRef.current = onBounds;
    onBlockedRef.current = onBlocked;
  });

  useEffect(() => {
    const features = [
      'popup=yes',
      `width=${Math.round(bounds.width)}`,
      `height=${Math.round(bounds.height)}`,
      bounds.left != null ? `left=${Math.round(bounds.left)}` : null,
      bounds.top != null ? `top=${Math.round(bounds.top)}` : null,
    ]
      .filter(Boolean)
      .join(',');

    const child = window.open('', '_blank', features);
    if (!child) {
      onBlockedRef.current?.();
      onUserCloseRef.current();
      return;
    }
    childRef.current = child;

    const doc = child.document;
    doc.title = `${title} - STACNotator`;
    copyStyles(document, doc);
    const styleSync = new MutationObserver(() => copyStyles(document, doc));
    styleSync.observe(document.head, { childList: true, subtree: true });

    doc.documentElement.style.height = '100%';
    doc.body.style.height = '100%';
    doc.body.style.margin = '0';
    doc.body.style.overflow = 'hidden';
    doc.body.className = document.body.className;
    const root = doc.createElement('div');
    root.style.height = '100%';
    doc.body.appendChild(root);
    setContainer(root);

    // The annotation hotkeys listen on the opener window; replay key events
    // from the popout there so shortcuts work wherever focus is. Typing into
    // popout inputs stays local, mirroring the opener-side activeElement guard.
    const forwardKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const clone = new KeyboardEvent(event.type, event);
      window.dispatchEvent(clone);
      if (clone.defaultPrevented) event.preventDefault();
    };
    child.addEventListener('keydown', forwardKey);
    child.addEventListener('keyup', forwardKey);

    const captureBounds = () => {
      if (child.closed) return;
      onBoundsRef.current?.({
        width: child.outerWidth,
        height: child.outerHeight,
        left: child.screenX,
        top: child.screenY,
      });
    };

    // Fires for both the OS close button and a programmatic child.close().
    const handleChildClosed = () => {
      captureBounds();
      onUserCloseRef.current();
    };
    child.addEventListener('pagehide', handleChildClosed);

    // Never leave orphan popouts showing dead UI when the opener goes away.
    const closeChild = () => child.close();
    window.addEventListener('pagehide', closeChild);

    return () => {
      styleSync.disconnect();
      window.removeEventListener('pagehide', closeChild);
      child.removeEventListener('pagehide', handleChildClosed);
      captureBounds();
      setContainer(null);
      childRef.current = null;
      child.close();
    };
    // Open exactly once per mount; bounds are only meaningful at open time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!container) return null;

  return createPortal(
    <div className="flex h-full min-h-0 flex-col bg-base">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 bg-white px-3 py-1.5">
        <span className="truncate text-xs font-semibold text-neutral-800">{title}</span>
        <button
          type="button"
          onClick={() => childRef.current?.close()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
          title="Close this window and return the panel to the canvas"
        >
          <IconClose className="h-3 w-3" />
          Return to canvas
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-1">
        <div className="grid-card h-full">{children}</div>
      </div>
    </div>,
    container
  );
};
