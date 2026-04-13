import type { LabelBase } from '~/api/client';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import { useAnnotationStore } from '../stores/annotation.store';
import { capitalizeFirst } from '~/shared/utils/utility';

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
  '#a3883a', // ochre - mixed use
  '#6366f1', // indigo - infrastructure
  '#14b8a6', // teal - wetlands
];

/**
 * Assign colors to labels and use geometry types from backend
 * Falls back to 'polygon' if geometry_type is not set (legacy data)
 */
export const extendLabelsWithMetadata = (labels: LabelBase[]): ExtendedLabel[] => {
  return labels.map((label, index) => ({
    ...label,
    geometry_type: (label.geometry_type as GeometryType) || 'polygon',
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
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
      </svg>
    ),
  },
  {
    id: 'annotate',
    label: 'Annotate',
    shortcut: 'R',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
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
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
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
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
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
  const campaign = useCampaignStore((s) => s.campaign);
  const selectedLabelId = useTaskStore((s) => s.selectedLabelId);
  const magicWandEnabled = useTaskStore((s) => s.magicWandEnabled);
  const setSelectedLabelId = useTaskStore((s) => s.setSelectedLabelId);
  const toggleMagicWand = useTaskStore((s) => s.toggleMagicWand);
  const activeTool = useMapStore((s) => s.activeTool);
  const setActiveTool = useMapStore((s) => s.setActiveTool);
  const setTimeseriesPoint = useMapStore((s) => s.setTimeseriesPoint);
  const annotations = useAnnotationStore((s) => s.annotations);
  const currentAnnotationIndex = useAnnotationStore((s) => s.currentAnnotationIndex);
  const goToPreviousAnnotation = useAnnotationStore((s) => s.goToPreviousAnnotation);
  const goToNextAnnotation = useAnnotationStore((s) => s.goToNextAnnotation);
  const triggerFitAnnotations = useMapStore((s) => s.triggerFitAnnotations);

  // Get labels and extend with metadata
  const baseLabels = campaign?.settings.labels || [];
  const extendedLabels = extendLabelsWithMetadata(baseLabels);

  // Filter tools based on campaign configuration
  const hasTimeseries = (campaign?.time_series?.length ?? 0) > 0;
  const availableTools = TOOLS.filter((tool) => tool.id !== 'timeseries' || hasTimeseries);

  // Find currently selected label
  const selectedLabel = extendedLabels.find((l) => l.id === selectedLabelId) || null;

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
  }; // Quick label selection for efficient workflow
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
    <div className="w-full h-full p-2 bg-white overflow-y-auto">
      <div className="flex flex-col gap-3">
        {/* Drawing Tools */}
        <div className="flex flex-col gap-1.5">
          <span className="font-semibold text-neutral-700 text-xs tracking-wide">Tools</span>
          <div className="flex flex-row flex-wrap gap-1.5">
            {availableTools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => handleToolSelect(tool.id)}
                title={`${tool.label} (${tool.shortcut})`}
                className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  activeTool === tool.id
                    ? 'bg-brand-50 text-brand-700 border border-brand-600'
                    : 'bg-neutral-50 text-neutral-600 border border-neutral-200 hover:bg-neutral-100 hover:border-neutral-300'
                }`}
              >
                {tool.icon}
                <span className="truncate">{tool.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Label Selection - show for annotate tool */}
        {activeTool === 'annotate' && (
          <>
            <div className="flex flex-col gap-1.5 w-full">
              <span className="font-semibold text-neutral-700 text-xs tracking-wide">Labels</span>
              <div className="flex flex-col gap-1">
                {extendedLabels.map((label, index) => (
                  <div key={label.id} className="relative">
                    <button
                      className={`w-full text-left px-2.5 py-1.5 text-[11px] font-medium rounded transition-colors flex items-center gap-2 ${
                        selectedLabelId === label.id
                          ? 'bg-brand-50 text-brand-700 border border-brand-600 font-semibold'
                          : 'bg-neutral-50 hover:bg-neutral-100 hover:border-neutral-400 text-neutral-700 border border-neutral-200'
                      } cursor-pointer`}
                      onClick={() => handleLabelSelect(label)}
                    >
                      {/* Color indicator */}
                      <span
                        className="w-3.5 h-3.5 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: label.color }}
                      />
                      <span className="flex-1 min-w-0 truncate">
                        {selectedLabelId === label.id ? '✓ ' : ''}
                        {capitalizeFirst(label.name)}
                      </span>
                      <span className="text-neutral-400 text-[10px] flex items-center gap-0.5 flex-shrink-0 tabular-nums">
                        <span>{getGeometryIcon(label.geometry_type)}</span>
                        <span>{index + 1}</span>
                      </span>
                    </button>
                    {/* Magic Wand Icon - only for polygon labels.
                        Currently disabled: the click-to-segment backend (SAM3)
                        requires GPU inference which we don't have provisioned. */}
                    {label.geometry_type === 'polygon' && (
                      <button
                        type="button"
                        disabled
                        title="Disabled - no GPUs available to run SAM3 click image segmentation"
                        aria-disabled="true"
                        className="absolute top-0.5 right-0.5 p-0.5 rounded bg-neutral-200 text-neutral-400 cursor-not-allowed opacity-60"
                        style={{ zIndex: 10 }}
                      >
                        <svg
                          width="12"
                          height="12"
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
              </div>
              {extendedLabels.length === 0 && (
                <p className="text-xs text-neutral-500 italic">No labels defined</p>
              )}

              {!selectedLabel && (
                <p className="text-[11px] text-amber-700 mt-1 p-2 bg-amber-50 rounded border border-amber-200">
                  Select a label to start annotating
                </p>
              )}
            </div>

            {/* Current selection info */}
            {selectedLabel && (
              <div className="p-2.5 bg-blue-50 rounded border border-blue-200 w-full">
                <p className="text-[11px] text-blue-700 font-medium mb-1">
                  Selected: {capitalizeFirst(selectedLabel.name)}
                </p>
                <p className="text-[11px] text-blue-600">
                  Type: {capitalizeFirst(selectedLabel.geometry_type)}
                </p>
                {selectedLabel.geometry_type === 'polygon' && magicWandEnabled[selectedLabel.id] ? (
                  <p className="text-[11px] text-purple-600 mt-1 font-medium">
                    Magic wand active - click once to auto-generate polygon.
                  </p>
                ) : (
                  <p className="text-[11px] text-neutral-500 mt-1">
                    Click on the map to draw a {selectedLabel.geometry_type}.
                    {selectedLabel.geometry_type === 'polygon' && ' Double-click to finish.'}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* Edit Tool Info */}
        {activeTool === 'edit' && (
          <div className="flex flex-col gap-1.5 w-full">
            <span className="font-semibold text-neutral-700 text-xs tracking-wide">Edit Tool</span>
            <div className="text-[11px] text-neutral-600 flex flex-col gap-1 leading-relaxed">
              <p>Click a geometry to select it and show its vertices.</p>
              <p>
                Drag a <strong>vertex</strong> to move it.
              </p>
              <p>
                Click an <strong>edge midpoint</strong> to insert a new vertex.
              </p>
              <p>
                Hold{' '}
                <kbd className="px-1 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono">
                  Alt
                </kbd>{' '}
                + drag to move the whole feature.
              </p>
              <p className="text-neutral-500">
                Save, delete, or press{' '}
                <kbd className="px-1 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono">
                  Esc
                </kbd>{' '}
                to cancel.
              </p>
            </div>
          </div>
        )}

        {/* Timeseries Tool Info */}
        {activeTool === 'timeseries' && (
          <div className="flex flex-col gap-1.5 w-full">
            <span className="font-semibold text-neutral-700 text-xs tracking-wide">Timeseries</span>
            <p className="text-[11px] text-neutral-600 leading-relaxed">
              Click anywhere on the map to load timeseries data for that location.
            </p>
          </div>
        )}

        {/* Pan Tool Info */}
        {activeTool === 'pan' && (
          <div className="flex flex-col gap-1.5 w-full">
            <span className="font-semibold text-neutral-700 text-xs tracking-wide">Navigation</span>
            <p className="text-[11px] text-neutral-600 leading-relaxed">
              Drag to pan the map. Use scroll wheel to zoom.
            </p>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Tip: Select a label to quickly start annotating.
            </p>
          </div>
        )}

        {/* Annotation Navigation */}
        {annotations.length > 0 && (
          <div className="flex flex-col gap-1.5 w-full">
            <span className="font-semibold text-neutral-700 text-xs tracking-wide">Navigate</span>
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  const ann = goToPreviousAnnotation();
                  if (ann) triggerFitAnnotations();
                }}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] font-medium bg-neutral-50 text-neutral-600 border border-neutral-200 hover:bg-neutral-100 hover:border-neutral-300 transition-colors cursor-pointer"
                title="Previous annotation (older)"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span>Prev</span>
              </button>
              <button
                onClick={() => {
                  const ann = goToNextAnnotation();
                  if (ann) triggerFitAnnotations();
                }}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] font-medium bg-neutral-50 text-neutral-600 border border-neutral-200 hover:bg-neutral-100 hover:border-neutral-300 transition-colors cursor-pointer"
                title="Next annotation (newer)"
              >
                <span>Next</span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
            <p className="text-[10px] text-neutral-400 text-center tabular-nums">
              {currentAnnotationIndex >= 0
                ? `${currentAnnotationIndex + 1} / ${annotations.length}`
                : `${annotations.length} annotation${annotations.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        )}

        {/* Keyboard Shortcuts Help */}
        <div className="pt-2 border-t border-neutral-200 w-full">
          <span className="font-semibold text-neutral-700 text-[11px]">Shortcuts</span>
          <div className="mt-1.5 space-y-1 max-w-xs">
            {availableTools.map((tool) => (
              <div key={tool.id} className="flex justify-between text-[11px] text-neutral-500">
                <span>{tool.label}</span>
                <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                  {tool.shortcut}
                </kbd>
              </div>
            ))}
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Select label</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                1-9
              </kbd>
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Move feature</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                Alt+drag
              </kbd>
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Cancel edit</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                Esc
              </kbd>
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Sync windows</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                L
              </kbd>
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Cycle source</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                I
              </kbd>
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Cycle viz</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                Shift+I
              </kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OpenModeControls;
