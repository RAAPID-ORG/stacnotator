import { useEffect, useRef, useState } from 'react';

export interface ContainerSize {
  containerRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  height: number;
  isMounted: boolean;
}

/** Tracks a container's content box via ResizeObserver, coalesced to one
 *  update per animation frame. Platform-level primitive: no app-specific
 *  suspension logic (e.g. pausing during a sidebar transition) - callers
 *  that need that layer it on top. */
export function useContainerSize(): ContainerSize {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let rafId: number | null = null;
    let latestWidth = 0;
    let latestHeight = 0;

    const flush = () => {
      rafId = null;
      setWidth(latestWidth);
      setHeight(latestHeight);
    };

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      latestWidth = entry.contentRect.width;
      latestHeight = entry.contentRect.height;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    });

    resizeObserver.observe(containerRef.current);
    setIsMounted(true);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, []);

  return { containerRef, width, height, isMounted };
}
