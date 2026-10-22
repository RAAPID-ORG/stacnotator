import { useRef } from 'react';

export interface ColumnResizerProps {
  /** The column whose right edge this handle sits on. */
  columnRef: React.RefObject<HTMLElement | null>;
  min: number;
  /** Space the column has to leave free beside it, so the neighbouring
   *  column never gets squeezed out. */
  reserve: number;
  onResize: (width: number) => void;
  onReset: () => void;
}

const KEY_STEP = 16;

/** A grip on a column's right edge: drag to set its width, double-click to go
 *  back to the default. A button, so the layout editor never mistakes the drag
 *  for moving the whole panel. */
export function ColumnResizer({ columnRef, min, reserve, onResize, onReset }: ColumnResizerProps) {
  const start = useRef<{ x: number; width: number } | null>(null);

  const clamp = (width: number) => {
    const container = columnRef.current?.parentElement?.clientWidth ?? Infinity;
    return Math.round(Math.max(min, Math.min(width, container - reserve)));
  };

  return (
    <button
      type="button"
      aria-label="Resize label column"
      title="Drag to resize, double-click to reset"
      data-testid="task-labels-resizer"
      onPointerDown={(e) => {
        if (!columnRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width: columnRef.current.offsetWidth };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onResize(clamp(start.current.width + e.clientX - start.current.x));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        e.stopPropagation();
        const width = columnRef.current?.offsetWidth ?? 0;
        onResize(clamp(width + (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP)));
      }}
      className="group/resizer absolute inset-y-0 -right-1.5 z-10 hidden w-3 cursor-col-resize touch-none @md:block"
    >
      <span className="mx-auto block h-full w-px bg-transparent transition-colors group-hover/resizer:w-0.5 group-hover/resizer:bg-brand-400 group-focus-visible/resizer:w-0.5 group-focus-visible/resizer:bg-brand-400" />
    </button>
  );
}
