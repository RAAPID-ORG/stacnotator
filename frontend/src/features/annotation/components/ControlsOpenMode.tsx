import { useEffect, useState } from 'react';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import { useAnnotationStore } from '../stores/annotation.store';
import { capitalizeFirst } from '~/shared/utils/utility';
import {
  extendLabelsWithMetadata,
  type ExtendedLabel,
  type GeometryType,
} from '../utils/labelMetadata';
import { usePreferencesStore } from '../stores/preferences.store';
import { resolveLabelStyle, styleKey } from '../utils/annotationStyle';

type OpenModeTool = 'pan' | 'annotate' | 'edit' | 'timeseries' | 'labelvector';

/**
 * Tool definitions for open mode annotation
 */
const TOOLS: { id: OpenModeTool; label: string; icon: React.ReactNode; shortcut: string }[] = [
  {
    id: 'pan',
    label: 'Pan',
    shortcut: 'P',
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
    id: 'labelvector',
    label: 'Label vector',
    shortcut: 'V',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
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
  const showAnnotations = useMapStore((s) => s.showAnnotations);
  const toggleAnnotations = useMapStore((s) => s.toggleAnnotations);
  const styleOverrides = usePreferencesStore((s) => s.annotationStyles);
  const setLabelStyle = usePreferencesStore((s) => s.setLabelStyle);
  const resetLabelStyle = usePreferencesStore((s) => s.resetLabelStyle);
  // Which label's inline style editor is currently expanded (null = none)
  const [styleEditorLabelId, setStyleEditorLabelId] = useState<number | null>(null);
  const updateAnnotationFlags = useAnnotationStore((s) => s.updateAnnotationFlags);
  // The single selected annotation's full record, fetched by id for this panel.
  const selectedAnnotation = useAnnotationStore((s) => s.selectedAnnotationDetail);
  // Local draft for the flag comment textarea so the user can type without
  // hammering the API on each keystroke. Pushed to the server on blur or
  // when the toggle changes.
  const [editFlagCommentDraft, setEditFlagCommentDraft] = useState('');
  useEffect(() => {
    setEditFlagCommentDraft(selectedAnnotation?.flag_comment ?? '');
  }, [selectedAnnotation?.id, selectedAnnotation?.flag_comment]);

  // Get labels and extend with metadata
  const baseLabels = campaign?.settings.labels || [];
  const extendedLabels = extendLabelsWithMetadata(baseLabels);

  // Filter tools based on campaign configuration
  const hasTimeseries = (campaign?.time_series?.length ?? 0) > 0;
  const hasVectorLayers = (campaign?.vector_layers?.length ?? 0) > 0;
  const availableTools = TOOLS.filter(
    (tool) =>
      (tool.id !== 'timeseries' || hasTimeseries) && (tool.id !== 'labelvector' || hasVectorLayers)
  );
  const enabledVectorLayerIds = useMapStore((s) => s.enabledVectorLayerIds);

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
    // In label-vector mode the label applies to clicked features; keep that tool.
    // Otherwise selecting a label starts drawing.
    if (activeTool !== 'annotate' && activeTool !== 'labelvector') {
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
            <button
              onClick={toggleAnnotations}
              title={`${showAnnotations ? 'Hide' : 'Show'} drawn objects (X)`}
              className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                showAnnotations
                  ? 'bg-neutral-50 text-neutral-600 border border-neutral-200 hover:bg-neutral-100 hover:border-neutral-300'
                  : 'bg-amber-50 text-amber-700 border border-amber-600'
              }`}
            >
              {showAnnotations ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                  <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </svg>
              )}
              <span className="truncate">{showAnnotations ? 'Hide' : 'Show'}</span>
            </button>
          </div>
        </div>

        {/* Label-vector mode banner */}
        {activeTool === 'labelvector' && (
          <div className="p-2.5 bg-emerald-50 rounded border border-emerald-200 w-full">
            <p className="text-[11px] text-emerald-800 font-medium mb-1">Label vector data</p>
            {enabledVectorLayerIds.length === 0 ? (
              <p className="text-[11px] text-amber-700">
                Enable a vector layer from the header first, then pick a label below.
              </p>
            ) : (
              <p className="text-[11px] text-emerald-700">
                Pick a label, then click a vector feature to label it. Shift+drag a box to label
                every feature inside it.
              </p>
            )}
          </div>
        )}

        {/* Label Selection - show for annotate & label-vector tools */}
        {(activeTool === 'annotate' || activeTool === 'labelvector') && (
          <>
            <div className="flex flex-col gap-1.5 w-full">
              <span className="font-semibold text-neutral-700 text-xs tracking-wide">Labels</span>
              <div className="flex flex-col gap-1">
                {extendedLabels.map((label, index) => {
                  const resolved = resolveLabelStyle(
                    label.color,
                    label.geometry_type,
                    campaign ? styleOverrides[styleKey(campaign.id, label.id)] : undefined
                  );
                  const editorOpen = styleEditorLabelId === label.id;
                  const patchStyle = (patch: Partial<typeof resolved>) => {
                    if (campaign) setLabelStyle(campaign.id, label.id, patch);
                  };
                  return (
                    <div key={label.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-1">
                        <div className="relative flex-1 min-w-0">
                          <button
                            className={`w-full text-left px-2.5 py-1.5 text-[11px] font-medium rounded transition-colors flex items-center gap-2 ${
                              selectedLabelId === label.id
                                ? 'bg-brand-50 text-brand-700 border border-brand-600 font-semibold'
                                : 'bg-neutral-50 hover:bg-neutral-100 hover:border-neutral-400 text-neutral-700 border border-neutral-200'
                            } cursor-pointer`}
                            onClick={() => handleLabelSelect(label)}
                          >
                            {/* Color indicator - reflects the user's resolved style */}
                            <span
                              className="w-3.5 h-3.5 rounded-sm flex-shrink-0 border"
                              style={{
                                backgroundColor: resolved.fillColor,
                                borderColor: resolved.strokeColor,
                              }}
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
                        {/* Style editor toggle */}
                        <button
                          type="button"
                          onClick={() => setStyleEditorLabelId(editorOpen ? null : label.id)}
                          title="Customize this label's style"
                          aria-expanded={editorOpen}
                          className={`flex-shrink-0 p-1.5 rounded border transition-colors cursor-pointer ${
                            editorOpen
                              ? 'bg-brand-50 text-brand-700 border-brand-600'
                              : 'bg-neutral-50 text-neutral-500 border-neutral-200 hover:bg-neutral-100 hover:text-neutral-700'
                          }`}
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
                            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
                          </svg>
                        </button>
                      </div>

                      {editorOpen && (
                        <div className="flex flex-col gap-2 p-2.5 bg-neutral-50 border border-neutral-200 rounded text-[11px] text-neutral-600">
                          <div className="flex items-center justify-between gap-2">
                            <span>Fill</span>
                            <input
                              type="color"
                              value={resolved.fillColor}
                              onChange={(e) => patchStyle({ fillColor: e.target.value })}
                              className="w-7 h-6 rounded cursor-pointer border border-neutral-300 bg-white"
                              title="Fill color"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-20 flex-shrink-0">Fill opacity</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={Math.round(resolved.fillOpacity * 100)}
                              onChange={(e) =>
                                patchStyle({ fillOpacity: Number(e.target.value) / 100 })
                              }
                              className="flex-1"
                            />
                            <span className="w-9 text-right tabular-nums">
                              {Math.round(resolved.fillOpacity * 100)}%
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-neutral-200">
                            <span>Border</span>
                            <input
                              type="color"
                              value={resolved.strokeColor}
                              onChange={(e) => patchStyle({ strokeColor: e.target.value })}
                              className="w-7 h-6 rounded cursor-pointer border border-neutral-300 bg-white"
                              title="Border color"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-20 flex-shrink-0">Border opacity</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={Math.round(resolved.strokeOpacity * 100)}
                              onChange={(e) =>
                                patchStyle({ strokeOpacity: Number(e.target.value) / 100 })
                              }
                              className="flex-1"
                            />
                            <span className="w-9 text-right tabular-nums">
                              {Math.round(resolved.strokeOpacity * 100)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-20 flex-shrink-0">Border width</span>
                            <input
                              type="range"
                              min={1}
                              max={6}
                              step={0.5}
                              value={resolved.strokeWidth}
                              onChange={(e) => patchStyle({ strokeWidth: Number(e.target.value) })}
                              className="flex-1"
                            />
                            <span className="w-9 text-right tabular-nums">
                              {resolved.strokeWidth}px
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => campaign && resetLabelStyle(campaign.id, label.id)}
                            className="self-start mt-0.5 text-[10px] text-neutral-500 hover:text-neutral-700 underline cursor-pointer"
                          >
                            Reset to default
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
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
                {activeTool === 'labelvector' ? (
                  <p className="text-[11px] text-neutral-500 mt-1">
                    Click a vector feature to apply this label, or Shift+drag a box for many.
                  </p>
                ) : selectedLabel.geometry_type === 'polygon' &&
                  magicWandEnabled[selectedLabel.id] ? (
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
          <div className="flex flex-col gap-2 w-full">
            <span className="font-semibold text-neutral-700 text-xs tracking-wide">Edit Tool</span>
            <p className="text-[11px] text-neutral-500 leading-relaxed">
              Click a geometry to edit its vertices. See <strong>Shortcuts</strong> below for all
              edit gestures.
            </p>

            {selectedAnnotation && (
              <div className="flex flex-col gap-1.5 pt-2 border-t border-neutral-200">
                <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide">
                  Selected annotation #{selectedAnnotation.id}
                </span>
                <label
                  className="flex items-center gap-1.5 cursor-pointer select-none"
                  title="Toggle flag-for-review on this annotation. Saves immediately. Press F to toggle."
                >
                  <input
                    type="checkbox"
                    checked={selectedAnnotation.flagged_for_review}
                    onChange={(e) =>
                      updateAnnotationFlags(
                        selectedAnnotation.id,
                        e.target.checked,
                        e.target.checked ? editFlagCommentDraft || null : null
                      )
                    }
                    className="w-3.5 h-3.5 rounded border-neutral-300 text-rose-600 focus:ring-rose-500"
                  />
                  <span
                    className={`text-[11px] ${selectedAnnotation.flagged_for_review ? 'text-rose-700 font-semibold' : 'text-neutral-600'}`}
                  >
                    Flag for review [F]
                  </span>
                </label>
                {selectedAnnotation.flagged_for_review && (
                  <textarea
                    value={editFlagCommentDraft}
                    onChange={(e) => setEditFlagCommentDraft(e.target.value)}
                    onBlur={() => {
                      if ((selectedAnnotation.flag_comment ?? '') !== editFlagCommentDraft) {
                        updateAnnotationFlags(
                          selectedAnnotation.id,
                          true,
                          editFlagCommentDraft || null
                        );
                      }
                    }}
                    placeholder="Why are you flagging this? (optional)"
                    rows={2}
                    className="w-full resize-none px-2.5 py-2 text-xs text-neutral-900 bg-white border border-neutral-300 rounded-md focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 placeholder:text-neutral-400 transition-colors"
                  />
                )}
              </div>
            )}
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
              <span>Toggle drawn objects</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                X
              </kbd>
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Select / edit (edit tool)</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                Click
              </kbd>
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Insert vertex</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                Click edge
              </kbd>
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Move feature</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                Alt+drag
              </kbd>
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Multi-select</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                Shift+drag
              </kbd>
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Delete selection</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                Del
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
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Toggle overlay</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                M
              </kbd>
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Cycle overlays</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                Shift+M
              </kbd>
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Flag selected (edit tool)</span>
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-600">
                F
              </kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OpenModeControls;
