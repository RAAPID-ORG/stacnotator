import { useCampaignStore, useCatalog } from '../../stores/campaign';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useImageryStore } from '../../stores/imagery';
import { monthYear, segmentIndexAt, timelineCollections, timelineRange } from './timeline';

interface Scrub {
  /** Pointer position inside the track, px from its top. */
  y: number;
  label: string;
}

export function TimelineSidebar() {
  const catalog = useCatalog();
  const address = useImageryStore((s) => s.address);
  const activateCollection = useImageryStore((s) => s.activateCollection);

  const trackRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [scrub, setScrub] = useState<Scrub | null>(null);

  const view = useCampaignStore((s) => s.view);
  const collections = useMemo(
    () => timelineCollections(catalog, view?.source_ids ?? [], address?.sourceId ?? null),
    [catalog, view, address?.sourceId]
  );
  const range = useMemo(() => timelineRange(catalog, collections), [catalog, collections]);

  // The ticks don't move while scrubbing, and the scrub tooltip re-renders on
  // every pointer move - holding them as one memoized element keeps those
  // renders off the rail itself.
  const ticks = useMemo(
    () =>
      collections.map((collection) => {
        const height = `${100 / collections.length}%`;
        return (
          <div
            key={collection.id}
            data-collection-id={collection.id}
            className="relative flex items-center justify-center"
            style={{ height, minHeight: height }}
            title={collection.name}
          >
            <div className="h-px w-3 bg-neutral-200" />
          </div>
        );
      }),
    [collections]
  );

  /** Selects the collection under the pointer. Reads the active collection
   *  back off the store rather than closing over it: re-selecting the one
   *  already showing would restart its tile loads on every pointer move. */
  const pickAt = useCallback(
    (clientY: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const index = segmentIndexAt(collections.length, clientY - rect.top, rect.height);
      if (index === null) return;
      const collection = collections[index];
      if (collection.id !== useImageryStore.getState().address?.collectionId) {
        activateCollection(catalog, collection.id);
      }
      setScrub({ y: clientY - rect.top, label: collection.name });
    },
    [activateCollection, catalog, collections]
  );

  const startScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // The track sits inside a draggable grid panel, so the gesture has to be
    // claimed here or the panel moves instead.
    e.preventDefault();
    e.stopPropagation();
    // Capture keeps the drag alive over the map and past the track's edges.
    e.currentTarget.setPointerCapture(e.pointerId);
    pickAt(e.clientY);
  };

  const endScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrub) return;
    pickAt(e.clientY);
    setScrub(null);
  };

  const activeIndex = collections.findIndex((c) => c.id === address?.collectionId);
  const activeCollection = activeIndex >= 0 ? collections[activeIndex] : null;
  const activeLabel =
    activeCollection?.name || monthYear(activeCollection?.slices[0]?.start_date ?? null);
  const activeTopPct =
    collections.length > 0 ? ((activeIndex + 0.5) / collections.length) * 100 : 0;

  return (
    <div className="relative h-full" data-tour="timeline-sidebar">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="absolute right-0 top-1/2 z-[1001] flex h-12 w-4 -translate-y-1/2 translate-x-full cursor-pointer items-center justify-center rounded-r-md border border-l-0 border-neutral-200 bg-white text-neutral-400 shadow-sm transition-colors hover:bg-neutral-50 hover:text-neutral-700"
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
        className="h-full overflow-hidden border-r border-neutral-200 bg-white"
        style={{
          width: collapsed ? 0 : 60,
          transition: 'width 180ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {!collapsed && (
          <div className="flex h-full select-none flex-col px-1.5 py-2">
            <div className="mb-2 text-center text-[9px] font-medium uppercase leading-tight tracking-wider text-neutral-500">
              {monthYear(range.start)}
            </div>

            <div
              ref={trackRef}
              className="group/track relative flex flex-1 cursor-ns-resize flex-col"
              onPointerDown={startScrub}
              onPointerMove={(e) => {
                if (scrub) pickAt(e.clientY);
              }}
              onPointerUp={endScrub}
              onPointerCancel={endScrub}
            >
              <div className="pointer-events-none absolute bottom-0 left-1/2 top-0 w-px -translate-x-px bg-neutral-200" />

              {ticks}

              {activeCollection && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center justify-center rounded-md border border-brand-500 bg-brand-50 px-0.5 py-1 shadow-sm"
                  style={{ top: `${activeTopPct}%`, transform: 'translateY(-50%)', minHeight: 34 }}
                >
                  <span className="w-full break-words text-center text-[9px] font-semibold leading-tight text-brand-800">
                    {activeLabel}
                  </span>
                </div>
              )}

              {scrub && (
                <div
                  className="pointer-events-none absolute left-full z-50 ml-3"
                  style={{ top: Math.max(0, scrub.y - 14) }}
                >
                  <div className="whitespace-nowrap rounded-md bg-neutral-800 px-2.5 py-1.5 text-[10px] leading-snug text-white shadow-lg">
                    {scrub.label}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-2 text-center text-[9px] font-medium uppercase leading-tight tracking-wider text-neutral-500">
              {monthYear(range.end)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
