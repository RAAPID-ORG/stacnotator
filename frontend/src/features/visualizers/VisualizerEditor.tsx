import { useEffect, useState } from 'react';
import {
  createVisualizer,
  getVisualizer,
  listVisualizerOptions,
  updateVisualizer,
  type VisualizerImageryCreate,
  type VisualizerOptionsOut,
  type VisualizerOverlayCreate,
} from '~/api/client';
import { Modal } from '~/shared/ui/Modal';
import { Button, Field, Input, Switch, Textarea } from '~/shared/ui/forms';
import { IconGlobe, IconMap } from '~/shared/ui/Icons';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';

interface Draft {
  name: string;
  description: string;
  isPublic: boolean;
  imagery: VisualizerImageryCreate[];
  overlays: VisualizerOverlayCreate[];
}

const EMPTY: Draft = { name: '', description: '', isPublic: false, imagery: [], overlays: [] };

/**
 * Build a visualizer by picking from what the project already has.
 *
 * There is no imagery wizard here on purpose: every source listed was set up
 * once for a campaign, registered once, and is reused as it stands - which is
 * also why a visualizer stays in step with the campaign it draws from.
 */
export function VisualizerEditor({
  projectId,
  visualizerId,
  onClose,
  onSaved,
}: {
  projectId: number;
  visualizerId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [options, setOptions] = useState<VisualizerOptionsOut | null>(null);
  const [draft, setDraft] = useState<Draft | null>(visualizerId === null ? EMPTY : null);
  const [saving, setSaving] = useState(false);
  const showAlert = useLayoutStore((s) => s.showAlert);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [optionsRes, existing] = await Promise.all([
          listVisualizerOptions({ path: { project_id: projectId } }),
          visualizerId === null
            ? Promise.resolve(null)
            : getVisualizer({ path: { visualizer_id: visualizerId } }),
        ]);
        if (cancelled) return;
        setOptions(optionsRes.data ?? { campaigns: [] });
        if (existing?.data) {
          setDraft({
            name: existing.data.name,
            description: existing.data.description ?? '',
            isPublic: existing.data.is_public,
            imagery: existing.data.imagery,
            overlays: existing.data.overlays,
          });
        }
      } catch (error) {
        handleError(error, 'Failed to load what this project has to show');
        onClose();
      }
    })();
    return () => {
      cancelled = true;
    };
    // onClose is stable enough for a mount-time load; re-running would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, visualizerId]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        is_public: draft.isPublic,
        imagery: draft.imagery,
        overlays: draft.overlays,
      };
      if (visualizerId === null) {
        await createVisualizer({ path: { project_id: projectId }, body });
        showAlert('Visualizer created', 'success');
      } else {
        await updateVisualizer({ path: { visualizer_id: visualizerId }, body });
        showAlert('Visualizer saved', 'success');
      }
      onSaved();
    } catch (error) {
      handleError(error, 'Failed to save the visualizer');
    } finally {
      setSaving(false);
    }
  };

  const ready = draft !== null && options !== null;
  const valid =
    ready && draft.name.trim().length > 0 && draft.imagery.length + draft.overlays.length > 0;

  return (
    <Modal
      title={visualizerId === null ? 'New visualizer' : 'Edit visualizer'}
      onClose={onClose}
      maxWidth="max-w-lg"
      scrollable
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-neutral-500">
            {ready && draft.imagery.length + draft.overlays.length === 0
              ? 'Pick at least one layer.'
              : ''}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" disabled={!valid || saving} onClick={() => void save()}>
              {saving ? 'Saving…' : visualizerId === null ? 'Create' : 'Save'}
            </Button>
          </div>
        </div>
      }
    >
      {!ready ? (
        <div className="p-8">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="space-y-5 p-4">
          <Field label="Name" htmlFor="visualizer-name" required>
            <Input
              id="visualizer-name"
              value={draft.name}
              placeholder="Maize yield 2024"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>

          <Field label="Description" htmlFor="visualizer-description">
            <Textarea
              id="visualizer-description"
              rows={2}
              value={draft.description}
              placeholder="One line, shown in the viewer's header."
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </Field>

          <div className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3">
            <span className="pt-0.5">
              <Switch
                checked={draft.isPublic}
                aria-label="Anyone with the link"
                onChange={(checked) => setDraft({ ...draft, isPublic: checked })}
              />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
                <IconGlobe className="h-3.5 w-3.5" />
                Anyone with the link
              </p>
              <p className="mt-0.5 text-xs text-neutral-500">
                {draft.isPublic
                  ? 'The link opens for anyone, with no account. Only what you add here is exposed.'
                  : 'Only people who can already open this project can see it.'}
              </p>
            </div>
          </div>

          {options.campaigns.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-500">
              This project has no campaigns to draw from yet.
            </p>
          ) : (
            <div className="space-y-4">
              {options.campaigns.map((campaign) => {
                const empty =
                  campaign.sources.length === 0 &&
                  campaign.raster_overlays.length === 0 &&
                  campaign.vector_overlays.length === 0;
                if (empty) return null;
                return (
                  <section key={campaign.campaign_id}>
                    <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-neutral-700">
                      <IconMap className="h-3.5 w-3.5 text-neutral-400" />
                      {campaign.campaign_name}
                    </h4>
                    <div className="overflow-hidden rounded-lg border border-neutral-200">
                      {campaign.sources.map((source) => (
                        <PickRow
                          key={`source-${source.id}`}
                          checked={draft.imagery.some((e) => e.source_id === source.id)}
                          onToggle={(checked) =>
                            setDraft({
                              ...draft,
                              imagery: checked
                                ? [...draft.imagery, { source_id: source.id }]
                                : draft.imagery.filter((e) => e.source_id !== source.id),
                            })
                          }
                          title={source.name}
                          note={sourceNote(source)}
                          disabled={source.step_count === 0}
                        />
                      ))}
                      {campaign.raster_overlays.map((overlay) => (
                        <PickRow
                          key={`raster-${overlay.id}`}
                          checked={draft.overlays.some((e) => e.custom_map_id === overlay.id)}
                          onToggle={(checked) =>
                            setDraft({
                              ...draft,
                              overlays: checked
                                ? [
                                    ...draft.overlays,
                                    { custom_map_id: overlay.id, visible: true, opacity: 0.8 },
                                  ]
                                : draft.overlays.filter((e) => e.custom_map_id !== overlay.id),
                            })
                          }
                          title={overlay.name}
                          note={
                            overlay.status === 'ready' ? 'Overlay' : `Overlay - ${overlay.status}`
                          }
                        />
                      ))}
                      {campaign.vector_overlays.map((overlay) => (
                        <PickRow
                          key={`vector-${overlay.id}`}
                          checked={draft.overlays.some((e) => e.vector_layer_id === overlay.id)}
                          onToggle={(checked) =>
                            setDraft({
                              ...draft,
                              overlays: checked
                                ? [
                                    ...draft.overlays,
                                    { vector_layer_id: overlay.id, visible: true, opacity: 1 },
                                  ]
                                : draft.overlays.filter((e) => e.vector_layer_id !== overlay.id),
                            })
                          }
                          title={overlay.name}
                          note="Vector layer"
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

const sourceNote = (source: {
  step_count: number;
  start_date: string | null;
  end_date: string | null;
}) => {
  if (source.step_count === 0) return 'No registered imagery yet';
  const span =
    source.start_date && source.end_date ? ` - ${source.start_date} to ${source.end_date}` : '';
  return `${source.step_count} ${source.step_count === 1 ? 'date' : 'dates'}${span}`;
};

function PickRow({
  checked,
  onToggle,
  title,
  note,
  disabled,
}: {
  checked: boolean;
  onToggle: (checked: boolean) => void;
  title: string;
  note: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-3 border-b border-neutral-100 px-3 py-2 last:border-b-0 ${
        disabled ? 'opacity-50' : 'cursor-pointer hover:bg-neutral-50'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-3.5 w-3.5 shrink-0 accent-brand-600"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-neutral-900">{title}</span>
        <span className="block truncate text-xs text-neutral-500">{note}</span>
      </span>
    </label>
  );
}
