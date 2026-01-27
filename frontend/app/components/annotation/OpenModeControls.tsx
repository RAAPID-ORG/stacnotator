import { useState } from 'react';
import type { LabelBase } from '~/api/client';
import { useAnnotationStore } from '~/stores/annotationStore';
import { capitalizeFirst } from '~/utils/utility';

type OpenModeTool = 'pan' | 'annotate' | 'edit' | 'timeseries';
export type GeometryType = 'point' | 'polygon' | 'line';

/**
 * Extended label type with geometry type and color
 */
export interface ExtendedLabel extends LabelBase {
  geometry_type: GeometryType;
  color: string;
}

/**
 * Color palette for remote sensing annotation
 * Using colors that work well on satellite imagery
 */
const LABEL_COLORS = [
  '#10b981', // emerald - vegetation/crops
  '#f59e0b', // amber - urban/built-up
  '#3b82f6', // blue - water
  '#8b5cf6', // purple - forest
  '#ef4444', // red - barren/soil
  '#ec4899', // pink - special features
  '#06b6d4', // cyan - ice/snow
  '#f97316', // orange - mixed use
  '#6366f1', // indigo - infrastructure
  '#14b8a6', // teal - wetlands
];

/**
 * Assign colors and mock geometry types to labels
 * In production, these would come from the backend
 */
export const extendLabelsWithMetadata = (labels: LabelBase[]): ExtendedLabel[] => {
  return labels.map((label, index) => ({
    ...label,
    // TODO: geometry_type should come from backend
    // For now, default all labels to polygon (most common for remote sensing)
    // You can manually change specific labels if needed
    geometry_type: 'polygon' as GeometryType,
    color: LABEL_COLORS[index % LABEL_COLORS.length],
  }));
};

/**
 * Tool definitions for open mode annotation
 */
const TOOLS: { id: OpenModeTool; label: string; icon: React.ReactNode; shortcut: string }[] = [
  {
    id: 'pan',
    label: 'Pan',
    shortcut: 'V',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
      </svg>
    ),
  },
  {
    id: 'annotate',
    label: 'Annotate',
    shortcut: 'A',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
  },
  {
    id: 'edit',
    label: 'Edit',
    shortcut: 'E',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
  },
  {
    id: 'timeseries',
    label: 'Timeseries',
    shortcut: 'T',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v18h18" />
        <path d="M7 16l4-4 4 4 5-6" />
      </svg>
    ),
  },
];

/**
 * Controls panel for open mode annotation
 * Provides Pan, Annotate (with label-based drawing), and Timeseries tools
 */
const OpenModeControls = () => {
  // Get state from store
  const campaign = useAnnotationStore(state => state.campaign);
  const selectedLabelId = useAnnotationStore(state => state.selectedLabelId);
  const activeTool = useAnnotationStore(state => state.activeTool);
  const magicWandEnabled = useAnnotationStore(state => state.magicWandEnabled);
  const setSelectedLabelId = useAnnotationStore(state => state.setSelectedLabelId);
  const setActiveTool = useAnnotationStore(state => state.setActiveTool);
  const setTimeseriesPoint = useAnnotationStore(state => state.setTimeseriesPoint);
  const toggleMagicWand = useAnnotationStore(state => state.toggleMagicWand);

  // Get labels and extend with metadata
  const baseLabels = campaign?.settings.labels || [];
  const extendedLabels = extendLabelsWithMetadata(baseLabels);

  // Filter tools based on campaign configuration
  const hasTimeseries = (campaign?.time_series?.length ?? 0) > 0;
  const availableTools = TOOLS.filter(tool => 
    tool.id !== 'timeseries' || hasTimeseries
  );

  // Find currently selected label
  const selectedLabel = extendedLabels.find(l => l.id === selectedLabelId) || null;

  const handleToolSelect = (tool: OpenModeTool) => {
    setActiveTool(tool);
    // Clear label selection when switching to pan mode
    if (tool === 'pan') {
      setSelectedLabelId(null);
    }
    // Clear timeseries point when switching away from timeseries tool
    if (tool !== 'timeseries') {
      setTimeseriesPoint(null);
    }
  };  // Quick label selection for efficient workflow
  const handleLabelSelect = (label: ExtendedLabel) => {
    setSelectedLabelId(label.id);
    // Auto-switch to annotate mode if not already there
    if (activeTool !== 'annotate') {
      setActiveTool('annotate');
    }
  };

  // Toggle magic wand for a label
  const handleMagicWandToggle = (e: React.MouseEvent, labelId: number) => {
    e.stopPropagation(); // Prevent label selection when clicking magic wand
    toggleMagicWand(labelId);
  };

  // Get geometry icon based on type
  const getGeometryIcon = (type: GeometryType) => {
    switch (type) {
      case 'point':
        return '●';
      case 'polygon':
        return '▰'; // Rectangle/polygon icon
      case 'line':
        return '━';
    }
  };

  return (
    <div className="w-40 flex flex-col gap-3 p-2 bg-white overflow-y-auto h-full">
      {/* Drawing Tools */}
      <div className="flex flex-col gap-1">
        <span className="font-bold text-neutral-900 text-xs">Tools</span>
        <div className="flex flex-col gap-1">
          {availableTools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => handleToolSelect(tool.id)}
              title={`${tool.label} (${tool.shortcut})`}
              className={`flex items-center gap-2 p-2 rounded text-[11px] transition-colors cursor-pointer ${
                activeTool === tool.id
                  ? 'bg-brand-100 text-brand-700 border-2 border-brand-500 font-semibold'
                  : 'bg-neutral-100 text-neutral-700 border-2 border-transparent hover:border-brand-300'
              }`}
            >
              {tool.icon}
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Label Selection - show for annotate tool */}
      {activeTool === 'annotate' && (
        <div className="flex flex-col gap-1">
          <span className="font-bold text-neutral-900 text-xs">
            Labels
          </span>
          {extendedLabels.map((label, index) => (
            <div key={label.id} className="relative">
              <button
                className={`w-full text-left px-2 py-1.5 text-[10px] font-bold rounded-sm transition-colors flex items-center gap-2 ${
                  selectedLabelId === label.id
                    ? 'bg-neutral-100 text-brand-700 border-brand-500 border-2 font-semibold'
                    : 'bg-neutral-100 hover:border-brand-500 text-neutral-800 border-neutral-100 border-2'
                } cursor-pointer`}
                onClick={() => handleLabelSelect(label)}
              >
                {/* Color indicator */}
                <span
                  className="w-3 h-3 rounded-sm border border-neutral-300 flex-shrink-0"
                  style={{ backgroundColor: label.color }}
                />
                <span className="flex-1">
                  {selectedLabelId === label.id ? '✓ ' : ''}
                  {capitalizeFirst(label.name)}
                </span>
                <span className="text-neutral-400 text-[9px] flex items-center gap-1">
                  <span>{getGeometryIcon(label.geometry_type)}</span>
                  <span>[{index + 1}]</span>
                </span>
              </button>
              {/* Magic Wand Icon - only for polygon labels */}
              {label.geometry_type === 'polygon' && (
                <button
                  onClick={(e) => handleMagicWandToggle(e, label.id)}
                  title={magicWandEnabled[label.id] ? 'Magic wand active - Click to draw automatically' : 'Magic wand inactive - Click to enable'}
                  className={`absolute top-1 right-1 p-0.5 rounded transition-all hover:scale-110 ${
                    magicWandEnabled[label.id]
                      ? 'bg-purple-500 text-white shadow-md'
                      : 'bg-neutral-200 text-neutral-500 hover:bg-neutral-300'
                  }`}
                  style={{ zIndex: 10 }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15 4V2" />
                    <path d="M15 16v-2" />
                    <path d="M8 9h2" />
                    <path d="M20 9h2" />
                    <path d="M17.8 11.8 19 13" />
                    <path d="M15 9h0" />
                    <path d="M17.8 6.2 19 5" />
                    <path d="m3 21 9-9" />
                    <path d="M12.2 6.2 11 5" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          {extendedLabels.length === 0 && (
            <p className="text-xs text-neutral-500 italic">No labels defined</p>
          )}
          
          {/* Current selection info */}
          {selectedLabel && (
            <div className="mt-2 p-2 bg-blue-50 rounded border border-blue-200">
              <p className="text-[10px] text-blue-700 font-medium mb-1">
                Selected: {capitalizeFirst(selectedLabel.name)}
              </p>
              <p className="text-[9px] text-blue-600">
                Type: {capitalizeFirst(selectedLabel.geometry_type)}
              </p>
              {selectedLabel.geometry_type === 'polygon' && magicWandEnabled[selectedLabel.id] ? (
                <p className="text-[9px] text-purple-600 mt-1 font-medium">
                  Magic wand active! Click once to auto-generate polygon.
                </p>
              ) : (
                <p className="text-[9px] text-neutral-500 mt-1">
                  Click on the map to draw a {selectedLabel.geometry_type}.
                  {selectedLabel.geometry_type === 'polygon' && ' Double-click to finish.'}
                </p>
              )}
            </div>
          )}
          
          {!selectedLabel && (
            <p className="text-[9px] text-amber-600 mt-1 p-2 bg-amber-50 rounded">
              Select a label to start annotating
            </p>
          )}
        </div>
      )}

      {/* Edit Tool Info */}
      {activeTool === 'edit' && (
        <div className="flex flex-col gap-1">
          <span className="font-bold text-neutral-900 text-xs">Edit Tool</span>
          <p className="text-[10px] text-neutral-600">
            Hover over geometries to highlight them, then click to select and edit vertices.
          </p>
          <p className="text-[10px] text-neutral-500 mt-1">
            Drag vertices to move them. Use the controls to save or delete.
            Right click on vertices to delete them.
          </p>
        </div>
      )}

      {/* Timeseries Tool Info */}
      {activeTool === 'timeseries' && (
        <div className="flex flex-col gap-1">
          <span className="font-bold text-neutral-900 text-xs">Timeseries Tool</span>
          <p className="text-[10px] text-neutral-600">
            Click anywhere on the map to load timeseries data for that location.
          </p>
        </div>
      )}

      {/* Pan Tool Info */}
      {activeTool === 'pan' && (
        <div className="flex flex-col gap-1">
          <span className="font-bold text-neutral-900 text-xs">Navigation</span>
          <p className="text-[10px] text-neutral-600">
            Drag to pan the map. Use scroll wheel to zoom.
          </p>
          <p className="text-[10px] text-neutral-500 mt-1">
            Tip: Select a label to quickly start annotating.
          </p>
        </div>
      )}

      {/* Keyboard Shortcuts Help */}
      <div className="mt-auto pt-2 border-t border-neutral-200">
        <span className="font-bold text-neutral-900 text-[10px]">Shortcuts</span>
        <div className="mt-1 space-y-0.5">
          {TOOLS.map((tool) => (
            <div key={tool.id} className="flex justify-between text-[9px] text-neutral-500">
              <span>{tool.label}</span>
              <kbd className="px-1 bg-neutral-100 rounded">{tool.shortcut}</kbd>
            </div>
          ))}
          <div className="flex justify-between text-[9px] text-neutral-500">
            <span>Label 1-9</span>
            <kbd className="px-1 bg-neutral-100 rounded">1-9</kbd>
          </div>
          <div className="flex justify-between text-[9px] text-neutral-500">
            <span>Escape</span>
            <kbd className="px-1 bg-neutral-100 rounded">Cancel</kbd>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OpenModeControls;
