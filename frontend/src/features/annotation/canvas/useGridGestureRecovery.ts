import { useEffect, type RefObject } from 'react';
import { PANEL_DRAG_CANCEL_SELECTOR, PANEL_DRAG_HANDLE_CLASS } from './PanelHost';

/** react-draggable only ends mouse gestures on mouseup, which the browser
 * can lose when focus or pointer capture leaves the window. */
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

    const clear = () => {
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
