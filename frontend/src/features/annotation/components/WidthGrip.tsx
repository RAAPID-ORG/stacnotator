import { useRef } from 'react';

export interface WidthGripProps {
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onReset: () => void;
  label: string;
  className?: string;
}

const KEY_STEP = 16;

/** A grip on an element's right edge: drag to set its width, arrow keys to
 *  nudge it, double-click to go back to the default. A button, so the layout
 *  editor never mistakes the drag for moving the whole panel. */
export function WidthGrip({
  width,
  min,
  max,
  onResize,
  onReset,
  label,
  className = '',
}: WidthGripProps) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.max(min, Math.min(w, max)));

  return (
    <button
      type="button"
      aria-label={label}
      title={`${label}: drag to resize, double-click to reset`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width };
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
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        e.stopPropagation();
        onResize(clamp(width + (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP)));
      }}
      className={`group/grip absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none ${className}`}
    >
      <span className="mx-auto block h-full w-0.5 rounded-full bg-transparent transition-colors group-hover/grip:bg-brand-400 group-focus-visible/grip:bg-brand-400" />
    </button>
  );
}
