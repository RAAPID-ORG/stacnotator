import { useState, useMemo } from 'react';

export interface Layer {
  name: string;
  id: string;
  layerType: 'imagery' | 'basemap';
}

interface LayerGroup {
  sourceName: string;
  layers: Layer[];
}

interface LayerSelectorProps {
  layers: Layer[];
  selectedLayer: Layer | undefined;
  onLayerSelect: (layerId: string) => void;
}

/** Parse "SourceName - VizName" into { source, viz }. Falls back to full name for both. */
function parseLayerName(name: string): { source: string; viz: string } {
  const idx = name.indexOf(' - ');
  if (idx === -1) return { source: name, viz: name };
  return { source: name.slice(0, idx), viz: name.slice(idx + 3) };
}

const LayerSelector = ({ layers, selectedLayer, onLayerSelect }: LayerSelectorProps) => {
  const [showLayerDropdown, setShowLayerDropdown] = useState(false);

  const baseMapLayers: Layer[] = layers.filter((layer) => layer.layerType === 'basemap');
  const imageryLayers: Layer[] = layers.filter((layer) => layer.layerType === 'imagery');

  // Group imagery layers by source name
  const imageryGroups: LayerGroup[] = useMemo(() => {
    const groupMap = new Map<string, Layer[]>();
    for (const layer of imageryLayers) {
      const { source } = parseLayerName(layer.name);
      if (!groupMap.has(source)) groupMap.set(source, []);
      groupMap.get(source)!.push(layer);
    }
    return Array.from(groupMap.entries()).map(([sourceName, groupLayers]) => ({
      sourceName,
      layers: groupLayers,
    }));
  }, [imageryLayers]);

  // Always show hierarchical when any group has more than one viz
  const showHierarchy = imageryGroups.some((g) => g.layers.length > 1) || imageryGroups.length > 1;

  /** Display name for the selected layer in the button */
  const selectedDisplayName = useMemo(() => {
    if (!selectedLayer) return '';
    if (selectedLayer.layerType === 'basemap') return selectedLayer.name;
    if (!showHierarchy) return selectedLayer.name;
    const { source, viz } = parseLayerName(selectedLayer.name);
    return `${source} › ${viz}`;
  }, [selectedLayer, showHierarchy]);

  const handleLayerSelect = (layerId: string) => {
    onLayerSelect(layerId);
    setShowLayerDropdown(false);
  };

  return (
    <div className="relative" onMouseLeave={() => setShowLayerDropdown(false)}>
      <button
        onMouseEnter={() => setShowLayerDropdown(true)}
        className="px-3 py-1.5 bg-white text-neutral-900 text-xs font-medium rounded shadow hover:bg-neutral-50 transition-colors flex items-center gap-1.5 cursor-pointer"
        title="Select layer ('i' for layer switching and 'shift + i' for visualization switching)"
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 2L2 6L10 10L18 6L10 2Z" />
          <path d="M2 10L10 14L18 10" />
          <path d="M2 14L10 18L18 14" />
        </svg>
        {selectedDisplayName}
      </button>

      {showLayerDropdown && (
        <div
          className="absolute top-full right-0 bg-white border border-neutral-300 rounded-bl rounded-br shadow-lg min-w-[200px] max-h-[300px] overflow-y-auto z-[1001]"
          onMouseEnter={() => setShowLayerDropdown(true)}
          onMouseLeave={() => setShowLayerDropdown(false)}
        >
          {/* Imagery layers - grouped by source */}
          {imageryGroups.map((group, gi) => (
            <div key={group.sourceName}>
              {/* Source group header */}
              {showHierarchy && (
                <div className="px-3 py-1 text-[11px] font-semibold text-neutral-700 uppercase tracking-wider bg-neutral-50 border-b border-neutral-200">
                  {group.sourceName}
                </div>
              )}
              {group.layers.map((layer) => {
                const displayName = showHierarchy ? parseLayerName(layer.name).viz : layer.name;
                return (
                  <label
                    key={layer.id}
                    className={`flex items-center px-3 py-2 text-sm text-neutral-900 cursor-pointer transition-colors hover:bg-neutral-50
                            ${showHierarchy ? 'pl-5' : ''}
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
                    <span>{displayName}</span>
                  </label>
                );
              })}
              {/* Divider between source groups */}
              {showHierarchy && gi < imageryGroups.length - 1 && (
                <div className="border-t border-neutral-200"></div>
              )}
            </div>
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
        </div>
      )}
    </div>
  );
};

export default LayerSelector;
