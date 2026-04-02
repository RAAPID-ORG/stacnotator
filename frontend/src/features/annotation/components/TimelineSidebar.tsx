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

  // Resolve the current view's collections
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

  // Compute overall date range from all collections' slices
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
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full z-[1001] w-5 h-10 bg-neutral-100 hover:bg-neutral-200 text-neutral-400 hover:text-neutral-600 rounded-r border border-l-0 border-neutral-200 transition-colors cursor-pointer flex items-center justify-center"
        title={collapsed ? 'Show timeline' : 'Hide timeline'}
      >
        <svg
          width="8"
          height="14"
          viewBox="0 0 8 14"
          fill="currentColor"
          className={`transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          <path
            d="M7 1L1 7L7 13"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>

      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden border-r border-neutral-200 h-full bg-white ${
          collapsed ? 'w-0' : 'w-[56px]'
        }`}
      >
        {!collapsed && (
          <div className="h-full flex flex-col px-1 py-1 select-none">
            <div className="text-[10px] font-medium text-neutral-500 mb-1 text-center leading-tight">
              {formatDateLabel(dateRange.start)}
            </div>

            <div
              ref={trackRef}
              className="flex-1 flex flex-col relative cursor-ns-resize"
              onPointerDown={startDrag}
            >
              <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-brand-300 pointer-events-none" />

              {viewCollections.map(({ collection }, _index) => {
                if (!collection) return null;
                const isActive = collection.id === liveCollectionId;
                const segH = `${100 / totalCollections}%`;
                const slices = collection.slices;
                const _hasSlices = isActive && slices.length > 1;

                return (
                  <div
                    key={collection.id}
                    className="relative flex items-center justify-center"
                    style={{ height: segH, minHeight: segH }}
                  >
                    {isActive ? (
                      <div
                        className="absolute inset-x-0 inset-y-0 flex flex-col items-center justify-center
                        border-2 border-brand-500 rounded bg-brand-50 z-10 py-1 gap-0.5"
                      >
                        <span className="text-[8px] font-bold text-brand-700 leading-tight text-center px-0.5 break-words w-full">
                          {collection.name}
                        </span>
                      </div>
                    ) : (
                      <div
                        className="absolute inset-x-0 inset-y-0 flex flex-col items-center justify-center
                        group rounded transition-all duration-150 hover:bg-neutral-50 hover:border hover:border-brand-300 z-10"
                      >
                        <div className="w-2.5 h-px bg-brand-400 group-hover:bg-brand-500 transition-colors" />
                        <span
                          className="text-[7.5px] text-neutral-400 group-hover:text-brand-600
                          leading-tight text-center px-0.5 mt-0.5 break-words w-full transition-colors"
                        >
                          {collection.name}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              {isDragging && tooltip && (
                <div
                  className="absolute left-full ml-2 z-50 pointer-events-none"
                  style={{ top: Math.max(0, tooltip.y - 16) }}
                >
                  <div
                    className="bg-neutral-900 text-white text-[10px] rounded px-2 py-1
                    shadow-lg whitespace-nowrap border border-neutral-700 leading-snug"
                  >
                    {tooltip.text}
                  </div>
                </div>
              )}
            </div>

            <div className="text-[10px] font-medium text-neutral-500 mt-1 text-center leading-tight">
              {formatDateLabel(dateRange.end)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TimelineSidebar;
