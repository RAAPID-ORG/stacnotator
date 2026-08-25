import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  type VisualizerArea,
  type VisualizerImageryCreate,
  type SourceOptionOut,
  type VisualizerOptionsOut,
  type VisualizerOverlayCreate,
} from '~/api/client';
import {
  createVisualizerMutation,
  getVisualizerOptions,
  listVisualizerOptionsOptions,
  updateVisualizerMutation,
} from '~/api/queries';
import type { ImageryStepState } from '~/features/campaigns/components/imagery/types';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Button, Field, Input, Switch, Textarea } from '~/shared/ui/forms';
import { IconGlobe, IconMap, IconWarning } from '~/shared/ui/Icons';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { Modal } from '~/shared/ui/Modal';
import { CustomMapsEditor } from '~/features/campaigns/components/CustomMapsEditor';
import { VectorLayersEditor } from '~/features/campaigns/components/VectorLayersEditor';
import { AreaField } from './editor/AreaField';
import {
  basemapsPayload,
  emptyImageryState,
  imageryStateFrom,
  OwnImagery,
  ownImageryPayload,
  VisualizerBasemaps,
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
  onCreated,
}: {
  projectId: number;
  visualizerId: number | null;
  onClose: () => void;
  onSaved: () => void;
  /** A visualizer was created. The panel stays open on it so its own overlays and
   *  layers, which need an id to be created against, can be set up straight away. */
  onCreated: (id: number) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(visualizerId === null ? EMPTY : null);
  // The manual forms open on their own where a visualizer already has layers of
  // its own, so editing one does not hide what is there behind a link.
  const [addingImagery, setAddingImagery] = useState(false);
  const [addingOverlay, setAddingOverlay] = useState(false);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);

  const optionsQuery = useQuery({
    ...listVisualizerOptionsOptions({ path: { project_id: projectId } }),
    meta: { errorMessage: 'Failed to load what this project has to show' },
  });
  const existingQuery = useQuery({
    ...getVisualizerOptions({ path: { visualizer_id: visualizerId ?? 0 } }),
    enabled: visualizerId !== null,
    meta: { errorMessage: 'Failed to load the visualizer' },
  });

  const options = optionsQuery.data ?? null;
  const existing = existingQuery.data;

  // The editor works on a draft; the stored visualizer only seeds it, once.
  useEffect(() => {
    if (!existing) return;
    setDraft({
      name: existing.name,
      description: existing.description ?? '',
      isPublic: existing.is_public,
      area: existing.area,
      imagery: existing.imagery,
      overlays: existing.overlays,
      ownImagery: imageryStateFrom(existing.own_imagery, existing.basemaps),
    });
  }, [existing]);

  // Nothing to edit if we cannot read what the project has to offer.
  useEffect(() => {
    if (optionsQuery.isError || existingQuery.isError) onClose();
    // onClose identity changes on every parent render; only the failure matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsQuery.isError, existingQuery.isError]);

  const create = useMutation({
    ...createVisualizerMutation(),
    meta: { errorMessage: 'Failed to save the visualizer' },
    onSuccess: (created) => {
      showAlert('Visualizer created. You can now add overlays of its own.', 'success');
      onCreated(created.id);
    },
  });
  const update = useMutation({
    ...updateVisualizerMutation(),
    meta: { errorMessage: 'Failed to save the visualizer' },
    onSuccess: () => {
      showAlert('Visualizer saved', 'success');
      onSaved();
    },
  });
  const saving = create.isPending || update.isPending;

  const save = async () => {
    if (!draft) return;
    const confirm = draft.isPublic ? publishConfirm(restricted) : null;
    if (confirm && !(await showConfirmDialog(confirm))) return;
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
    if (visualizerId === null) create.mutate({ path: { project_id: projectId }, body });
    else update.mutate({ path: { visualizer_id: visualizerId }, body });
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
                  A campaign browses imagery as windows, often with a cover image composited over
                  the whole temporal window. A visualizer has a date slider instead. Cover
                  composites covering the whole temporal window, will result in an additional
                  imagery source here, as each source needs evenly discrete steps for it's
                  timeslider.
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

            {/* Shown outright, not behind "add imagery": these are the backdrops the
                visualizer already has, and a new one starts with a full set. Carries
                the same separator as the Manual blocks below it. */}
            <div className="mt-4 border-t border-neutral-100 pt-4">
              <VisualizerBasemaps
                state={draft.ownImagery}
                onChange={(ownImagery) => setDraft({ ...draft, ownImagery })}
                area={draft.area}
                projectId={projectId}
              />
            </div>

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
            description="Predictions and reference layers drawn over the imagery. You can add more, not yet registered, overlays after setting up the visualizer."
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
              <p className="mt-4 rounded-lg border border-dashed border-neutral-200 px-4 py-4 text-center text-xs text-neutral-500">
                An overlay is stored against the visualizer, so create it first. This panel stays
                open afterwards and you can add them straight away.
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
                {/* Two kinds of overlay, each with its own header and add action, so
                    they are separated the way the sections above are rather than
                    stacked into one column. */}
                <div className="space-y-6 divide-y divide-neutral-100 [&>*+*]:pt-6">
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
      // The campaign name is the head of its own list rather than a caption floating
      // above one: same box, same horizontal padding as the rows, tinted and with a
      // straight edge where the first option meets it.
      <section
        key={campaign.campaign_id}
        className="overflow-hidden rounded-lg border border-neutral-200"
      >
        <h4 className="flex items-center gap-1.5 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-700">
          <IconMap className="h-3.5 w-3.5 text-neutral-400" />
          <span className="truncate">{campaign.campaign_name}</span>
        </h4>
        {rows(campaign)}
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
