import { useEffect, useState, type ReactNode } from 'react';

const EXIT_DURATION_MS = 120;

/**
 * Keeps `children` mounted long enough to play an exit animation after
 * `open` flips to false. Equivalent to <AnimatePresence> for a single child.
 */
const useDelayedUnmount = (open: boolean, exitMs = EXIT_DURATION_MS) => {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(t);
  }, [open, exitMs]);
  return mounted;
};

export const FadeIn = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={`motion-fade-in ${className ?? ''}`}>{children}</div>
);

export const Dropdown = ({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) => {
  const mounted = useDelayedUnmount(open);
  if (!mounted) return null;
  return (
    <div className={`${open ? 'motion-dropdown-in' : 'motion-dropdown-out'} ${className ?? ''}`}>
      {children}
    </div>
  );
};

/**
 * Animated dialog wrapper. Renders nothing when `open` is false (after the
 * exit animation completes). Pass the backdrop styling via `backdropClassName`
 * and the panel styling via `panelClassName`.
 */
export const AnimatedDialog = ({
  open,
  children,
  backdropClassName,
  panelClassName,
}: {
  open: boolean;
  children: ReactNode;
  backdropClassName?: string;
  panelClassName?: string;
}) => {
  const mounted = useDelayedUnmount(open);
  if (!mounted) return null;
  return (
    <div
      className={`${open ? 'motion-backdrop-in' : 'motion-backdrop-out'} ${backdropClassName ?? ''}`}
    >
      <div className={`${open ? 'motion-panel-in' : 'motion-panel-out'} ${panelClassName ?? ''}`}>
        {children}
      </div>
    </div>
  );
};

/**
 * Animate a list item with a staggered delay. Use the `index` and let CSS
 * handle the timing.
 */
export const MotionListItem = ({
  index,
  children,
  className,
}: {
  index: number;
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={`motion-list-item ${className ?? ''}`}
    style={{ animationDelay: `${40 + index * 30}ms` }}
  >
    {children}
  </div>
);
