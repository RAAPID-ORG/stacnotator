import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconInfo } from '~/shared/ui/Icons';

type Tone = 'neutral' | 'danger';

// 'center' anchors the bubble on the trigger's midpoint; 'start' pins it to the
// trigger's left edge so it can't escape the viewport in narrow containers.
type Align = 'center' | 'start';

const tone: Record<Tone, { bubble: string; arrow: string }> = {
  neutral: { bubble: 'bg-neutral-800', arrow: 'border-t-neutral-800' },
  danger: { bubble: 'bg-rose-900', arrow: 'border-t-rose-900' },
};

const alignment: Record<Align, { bubble: string; arrow: string }> = {
  center: { bubble: '-translate-x-1/2', arrow: 'left-1/2 -translate-x-1/2' },
  start: { bubble: '', arrow: 'left-4' },
};

export const Tooltip = ({
  text,
  children,
  variant = 'neutral',
  align = 'center',
  className,
}: {
  text: string;
  children?: ReactNode;
  variant?: Tone;
  align?: Align;
  className?: string;
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: align === 'start' ? r.left : r.left + r.width / 2, y: r.top });
  };

  const hide = () => setPos(null);

  return (
    <span
      ref={ref}
      className={`cursor-help inline-flex ${className ?? ''}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children ?? (
        <IconInfo className="w-3 h-3 text-neutral-400 hover:text-neutral-600 transition-colors" />
      )}
      {pos &&
        createPortal(
          <div
            style={{ left: pos.x, top: pos.y }}
            className={`fixed ${alignment[align].bubble} -translate-y-full -mt-1.5 w-64 px-2.5 py-2 ${tone[variant].bubble} text-white text-[11px] leading-relaxed rounded-md shadow-lg z-[100] pointer-events-none whitespace-pre-wrap`}
          >
            {text}
            <div
              className={`absolute top-full ${alignment[align].arrow} border-4 border-transparent ${tone[variant].arrow}`}
            />
          </div>,
          // The anchor may live in a pop-out window; portal into its document
          // so the bubble appears next to it (coords are per-viewport).
          ref.current?.ownerDocument.body ?? document.body
        )}
    </span>
  );
};
