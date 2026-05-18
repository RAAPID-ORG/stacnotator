import type { MouseEvent } from 'react';
import { useSliceNavigation } from '../hooks/useSliceNavigation';

/**
 * Touch-only on-screen arrows that mirror the A / D / Shift+A / Shift+D
 * keyboard shortcuts. Hidden on devices with a precise pointer + hover
 * (desktops/laptops) since those users have a keyboard and the toolbar's
 * collection / slice selectors. Shown on phones in either orientation.
 */
export const MobileSliceNav = () => {
  const { navigateSlice, navigateCollection, hasMultipleSlices, hasMultipleCollections } =
    useSliceNavigation();

  if (!hasMultipleSlices && !hasMultipleCollections) return null;

  const handle = (fn: () => void) => (e: MouseEvent) => {
    // Map components (Leaflet/OL) capture touches on their container; without
    // stopPropagation a tap on the pill can also pan/drag the map underneath.
    e.stopPropagation();
    fn();
  };

  return (
    <div
      className="desktop:hidden absolute left-1/2 -translate-x-1/2 z-[450] flex items-stretch gap-px bg-neutral-200 border border-neutral-300 rounded-full shadow-md pointer-events-auto overflow-hidden"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        touchAction: 'none',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      role="group"
      aria-label="Slice and collection navigation"
    >
      {hasMultipleCollections && (
        <NavButton
          onClick={handle(() => navigateCollection('prev'))}
          ariaLabel="Previous collection"
        >
          <DoubleChevron direction="left" />
        </NavButton>
      )}
      {hasMultipleSlices && (
        <NavButton onClick={handle(() => navigateSlice('prev'))} ariaLabel="Previous slice">
          <Chevron direction="left" />
        </NavButton>
      )}
      {hasMultipleSlices && (
        <NavButton onClick={handle(() => navigateSlice('next'))} ariaLabel="Next slice">
          <Chevron direction="right" />
        </NavButton>
      )}
      {hasMultipleCollections && (
        <NavButton onClick={handle(() => navigateCollection('next'))} ariaLabel="Next collection">
          <DoubleChevron direction="right" />
        </NavButton>
      )}
    </div>
  );
};

const NavButton = ({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: (e: MouseEvent) => void;
  ariaLabel: string;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    // 44×40 hits the iOS 44pt minimum on width with a comfortable height.
    // Hairline gaps (gap-px on parent + bg-neutral-200) keep buttons visually
    // separate so misstaps don't bleed into the adjacent action.
    className="flex items-center justify-center w-11 h-10 bg-white text-neutral-700 active:bg-brand-50 active:text-brand-700 transition-colors first:rounded-l-full last:rounded-r-full"
  >
    {children}
  </button>
);

const Chevron = ({ direction }: { direction: 'left' | 'right' }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transform: direction === 'left' ? 'rotate(180deg)' : undefined }}
  >
    <path d="M7 4l6 6-6 6" />
  </svg>
);

const DoubleChevron = ({ direction }: { direction: 'left' | 'right' }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transform: direction === 'left' ? 'rotate(180deg)' : undefined }}
  >
    <path d="M4 4l6 6-6 6" />
    <path d="M10 4l6 6-6 6" />
  </svg>
);
