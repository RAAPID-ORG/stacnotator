import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import type { CampaignOutFull } from '~/api/client';

interface TimelineSidebarProps {
  campaign: CampaignOutFull;
  selectedViewId: number | null;
  activeCollectionId: number | null;
  activeSliceIndex: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCollectionChange?: (collectionId: number) => void;
  onSliceChange?: (sliceIndex: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
  emptySlices?: Record<string, true>;
}

interface TimelineStep {
  collectionId: number;
  collectionIndex: number;
  sliceIndex: number;
  collectionLabel: string;
  sliceLabel: string;
  sliceCount: number;
}

const TimelineSidebar = ({
  campaign,
  selectedViewId,
  activeCollectionId,
  activeSliceIndex,
  collapsed,
  onToggleCollapse,
  onCollectionChange,
  onSliceChange,
  onDraggingChange,
  emptySlices = {},
}: TimelineSidebarProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const onCollectionChangeRef = useRef(onCollectionChange);
  const onSliceChangeRef = useRef(onSliceChange);
  const onDraggingChangeRef = useRef(onDraggingChange);
  useEffect(() => {
    onCollectionChangeRef.current = onCollectionChange;
  }, [onCollectionChange]);
  useEffect(() => {
    onSliceChangeRef.current = onSliceChange;
  }, [onSliceChange]);
  useEffect(() => {
    onDraggingChangeRef.current = onDraggingChange;
  }, [onDraggingChange]);

  const [isDragging, setIsDragging] = useState(false);
  const dragCollectionIdRef = useRef<number | null>(null);
  const dragSliceIndexRef = useRef<number>(0);
  const [dragCollectionId, setDragCollectionId] = useState<number | null>(null);
  const [dragSliceIndex, setDragSliceIndex] = useState<number>(0);
  const [tooltip, setTooltip] = useState<{ y: number; text: string } | null>(null);
  const rafRef = useRef<number | null>(null);

  const allStepsRef = useRef<TimelineStep[]>([]);
  const yToStepRef = useRef<(clientY: number) => TimelineStep | null>(() => null);

  const selectedView = campaign.imagery_views?.find((v) => v.id === selectedViewId) ?? null;

  const viewCollections = useMemo(() => {
    if (!selectedView) return [];
    return selectedView.collection_refs
      .map((ref) => {
        const source = campaign.imagery_sources.find((s) => s.id === ref.source_id);
        const collection = source?.collections.find((c) => c.id === ref.collection_id);
        return { ...ref, collection, source };
      })
      .filter((r) => r.collection);
  }, [selectedView, campaign.imagery_sources]);

  const dateRange = useMemo(() => {
    let earliest: string | null = null;
    let latest: string | null = null;
    for (const { collection } of viewCollections) {
      if (!collection) continue;
      for (const slice of collection.slices) {
        if (!earliest || slice.start_date < earliest) earliest = slice.start_date;
        if (!latest || slice.end_date > latest) latest = slice.end_date;
      }
    }
    return { start: earliest, end: latest };
  }, [viewCollections]);

  const allSteps = useMemo<TimelineStep[]>(() => {
    return viewCollections.map((r, ci) => {
      const col = r.collection!;
      return {
        collectionId: col.id,
        collectionIndex: ci,
        sliceIndex: 0,
        collectionLabel: col.name,
        sliceLabel: col.slices[0]?.name ?? '',
        sliceCount: col.slices.length,
      };
    });
  }, [viewCollections]);

  allStepsRef.current = allSteps;
  yToStepRef.current = useCallback((clientY: number): TimelineStep | null => {
    const track = trackRef.current;
    const steps = allStepsRef.current;
    if (!track || steps.length === 0) return null;
    const rect = track.getBoundingClientRect();
    const relY = Math.max(0, Math.min(clientY - rect.top, rect.height - 1));
    const frac = relY / rect.height;
    const idx = Math.floor(frac * steps.length);
    return steps[Math.min(idx, steps.length - 1)];
  }, []);

  const liveCollectionId = isDragging
    ? (dragCollectionId ?? activeCollectionId)
    : activeCollectionId;
  const _liveSliceIndex = isDragging ? dragSliceIndex : activeSliceIndex;

  const pointerMoveHandlerRef = useRef<(e: PointerEvent) => void>(() => {});
  const pointerUpHandlerRef = useRef<(e: PointerEvent) => void>(() => {});

  pointerMoveHandlerRef.current = (e: PointerEvent) => {
    if (!isDraggingRef.current) return;
    const step = yToStepRef.current(e.clientY);
    if (!step) return;

    const landingSlice = (() => {
      for (let i = 0; i < step.sliceCount; i++) {
        if (!emptySlices[`${step.collectionId}-${i}`]) return i;
      }
      return 0;
    })();

    dragCollectionIdRef.current = step.collectionId;
    dragSliceIndexRef.current = landingSlice;

    onCollectionChangeRef.current?.(step.collectionId);
    onSliceChangeRef.current?.(landingSlice);

    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const track = trackRef.current;
        const cId = dragCollectionIdRef.current;
        const sIdx = dragSliceIndexRef.current;
        setDragCollectionId(cId);
        setDragSliceIndex(sIdx);
        if (track && cId !== null) {
          const allS = allStepsRef.current;
          const step = allS.find((s) => s.collectionId === cId);
          if (step) {
            const rect = track.getBoundingClientRect();
            const relY = e.clientY - rect.top;
            setTooltip({ y: relY, text: step.collectionLabel });
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

    document.removeEventListener('pointermove', stablePointerMove, {
      capture: true,
    } as AddEventListenerOptions);
    document.removeEventListener('pointerup', stablePointerUp, {
      capture: true,
    } as AddEventListenerOptions);

    setIsDragging(false);
    setTooltip(null);
    onDraggingChangeRef.current?.(false);

    const step = yToStepRef.current(e.clientY);
    if (step) {
      const landingSlice = (() => {
        for (let i = 0; i < step.sliceCount; i++) {
          if (!emptySlices[`${step.collectionId}-${i}`]) return i;
        }
        return 0;
      })();
      onCollectionChangeRef.current?.(step.collectionId);
      onSliceChangeRef.current?.(landingSlice);
    }
  };

  const stablePointerMove = useRef((e: PointerEvent) => pointerMoveHandlerRef.current(e)).current;
  const stablePointerUp = useRef((e: PointerEvent) => pointerUpHandlerRef.current(e)).current;

  useEffect(
    () => () => {
      document.removeEventListener('pointermove', stablePointerMove, {
        capture: true,
      } as AddEventListenerOptions);
      document.removeEventListener('pointerup', stablePointerUp, {
        capture: true,
      } as AddEventListenerOptions);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [stablePointerMove, stablePointerUp]
  );

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;
      setIsDragging(true);
      onDraggingChangeRef.current?.(true);
      document.addEventListener('pointermove', stablePointerMove, { capture: true, passive: true });
      document.addEventListener('pointerup', stablePointerUp, { capture: true });
      pointerMoveHandlerRef.current(e.nativeEvent);
    },
    [stablePointerMove, stablePointerUp]
  );

  const totalCollections = viewCollections.length;

  const formatDateLabel = (d: string | null) => {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  };

  return (
    <div className="relative h-full" data-tour="timeline-sidebar">
      <button
        onClick={onToggleCollapse}
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full z-[1001] w-4 h-12 bg-white hover:bg-neutral-50 text-neutral-400 hover:text-neutral-700 rounded-r-md border border-l-0 border-neutral-200 shadow-sm transition-colors cursor-pointer flex items-center justify-center"
        title={collapsed ? 'Show timeline' : 'Hide timeline'}
        type="button"
      >
        <svg
          width="8"
          height="14"
          viewBox="0 0 8 14"
          fill="none"
          className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
        >
          <path
            d="M6 1L1.5 7L6 13"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div
        className="overflow-hidden border-r border-neutral-200 h-full bg-white"
        style={{
          width: collapsed ? 0 : 60,
          transition: 'width 180ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {!collapsed && (
          <div className="h-full flex flex-col px-1.5 py-2 select-none">
            <div className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider mb-2 text-center leading-tight">
              {formatDateLabel(dateRange.start)}
            </div>

            <div
              ref={trackRef}
              className="flex-1 flex flex-col relative cursor-ns-resize group/track"
              onPointerDown={startDrag}
            >
              <div className="absolute left-1/2 -translate-x-px top-0 bottom-0 w-px bg-neutral-200 pointer-events-none" />

              {viewCollections.map(({ collection }, _index) => {
                if (!collection) return null;
                const isActive = collection.id === liveCollectionId;
                const segH = `${100 / totalCollections}%`;

                return (
                  <div
                    key={collection.id}
                    className="relative flex items-center justify-center"
                    style={{ height: segH, minHeight: segH }}
                  >
                    {isActive ? (
                      <div className="absolute inset-x-0 inset-y-0.5 flex flex-col items-center justify-center bg-brand-50 border border-brand-500 rounded-md shadow-sm z-10 px-0.5">
                        <span className="text-[9px] font-semibold text-brand-800 leading-tight text-center break-words w-full">
                          {collection.name}
                        </span>
                      </div>
                    ) : (
                      <div
                        className="absolute inset-x-0 inset-y-0 flex items-center justify-center z-10"
                        title={collection.name}
                      >
                        <div className="relative flex items-center justify-center w-full h-full">
                          <div className="h-px w-3 bg-neutral-300 group-hover/track:bg-neutral-400 transition-colors" />
                          <div className="absolute inset-x-1 inset-y-0 rounded hover:bg-neutral-100/70 transition-colors" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {isDragging && tooltip && (
                <div
                  className="absolute left-full ml-3 z-50 pointer-events-none"
                  style={{ top: Math.max(0, tooltip.y - 14) }}
                >
                  <div className="bg-neutral-800 text-white text-[10px] rounded-md px-2.5 py-1.5 shadow-lg whitespace-nowrap leading-snug">
                    {tooltip.text}
                  </div>
                </div>
              )}
            </div>

            <div className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider mt-2 text-center leading-tight">
              {formatDateLabel(dateRange.end)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TimelineSidebar;
