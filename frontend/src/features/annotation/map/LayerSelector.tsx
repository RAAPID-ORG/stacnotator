/**
 * LayerSelector – hover-triggered dropdown to switch between available layers.
 *
 * Reads available layers & active layer from the map store.
 * XYZ and STAC layers are grouped separately.
 */

import { useState } from 'react';
import { useMapStore } from './map.store';
import type { LayerDef } from './layers';

const LayerIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
    <path d="M10 2L2 6L10 10L18 6L10 2Z" />
    <path d="M2 10L10 14L18 10" />
    <path d="M2 14L10 18L18 14" />
  </svg>
);

export function LayerSelector() {
  const [open, setOpen] = useState(false);

  const availableLayers = useMapStore((s) => s.availableLayers);
  const activeLayerId = useMapStore((s) => s.activeLayerId);
  const setActiveLayer = useMapStore((s) => s.setActiveLayer);

  const activeLayer = availableLayers.find((l) => l.id === activeLayerId);

  const xyzLayers = availableLayers.filter((l) => l.kind === 'xyz');
  const stacLayers = availableLayers.filter((l) => l.kind === 'stac');

  const handleSelect = (id: string) => {
    setActiveLayer(id);
    setOpen(false);
  };

  const renderOption = (layer: LayerDef) => (
    <label
      key={layer.id}
      className={`flex items-center gap-2 px-3 py-2 text-sm text-neutral-900 cursor-pointer hover:bg-neutral-50 transition-colors ${
        layer.id === activeLayerId ? 'bg-neutral-100 font-medium' : ''
      }`}
    >
      <input
        type="radio"
        name="map-layer"
        checked={layer.id === activeLayerId}
        onChange={() => handleSelect(layer.id)}
        className="accent-brand-500"
      />
      <span>{layer.name}</span>
    </label>
  );

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-neutral-900 text-xs font-medium rounded shadow hover:bg-neutral-50 transition-colors cursor-pointer"
        title="Select layer"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <LayerIcon />
        {activeLayer?.name ?? 'Layers'}
      </button>

      {open && (
        <div className="absolute top-full right-0 min-w-[220px] max-h-[320px] overflow-y-auto bg-white border border-neutral-200 rounded-b shadow-lg z-[1001]">
          {/* XYZ base layers */}
          {xyzLayers.length > 0 && (
            <div>
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">
                Base layers
              </p>
              {xyzLayers.map(renderOption)}
            </div>
          )}

          {/* STAC imagery layers */}
          {stacLayers.length > 0 && (
            <div>
              <div className="border-t border-neutral-200 my-1" />
              <p className="px-3 pt-1 pb-1 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">
                Imagery
              </p>
              {stacLayers.map(renderOption)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
