import type { MouseEvent } from 'react';
import { useSliceNavigation } from '../hooks/useSliceNavigation';
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronDoubleLeft,
  IconChevronDoubleRight,
} from '~/shared/ui/Icons';

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
      className="desktop:hidden absolute left-1/2 -translate-x-1/2 z-[450] flex items-stretch divide-x divide-neutral-100 bg-white border border-neutral-200 rounded-full shadow-lg pointer-events-auto overflow-hidden"
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
          <IconChevronDoubleLeft className="w-5 h-5" />
        </NavButton>
      )}
      {hasMultipleSlices && (
        <NavButton onClick={handle(() => navigateSlice('prev'))} ariaLabel="Previous slice">
          <IconChevronLeft className="w-5 h-5" />
        </NavButton>
      )}
      {hasMultipleSlices && (
        <NavButton onClick={handle(() => navigateSlice('next'))} ariaLabel="Next slice">
          <IconChevronRight className="w-5 h-5" />
        </NavButton>
      )}
      {hasMultipleCollections && (
        <NavButton onClick={handle(() => navigateCollection('next'))} ariaLabel="Next collection">
          <IconChevronDoubleRight className="w-5 h-5" />
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
  // 44×40 hits the iOS 44pt minimum on width with a comfortable height.
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    className="flex items-center justify-center w-11 h-10 text-neutral-700 active:bg-brand-50 active:text-brand-700 transition-colors"
  >
    {children}
  </button>
);
