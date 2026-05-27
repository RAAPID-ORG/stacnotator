import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconInfo } from '~/shared/ui/Icons';

interface InfoPopoverProps {
  children: React.ReactNode;
}

export const InfoPopover = ({ children }: InfoPopoverProps) => {
  const ref = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pos) {
      setPos(null);
    } else {
      const r = ref.current?.getBoundingClientRect();
      if (r) setPos({ x: r.left + r.width / 2, y: r.top });
    }
  };

  // Close on outside click
  useEffect(() => {
    if (!pos) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        ref.current &&
        !ref.current.contains(e.target as Node)
      ) {
        setPos(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pos]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={toggle}
        className="inline-flex items-center cursor-pointer shrink-0"
        title="Show details"
      >
        <IconInfo className="w-3.5 h-3.5 text-neutral-400 hover:text-brand-600 transition-colors" />
      </button>
      {pos &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ left: pos.x, top: pos.y }}
            className="fixed -translate-x-1/2 -translate-y-full -mt-2 w-80 max-h-64 overflow-y-auto px-3 py-2.5 bg-white border border-neutral-200 text-neutral-700 text-[11px] leading-relaxed rounded-lg shadow-xl z-[100]"
          >
            {children}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-200" />
          </div>,
          document.body
        )}
    </>
  );
};
