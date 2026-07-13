import { useMapStore } from '../stores/map.store';
import type { VectorLayerOut } from '~/api/client';
import HeaderSelect from './Map/HeaderSelect';

/** Header dropdown for PMTiles vector layers: one layer at a time, like overlays. */
export function VectorLayerControls({ vectorLayers }: { vectorLayers: VectorLayerOut[] }) {
  const activeVectorLayerId = useMapStore((s) => s.activeVectorLayerId);
  const setActiveVectorLayerId = useMapStore((s) => s.setActiveVectorLayerId);
  const showVectorLayer = useMapStore((s) => s.showVectorLayer);
  const setShowVectorLayer = useMapStore((s) => s.setShowVectorLayer);

  if (vectorLayers.length === 0) return null;
  const active = vectorLayers.find((l) => l.id === activeVectorLayerId);

  return (
    <div className="flex items-center gap-1" data-testid="vector-layer-controls">
      <div className="w-px h-3 bg-neutral-200 mx-0.5" />
      <HeaderSelect
        icon={
          active ? (
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0 border border-black/10"
              style={{ backgroundColor: active.color }}
            />
          ) : (
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
              <path d="M4 4l5 2 6-3 1 11-6 3-5-2-1-11z" />
            </svg>
          )
        }
        value={activeVectorLayerId ?? ''}
        options={[
          { value: '', label: 'No vector layer' },
          ...vectorLayers.map((l) => ({ value: l.id, label: l.name })),
        ]}
        onChange={(v) => {
          if (v === '') {
            setActiveVectorLayerId(null);
            return;
          }
          setActiveVectorLayerId(Number(v));
          setShowVectorLayer(true);
        }}
        title="Select vector layer"
      />
      {active && (
        <button
          data-testid="vector-layer-toggle"
          aria-pressed={showVectorLayer}
          onClick={() => setShowVectorLayer(!showVectorLayer)}
          title={showVectorLayer ? 'Hide vector layer (v)' : 'Show vector layer (v)'}
          className={`w-6 h-6 rounded-md transition-colors flex items-center justify-center cursor-pointer ${
            showVectorLayer
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
            <path d="M4 4l5 2 6-3 1 11-6 3-5-2-1-11z" />
          </svg>
        </button>
      )}
    </div>
  );
}
