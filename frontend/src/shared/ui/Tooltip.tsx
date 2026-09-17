import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconInfo } from '~/shared/ui/Icons';

type Tone = 'neutral' | 'danger';

// 'center' anchors the bubble on the trigger's midpoint; 'start' pins it to the
// trigger's left edge so it can't escape the viewport in narrow containers.
type Align = 'center' | 'start';

const tone: Record<Tone, { bubble: string; up: string; down: string }> = {
  neutral: { bubble: 'bg-neutral-800', up: 'border-b-neutral-800', down: 'border-t-neutral-800' },
  danger: { bubble: 'bg-rose-900', up: 'border-b-rose-900', down: 'border-t-rose-900' },
};

const GAP = 6; // trigger to bubble, the arrow's height
const EDGE = 8; // closest the bubble comes to a viewport edge

type Spot = { left: number; top: number; maxHeight: number; arrowLeft: number; below: boolean };

/** Where the bubble fits: above the trigger when its text fits there, below when
    that side has more room, and never past a viewport edge. */
const fit = (trigger: DOMRect, bubble: DOMRect, view: Window, align: Align): Spot => {
  const roomAbove = trigger.top - GAP - EDGE;
  const roomBelow = view.innerHeight - trigger.bottom - GAP - EDGE;
  const below = bubble.height > roomAbove && roomBelow > roomAbove;
  const wanted =
    align === 'start' ? trigger.left : trigger.left + trigger.width / 2 - bubble.width / 2;
  const left = Math.max(EDGE, Math.min(wanted, view.innerWidth - bubble.width - EDGE));
  return {
    left,
    top: below
      ? trigger.bottom + GAP
      : Math.max(EDGE, trigger.top - GAP - Math.min(bubble.height, roomAbove)),
    maxHeight: below ? roomBelow : roomAbove,
    arrowLeft: Math.min(Math.max(12, trigger.left + trigger.width / 2 - left), bubble.width - 12),
    below,
  };
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
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<Spot | null>(null);

  // Two passes: the bubble is rendered hidden at its natural size, measured, then placed.
  useLayoutEffect(() => {
    if (!open) {
      setSpot(null);
      return;
    }
    const trigger = ref.current?.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    const view = ref.current?.ownerDocument.defaultView;
    if (trigger && bubble && view) setSpot(fit(trigger, bubble, view, align));
  }, [open, align, text]);

  // The bubble is placed in viewport coordinates, so a scroll of the page or of any
  // container under it would leave it behind, pointing at nothing.
  useEffect(() => {
    if (!open) return;
    const doc = ref.current?.ownerDocument ?? document;
    const close = () => setOpen(false);
    doc.addEventListener('scroll', close, true);
    doc.defaultView?.addEventListener('resize', close);
    return () => {
      doc.removeEventListener('scroll', close, true);
      doc.defaultView?.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className={`cursor-help inline-flex ${className ?? ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children ?? (
        <IconInfo className="w-3 h-3 text-neutral-400 hover:text-neutral-600 transition-colors" />
      )}
      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            style={
              spot ? { left: spot.left, top: spot.top } : { left: 0, top: 0, visibility: 'hidden' }
            }
            // Long comments in a narrow bubble run out of height; they get a wider one.
            className={`fixed z-[100] max-w-[calc(100vw-16px)] pointer-events-none ${
              text.length > 240 ? 'w-96' : 'w-64'
            }`}
          >
            <div
              style={{ maxHeight: spot?.maxHeight }}
              className={`overflow-hidden px-2.5 py-2 ${tone[variant].bubble} text-white text-[11px] leading-relaxed rounded-md shadow-lg whitespace-pre-wrap`}
            >
              {text}
            </div>
            {spot && (
              <div
                style={{ left: spot.arrowLeft }}
                className={`absolute -translate-x-1/2 border-4 border-transparent ${
                  spot.below ? `bottom-full ${tone[variant].up}` : `top-full ${tone[variant].down}`
                }`}
              />
            )}
          </div>,
          // The anchor may live in a pop-out window; portal into its document
          // so the bubble appears next to it (coords are per-viewport).
          ref.current?.ownerDocument.body ?? document.body
        )}
    </span>
  );
};
