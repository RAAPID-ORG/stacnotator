import { useEffect, useRef, useState } from 'react';
import { useLayoutStore } from '~/features/layout/layout.store';

const SIDEBAR_TRANSITION_MS = 220;

export const useContainerWidth = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let rafId: number | null = null;
    let latestWidth = 0;
    let suspendedUntil = 0;
    let pendingSettle: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      rafId = null;
      setContainerWidth(latestWidth);
    };

    const scheduleFlush = () => {
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries[0]) return;
      latestWidth = entries[0].contentRect.width;
      const now = performance.now();
      if (now >= suspendedUntil) {
        scheduleFlush();
      } else {
        if (pendingSettle) clearTimeout(pendingSettle);
        pendingSettle = setTimeout(
          () => {
            pendingSettle = null;
            scheduleFlush();
          },
          suspendedUntil - now + 20
        );
      }
    });

    resizeObserver.observe(containerRef.current);
    setIsMounted(true);

    const unsubscribe = useLayoutStore.subscribe((state, prev) => {
      if (state.sidebarCollapsed !== prev.sidebarCollapsed) {
        suspendedUntil = performance.now() + SIDEBAR_TRANSITION_MS;
      }
    });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (pendingSettle) clearTimeout(pendingSettle);
      resizeObserver.disconnect();
      unsubscribe();
    };
  }, []);

  return { containerRef, containerWidth, isMounted };
};
