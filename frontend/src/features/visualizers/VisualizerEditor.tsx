import { useEffect, useState } from 'react';
import {
  createVisualizer,
  getVisualizer,
  listVisualizerOptions,
  updateVisualizer,
  type VisualizerArea,
  type VisualizerImageryCreate,
  type SourceOptionOut,
  type VisualizerOptionsOut,
  type VisualizerOverlayCreate,
} from '~/api/client';
import type { ImageryStepState } from '~/features/campaigns/components/imagery/types';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Button, Field, Input, Switch, Textarea } from '~/shared/ui/forms';
import { IconGlobe, IconMap, IconWarning } from '~/shared/ui/Icons';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { Modal } from '~/shared/ui/Modal';
import { handleError } from '~/shared/utils/errorHandler';
import { CustomMapsEditor } from '~/features/campaigns/components/CustomMapsEditor';
import { VectorLayersEditor } from '~/features/campaigns/components/VectorLayersEditor';
import { AreaField } from './editor/AreaField';
import {
  basemapsPayload,
  emptyImageryState,
  imageryStateFrom,
  OwnImagery,
  ownImageryPayload,
} from './editor/OwnImagery';
import {
  publishConfirm,
  restrictedSelection,
  RESTRICTION_TEXT,
  type RestrictedLayer,
} from './publishWarning';

interface Draft {
  name: string;
  description: string;
  isPublic: boolean;
  area: VisualizerArea | null;
  imagery: VisualizerImageryCreate[];
  overlays: VisualizerOverlayCreate[];
  ownImagery: ImageryStepState;
}

const EMPTY: Draft = {
  name: '',
  description: '',
  isPublic: false,
  area: null,
  imagery: [],
  overlays: [],
  ownImagery: emptyImageryState(),
};

/**
 * A visualizer is an area, some imagery over it, and what to draw on top.
 *
 * Imagery comes from one of two places, and the difference is worth being
 * explicit about in the UI: set up here it is registered for this visualizer
 * alone, while a campaign's is reused exactly as that campaign registered it.
 * Either way the viewer shows one flat list of dates.
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
  // The manual forms open on their own where a visualizer already has layers of
  // its own, so editing one does not hide what is there behind a link.
  const [addingImagery, setAddingImagery] = useState(false);
  const [addingOverlay, setAddingOverlay] = useState(false);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);

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
            area: existing.data.area,
            imagery: existing.data.imagery,
            overlays: existing.data.overlays,
            ownImagery: imageryStateFrom(existing.data.own_imagery, existing.data.basemaps),
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
    const confirm = draft.isPublic ? publishConfirm(restricted) : null;
    if (confirm && !(await showConfirmDialog(confirm))) return;
    setSaving(true);
    try {
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        is_public: draft.isPublic,
        area: draft.area,
        imagery: draft.imagery,
        overlays: draft.overlays,
        own_imagery: ownImageryPayload(draft.ownImagery),
        basemaps: basemapsPayload(draft.ownImagery),
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
  const restricted: RestrictedLayer[] = draft && options ? restrictedSelection(options, draft) : [];
  const campaigns = options?.campaigns ?? [];
  const campaignsWithSources = campaigns.filter((c) => c.sources.length > 0);
  const campaignsWithOverlays = campaigns.filter(
    (c) => c.raster_overlays.length > 0 || c.vector_overlays.length > 0
  );

  const layerCount = ready
    ? draft.imagery.length + draft.overlays.length + draft.ownImagery.sources.length
    : 0;
  const valid = ready && draft.name.trim().length > 0 && layerCount > 0;

  return (
    <Modal
      title={visualizerId === null ? 'New visualizer' : 'Edit visualizer'}
      onClose={onClose}
      maxWidth="max-w-3xl"
      scrollable
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-neutral-500">
            {ready && layerCount === 0 ? 'Add imagery or an overlay to show.' : ''}
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
        <div className="divide-y divide-neutral-100">
          <Section>
            <Field label="Name" htmlFor="visualizer-name" required>
              <Input
                id="visualizer-name"
                value={draft.name}
                placeholder="Maize yield 2024"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Description" htmlFor="visualizer-description" className="mt-4">
              <Textarea
                id="visualizer-description"
                rows={2}
                value={draft.description}
                placeholder="One line, shown in the viewer's header."
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>
          </Section>

          <Section
            title="Area of Interest"
            description="The map opens framed on it and imagery set up below is searched over it."
          >
            <AreaField
              value={draft.area}
              onChange={(area) => setDraft({ ...draft, area })}
              options={options}
            />
          </Section>

          <Section
            title="Imagery"
            description="What the date slider steps through, and the backdrop under it."
          >
            {campaignsWithSources.length > 0 && (
              <>
                <p className="mb-3 rounded-md bg-neutral-50 px-2.5 py-2 text-[11px] leading-relaxed text-neutral-600">
                  A campaign browses imagery as windows, each with a cover image composited over the
                  whole window. A visualizer has a date slider instead, so what you get here is
                  every one of that source&apos;s intervals in one list, oldest to newest, with the
                  cover images left out.
                </p>
                <CampaignGroups
                  campaigns={campaignsWithSources}
                  rows={(campaign) =>
                    campaign.sources.map((source) => (
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
                    ))
                  }
                />
              </>
            )}

            <Manual
              open={addingImagery}
              onOpen={() => setAddingImagery(true)}
              label={
                campaignsWithSources.length > 0
                  ? 'Add other imagery'
                  : 'Set up imagery for this visualizer'
              }
              hint="From a STAC catalog or Planet, the same way a campaign's imagery is. Registered for this visualizer alone."
            >
              <OwnImagery
                state={draft.ownImagery}
                onChange={(ownImagery) => setDraft({ ...draft, ownImagery })}
                area={draft.area}
                projectId={projectId}
              />
            </Manual>
          </Section>

          <Section
            title="Overlays"
            description="Predictions and reference layers drawn over the imagery."
          >
            {campaignsWithOverlays.length > 0 && (
              <CampaignGroups
                campaigns={campaignsWithOverlays}
                rows={(campaign) => [
                  ...campaign.raster_overlays.map((overlay) => (
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
                      note={overlay.status === 'ready' ? 'Raster' : `Raster - ${overlay.status}`}
                    />
                  )),
                  ...campaign.vector_overlays.map((overlay) => (
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
                      note="Vector"
                    />
                  )),
                ]}
              />
            )}

            {visualizerId === null ? (
              <p className="rounded-lg border border-dashed border-neutral-200 px-4 py-4 text-center text-xs text-neutral-500">
                Create the visualizer first, then set up overlays of its own here.
              </p>
            ) : (
              <Manual
                open={addingOverlay}
                onOpen={() => setAddingOverlay(true)}
                label={
                  campaignsWithOverlays.length > 0
                    ? 'Add another overlay'
                    : 'Add an overlay to this visualizer'
                }
                hint="Set up here rather than reused. Added to the map as soon as they are created."
              >
                <div className="space-y-6">
                  <CustomMapsEditor
                    ownerKind="visualizer"
                    ownerId={visualizerId}
                    projectId={projectId}
                  />
                  <VectorLayersEditor
                    ownerKind="visualizer"
                    ownerId={visualizerId}
                    description="Reference layers drawn over the imagery, toggled from the viewer's panel."
                  />
                </div>
              </Manual>
            )}
          </Section>

          <Section title="Publishing">
            <div className="flex items-start gap-3">
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
                {draft.isPublic && restricted.length > 0 && (
                  <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                    <p className="flex items-center gap-1.5 font-medium">
                      <IconWarning className="h-3.5 w-3.5 shrink-0" />
                      Not open imagery
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {restricted.map((layer) => (
                        <li key={`${layer.reason}-${layer.name}`}>
                          <span className="font-medium">{layer.name}</span> is{' '}
                          {RESTRICTION_TEXT[layer.reason]}.
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1">
                      Anonymous traffic spends that quota, and your licence may not let you
                      redistribute the imagery.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Section>
        </div>
      )}
    </Modal>
  );
}

/** A campaign's own layers, offered as they stand. Campaigns with nothing to
 *  offer are left out rather than listed empty. */
const CampaignGroups = ({
  campaigns,
  rows,
}: {
  campaigns: VisualizerOptionsOut['campaigns'];
  rows: (campaign: VisualizerOptionsOut['campaigns'][number]) => React.ReactNode[];
}) => (
  <div className="space-y-4">
    {campaigns.map((campaign) => (
      <section key={campaign.campaign_id}>
        <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-neutral-700">
          <IconMap className="h-3.5 w-3.5 text-neutral-400" />
          {campaign.campaign_name}
        </h4>
        <div className="overflow-hidden rounded-lg border border-neutral-200">{rows(campaign)}</div>
      </section>
    ))}
  </div>
);

/** Setting a layer up by hand is the second offer, so it stays a link until
 *  it is wanted - the form behind it is as long as a campaign's own. */
const Manual = ({
  open,
  onOpen,
  label,
  hint,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  label: string;
  hint: string;
  children: React.ReactNode;
}) =>
  open ? (
    <div className="mt-4 border-t border-neutral-100 pt-4">
      <p className="mb-3 text-xs text-neutral-500">{hint}</p>
      {children}
    </div>
  ) : (
    <button
      type="button"
      onClick={onOpen}
      className="mt-3 cursor-pointer text-xs text-brand-700 underline decoration-brand-300 underline-offset-4 transition-colors hover:text-brand-900 hover:decoration-brand-700"
    >
      + {label}
    </button>
  );

const Section = ({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <section className="p-4">
    {title && <h3 className="section-heading">{title}</h3>}
    {description && <p className="section-description">{description}</p>}
    {children}
  </section>
);

/** A source that carries covers over a coarser period than its slices arrives
 *  as two entries in the viewer, which is worth knowing before ticking it. */
const sourceNote = (source: SourceOptionOut) => {
  if (source.step_count === 0) return 'No registered imagery yet';
  const span =
    source.start_date && source.end_date ? `, ${source.start_date} to ${source.end_date}` : '';
  const dates = `${source.step_count} ${source.step_count === 1 ? 'date' : 'dates'}${span}`;
  return source.cadences.length > 1
    ? `Two timelines - ${source.cadences.join(' and ')} - ${dates}`
    : `${source.cadences[0] ?? ''} - ${dates}`.replace(/^ - /, '');
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
