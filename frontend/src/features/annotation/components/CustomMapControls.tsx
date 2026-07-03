import { useMapStore } from '../stores/map.store';
import type { CustomMapOut } from '~/api/client';
import HeaderSelect from './Map/HeaderSelect';

export function CustomMapControls({ customMaps }: { customMaps: CustomMapOut[] }) {
  const activeCustomMapId = useMapStore((s) => s.activeCustomMapId);
  const setActiveCustomMapId = useMapStore((s) => s.setActiveCustomMapId);
  const showCustomMap = useMapStore((s) => s.showCustomMap);
  const setShowCustomMap = useMapStore((s) => s.setShowCustomMap);

  const ready = customMaps.filter((m) => m.status === 'ready');
  if (ready.length === 0) return null;
  const active = ready.find((m) => m.id === activeCustomMapId);

  return (
    <div className="flex items-center gap-1" data-testid="custom-map-controls">
      {/* Overlays are their own control, visually separated from the imagery selectors. */}
      <div className="w-px h-3 bg-neutral-200 mx-0.5" />
      <HeaderSelect
        icon={
          <svg
            width="11"
            height="11"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="opacity-40 shrink-0"
          >
            <polygon points="10,3 18,8 10,13 2,8" />
            <path d="M2 12l8 5 8-5" opacity="0.5" />
          </svg>
        }
        value={activeCustomMapId ?? ''}
        options={[
          { value: '', label: 'No overlay' },
          ...ready.map((m) => ({ value: m.id, label: m.name })),
        ]}
        onChange={(v) => {
          if (v === '') {
            setActiveCustomMapId(null);
            return;
          }
          setActiveCustomMapId(Number(v));
          setShowCustomMap(true);
        }}
        title="Select overlay map"
      />
      {active && (
        <>
          <button
            data-testid="custom-map-toggle"
            aria-pressed={showCustomMap}
            onClick={() => setShowCustomMap(!showCustomMap)}
            title={showCustomMap ? 'Hide overlay (m)' : 'Show overlay (m)'}
            className={`w-6 h-6 rounded-md transition-colors flex items-center justify-center cursor-pointer ${
              showCustomMap
                ? 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                : 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500'
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="10,3 18,8 10,13 2,8" />
              <path d="M2 12l8 5 8-5" opacity="0.5" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
