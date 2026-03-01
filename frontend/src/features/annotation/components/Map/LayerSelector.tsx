import { useState } from "react";

export interface Layer {
    name: string;
    id: string;
    layerType: 'imagery' | 'basemap';
}

interface LayerSelectorProps {
    layers: Layer[];
    selectedLayer: Layer | undefined;
    onLayerSelect: (layerId: string) => void;
}

const LayerSelector = ({ layers, selectedLayer, onLayerSelect }: LayerSelectorProps) => {
    const [showLayerDropdown, setShowLayerDropdown] = useState(false);

    const baseMapLayers: Layer[] = layers.filter(layer => layer.layerType === 'basemap');
    const imageryLayers: Layer[] = layers.filter(layer => layer.layerType === 'imagery');

    const handleLayerSelect = (layerId: string) => {
        onLayerSelect(layerId);
        setShowLayerDropdown(false);
    }

    return (
        <div className="relative" onMouseLeave={() => setShowLayerDropdown(false)}>
            <button
              onMouseEnter={() => setShowLayerDropdown(true)}
              className="px-3 py-1.5 bg-white text-neutral-900 text-xs font-medium rounded shadow hover:bg-neutral-50 transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Select layer"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 2L2 6L10 10L18 6L10 2Z" />
                <path d="M2 10L10 14L18 10" />
                <path d="M2 14L10 18L18 14" />
              </svg>
              {selectedLayer?.name}
            </button>

            {showLayerDropdown && (
              <div
                className="absolute top-full right-0 bg-white border border-neutral-300 rounded-bl rounded-br shadow-lg min-w-[200px] max-h-[300px] overflow-y-auto z-[1001]"
                onMouseEnter={() => setShowLayerDropdown(true)}
                onMouseLeave={() => setShowLayerDropdown(false)}
              >
                {/* Imagery layers */}
                {imageryLayers.map((layer) => (
                  <label
                    key={layer.id}
                    className={`flex items-center px-3 py-2 text-sm text-neutral-900 cursor-pointer transition-colors
                      ${selectedLayer?.id === layer.id ? 'bg-neutral-100 text-brand-700' : ''}
                    `}
                  >
                    <input
                      type="radio"
                      name="layer"
                      checked={selectedLayer?.id === layer.id}
                      onChange={() => handleLayerSelect(layer.id)}
                      className={`mr-2 accent-brand-500${selectedLayer?.id === layer.id ? '' : ' hover:accent-brand-500'}`}
                    />
                    <span>{layer.name}</span>
                  </label>
                ))}

                <div className="border-t border-neutral-300 my-1"></div>

                {/* Basemap options */}
                {baseMapLayers.map((layer) => (
                  <label
                    key={layer.id}
                    className={`flex items-center px-3 py-2 text-sm text-neutral-900 cursor-pointer transition-colors
                      ${selectedLayer?.id === layer.id ? 'bg-neutral-100 text-brand-700' : ''}
                    `}
                  >
                    <input
                      type="radio"
                      name="layer"
                      checked={selectedLayer?.id === layer.id}
                      onChange={() => handleLayerSelect(layer.id)}
                      className={`mr-2 accent-brand-500${selectedLayer?.id === layer.id ? '' : ' hover:accent-brand-500'}`}
                    />
                    <span>{layer.name}</span>
                  </label>
                ))}
          </div> )}
    </div>
    )
}

export default LayerSelector