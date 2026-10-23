import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconPlus } from '~/shared/ui/Icons';

const MIN_PANEL_W = 280;
const MIN_PANEL_H = 200;
const MAX_PANEL_W = 560;
const MAX_PANEL_H = 720;
const PANEL_MARGIN = 12;
const DEFAULT_PANEL_SIZE = { width: 288, height: 520 };

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Where the panel sits, as an offset from its bottom-right home. Negative
 *  moves it left/up, which is the only direction that keeps it on screen. */
interface PanelOffset {
  dx: number;
  dy: number;
}

interface PanelGeometry {
  width: number;
  height: number;
  offset: PanelOffset;
}

function loadPanelGeometry(storageKey: string): PanelGeometry {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        width: clamp(parsed.width, MIN_PANEL_W, MAX_PANEL_W),
        height: clamp(parsed.height, MIN_PANEL_H, MAX_PANEL_H),
        offset: {
          dx: Number(parsed.offset?.dx) || 0,
          dy: Number(parsed.offset?.dy) || 0,
        },
      };
    }
  } catch {
    // ignore malformed/absent value
  }
  return { ...DEFAULT_PANEL_SIZE, offset: { dx: 0, dy: 0 } };
}

/** Keeps the panel reachable: it may leave its corner, but not the viewport. */
function clampOffset({ dx, dy }: PanelOffset, width: number, height: number): PanelOffset {
  return {
    dx: clamp(dx, -Math.max(0, window.innerWidth - width - PANEL_MARGIN * 2), 0),
    dy: clamp(dy, -Math.max(0, window.innerHeight - height - PANEL_MARGIN * 2), 0),
  };
}

export interface HiddenTrayItem {
  id: string;
  content: ReactNode;
}

export interface HiddenTrayProps {
  items: HiddenTrayItem[];
  title?: string;
  footerActions?: ReactNode;
  /** Sections shown above the hidden-panel section, in the same panel. */
  sections?: ReactNode;
  /** A section that keeps its place between the scrolling sections and the
   *  hidden-panel list, for controls reached for while arranging. */
  pinnedSection?: ReactNode;
  /** Rendered directly above the item list, so whatever names the list sits
   *  next to it rather than above the other sections. */
  listHeader?: ReactNode;
  /** localStorage key the panel's resized width/height persists under. */
  storageKey: string;
  /** A row was clicked: put that panel back on the canvas. */
  onAdd: (id: string) => void;
  className?: string;
}

/** Collapsible, resizable tray of hidden canvas panels. Clicking a row puts it
 *  back into the layout; where it lands is the layout's business, not this
 *  component's. */
export function HiddenTray({
  items,
  title = 'Hidden',
  footerActions,
  sections,
  pinnedSection,
  listHeader,
  storageKey,
  onAdd,
  className = '',
}: HiddenTrayProps) {
  const [expanded, setExpanded] = useState(true);
  const [panelGeometry, setPanelGeometry] = useState(() => loadPanelGeometry(storageKey));
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const panelSize = {
    width: Math.min(panelGeometry.width, viewport.width - PANEL_MARGIN * 2),
    height: Math.min(panelGeometry.height, viewport.height - PANEL_MARGIN * 2),
  };
  const panelOffset = clampOffset(panelGeometry.offset, panelSize.width, panelSize.height);
  const panelResizeStart = useRef<{ x: number; y: number; width: number; height: number } | null>(
    null
  );
  const panelMoveStart = useRef<{ x: number; y: number; offset: PanelOffset } | null>(null);

  const onPanelResizePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return;
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
    setPanelGeometry((prev) => ({
      ...prev,
      width: clamp(start.width + (start.x - e.clientX), MIN_PANEL_W, MAX_PANEL_W),
      height: clamp(start.height + (start.y - e.clientY), MIN_PANEL_H, MAX_PANEL_H),
    }));
  };

  const persistGeometry = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(panelGeometry));
    } catch {
      // ignore storage failures (private mode / quota)
    }
  };

  const onPanelResizePointerUp = (e: React.PointerEvent) => {
    if (!panelResizeStart.current) return;
    panelResizeStart.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    persistGeometry();
  };

  // The panel is tall enough to bury the canvas it edits, so it moves.
  const onPanelMovePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return;
    if (
      !(e.target instanceof Element) ||
      !e.currentTarget.contains(e.target) ||
      e.target.closest('button')
    )
      return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    panelMoveStart.current = { x: e.clientX, y: e.clientY, offset: panelOffset };
  };

  const onPanelMovePointerMove = (e: React.PointerEvent) => {
    const start = panelMoveStart.current;
    if (!start) return;
    setPanelGeometry((prev) => ({
      ...prev,
      offset: clampOffset(
        {
          dx: start.offset.dx + (e.clientX - start.x),
          dy: start.offset.dy + (e.clientY - start.y),
        },
        panelSize.width,
        panelSize.height
      ),
    }));
  };

  const onPanelMovePointerUp = (e: React.PointerEvent) => {
    if (!panelMoveStart.current) return;
    panelMoveStart.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    persistGeometry();
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={`fixed z-[900] inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/95 px-3 py-2 text-xs font-medium text-neutral-700 shadow-lg ${className}`}
        style={{ bottom: PANEL_MARGIN, right: PANEL_MARGIN }}
        title={`Show ${title.toLowerCase()}`}
        aria-label={`Show ${title.toLowerCase()}`}
      >
        <span>{title}</span>
        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-neutral-200 px-1 text-[10px] font-semibold tabular-nums text-neutral-600">
          {items.length}
        </span>
      </button>
    );
  }

  return (
    <div
      className={`fixed z-[900] flex flex-col rounded-xl border border-neutral-200 bg-white/95 shadow-xl ${className}`}
      style={{
        bottom: PANEL_MARGIN,
        right: PANEL_MARGIN,
        width: panelSize.width,
        maxHeight: panelSize.height,
        transform: `translate(${panelOffset.dx}px, ${panelOffset.dy}px)`,
      }}
      data-testid="hidden-tray"
    >
      <div
        onPointerDown={onPanelResizePointerDown}
        onPointerMove={onPanelResizePointerMove}
        onPointerUp={onPanelResizePointerUp}
        onPointerCancel={onPanelResizePointerUp}
        onLostPointerCapture={onPanelResizePointerUp}
        className="absolute top-0 left-0 z-20 h-5 w-5 touch-none cursor-nwse-resize"
        title="Drag to resize"
        aria-label={`Resize ${title.toLowerCase()}`}
        data-testid="resize-hidden-tray"
      />

      <div
        onPointerDown={onPanelMovePointerDown}
        onPointerMove={onPanelMovePointerMove}
        onPointerUp={onPanelMovePointerUp}
        onPointerCancel={onPanelMovePointerUp}
        onLostPointerCapture={onPanelMovePointerUp}
        className="flex shrink-0 touch-none cursor-grab items-center justify-between gap-2 rounded-t-xl border-b border-neutral-100 bg-neutral-50/70 px-3 py-2 select-none active:cursor-grabbing"
        title="Drag to move"
        data-testid="move-hidden-tray"
      >
        <span className="truncate pl-3 text-xs font-semibold text-neutral-800">{title}</span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label={`Minimize ${title.toLowerCase()}`}
          title="Minimize"
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-700"
        >
          -
        </button>
      </div>

      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${footerActions ? '' : 'rounded-b-xl'}`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sections && <div className="px-3 py-2.5">{sections}</div>}
        </div>
        {pinnedSection && (
          <div className="shrink-0 border-t border-neutral-100 px-3 py-2.5">{pinnedSection}</div>
        )}
        {/* The list keeps its own region rather than trailing the settings in
            one scroll: sharing it, the list fell off the bottom of the panel
            and went unnoticed. The floor keeps restoration controls on screen
            whatever sits above; the cap stops a long list squeezing the
            settings out in turn. */}
        <div
          className={`flex flex-col border-t border-neutral-100 p-2 ${
            items.length > 0 ? 'max-h-48 min-h-[6rem]' : ''
          }`}
        >
          {listHeader && <div className="shrink-0 px-1 pb-1.5">{listHeader}</div>}
          {items.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-neutral-400">Nothing hidden</p>
          ) : (
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onAdd(item.id)}
                    className="group flex w-full items-center gap-1.5 rounded-md border border-dashed border-neutral-200 px-2 py-1 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/60"
                    data-testid={`hidden-tray-item-${item.id}`}
                  >
                    <span
                      aria-hidden
                      className="grid h-4 w-4 shrink-0 place-items-center rounded bg-neutral-100 text-neutral-500 transition-colors group-hover:bg-brand-100 group-hover:text-brand-700"
                    >
                      <IconPlus className="h-3 w-3" />
                    </span>
                    <span className="min-w-0 flex-1">{item.content}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {footerActions && (
        <div
          className="flex shrink-0 items-center justify-end rounded-b-xl border-t border-neutral-200 bg-neutral-50/70 px-3 py-2"
          data-testid="layout-footer-actions"
        >
          {footerActions}
        </div>
      )}
    </div>
  );
}
