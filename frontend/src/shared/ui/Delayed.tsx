import { useEffect, useState, type ReactNode } from 'react';

/** Renders its children only after `delayMs` has elapsed. Wrap a loading
 *  placeholder in this so it never flashes for fast operations - a spinner or
 *  skeleton that appears and vanishes in <200ms reads as jank. If the awaited
 *  work finishes first, the placeholder unmounts before it was ever shown. */
export const Delayed = ({ children, delayMs = 200 }: { children: ReactNode; delayMs?: number }) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs]);

  return show ? <>{children}</> : null;
};
