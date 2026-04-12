import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const baseMapLayers: Layer[] = layers.filter((layer) => layer.layerType === 'basemap');
  const imageryLayers: Layer[] = layers.filter((layer) => layer.layerType === 'imagery');

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

  const showHierarchy = imageryGroups.some((g) => g.layers.length > 1) || imageryGroups.length > 1;

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

  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const scheduleClose = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setShowLayerDropdown(false), 80);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const toggle = useCallback(() => {
    cancelClose();
    setShowLayerDropdown((o) => !o);
  }, [cancelClose]);

  // Position the dropdown directly under the button via the DOM,
  // avoiding issues with CSS transforms breaking fixed positioning.
  useEffect(() => {
    if (!showLayerDropdown || !buttonRef.current || !dropdownRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    dropdownRef.current.style.top = `${rect.bottom + 4}px`;
    dropdownRef.current.style.left = `${rect.left}px`;
  }, [showLayerDropdown]);

  return (
    <div className="select-none" onMouseLeave={scheduleClose} onMouseEnter={cancelClose}>
      <button
        ref={buttonRef}
        onClick={toggle}
        className="h-6 px-1.5 text-neutral-500 text-[11px] font-medium rounded-md hover:bg-neutral-100 hover:text-neutral-700 transition-colors flex items-center gap-1.5 cursor-pointer"
        title="Select layer ('i' for layer switching and 'shift + i' for visualization switching)"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="opacity-40 shrink-0"
        >
          <path d="M10 2L2 6L10 10L18 6L10 2Z" />
          <path d="M2 10L10 14L18 10" />
          <path d="M2 14L10 18L18 14" />
        </svg>
        <span className="truncate">{selectedDisplayName}</span>
        <svg
          width="8"
          height="8"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-40 shrink-0"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {showLayerDropdown &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999]"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="bg-white border border-neutral-200 rounded-lg shadow-lg min-w-[220px] max-h-[300px] overflow-y-auto">
              {imageryGroups.map((group, gi) => (
                <div key={group.sourceName}>
                  {showHierarchy && (
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-neutral-500 tracking-wide bg-neutral-50 border-b border-neutral-200">
                      {group.sourceName}
                    </div>
                  )}
                  {group.layers.map((layer) => {
                    const displayName = showHierarchy ? parseLayerName(layer.name).viz : layer.name;
                    return (
                      <label
                        key={layer.id}
                        className={`flex items-center px-3 py-2 text-xs text-neutral-800 cursor-pointer transition-colors hover:bg-neutral-50
                          ${showHierarchy ? 'pl-5' : ''}
                          ${selectedLayer?.id === layer.id ? 'bg-brand-50 text-brand-700' : ''}
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
                  {showHierarchy && gi < imageryGroups.length - 1 && (
                    <div className="border-t border-neutral-200"></div>
                  )}
                </div>
              ))}

              <div className="border-t border-neutral-300 my-1"></div>

              {baseMapLayers.map((layer) => (
                <label
                  key={layer.id}
                  className={`flex items-center px-3 py-2 text-xs text-neutral-800 cursor-pointer transition-colors hover:bg-neutral-50
                    ${selectedLayer?.id === layer.id ? 'bg-brand-50 text-brand-700' : ''}
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
          </div>,
          document.body
        )}
    </div>
  );
};

export default LayerSelector;
