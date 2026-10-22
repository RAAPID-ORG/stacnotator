import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';
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
import { publishConfirm, restrictedSelection, type RestrictedLayer } from './publishWarning';

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
  const { t } = useTranslation(['visualizers', 'common']);
  const [draft, setDraft] = useState<Draft | null>(visualizerId === null ? EMPTY : null);
  // The manual forms open on their own where a visualizer already has layers of
  // its own, so editing one does not hide what is there behind a link.
  const [addingImagery, setAddingImagery] = useState(false);
  const [addingOverlay, setAddingOverlay] = useState(false);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);

  const optionsQuery = useQuery({
    ...listVisualizerOptionsOptions({ path: { project_id: projectId } }),
    meta: { errorMessage: t('editor.loadOptionsFailed') },
  });
  const existingQuery = useQuery({
    ...getVisualizerOptions({ path: { visualizer_id: visualizerId ?? 0 } }),
    enabled: visualizerId !== null,
    meta: { errorMessage: t('editor.loadFailed') },
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
    meta: { errorMessage: t('editor.saveFailed') },
    onSuccess: (created) => {
      showAlert(t('editor.created'), 'success');
      onCreated(created.id);
    },
  });
  const update = useMutation({
    ...updateVisualizerMutation(),
    meta: { errorMessage: t('editor.saveFailed') },
    onSuccess: () => {
      showAlert(t('editor.saved'), 'success');
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
      title={visualizerId === null ? t('editor.newTitle') : t('editor.editTitle')}
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-neutral-500">
            {ready && layerCount === 0 ? t('editor.addSomething') : ''}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button size="sm" disabled={!valid || saving} onClick={() => void save()}>
              {saving
                ? t('editor.saving')
                : visualizerId === null
                  ? t('common:actions.create')
                  : t('common:actions.save')}
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
            <Field label={t('editor.name')} htmlFor="visualizer-name" required>
              <Input
                id="visualizer-name"
                value={draft.name}
                placeholder={t('editor.namePlaceholder')}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field
              label={t('editor.description')}
              htmlFor="visualizer-description"
              className="mt-4"
            >
              <Textarea
                id="visualizer-description"
                rows={2}
                value={draft.description}
                placeholder={t('editor.descriptionPlaceholder')}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>
          </Section>

          <Section title={t('editor.areaTitle')} description={t('editor.areaDescription')}>
            <AreaField
              value={draft.area}
              onChange={(area) => setDraft({ ...draft, area })}
              options={options}
            />
          </Section>

          <Section title={t('editor.imageryTitle')} description={t('editor.imageryDescription')}>
            {campaignsWithSources.length > 0 && (
              <>
                <p className="mb-3 rounded-md bg-neutral-50 px-2.5 py-2 text-[11px] leading-relaxed text-neutral-600">
                  {t('editor.coverNote')}
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
                        note={sourceNote(source, t)}
                        disabled={
                          source.step_count === 0 || source.restriction === 'storage_access'
                        }
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
                  ? t('editor.addOtherImagery')
                  : t('editor.setUpImagery')
              }
              hint={t('editor.ownImageryHint')}
            >
              <OwnImagery
                state={draft.ownImagery}
                onChange={(ownImagery) => setDraft({ ...draft, ownImagery })}
                area={draft.area}
                projectId={projectId}
              />
            </Manual>
          </Section>

          <Section title={t('editor.overlaysTitle')} description={t('editor.overlaysDescription')}>
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
                      note={
                        overlay.restriction === 'storage_access'
                          ? t('editor.overlaySasNote')
                          : overlay.status === 'ready'
                            ? t('editor.raster')
                            : t('editor.rasterStatus', { status: overlay.status })
                      }
                      disabled={overlay.restriction === 'storage_access'}
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
                      note={t('editor.vector')}
                    />
                  )),
                ]}
              />
            )}

            {visualizerId === null ? (
              <p className="mt-4 rounded-lg border border-dashed border-neutral-200 px-4 py-4 text-center text-xs text-neutral-500">
                {t('editor.createFirst')}
              </p>
            ) : (
              <Manual
                open={addingOverlay}
                onOpen={() => setAddingOverlay(true)}
                label={
                  campaignsWithOverlays.length > 0
                    ? t('editor.addAnotherOverlay')
                    : t('editor.addOverlay')
                }
                hint={t('editor.ownOverlayHint')}
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
                    description={t('editor.vectorDescription')}
                  />
                </div>
              </Manual>
            )}
          </Section>

          <Section title={t('editor.publishingTitle')}>
            <div className="flex items-start gap-3">
              <span className="pt-0.5">
                <Switch
                  checked={draft.isPublic}
                  aria-label={t('editor.anyoneWithLink')}
                  onChange={(checked) => setDraft({ ...draft, isPublic: checked })}
                />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
                  <IconGlobe className="h-3.5 w-3.5" />
                  {t('editor.anyoneWithLink')}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {draft.isPublic ? t('editor.publicHint') : t('editor.privateHint')}
                </p>
                {draft.isPublic && restricted.length > 0 && (
                  <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                    <p className="flex items-center gap-1.5 font-medium">
                      <IconWarning className="h-3.5 w-3.5 shrink-0" />
                      {t('editor.notOpen')}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {restricted.map((layer) => (
                        <li key={`${layer.reason}-${layer.name}`}>
                          <Trans
                            t={t}
                            i18nKey="editor.restricted"
                            values={{ name: layer.name, reason: t(`restriction.${layer.reason}`) }}
                            components={{ strong: <span className="font-medium" /> }}
                          />
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1">{t('editor.quotaWarning')}</p>
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
const sourceNote = (source: SourceOptionOut, t: TFunction<'visualizers'>) => {
  if (source.restriction === 'storage_access') return t('editor.sourceSasNote');
  if (source.step_count === 0) return t('editor.noImagery');
  const dates =
    source.start_date && source.end_date
      ? t('editor.datesSpan', {
          count: source.step_count,
          start: source.start_date,
          end: source.end_date,
        })
      : t('editor.dates', { count: source.step_count });
  return source.cadences.length > 1
    ? t('editor.twoTimelines', {
        cadences: source.cadences.join(t('editor.cadenceJoin')),
        dates,
      })
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
