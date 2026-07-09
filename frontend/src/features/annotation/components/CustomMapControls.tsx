import { useMapStore } from '../stores/map.store';
import type { CustomMapOut } from '~/api/client';
import HeaderSelect from './Map/HeaderSelect';

export function CustomMapControls({ customMaps }: { customMaps: CustomMapOut[] }) {
  const activeCustomMapId = useMapStore((s) => s.activeCustomMapId);
  const setActiveCustomMapId = useMapStore((s) => s.setActiveCustomMapId);
  const showCustomMap = useMapStore((s) => s.showCustomMap);
  const setShowCustomMap = useMapStore((s) => s.setShowCustomMap);
  const customMapOpacity = useMapStore((s) => s.customMapOpacity);
  const setCustomMapOpacity = useMapStore((s) => s.setCustomMapOpacity);

  const ready = customMaps.filter((m) => m.status === 'ready');
  if (ready.length === 0) return null;
  const active = ready.find((m) => m.id === activeCustomMapId);

  return (
    <div className="flex items-center gap-1" data-testid="custom-map-controls">
      <HeaderSelect
        value={activeCustomMapId ?? ''}
        options={[
          { value: '', label: 'No map' },
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
          <input
            type="range"
            min={0}
            max={100}
            value={customMapOpacity}
            data-testid="custom-map-opacity"
            onChange={(e) => setCustomMapOpacity(Number(e.target.value))}
            title="Overlay opacity"
            className="w-16 accent-brand-500 cursor-pointer"
          />
        </>
      )}
    </div>
  );
}
