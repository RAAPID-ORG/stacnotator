import { useImageryStore } from '~/features/annotation/stores';

export interface ViewControlsProps {
  isTaskMode: boolean;
  onFocus: () => void;
  focusTitle: string;
  crosshairTitle: string;
  /** Only meaningful with more than one window to keep in step. */
  showViewSync: boolean;
  viewSyncTitle: string;
}

export function ViewControls({
  isTaskMode,
  onFocus,
  focusTitle,
  crosshairTitle,
  showViewSync,
  viewSyncTitle,
}: ViewControlsProps) {
  const crosshair = useImageryStore((s) => s.crosshair);
  const viewSync = useImageryStore((s) => s.viewSync);
  const toggleCrosshair = useImageryStore((s) => s.toggleCrosshair);
  const toggleViewSync = useImageryStore((s) => s.toggleViewSync);

  const button = 'flex h-6 w-6 items-center justify-center rounded-md cursor-pointer';

  return (
    <>
      <div className="mx-0.5 h-3 w-px bg-neutral-200" />

      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onFocus}
        title={focusTitle}
        data-testid="map-focus"
        className={`${button} text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600`}
      >
        {isTaskMode ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 3a1 1 0 011 1v1.07A7 7 0 0118.93 11H20a1 1 0 110 2h-1.07A7 7 0 0113 18.93V20a1 1 0 11-2 0v-1.07A7 7 0 015.07 13H4a1 1 0 110-2h1.07A7 7 0 0111 5.07V4a1 1 0 011-1zm0 4a5 5 0 100 10 5 5 0 000-10z" />
          </svg>
        ) : (
          <svg
            width="13"
            height="13"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="14" height="14" rx="1" />
            <path d="M3 7h14M3 13h14M7 3v14M13 3v14" strokeWidth="1" opacity="0.4" />
            <circle cx="10" cy="10" r="2.5" fill="currentColor" stroke="none" />
          </svg>
        )}
      </button>

      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={toggleCrosshair}
        aria-pressed={crosshair}
        title={crosshairTitle}
        data-testid="crosshair-toggle"
        className={`${button} ${crosshair ? 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700' : 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500'}`}
      >
        <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="10" cy="10" r="1.5" />
          <path
            d="M10 2V6M10 14V18M2 10H6M14 10H18"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
      </button>

      {showViewSync && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={toggleViewSync}
          aria-pressed={viewSync}
          title={viewSyncTitle}
          data-testid="view-sync-toggle"
          className={`${button} ${viewSync ? 'bg-brand-600 text-white hover:bg-brand-700' : 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500'}`}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <rect x="1" y="3" width="7" height="6" rx="1" />
            <rect x="12" y="11" width="7" height="6" rx="1" />
            {viewSync ? (
              <path d="M8 8l1.5 1.5M10.5 10.5L12 12M9 11l2-2" />
            ) : (
              <path d="M8 8l.5.5M11.5 11.5l.5.5" />
            )}
          </svg>
        </button>
      )}
    </>
  );
}
