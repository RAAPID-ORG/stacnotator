import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconInfo } from '~/shared/ui/Icons';

export const Tooltip = ({ text }: { text: string }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.top });
  };

  const hide = () => setPos(null);

  return (
    <span
      ref={ref}
      className="cursor-help inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <IconInfo className="w-3 h-3 text-neutral-400 hover:text-neutral-600 transition-colors" />
      {pos &&
        createPortal(
          <div
            style={{ left: pos.x, top: pos.y }}
            className="fixed -translate-x-1/2 -translate-y-full -mt-1.5 w-64 px-2.5 py-2 bg-neutral-800 text-white text-[11px] leading-relaxed rounded-md shadow-lg z-[100] pointer-events-none"
          >
            {text}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-800" />
          </div>,
          document.body,
        )}
    </span>
  );
};
