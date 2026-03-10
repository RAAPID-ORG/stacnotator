import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import type { ImageryWithWindowsOut } from '~/api/client';
import { computeTimeSlices, formatWindowLabel, formatYearMonth, type TimeSlice } from '~/shared/utils/utility';

interface TimelineSidebarProps {
  imagery: ImageryWithWindowsOut | null;
  activeWindowId: number | null;
  slices: TimeSlice[];
  activeSliceIndex: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onWindowChange?: (windowId: number) => void;
  onSliceChange?: (sliceIndex: number) => void;
  /** Called with true when drag starts, false when drag ends */
  onDraggingChange?: (dragging: boolean) => void;
  /** Slice keys (`{windowId}-{sliceIndex}`) confirmed to have no imagery - hidden in the UI */
  emptySlices?: Record<string, true>;
}

/** One addressable step in the flat drag range */
interface TimelineStep {
  windowId: number;
  windowIndex: number;
  sliceIndex: number;
  windowLabel: string;
  sliceLabel: string;
  sliceCount: number;
}

const TimelineSidebar = ({
  imagery,
  activeWindowId,
  slices,
  activeSliceIndex,
  collapsed,
  onToggleCollapse,
  onWindowChange,
  onSliceChange,
  onDraggingChange,
  emptySlices = {},
}: TimelineSidebarProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Keep ALL callbacks in refs - pointer listeners read the ref directly so
  // they never capture stale closures even as props change between renders.
  const onWindowChangeRef    = useRef(onWindowChange);
  const onSliceChangeRef     = useRef(onSliceChange);
  const onDraggingChangeRef  = useRef(onDraggingChange);
  useEffect(() => { onWindowChangeRef.current   = onWindowChange;  }, [onWindowChange]);
  useEffect(() => { onSliceChangeRef.current    = onSliceChange;   }, [onSliceChange]);
  useEffect(() => { onDraggingChangeRef.current = onDraggingChange;}, [onDraggingChange]);

  const [isDragging, setIsDragging] = useState(false);
  // Committed drag position - updated in-place via refs to avoid stale closures,
  // then flushed into state once per rAF for smooth rendering.
  const dragWindowIdRef    = useRef<number | null>(null);
  const dragSliceIndexRef  = useRef<number>(0);
  const [dragWindowId,   setDragWindowId]   = useState<number | null>(null);
  const [dragSliceIndex, setDragSliceIndex] = useState<number>(0);
  const [tooltip, setTooltip] = useState<{ y: number; text: string } | null>(null);
  const rafRef = useRef<number | null>(null);

  // Keep allSteps + yToStep in refs so pointer handlers always see fresh values
  const allStepsRef  = useRef<TimelineStep[]>([]);
  const yToStepRef   = useRef<(clientY: number) => TimelineStep | null>(() => null);

  if (!imagery) return null;

  const windows   = imagery.windows;
  const startDate = imagery.start_ym;
  const endDate   = imagery.end_ym;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const windowSlices = useMemo(() =>
    windows.map((w) =>
      computeTimeSlices(
        w.window_start_date,
        w.window_end_date,
        imagery.slicing_interval,
        imagery.slicing_unit,
      )
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [windows, imagery.slicing_interval, imagery.slicing_unit],
  );

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const allSteps = useMemo<TimelineStep[]>(() => {
    return windows.map((w, wi) => {
      const wSlices = windowSlices[wi];
      const wLabel  = formatWindowLabel(w.window_start_date, w.window_end_date, imagery.window_unit);
      return {
        windowId:    w.id,
        windowIndex: wi,
        sliceIndex:  0,
        windowLabel: wLabel,
        sliceLabel:  wSlices[0]?.label ?? '',
        sliceCount:  wSlices.length,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windows, windowSlices, imagery.window_unit]);

  // Keep the ref in sync so stable pointer handlers always see fresh steps
  allStepsRef.current = allSteps;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  yToStepRef.current = useCallback((clientY: number): TimelineStep | null => {
    const track = trackRef.current;
    const steps = allStepsRef.current;
    if (!track || steps.length === 0) return null;
    const rect = track.getBoundingClientRect();
    const relY = Math.max(0, Math.min(clientY - rect.top, rect.height - 1));
    const frac = relY / rect.height;
    const idx  = Math.floor(frac * steps.length);
    return steps[Math.min(idx, steps.length - 1)];
  }, []); // stable - reads refs, no deps

  // Which window/slice to display (preview during drag, committed otherwise)
  const liveWindowId   = isDragging ? (dragWindowId   ?? activeWindowId) : activeWindowId;
  const liveSliceIndex = isDragging ? dragSliceIndex  : activeSliceIndex;

  // Stable pointer handlers - stored in refs so addEventListener never needs
  // to be re-added and there is no stale-closure flicker.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const pointerMoveHandlerRef = useRef<(e: PointerEvent) => void>(() => {});
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const pointerUpHandlerRef   = useRef<(e: PointerEvent) => void>(() => {});

  pointerMoveHandlerRef.current = (e: PointerEvent) => {
    if (!isDraggingRef.current) return;
    const step = yToStepRef.current(e.clientY);
    if (!step) return;

    // Find the first non-empty slice for the target window
    const landingSlice = (() => {
      for (let i = 0; i < step.sliceCount; i++) {
        if (!emptySlices[`${step.windowId}-${i}`]) return i;
      }
      return 0; // all empty - fall back to 0
    })();

    // Update refs immediately (no re-render cost)
    dragWindowIdRef.current   = step.windowId;
    dragSliceIndexRef.current = landingSlice;

    // Commit to OL/store immediately - no batching needed, these are cheap
    onWindowChangeRef.current?.(step.windowId);
    onSliceChangeRef.current?.(landingSlice);

    // Throttle React state updates to once per animation frame for smooth rendering
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const track  = trackRef.current;
        const wId    = dragWindowIdRef.current;
        const sIdx   = dragSliceIndexRef.current;
        setDragWindowId(wId);
        setDragSliceIndex(sIdx);
        if (track && wId !== null) {
          const allS = allStepsRef.current;
          const step = allS.find((s) => s.windowId === wId);
          if (step) {
            const rect = track.getBoundingClientRect();
            const relY = e.clientY - rect.top;
            setTooltip({ y: relY, text: step.windowLabel });
          }
        }
      });
    }
  };

  pointerUpHandlerRef.current = (e: PointerEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    document.removeEventListener('pointermove', stablePointerMove, { capture: true } as any);
    document.removeEventListener('pointerup',   stablePointerUp,   { capture: true } as any);

    setIsDragging(false);
    setTooltip(null);
    onDraggingChangeRef.current?.(false);

    // Commit the final position
    const step = yToStepRef.current(e.clientY);
    if (step) {
      const landingSlice = (() => {
        for (let i = 0; i < step.sliceCount; i++) {
          if (!emptySlices[`${step.windowId}-${i}`]) return i;
        }
        return 0;
      })();
      onWindowChangeRef.current?.(step.windowId);
      onSliceChangeRef.current?.(landingSlice);
    }
  };

  // Truly stable wrapper functions - these are the actual listeners registered
  // on document. They delegate to the ref so they never go stale.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const stablePointerMove = useRef((e: PointerEvent) => pointerMoveHandlerRef.current(e)).current;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const stablePointerUp   = useRef((e: PointerEvent) => pointerUpHandlerRef.current(e)).current;

  // Cleanup on unmount
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => () => {
    document.removeEventListener('pointermove', stablePointerMove, { capture: true } as any);
    document.removeEventListener('pointerup',   stablePointerUp,   { capture: true } as any);
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, [stablePointerMove, stablePointerUp]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const startDrag = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    setIsDragging(true);
    onDraggingChangeRef.current?.(true);
    document.addEventListener('pointermove', stablePointerMove, { capture: true, passive: true });
    document.addEventListener('pointerup',   stablePointerUp,   { capture: true });
    // Process the initial position immediately
    pointerMoveHandlerRef.current(e.nativeEvent);
  }, [stablePointerMove, stablePointerUp]);

  const totalWindows = windows.length;

  return (
    <div className="relative h-full" data-tour="timeline-sidebar">
      {/* Collapse/Expand Button */}
      <button
        onClick={onToggleCollapse}
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full z-[1001] w-4 h-10 bg-neutral-200 hover:bg-neutral-300 text-neutral-500 hover:text-neutral-700 rounded-r border border-l-0 border-neutral-300 transition-colors cursor-pointer flex items-center justify-center"
        title={collapsed ? 'Show timeline' : 'Hide timeline'}
      >
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor"
          className={`transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          <path d="M7 1L1 7L7 13" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>

      <div className={`transition-all duration-300 ease-in-out overflow-hidden border-r border-gray-300 h-full bg-white ${
        collapsed ? 'w-0' : 'w-[56px]'
      }`}>
        {!collapsed && (
          <div className="h-full flex flex-col px-1 py-1 select-none">
            {/* Start date */}
            <div className="text-[9px] font-medium text-neutral-500 mb-1 text-center leading-tight">
              {formatYearMonth(startDate)}
            </div>

            {/* ── Track ── */}
            <div
              ref={trackRef}
              className="flex-1 flex flex-col relative cursor-ns-resize"
              onPointerDown={startDrag}
            >
              {/* Continuous centre line */}
              <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-brand-300 pointer-events-none" />

              {/* Per-window segments */}
              {windows.map((window, index) => {
                const isActive   = window.id === liveWindowId;
                const segH       = `${100 / totalWindows}%`;
                const wLabel     = formatWindowLabel(
                  window.window_start_date,
                  window.window_end_date,
                  imagery.window_unit,
                );
                const wSlices    = windowSlices[index];
                const hasSlices  = isActive && wSlices.length > 1;

                return (
                  <div
                    key={window.id}
                    className="relative flex items-center justify-center"
                    style={{ height: segH, minHeight: segH }}
                  >
                    {isActive ? (
                      /* ── Active window ── */
                      <div className="absolute inset-x-0 inset-y-0 flex flex-col items-center justify-center
                        border-2 border-brand-500 rounded bg-brand-50 z-10 py-1 gap-0.5">
                        {/* Window date label */}
                        <span className="text-[8px] font-bold text-brand-700 leading-tight text-center px-0.5 break-words w-full">
                          {wLabel}
                        </span>
                        {/* Slice indicator dots - hidden while dragging to avoid accidental activation */}
                        {hasSlices && !isDragging && (
                          <div
                            className="flex flex-row flex-wrap items-center justify-center gap-0.5 px-0.5"
                          >
                            {wSlices.map((slice, si) => {
                              const sliceKey = `${window.id}-${si}`;
                              const isEmpty = !!emptySlices[sliceKey];
                              const isActive = si === liveSliceIndex;
                              return (
                                <button
                                  key={si}
                                  onPointerDown={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    if (!isEmpty) onSliceChange?.(si);
                                  }}
                                  className={`relative w-1.5 h-1.5 rounded-full transition-colors ${
                                    isEmpty
                                      ? 'bg-neutral-200 cursor-not-allowed opacity-50'
                                      : isActive
                                        ? 'bg-brand-500 cursor-pointer'
                                        : 'bg-neutral-300 hover:bg-neutral-400 cursor-pointer'
                                  }`}
                                  title={isEmpty ? `${slice.label} (no imagery)` : slice.label}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      /* ── Inactive window ── */
                      <div className="absolute inset-x-0 inset-y-0 flex flex-col items-center justify-center
                        group rounded transition-all duration-150 hover:bg-neutral-50 hover:border hover:border-brand-300 z-10">
                        {/* Tick mark on the centre line */}
                        <div className="w-2.5 h-px bg-brand-400 group-hover:bg-brand-500 transition-colors" />
                        {/* Date label - always visible, small */}
                        <span className="text-[7.5px] text-neutral-400 group-hover:text-brand-600
                          leading-tight text-center px-0.5 mt-0.5 break-words w-full transition-colors">
                          {wLabel}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Drag tooltip - floats to the right of the track */}
              {isDragging && tooltip && (
                <div
                  className="absolute left-full ml-2 z-50 pointer-events-none"
                  style={{ top: Math.max(0, tooltip.y - 16) }}
                >
                  <div className="bg-neutral-900 text-white text-[10px] rounded px-2 py-1
                    shadow-lg whitespace-nowrap border border-neutral-700 leading-snug">
                    {tooltip.text}
                  </div>
                </div>
              )}
            </div>

            {/* End date */}
            <div className="text-[9px] font-medium text-neutral-500 mt-1 text-center leading-tight">
              {formatYearMonth(endDate)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TimelineSidebar;
