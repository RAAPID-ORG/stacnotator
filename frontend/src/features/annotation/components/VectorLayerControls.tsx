import { useMapStore } from '../stores/map.store';
import type { VectorLayerOut } from '~/api/client';

/** Header toggle chips for PMTiles vector layers. Several may be enabled at once. */
export function VectorLayerControls({ vectorLayers }: { vectorLayers: VectorLayerOut[] }) {
  const enabledIds = useMapStore((s) => s.enabledVectorLayerIds);
  const toggleVectorLayer = useMapStore((s) => s.toggleVectorLayer);

  if (vectorLayers.length === 0) return null;

  return (
    <div className="flex items-center gap-1" data-testid="vector-layer-controls">
      {vectorLayers.map((layer) => {
        const on = enabledIds.includes(layer.id);
        return (
          <button
            key={layer.id}
            data-testid="vector-layer-toggle"
            data-layer-id={layer.id}
            data-enabled={on}
            aria-pressed={on}
            onClick={() => toggleVectorLayer(layer.id)}
            title={`${on ? 'Hide' : 'Show'} vector layer: ${layer.name}`}
            className={`flex items-center gap-1.5 px-2 h-6 rounded-md text-[11px] font-medium transition-colors cursor-pointer border ${
              on
                ? 'bg-brand-50 text-brand-700 border-brand-600'
                : 'bg-neutral-50 text-neutral-500 border-neutral-200 hover:bg-neutral-100 hover:text-neutral-700'
            }`}
          >
            <span
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0 border border-black/10"
              style={{ backgroundColor: layer.color }}
            />
            <span className="truncate max-w-[8rem]">{layer.name}</span>
          </button>
        );
      })}
    </div>
  );
}
