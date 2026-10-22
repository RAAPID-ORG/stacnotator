import { useTranslation } from 'react-i18next';
import { useCampaignStore, useCatalog } from '../../stores/campaign';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useImageryStore } from '../../stores/imagery';
import { monthYear, segmentIndexAt, timelineCollections, timelineRange } from './timeline';

export function Timeline({
  orientation = 'vertical',
}: {
  orientation?: 'horizontal' | 'vertical';
}) {
  const { t } = useTranslation('panels');
  const horizontal = orientation === 'horizontal';
  const catalog = useCatalog();
  const address = useImageryStore((s) => s.address);
  const activateCollection = useImageryStore((s) => s.activateCollection);

  const trackRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  const view = useCampaignStore((s) => s.view);
  const collections = useMemo(
    () => timelineCollections(catalog, view?.source_ids ?? [], address?.sourceId ?? null),
    [catalog, view, address?.sourceId]
  );
  const range = useMemo(() => timelineRange(catalog, collections), [catalog, collections]);

  const ticks = useMemo(
    () =>
      collections.map((collection) => {
        const size = `${100 / collections.length}%`;
        return (
          <div
            key={collection.id}
            data-collection-id={collection.id}
            className="relative flex items-center justify-center"
            style={horizontal ? { width: size, minWidth: size } : { height: size, minHeight: size }}
            title={collection.name}
          >
            <div className={`${horizontal ? 'h-3 w-px' : 'h-px w-3'} bg-neutral-200`} />
          </div>
        );
      }),
    [collections, horizontal]
  );

  /** Selects the collection under the pointer. Reads the active collection
   *  back off the store rather than closing over it: re-selecting the one
   *  already showing would restart its tile loads on every pointer move. */
  const pickAt = useCallback(
    (clientX: number, clientY: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const index = segmentIndexAt(
        collections.length,
        horizontal ? clientX - rect.left : clientY - rect.top,
        horizontal ? rect.width : rect.height
      );
      if (index === null) return;
      const collection = collections[index];
      if (collection.id !== useImageryStore.getState().address?.collectionId) {
        activateCollection(catalog, collection.id);
      }
    },
    [activateCollection, catalog, collections, horizontal]
  );

  const startScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // The track sits inside a draggable grid panel, so the gesture has to be
    // claimed here or the panel moves instead.
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.focus({ preventScroll: true });
    // Capture keeps the drag alive over the map and past the track's edges.
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbing.current = true;
    pickAt(e.clientX, e.clientY);
  };

  const endScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing.current) return;
    pickAt(e.clientX, e.clientY);
    scrubbing.current = false;
  };

  const activeIndex = collections.findIndex((c) => c.id === address?.collectionId);
  const activeCollection = activeIndex >= 0 ? collections[activeIndex] : null;
  const activeLabel =
    activeCollection?.name || monthYear(activeCollection?.slices[0]?.start_date ?? null);
  const activeTopPct =
    collections.length > 0 ? ((activeIndex + 0.5) / collections.length) * 100 : 0;

  return (
    <div
      className={`flex h-full min-h-0 w-full select-none gap-2 p-2 ${horizontal ? 'items-center' : 'flex-col'}`}
      data-orientation={orientation}
      data-testid="imagery-timeline"
      data-tour="timeline-sidebar"
    >
      <span className="shrink-0 text-center text-[9px] font-medium uppercase tracking-wider text-neutral-500">
        {monthYear(range.start)}
      </span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={collections.length ? 0 : -1}
        aria-label={t('timeline.label')}
        aria-orientation={orientation}
        aria-valuemin={1}
        aria-valuemax={Math.max(1, collections.length)}
        aria-valuenow={Math.max(1, activeIndex + 1)}
        aria-valuetext={activeCollection?.name ?? t('timeline.noImagery')}
        title={activeLabel || undefined}
        className={`group/timeline relative flex min-h-0 min-w-0 flex-1 touch-none outline-none ${
          horizontal ? 'h-full cursor-ew-resize' : 'w-full cursor-ns-resize flex-col'
        }`}
        onPointerDown={startScrub}
        onPointerMove={(e) => {
          if (scrubbing.current) pickAt(e.clientX, e.clientY);
        }}
        onPointerUp={endScrub}
        onPointerCancel={() => {
          scrubbing.current = false;
        }}
        onLostPointerCapture={() => {
          scrubbing.current = false;
        }}
        onKeyDown={(e) => {
          const step =
            e.key === 'ArrowRight' || e.key === 'ArrowDown'
              ? 1
              : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                ? -1
                : 0;
          const index =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? collections.length - 1
                : step
                  ? Math.max(0, Math.min(collections.length - 1, activeIndex + step))
                  : null;
          if (index === null || !collections[index]) return;
          e.preventDefault();
          e.stopPropagation();
          activateCollection(catalog, collections[index].id);
        }}
      >
        <div
          className={`pointer-events-none absolute bg-neutral-200 ${
            horizontal ? 'inset-x-0 top-1/2 h-px' : 'inset-y-0 left-1/2 w-px'
          }`}
        />
        {ticks}
        {activeCollection && (
          <div
            className={`pointer-events-none absolute z-20 flex items-center justify-center rounded-md border border-brand-500 bg-brand-50 px-1 py-1 shadow-sm group-focus-visible/timeline:ring-2 group-focus-visible/timeline:ring-brand-500 ${
              horizontal
                ? 'top-1/2 -translate-x-1/2 -translate-y-1/2'
                : 'inset-x-0 -translate-y-1/2'
            }`}
            style={
              horizontal
                ? {
                    left: `${activeTopPct}%`,
                    maxWidth: `min(8rem, ${2 * Math.min(activeTopPct, 100 - activeTopPct)}%)`,
                  }
                : { top: `${activeTopPct}%` }
            }
          >
            <span
              className={`w-full text-center text-[9px] font-semibold leading-tight text-brand-800 ${horizontal ? 'truncate' : 'break-words'}`}
            >
              {activeLabel}
            </span>
          </div>
        )}
      </div>
      <span className="shrink-0 text-center text-[9px] font-medium uppercase tracking-wider text-neutral-500">
        {monthYear(range.end)}
      </span>
    </div>
  );
}

export function TimelineSidebar() {
  const { t } = useTranslation('panels');
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="relative h-full">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="absolute right-0 top-1/2 z-[1001] flex h-12 w-4 -translate-y-1/2 translate-x-full cursor-pointer items-center justify-center rounded-r-md border border-l-0 border-neutral-200 bg-white text-neutral-400 shadow-sm transition-colors hover:bg-neutral-50 hover:text-neutral-700"
        title={collapsed ? t('timeline.show') : t('timeline.hide')}
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
        {!collapsed && <Timeline />}
      </div>
    </div>
  );
}
