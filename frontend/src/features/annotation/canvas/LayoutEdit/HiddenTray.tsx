import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cellToPixelRect, nextFreeSlot } from '../dropCell';
import type { LayoutItem } from '../grid';
import { step, type DragOutGeometry, type DragOutState } from './dragOut';

const MIN_PANEL_W = 240;
const MIN_PANEL_H = 200;
const MAX_PANEL_W = 560;
const MAX_PANEL_H = 720;
const DEFAULT_PANEL_SIZE = { width: 288, height: 520 };

/** Marks the tray's floating panel for the elementFromPoint exclusion check
 *  in finishDrag below. */
const TRAY_ROOT_ATTR = 'data-hidden-tray-root';

// Edge auto-scroll while dragging: zone height from each edge, and max
// scroll speed per animation frame.
const EDGE_ZONE = 60;
const MAX_SCROLL_SPEED = 20;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function loadPanelSize(storageKey: string): { width: number; height: number } {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        width: clamp(parsed.width, MIN_PANEL_W, MAX_PANEL_W),
        height: clamp(parsed.height, MIN_PANEL_H, MAX_PANEL_H),
      };
    }
  } catch {
    // ignore malformed/absent value
  }
  return DEFAULT_PANEL_SIZE;
}

export interface HiddenTrayItem {
  id: string;
  content: ReactNode;
  /** Grid footprint used for the drag-out ghost/preview and the cell it's
   *  placed into (by drag, or by a plain click on its row). */
  size: { w: number; h: number };
}

export interface HiddenTrayProps {
  items: HiddenTrayItem[];
  title?: string;
  /** Rendered above the item list, inside the same scrolling body - e.g. the
   *  size controls for windows placed back onto the canvas. */
  headerExtra?: ReactNode;
  /** localStorage key the panel's resized width/height persists under. */
  storageKey: string;
  /** The canvas element items are dropped onto - read live (rect + scroll)
   *  during a drag to resolve the drop cell. Must be positioned (e.g.
   *  `relative`) so the drop preview can be portaled into it. */
  canvasRef: React.RefObject<HTMLElement | null>;
  layout: LayoutItem[];
  /** A row was placed: either dropped at a dragged-to cell, or clicked
   *  (placed at the next free slot). */
  onDrop: (id: string, cell: { x: number; y: number }) => void;
  /** Customize the floating drag ghost; defaults to the item's own content. */
  renderGhost?: (item: HiddenTrayItem) => ReactNode;
  className?: string;
}

/** Collapsible, resizable tray of hidden canvas panels. Dragging a row onto
 *  the canvas (or clicking it) places it back into the layout; the pure
 *  dragOut.ts state machine decides click vs. drag vs. cancel, this
 *  component only wires it to pointer-capture DOM events and renders the
 *  ghost/preview. */
export function HiddenTray({
  items,
  title = 'Hidden',
  headerExtra,
  storageKey,
  canvasRef,
  layout,
  onDrop,
  renderGhost,
  className = '',
}: HiddenTrayProps) {
  const [expanded, setExpanded] = useState(true);
  const [panelSize, setPanelSize] = useState(() => loadPanelSize(storageKey));
  const panelResizeStart = useRef<{ x: number; y: number; width: number; height: number } | null>(
    null
  );

  const [dragState, setDragState] = useState<DragOutState>({ phase: 'idle' });
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  const geometryNow = (): DragOutGeometry => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    return {
      canvasRect: { left: rect?.left ?? 0, top: rect?.top ?? 0, width: rect?.width ?? 0 },
      scrollTop: canvas?.scrollTop ?? 0,
      layout,
    };
  };

  const onItemPointerDown = (item: HiddenTrayItem) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({
      phase: 'pending',
      id: item.id,
      size: item.size,
      origin: { x: e.clientX, y: e.clientY },
    });
  };

  const onItemPointerMove = (e: React.PointerEvent) => {
    if (dragStateRef.current.phase !== 'pending' && dragStateRef.current.phase !== 'dragging')
      return;
    setDragState(
      step(dragStateRef.current, { type: 'pointermove', x: e.clientX, y: e.clientY }, geometryNow())
    );
  };

  const finishDrag = (e: React.PointerEvent) => {
    const current = dragStateRef.current;
    if (current.phase !== 'pending' && current.phase !== 'dragging') return;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    // The tray floats above the canvas, so a release that hit-tests back to
    // the tray's own panel isn't a real drop even if a grid cell happens to
    // sit underneath it.
    const overExcludedRegion =
      document.elementFromPoint(e.clientX, e.clientY)?.closest(`[${TRAY_ROOT_ATTR}]`) != null;
    const next = step(current, { type: 'pointerup', overExcludedRegion }, geometryNow());
    if (next.phase === 'dropped') {
      onDrop(next.id, next.cell);
    } else if (next.phase === 'clicked') {
      const item = items.find((it) => it.id === next.id);
      if (item) onDrop(item.id, nextFreeSlot(layout, item.size.w));
    }
    setDragState({ phase: 'idle' });
  };

  const onItemPointerCancel = () => setDragState({ phase: 'idle' });

  // Escape cancels; pointer events aren't routed here since capture stays on
  // the row element, so this listens at the window regardless of capture.
  useEffect(() => {
    if (dragState.phase !== 'pending' && dragState.phase !== 'dragging') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDragState({ phase: 'idle' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragState.phase]);

  // Continuously scroll the canvas while the cursor rests near a vertical
  // edge (pointermove alone wouldn't fire again if the user holds still).
  useEffect(() => {
    if (dragState.phase !== 'dragging') return;
    let raf = requestAnimationFrame(function autoScroll() {
      const canvas = canvasRef.current;
      const state = dragStateRef.current;
      if (canvas && state.phase === 'dragging') {
        const rect = canvas.getBoundingClientRect();
        let dy = 0;
        if (state.pointer.y < rect.top + EDGE_ZONE) {
          dy =
            -MAX_SCROLL_SPEED * Math.min(1, (rect.top + EDGE_ZONE - state.pointer.y) / EDGE_ZONE);
        } else if (state.pointer.y > rect.bottom - EDGE_ZONE) {
          dy =
            MAX_SCROLL_SPEED *
            Math.min(1, (state.pointer.y - (rect.bottom - EDGE_ZONE)) / EDGE_ZONE);
        }
        if (dy !== 0) {
          const before = canvas.scrollTop;
          canvas.scrollTop = before + dy;
          if (canvas.scrollTop !== before) {
            setDragState(
              step(
                state,
                { type: 'pointermove', x: state.pointer.x, y: state.pointer.y },
                geometryNow()
              )
            );
          }
        }
      }
      raf = requestAnimationFrame(autoScroll);
    });
    return () => cancelAnimationFrame(raf);
    // geometryNow reads live refs/props; only the drag phase should restart the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState.phase]);

  const onPanelResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    panelResizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      width: panelSize.width,
      height: panelSize.height,
    };
  };

  const onPanelResizePointerMove = (e: React.PointerEvent) => {
    const start = panelResizeStart.current;
    if (!start) return;
    // Anchored bottom-right: dragging left/up enlarges the panel.
    setPanelSize({
      width: clamp(start.width + (start.x - e.clientX), MIN_PANEL_W, MAX_PANEL_W),
      height: clamp(start.height + (start.y - e.clientY), MIN_PANEL_H, MAX_PANEL_H),
    });
  };

  const onPanelResizePointerUp = (e: React.PointerEvent) => {
    if (!panelResizeStart.current) return;
    panelResizeStart.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    try {
      localStorage.setItem(storageKey, JSON.stringify(panelSize));
    } catch {
      // ignore storage failures (private mode / quota)
    }
  };

  const dragging = dragState.phase === 'dragging' ? dragState : null;
  const draggingItem = dragging ? items.find((it) => it.id === dragging.id) : null;
  const canvas = canvasRef.current;

  return (
    <>
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={`fixed bottom-3 right-3 z-[1002] inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/95 px-3 py-2 text-xs font-medium text-neutral-700 shadow-lg ${className}`}
          title={`Show ${title.toLowerCase()}`}
        >
          <span>{title}</span>
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-neutral-200 px-1 text-[10px] font-semibold tabular-nums text-neutral-600">
            {items.length}
          </span>
        </button>
      ) : (
        <div
          className={`fixed bottom-3 right-3 z-[1002] flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white/95 shadow-xl ${className}`}
          style={{ width: panelSize.width, maxHeight: panelSize.height }}
          data-testid="hidden-tray"
          data-hidden-tray-root=""
        >
          <div
            onPointerDown={onPanelResizePointerDown}
            onPointerMove={onPanelResizePointerMove}
            onPointerUp={onPanelResizePointerUp}
            className="absolute top-0 left-0 z-20 h-5 w-5 cursor-nwse-resize"
            title="Drag to resize"
            aria-label={`Resize ${title.toLowerCase()}`}
            data-testid="resize-hidden-tray"
          />

          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50/70 px-3.5 py-2.5">
            <span className="truncate pl-3 text-xs font-semibold text-neutral-800">{title}</span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label={`Minimize ${title.toLowerCase()}`}
              title="Minimize"
            >
              -
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {headerExtra && (
              <div className="border-b border-neutral-100 px-3.5 py-3">{headerExtra}</div>
            )}
            <div className="p-2">
              {items.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-neutral-400">Nothing hidden</p>
              ) : (
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      onPointerDown={onItemPointerDown(item)}
                      onPointerMove={onItemPointerMove}
                      onPointerUp={finishDrag}
                      onPointerCancel={onItemPointerCancel}
                      className="cursor-grab select-none rounded-lg px-2.5 py-1.5 transition-colors hover:bg-neutral-50 active:cursor-grabbing"
                      data-testid={`hidden-tray-item-${item.id}`}
                    >
                      {item.content}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {dragging &&
        draggingItem &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[2000] rounded-md bg-neutral-900/85 px-2 py-1 text-[11px] font-medium text-white shadow-lg"
            style={{ left: dragging.pointer.x + 14, top: dragging.pointer.y + 14 }}
          >
            {renderGhost
              ? renderGhost(draggingItem)
              : dragging.cell.free
                ? 'Drop to place'
                : 'No space here'}
          </div>,
          document.body
        )}

      {dragging &&
        canvas &&
        createPortal(
          <div
            className={`pointer-events-none absolute z-50 rounded-md border-2 border-dashed ${
              dragging.cell.free
                ? 'border-orange-400 bg-orange-100/40'
                : 'border-neutral-400 bg-neutral-200/40'
            }`}
            style={cellToPixelRect(
              dragging.cell,
              canvas.getBoundingClientRect().width,
              dragging.size.w,
              dragging.size.h
            )}
            data-valid={dragging.cell.free}
            data-testid="hidden-tray-drop-preview"
          />,
          canvas
        )}
    </>
  );
}
