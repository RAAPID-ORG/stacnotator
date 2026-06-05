import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { calcGridItemPosition, calcXY } from 'react-grid-layout';
import { useWindowDragStore } from '../stores/windowDrag.store';
import { useCampaignStore } from '../stores/campaign.store';
import { GRID_COLS, resolveDropCell } from '../utils/layoutDefaults';

interface WindowDropControllerProps {
  /** The react-grid-layout inner container (positioned parent for the preview). */
  gridRef: React.RefObject<HTMLDivElement | null>;
  /** The scrollable canvas container, edge-scrolled while dragging. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  containerWidth: number;
  rowHeight: number;
}

const MARGIN: [number, number] = [6, 6];
const MOVE_THRESHOLD = 4;
// Edge auto-scroll: zone height from each edge and max scroll speed per frame.
const EDGE_ZONE = 60;
const MAX_SCROLL_SPEED = 20;

/** Custom drag-and-drop for placing a hidden window onto the canvas. We avoid
 *  react-grid-layout's native external drop: its dropping placeholder writes
 *  back through `onLayoutChange` on our controlled layout, which loops
 *  ("Maximum update depth"). Here we track the pointer ourselves, snap a
 *  placeholder to the grid with RGL's own math, and insert on release. */
export const WindowDropController = ({
  gridRef,
  scrollRef,
  containerWidth,
  rowHeight,
}: WindowDropControllerProps) => {
  const collectionId = useWindowDragStore((s) => s.collectionId);
  const clear = useWindowDragStore((s) => s.clear);

  const [preview, setPreview] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    valid: boolean;
  } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);

  const cellRef = useRef<{ x: number; y: number; valid: boolean } | null>(null);
  const activeRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  // Latest geometry, read by the window listeners without re-subscribing.
  const geomRef = useRef({ containerWidth, rowHeight });
  geomRef.current = { containerWidth, rowHeight };

  useEffect(() => {
    if (collectionId == null) return;
    activeRef.current = false;
    cellRef.current = null;
    lastPointerRef.current = null;

    const params = () => ({
      margin: MARGIN,
      containerPadding: MARGIN,
      containerWidth: geomRef.current.containerWidth,
      cols: GRID_COLS,
      rowHeight: geomRef.current.rowHeight,
      maxRows: Infinity,
    });

    // Snap the placeholder to the cursor cell and flag whether it's droppable.
    const updateFromPointer = (clientX: number, clientY: number) => {
      setGhost({ x: clientX, y: clientY });
      const grid = gridRef.current;
      if (!grid) return;
      const rect = grid.getBoundingClientRect();
      const { newWindowSize, currentLayout } = useCampaignStore.getState();
      const p = params();
      const item = calcGridItemPosition(p, 0, 0, newWindowSize.w, newWindowSize.h);
      // Center the footprint on the cursor.
      const left = clientX - rect.left - item.width / 2;
      const top = clientY - rect.top - item.height / 2;
      const { x, y } = calcXY(p, top, left, newWindowSize.w, newWindowSize.h);
      // The outline always sits at the cursor cell so the user gets continuous
      // feedback; it's only droppable when that exact cell is free.
      const resolved = resolveDropCell(
        currentLayout ?? [],
        x,
        y,
        newWindowSize,
        String(collectionId)
      );
      const valid = resolved.x === x && resolved.y === y;
      cellRef.current = { x, y, valid };
      const pos = calcGridItemPosition(p, x, y, newWindowSize.w, newWindowSize.h);
      setPreview({ left: pos.left, top: pos.top, width: pos.width, height: pos.height, valid });
    };

    const onMove = (e: PointerEvent) => {
      const { originX, originY } = useWindowDragStore.getState();
      if (!activeRef.current) {
        if (Math.hypot(e.clientX - originX, e.clientY - originY) < MOVE_THRESHOLD) return;
        activeRef.current = true;
      }
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      updateFromPointer(e.clientX, e.clientY);
    };

    // Continuously scroll the canvas while the cursor rests near a vertical edge
    // (pointermove alone wouldn't fire if the user holds still at the edge).
    let raf = requestAnimationFrame(function autoScroll() {
      const sc = scrollRef.current;
      const lp = lastPointerRef.current;
      if (activeRef.current && sc && lp) {
        const rect = sc.getBoundingClientRect();
        let dy = 0;
        if (lp.y < rect.top + EDGE_ZONE) {
          dy = -MAX_SCROLL_SPEED * Math.min(1, (rect.top + EDGE_ZONE - lp.y) / EDGE_ZONE);
        } else if (lp.y > rect.bottom - EDGE_ZONE) {
          dy = MAX_SCROLL_SPEED * Math.min(1, (lp.y - (rect.bottom - EDGE_ZONE)) / EDGE_ZONE);
        }
        if (dy !== 0) {
          const before = sc.scrollTop;
          sc.scrollTop = before + dy;
          // The grid moved under the cursor → recompute the placeholder cell.
          if (sc.scrollTop !== before) updateFromPointer(lp.x, lp.y);
        }
      }
      raf = requestAnimationFrame(autoScroll);
    });

    const finish = (commit: boolean) => {
      const cell = cellRef.current;
      // Only drop where there is actually space (valid). Releasing over an
      // occupied cell cancels rather than relocating the window elsewhere.
      if (commit && activeRef.current && cell && cell.valid) {
        useCampaignStore.getState().addWindowAt(collectionId, cell.x, cell.y);
      }
      setPreview(null);
      setGhost(null);
      activeRef.current = false;
      cellRef.current = null;
      lastPointerRef.current = null;
      clear();
    };

    const onUp = (e: PointerEvent) => {
      // Released over the panel itself → cancel (only the canvas accepts drops).
      const overPanel = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-testid="hidden-windows-panel"]');
      finish(!overPanel);
    };
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [collectionId, clear, gridRef, scrollRef]);

  const grid = gridRef.current;

  return (
    <>
      {preview &&
        grid &&
        createPortal(
          <div
            className={`pointer-events-none absolute z-50 rounded-md border-2 border-dashed ${
              preview.valid
                ? 'border-orange-400 bg-orange-100/40'
                : 'border-neutral-400 bg-neutral-200/40'
            }`}
            style={{
              left: preview.left,
              top: preview.top,
              width: preview.width,
              height: preview.height,
            }}
            data-valid={preview.valid}
            data-testid="window-drop-preview"
          />,
          grid
        )}
      {ghost &&
        createPortal(
          <div
            className={`pointer-events-none fixed z-[2000] rounded-md px-2 py-1 text-[11px] font-medium text-white shadow-lg ${
              preview && !preview.valid ? 'bg-neutral-500/90' : 'bg-neutral-900/85'
            }`}
            style={{ left: ghost.x + 14, top: ghost.y + 14 }}
          >
            {preview && !preview.valid ? 'No space here' : 'Drop to place'}
          </div>,
          document.body
        )}
    </>
  );
};
