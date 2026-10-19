import { useEffect, type RefObject } from 'react';
import { PANEL_DRAG_CANCEL_SELECTOR, PANEL_DRAG_HANDLE_CLASS } from './PanelHost';

/** react-draggable only ends mouse gestures on mouseup, which the browser
 * can lose when focus or pointer capture leaves the window. The same captured
 * gesture drives edge scrolling in either canvas's own document. */
export function useGridGestureRecovery(
  containerRef: RefObject<HTMLDivElement | null>,
  enabled: boolean
) {
  useEffect(() => {
    const container = containerRef.current;
    const doc = container?.ownerDocument;
    const win = doc?.defaultView;
    if (!enabled || !container || !doc || !win) return;

    let active: { node: Element; pointerId: number; x: number; y: number } | null = null;
    let scrollFrame: number | null = null;
    let lastScrollTime: number | null = null;

    const stopScrolling = () => {
      if (scrollFrame !== null) win.cancelAnimationFrame(scrollFrame);
      scrollFrame = null;
      lastScrollTime = null;
    };
    const scroll = (time: number) => {
      if (!active) {
        stopScrolling();
        return;
      }
      const rect = container.getBoundingClientRect();
      const top = Math.max(0, rect.top);
      const bottom = Math.min(win.innerHeight, rect.bottom);
      const edge = Math.min(56, (bottom - top) / 4);
      if (edge <= 0 || active.x < rect.left || active.x > rect.right) {
        stopScrolling();
        return;
      }
      const distance =
        active.y < top + edge
          ? active.y - top - edge
          : active.y > bottom - edge
            ? active.y - bottom + edge
            : 0;
      const velocity = Math.max(-1, Math.min(1, distance / edge)) * 800;
      const seconds =
        lastScrollTime === null ? 1 / 60 : Math.min((time - lastScrollTime) / 1000, 0.032);
      lastScrollTime = time;
      const before = container.scrollTop;
      container.scrollTop += velocity * seconds;
      if (container.scrollTop === before) {
        stopScrolling();
        return;
      }
      // react-draggable includes scroll offsets when reading a mouse move.
      // Re-read them even when the pointer is held still at the edge.
      doc.dispatchEvent(
        new win.MouseEvent('mousemove', {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: active.x,
          clientY: active.y,
        })
      );
      if (active) scrollFrame = win.requestAnimationFrame(scroll);
    };

    const clear = () => {
      stopScrolling();
      const gesture = active;
      active = null;
      if (gesture?.node.hasPointerCapture(gesture.pointerId)) {
        gesture.node.releasePointerCapture(gesture.pointerId);
      }
    };
    const finish = () => {
      if (!active) return;
      // Use the library's own stop path so it commits the layout and removes
      // its document listeners and user-select lock, not just the drag ghost.
      doc.dispatchEvent(
        new win.MouseEvent('mouseup', {
          bubbles: true,
          button: 0,
          buttons: 0,
          clientX: active.x,
          clientY: active.y,
        })
      );
      clear();
    };
    const start = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') return;
      const target = event.target;
      if (!(target instanceof win.Element) || target.closest(PANEL_DRAG_CANCEL_SELECTOR)) return;
      const node = target.closest(`.${PANEL_DRAG_HANDLE_CLASS}, .react-resizable-handle`);
      if (!node?.closest('.react-grid-item') || !container.contains(node)) return;
      active = { node, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      node.setPointerCapture(event.pointerId);
    };
    const move = (event: MouseEvent) => {
      if (!active) return;
      if ((event.buttons & 1) === 0) finish();
      else {
        active.x = event.clientX;
        active.y = event.clientY;
        if (scrollFrame === null && !active.node.matches('.react-resizable-handle')) {
          scrollFrame = win.requestAnimationFrame(scroll);
        }
      }
    };
    const lostCapture = (event: PointerEvent) => {
      if (event.pointerId === active?.pointerId) finish();
    };
    const visibility = () => {
      if (doc.hidden) finish();
    };
    const preventNativeDrag = (event: DragEvent) => {
      if (active) event.preventDefault();
    };

    container.addEventListener('pointerdown', start, true);
    container.addEventListener('lostpointercapture', lostCapture, true);
    container.addEventListener('pointercancel', lostCapture, true);
    container.addEventListener('dragstart', preventNativeDrag);
    doc.addEventListener('mousemove', move, true);
    doc.addEventListener('mouseup', clear, true);
    doc.addEventListener('visibilitychange', visibility);
    win.addEventListener('blur', finish);
    return () => {
      finish();
      container.removeEventListener('pointerdown', start, true);
      container.removeEventListener('lostpointercapture', lostCapture, true);
      container.removeEventListener('pointercancel', lostCapture, true);
      container.removeEventListener('dragstart', preventNativeDrag);
      doc.removeEventListener('mousemove', move, true);
      doc.removeEventListener('mouseup', clear, true);
      doc.removeEventListener('visibilitychange', visibility);
      win.removeEventListener('blur', finish);
    };
  }, [containerRef, enabled]);
}
