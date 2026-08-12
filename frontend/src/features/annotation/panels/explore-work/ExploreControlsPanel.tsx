import { useEffect, useState } from 'react';
import { capitalizeFirst } from '~/shared/utils/utility';
import {
  extendedLabels,
  resolveLabelStyle,
  type ExtendedLabel,
  type GeometryType,
} from '~/features/annotation/core/annotation';
import { useImageryStore, usePrefsStore, useWorkStore } from '~/features/annotation/stores';
import { getHelp } from '~/features/annotation/engine/hotkeys';
import type { ComposeCtx } from '../registry';
import { bumpAnnotationVersion } from '../shared/annotationVersion';
import { fitAnnotations } from '../shared/cameras';
import { FormFields } from '../shared/FormFields';
import { LabelChips } from '../shared/LabelChips';
import { selectLabel, selectTool, useActiveTool, type ActiveTool } from '../shared/toolState';
import { DraftCatalog } from './DraftCatalog';
import { EditDetails } from './EditDetails';
import { LabelStyleEditor } from './LabelStyleEditor';

interface ToolDef {
  id: ActiveTool;
  label: string;
  shortcut: string;
  /** Single `d`, several sub-paths concatenated - these are outline icons. */
  icon: string;
}

const TOOLS: ToolDef[] = [
  {
    id: 'pan',
    label: 'Pan',
    shortcut: 'P',
    icon: 'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
  },
  {
    id: 'annotate',
    label: 'Annotate',
    shortcut: 'R',
    icon: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  },
  {
    id: 'edit',
    label: 'Edit',
    shortcut: 'E',
    icon: 'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',
  },
  {
    id: 'labelVector',
    label: 'Label vector',
    shortcut: 'B',
    icon: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01',
  },
  {
    id: 'timeseries',
    label: 'Timeseries',
    shortcut: 'T',
    icon: 'M3 3v18h18M7 16l4-4 4 4 5-6',
  },
];

const EYE_ICON = 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z';
const EYE_OFF_ICON =
  'M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20';

const GEOMETRY_ICONS: Record<GeometryType, string> = { point: '●', polygon: '▰', line: '━' };

function Icon({ path }: { path: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

const chipClass = (active: boolean) =>
  `flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
    active
      ? 'bg-brand-50 text-brand-700 border border-brand-600'
      : 'bg-neutral-50 text-neutral-600 border border-neutral-200 hover:bg-neutral-100 hover:border-neutral-300'
  }`;

function ShortcutLegend() {
  // Only the two scopes this mode owns: 'global' is the map's own table, which
  // the toolbar's help menu already lists in full.
  const rows = getHelp().filter((row) => row.scope === 'mode' || row.scope === 'drawing');
  if (rows.length === 0) return null;

  return (
    <div className="pt-2 border-t border-neutral-200 w-full">
      <span className="font-semibold text-neutral-700 text-[11px]">Shortcuts</span>
      <ul className="mt-1.5 space-y-0.5 max-w-xs">
        {rows.map((row) => (
          <li
            key={`${row.scope}:${row.key}`}
            className="flex items-center justify-between gap-3 text-[11px]"
          >
            <span className="text-neutral-600">{row.help}</span>
            <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
              {row.key}
            </kbd>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ExploreControlsPanelProps {
  ctx: ComposeCtx;
}

export function ExploreControlsPanel({ ctx }: ExploreControlsPanelProps) {
  const tool = useActiveTool();
  const [styleEditorLabelId, setStyleEditorLabelId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedLabelId = useWorkStore((s) => s.selectedLabelId);
  const formValues = useWorkStore((s) => s.formValues);
  const activeFieldIndex = useWorkStore((s) => s.activeFieldIndex);
  const setFormValues = useWorkStore((s) => s.setFormValues);
  const draft = useWorkStore((s) => s.draft);
  const showAnnotations = useImageryStore((s) => s.showAnnotations);
  const toggleAnnotations = useImageryStore((s) => s.toggleAnnotations);
  const labelStyles = usePrefsStore((s) => s.labelStyles);
  const vectorShown = useImageryStore((s) => s.vector.id !== null && s.vector.visible);

  const labels = extendedLabels(ctx.campaign);
  const fields = ctx.campaign.settings.form_fields ?? [];
  const selectedLabel = labels.find((l) => l.id === selectedLabelId) ?? null;
  const draftLabel =
    draft.phase === 'idle' ? null : (labels.find((l) => l.id === draft.labelId) ?? null);
  const draftOpen = draft.phase === 'draft' || draft.phase === 'committing';

  const availableTools = TOOLS.filter(
    (t) =>
      (t.id !== 'timeseries' || ctx.campaign.time_series.length > 0) &&
      (t.id !== 'labelVector' || (ctx.campaign.vector_layers?.length ?? 0) > 0)
  );

  /** The chip swatch shows the label as the map draws it: the user's resolved
   *  fill inside their resolved border. */
  const swatch = (label: ExtendedLabel) => {
    const style = resolveLabelStyle(label.color, label.geometry_type, labelStyles[label.id]);
    return { ...label, color: style.fillColor, borderColor: style.strokeColor };
  };

  // Enter and Escape resolve the draft too (explore-work/hotkeys.ts), so the
  // failure notice clears on the draft itself going away, not only on the
  // buttons below.
  useEffect(() => {
    if (draft.phase === 'idle') setSaveError(null);
  }, [draft.phase]);

  const saveDraft = async () => {
    const saved = await useWorkStore.getState().commitDraft(ctx.campaign.id);
    setSaveError(saved ? null : 'Could not save. Check the required questions, then retry.');
    if (saved) bumpAnnotationVersion();
  };

  const closeDraft = async () => {
    const outcome = await useWorkStore.getState().closeDraft(ctx.campaign.id, fields);
    setSaveError(
      outcome === 'save-failed' ? 'Could not save. Retry, or answer what is missing.' : null
    );
    if (outcome === 'saved') bumpAnnotationVersion();
  };

  return (
    <div className="w-full h-full p-2 bg-white overflow-y-auto">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="font-semibold text-neutral-700 text-xs tracking-wide">Tools</span>
          <div className="flex flex-row flex-wrap gap-1.5">
            {availableTools.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => void selectTool(t.id, ctx)}
                title={`${t.label} (${t.shortcut})`}
                aria-pressed={tool === t.id}
                className={chipClass(tool === t.id)}
              >
                <Icon path={t.icon} />
                <span className="truncate">{t.label}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={toggleAnnotations}
              title={`${showAnnotations ? 'Hide' : 'Show'} drawn objects (Shift+X)`}
              className={
                showAnnotations
                  ? chipClass(false)
                  : 'flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-600 cursor-pointer'
              }
            >
              <Icon path={showAnnotations ? EYE_ICON : EYE_OFF_ICON} />
              <span className="truncate">{showAnnotations ? 'Hide' : 'Show'}</span>
            </button>
            <button
              type="button"
              onClick={() => void fitAnnotations(ctx.campaign.id)}
              title="Zoom to every annotation (Space)"
              className={chipClass(false)}
            >
              <span className="truncate">Fit annotations</span>
            </button>
          </div>
        </div>

        {tool === 'labelVector' && (
          <div className="p-2.5 bg-emerald-50 rounded border border-emerald-200 w-full">
            <p className="text-[11px] text-emerald-800 font-medium mb-1">Label vector data</p>
            <p
              className={
                vectorShown ? 'text-[11px] text-emerald-700' : 'text-[11px] text-amber-700'
              }
            >
              {vectorShown
                ? 'Pick a label, then click a vector feature to label it. Shift+drag a box to label every feature inside it.'
                : 'Select a vector layer in the header first, then pick a label below.'}
            </p>
          </div>
        )}

        {draftOpen ? (
          <DraftCatalog
            label={draftLabel}
            fields={fields}
            values={formValues}
            activeFieldIndex={activeFieldIndex}
            onChange={setFormValues}
            onSave={() => void saveDraft()}
            onClose={() => void closeDraft()}
            saving={draft.phase === 'committing'}
            error={saveError}
          />
        ) : (
          (tool === 'annotate' || tool === 'labelVector') && (
            <>
              <div className="flex flex-col gap-1.5 w-full">
                <span className="font-semibold text-neutral-700 text-xs tracking-wide">Labels</span>
                {labels.length === 0 ? (
                  <p className="text-xs text-neutral-500 italic">No labels defined</p>
                ) : (
                  <LabelChips
                    labels={labels.map(swatch)}
                    selectedId={selectedLabelId}
                    onSelect={(label) => selectLabel(label.id, ctx)}
                    renderIcon={(label) => <span>{GEOMETRY_ICONS[label.geometry_type]}</span>}
                    renderAfter={(label) => (
                      <button
                        type="button"
                        onClick={() =>
                          setStyleEditorLabelId(styleEditorLabelId === label.id ? null : label.id)
                        }
                        title="Customize this label's style"
                        aria-expanded={styleEditorLabelId === label.id}
                        className={`flex-shrink-0 px-1.5 py-1 rounded border text-[11px] transition-colors cursor-pointer ${
                          styleEditorLabelId === label.id
                            ? 'bg-brand-50 text-brand-700 border-brand-600'
                            : 'bg-neutral-50 text-neutral-500 border-neutral-200 hover:bg-neutral-100'
                        }`}
                      >
                        ✎
                      </button>
                    )}
                  />
                )}
                {styleEditorLabelId !== null && labels.some((l) => l.id === styleEditorLabelId) && (
                  <LabelStyleEditor label={labels.find((l) => l.id === styleEditorLabelId)!} />
                )}
                {!selectedLabel && labels.length > 0 && (
                  <p className="text-[11px] text-amber-700 mt-1 p-2 bg-amber-50 rounded border border-amber-200">
                    Select a label to start annotating
                  </p>
                )}
              </div>

              {/* Label-vector applies the answers on click, so it keeps the form inline. */}
              {tool === 'labelVector' && (
                <div className="flex flex-wrap border-t border-l border-neutral-100 rounded">
                  <FormFields
                    fields={fields}
                    values={formValues}
                    onChange={setFormValues}
                    activeFieldIndex={activeFieldIndex}
                  />
                </div>
              )}

              {selectedLabel && (
                <div className="p-2.5 bg-blue-50 rounded border border-blue-200 w-full">
                  <p className="text-[11px] text-blue-700 font-medium mb-1">
                    Selected: {capitalizeFirst(selectedLabel.name)}
                  </p>
                  <p className="text-[11px] text-blue-600">
                    Type: {capitalizeFirst(selectedLabel.geometry_type)}
                  </p>
                  <p className="text-[11px] text-neutral-500 mt-1">
                    {tool === 'labelVector'
                      ? 'Click a vector feature to apply this label, or Shift+drag a box for many.'
                      : `Click on the map to draw a ${selectedLabel.geometry_type}.${
                          selectedLabel.geometry_type === 'polygon'
                            ? ' Double-click to finish.'
                            : ''
                        }`}
                  </p>
                </div>
              )}
            </>
          )
        )}

        {tool === 'edit' && (
          <div className="flex flex-col gap-2 w-full">
            <span className="font-semibold text-neutral-700 text-xs tracking-wide">Edit tool</span>
            <p className="text-[11px] text-neutral-500 leading-relaxed">
              Click a geometry to edit its vertices, alt-drag to move it whole, Shift+drag to select
              many. See <strong>Shortcuts</strong> below.
            </p>
            <EditDetails ctx={ctx} />
          </div>
        )}

        {tool === 'timeseries' && (
          <p className="text-[11px] text-neutral-600 leading-relaxed">
            Click anywhere on the map to load timeseries data for that location.
          </p>
        )}

        {tool === 'pan' && (
          <div className="flex flex-col gap-1.5 w-full">
            <span className="font-semibold text-neutral-700 text-xs tracking-wide">Navigation</span>
            <p className="text-[11px] text-neutral-600 leading-relaxed">
              Drag to pan the map, scroll to zoom.
            </p>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Tip: select a label to start annotating straight away.
            </p>
          </div>
        )}

        <ShortcutLegend />
      </div>
    </div>
  );
}
