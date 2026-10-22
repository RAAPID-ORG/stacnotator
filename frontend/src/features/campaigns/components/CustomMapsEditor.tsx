import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useProjectTilers } from '~/shared/hooks/useProjectTilers';
import { customMapApi, type OverlayOwnerKind } from './overlayOwner';
import { Spinner } from '~/shared/ui/Spinner';
import { Input, Button, IconButton } from '~/shared/ui/forms';
import { IconTrash, IconPlus, IconPencil, IconExternalLink } from '~/shared/ui/Icons';
import { ColormapSelect } from '~/shared/colormaps/ColormapSelect';
import {
  isColormapName,
  nextCategoricalColor,
  CATEGORICAL_PALETTE,
  type ColormapName,
} from '~/shared/colormaps/colormaps';
import { type CategoricalEntry, type CustomMapCreate, type CustomMapOut } from '~/api/client';
import { SasTokenField } from './imagery/SasTokenField';
import { readSasToken } from './imagery/sasToken';

const NO_MAPS: CustomMapOut[] = [];

/** A tiler registration takes a couple of seconds, so the list checks back
 *  often enough that "registering" does not look stuck. */
const REGISTRATION_POLL_MS = 2000;

interface FormState {
  name: string;
  cog_url: string;
  mlops_url: string;
  mode: 'continuous' | 'categorical';
  colormap_name: ColormapName;
  rescale_min: string;
  rescale_max: string;
  entries: Array<{ value: string; color: string; label: string }>;
  max_native_zoom: string;
  internal_storage: boolean;
  private_storage: boolean;
  sas_token: string;
  storage_expiry: string | null;
}

const defaultForm = (): FormState => ({
  name: '',
  cog_url: '',
  mlops_url: '',
  mode: 'continuous',
  colormap_name: 'viridis',
  rescale_min: '0',
  rescale_max: '1',
  entries: [{ value: '1', color: CATEGORICAL_PALETTE[0], label: '' }],
  max_native_zoom: '',
  internal_storage: false,
  private_storage: false,
  sas_token: '',
  storage_expiry: null,
});

const formFromMap = (m: CustomMapOut): FormState => {
  const rc = m.render_config;
  const entries = rc.entries ?? [];
  return {
    name: m.name,
    cog_url: m.cog_url,
    mlops_url: m.mlops_url ?? '',
    mode: rc.mode,
    colormap_name:
      rc.colormap_name && isColormapName(rc.colormap_name) ? rc.colormap_name : 'viridis',
    rescale_min: rc.rescale ? String(rc.rescale[0]) : '0',
    rescale_max: rc.rescale ? String(rc.rescale[1]) : '1',
    entries: entries.length
      ? entries.map((e) => ({ value: String(e.value), color: e.color, label: e.label ?? '' }))
      : defaultForm().entries,
    max_native_zoom: m.max_native_zoom != null ? String(m.max_native_zoom) : '',
    internal_storage: m.internal_storage ?? false,
    private_storage: !!m.storage_access,
    sas_token: '',
    storage_expiry: m.storage_access?.expires_at ?? null,
  };
};

interface StatusBadgeProps {
  status: CustomMapOut['status'];
  statusError?: CustomMapOut['status_error'];
}

const StatusBadge = ({ status, statusError }: StatusBadgeProps) => {
  const { t } = useTranslation('campaigns');
  if (status === 'registering') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-blue-700">
        <Spinner size="xs" />
        {t('customMaps.status.processing')}
      </span>
    );
  }
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        {t('customMaps.status.ready')}
      </span>
    );
  }
  if (status === 'failed') {
    const errMsg =
      statusError && typeof statusError === 'object' && 'error' in statusError
        ? String((statusError as { error: unknown }).error)
        : t('customMaps.status.processingFailed');
    return (
      <span
        className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 cursor-help"
        title={errMsg}
      >
        {t('customMaps.status.failed')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
      {status}
    </span>
  );
};

interface CustomMapsEditorProps {
  ownerKind: OverlayOwnerKind;
  ownerId: number;
  projectId: number;
}

export const CustomMapsEditor = ({ ownerKind, ownerId, projectId }: CustomMapsEditorProps) => {
  // Memoised so the effects below can depend on it rather than on the owner's
  // parts, and so a re-render never re-runs the fetch.
  const { t } = useTranslation(['campaigns', 'common']);
  const api = useMemo(() => customMapApi(ownerKind, ownerId), [ownerKind, ownerId]);
  const { allowsInternalStorage } = useProjectTilers(projectId);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(defaultForm());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  // Focus the value field of a freshly added class entry so Enter/Add keeps the keyboard flow going.
  const entryValueRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const pendingFocus = useRef<number | null>(null);

  useEffect(() => {
    if (pendingFocus.current !== null) {
      entryValueRefs.current[pendingFocus.current]?.focus();
      pendingFocus.current = null;
    }
  }, [form.entries.length]);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(defaultForm());
  };

  const startCreate = () => {
    setForm(defaultForm());
    setEditingId(null);
    setShowForm(true);
  };

  const startEdit = (m: CustomMapOut) => {
    setForm(formFromMap(m));
    setEditingId(m.id);
    setShowForm(true);
  };

  // A freshly added map registers with the tiler in the background, so the list
  // keeps re-reading until nothing is mid-registration.
  const {
    data: maps = NO_MAPS,
    isError: mapsFailed,
    refetch: refetchMaps,
  } = useQuery({
    queryKey: api.queryKey,
    queryFn: async () => (await api.list()).data ?? NO_MAPS,
    refetchInterval: (query) =>
      query.state.data?.some((m) => m.status === 'registering') ? REGISTRATION_POLL_MS : false,
    // No toast: the list says so itself, in place, with a way to try again. An empty
    // list and silence is indistinguishable from having no layers, which is how a 500
    // here went unnoticed until someone tried to add the same layer twice.
    meta: { errorMessage: t('customMaps.errors.load'), showUser: false },
  });

  const reloadMaps = () => queryClient.invalidateQueries({ queryKey: api.queryKey });

  const save = useMutation({
    mutationFn: (body: CustomMapCreate) =>
      editingId === null ? api.create(body) : api.update(editingId, body),
    meta: {
      errorMessage: editingId === null ? t('customMaps.errors.add') : t('customMaps.errors.save'),
    },
    onSuccess: () => {
      closeForm();
      void reloadMaps();
    },
  });
  const submitting = save.isPending;
  const savedAccess = maps.find((m) => m.id === editingId)?.storage_access;
  const sasReading = form.sas_token.trim() ? readSasToken(form.sas_token) : null;
  const invalidAccess = form.private_storage && (sasReading ? 'error' in sasReading : !savedAccess);

  const remove = useMutation({
    mutationFn: (mapId: number) => api.remove(mapId),
    meta: { errorMessage: t('customMaps.errors.delete') },
    onSuccess: reloadMaps,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (invalidAccess) return;
    const renderConfig =
      form.mode === 'continuous'
        ? {
            mode: 'continuous' as const,
            colormap_name: form.colormap_name || null,
            rescale:
              form.rescale_min !== '' && form.rescale_max !== ''
                ? ([Number(form.rescale_min), Number(form.rescale_max)] as [number, number])
                : null,
          }
        : {
            mode: 'categorical' as const,
            entries: form.entries.map(
              (e): CategoricalEntry => ({
                value: Number(e.value),
                color: e.color,
                label: e.label || undefined,
              })
            ),
          };

    save.mutate({
      name: form.name,
      cog_url: form.cog_url,
      render_config: renderConfig,
      max_native_zoom: form.max_native_zoom !== '' ? Number(form.max_native_zoom) : null,
      mlops_url: form.mlops_url.trim() !== '' ? form.mlops_url.trim() : null,
      // Omitted when the project cannot use internal storage, so editing a map never
      // downgrades a flag the user cannot see; the backend defaults it to false on
      // create and leaves it on update.
      ...(allowsInternalStorage ? { internal_storage: form.internal_storage } : {}),
      storage_access: form.private_storage
        ? sasReading && 'token' in sasReading
          ? { kind: 'azure_sas', secret: sasReading.token }
          : undefined
        : null,
    });
  };

  const handleDelete = (mapId: number) => remove.mutate(mapId);

  const updateEntry = (idx: number, patch: Partial<(typeof form.entries)[0]>) =>
    setForm((f) => ({
      ...f,
      entries: f.entries.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    }));

  const addEntry = () =>
    setForm((f) => {
      const entries = [
        ...f.entries,
        { value: '', color: nextCategoricalColor(f.entries.map((e) => e.color)), label: '' },
      ];
      pendingFocus.current = entries.length - 1;
      return { ...f, entries };
    });

  const removeEntry = (idx: number) =>
    setForm((f) => ({ ...f, entries: f.entries.filter((_, i) => i !== idx) }));

  const submitLabel = submitting
    ? t('settingsPage.saving')
    : editingId === null
      ? t('customMaps.addMap')
      : t('customMaps.saveMap');

  // Rendered as a subsection of the settings "Overlays" section (ImagerySetup
  // owns the section header), alongside the vector-layers subsection.
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            {t('customMaps.title')}
          </h4>
          <p className="text-xs text-neutral-500 mt-0.5">{t('customMaps.description')}</p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={startCreate}
            className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
          >
            {t('customMaps.add')}
          </button>
        )}
      </div>

      {mapsFailed ? (
        <div className="flex items-center gap-3 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          <span className="flex-1">{t('customMaps.loadError')}</span>
          <button
            type="button"
            onClick={() => void refetchMaps()}
            className="font-medium underline underline-offset-2 hover:text-red-900"
          >
            {t('vectorLayers.tryAgain')}
          </button>
        </div>
      ) : maps.length === 0 && !showForm ? (
        <p className="text-xs text-neutral-400 italic">{t('customMaps.empty')}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
          {maps.map((m) => (
            <li
              key={m.id}
              data-testid="custom-map-row"
              data-status={m.status}
              className="py-2.5 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-sm font-medium text-neutral-900 truncate">{m.name}</p>
                  {m.mlops_url && (
                    <a
                      href={m.mlops_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="custom-map-row-mlops-link"
                      title={t('customMaps.openExperiment')}
                      className="shrink-0 text-neutral-400 hover:text-neutral-700 transition-colors"
                    >
                      <IconExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
                <p className="text-xs text-neutral-500 truncate font-mono">{m.cog_url}</p>
              </div>
              <StatusBadge status={m.status} statusError={m.status_error} />
              <IconButton
                onClick={() => startEdit(m)}
                aria-label={t('customMaps.editMap')}
                title={t('common:actions.edit')}
                data-testid="edit-custom-map"
              >
                <IconPencil className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                tone="danger"
                onClick={() => handleDelete(m.id)}
                aria-label={t('customMaps.deleteMap')}
                title={t('common:actions.delete')}
              >
                <IconTrash className="w-3.5 h-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mt-4 space-y-4 border border-neutral-200 rounded-lg p-4 bg-neutral-50"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                {t('vectorLayers.name')}
              </label>
              <Input
                size="sm"
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t('customMaps.namePlaceholder')}
                required
                data-testid="custom-map-name"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                {t('customMaps.maxZoom')}
              </label>
              <Input
                size="sm"
                type="number"
                min={0}
                max={24}
                value={form.max_native_zoom}
                onChange={(e) => setForm((f) => ({ ...f, max_native_zoom: e.target.value }))}
                placeholder={t('customMaps.auto')}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              {t('customMaps.url')}
            </label>
            <Input
              size="sm"
              type="text"
              value={form.cog_url}
              onChange={(e) => setForm((f) => ({ ...f, cog_url: e.target.value }))}
              placeholder="https://example.com/data.tif"
              required
              data-testid="custom-map-url"
              className="font-mono text-[11px]"
            />
            <ul
              data-testid="custom-map-url-help"
              className="mt-1.5 space-y-0.5 text-[11px] text-neutral-500 leading-snug list-disc list-inside"
            >
              <li>
                <Trans
                  t={t}
                  i18nKey="customMaps.hints.cog"
                  components={{ strong: <strong className="font-medium text-neutral-600" /> }}
                />
              </li>
              <li>{t('customMaps.hints.singleBand')}</li>
              <li>{t('customMaps.hints.reachable')}</li>
              <li>{t('customMaps.hints.projection')}</li>
              <li>{t('customMaps.hints.notValidated')}</li>
            </ul>
          </div>

          {ownerKind === 'campaign' && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-neutral-700">
                <input
                  type="checkbox"
                  checked={form.private_storage}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      private_storage: e.target.checked,
                      internal_storage: e.target.checked ? false : f.internal_storage,
                      sas_token: '',
                    }))
                  }
                />
                {t('customMaps.privateStorage')}
              </label>
              {form.private_storage && (
                <>
                  <SasTokenField
                    value={form.sas_token}
                    onChange={(sas_token) => setForm((f) => ({ ...f, sas_token }))}
                    configured={!!savedAccess}
                    expiresAt={form.storage_expiry}
                    placeholder={savedAccess ? t('customMaps.replaceToken') : undefined}
                  />
                  {!savedAccess && !form.sas_token.trim() && (
                    <p className="text-[11px] text-neutral-500">{t('customMaps.provideToken')}</p>
                  )}
                </>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              {t('customMaps.experimentLink')}{' '}
              <span className="font-normal text-neutral-400">{t('optional')}</span>
            </label>
            <Input
              size="sm"
              type="url"
              value={form.mlops_url}
              onChange={(e) => setForm((f) => ({ ...f, mlops_url: e.target.value }))}
              placeholder="https://mlflow.example.org/#/experiments/7/runs/…"
              data-testid="custom-map-mlops-url"
              className="font-mono text-[11px]"
            />
            <p className="mt-1.5 text-[11px] text-neutral-500 leading-snug">
              {t('customMaps.experimentHint')}
            </p>
          </div>

          {allowsInternalStorage && (
            <div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.internal_storage}
                  disabled={form.private_storage}
                  onChange={(e) => setForm((f) => ({ ...f, internal_storage: e.target.checked }))}
                  data-testid="custom-map-internal-storage"
                />
                <span className="text-xs text-neutral-700">
                  <span className="font-medium">{t('customMaps.internalStorage')}</span>
                  <span className="block text-[11px] text-neutral-500 leading-snug">
                    {t('customMaps.internalStorageHint')}
                  </span>
                </span>
              </label>
            </div>
          )}

          <div>
            <span className="block text-xs font-medium text-neutral-700 mb-1">
              {t('customMaps.renderMode')}
            </span>
            <div className="flex gap-2">
              {(['continuous', 'categorical'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, mode: m }))}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
                    form.mode === m
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-neutral-600 border-neutral-300 hover:border-neutral-400'
                  }`}
                >
                  {t(`customMaps.modes.${m}`)}
                </button>
              ))}
            </div>
          </div>

          {form.mode === 'continuous' && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  {t('customMaps.colormap')}
                </label>
                <ColormapSelect
                  value={form.colormap_name}
                  onChange={(colormap_name) => setForm((f) => ({ ...f, colormap_name }))}
                  className="w-full h-8 px-2.5 text-xs text-neutral-900 bg-white border border-neutral-300 rounded-md focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  {t('customMaps.rescaleMin')}
                </label>
                <Input
                  size="sm"
                  type="number"
                  value={form.rescale_min}
                  onChange={(e) => setForm((f) => ({ ...f, rescale_min: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  {t('customMaps.rescaleMax')}
                </label>
                <Input
                  size="sm"
                  type="number"
                  value={form.rescale_max}
                  onChange={(e) => setForm((f) => ({ ...f, rescale_max: e.target.value }))}
                  placeholder="1"
                />
              </div>
            </div>
          )}

          {form.mode === 'categorical' && (
            <div>
              <span className="block text-xs font-medium text-neutral-700 mb-2">
                {t('customMaps.classEntries')}
              </span>
              {/* Enter adds the next entry instead of submitting the form, so classes can be typed
                  in one keyboard run; the new entry's value field takes focus (see pendingFocus). */}
              <ul className="space-y-2">
                {form.entries.map((entry, idx) => {
                  const addOnEnter = (e: React.KeyboardEvent) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addEntry();
                  };
                  return (
                    <li key={idx} className="flex items-center gap-2">
                      <Input
                        ref={(el) => {
                          entryValueRefs.current[idx] = el;
                        }}
                        size="sm"
                        type="number"
                        value={entry.value}
                        onChange={(e) => updateEntry(idx, { value: e.target.value })}
                        onKeyDown={addOnEnter}
                        placeholder={t('customMaps.value')}
                        className="!w-20"
                      />
                      <input
                        type="color"
                        value={entry.color}
                        onChange={(e) => updateEntry(idx, { color: e.target.value })}
                        className="h-8 w-10 rounded border border-neutral-300 cursor-pointer p-0.5 bg-white"
                        title={t('customMaps.color')}
                      />
                      <Input
                        size="sm"
                        type="text"
                        value={entry.label}
                        onChange={(e) => updateEntry(idx, { label: e.target.value })}
                        onKeyDown={addOnEnter}
                        placeholder={t('customMaps.labelPlaceholder')}
                        className="flex-1"
                      />
                      <IconButton
                        tone="danger"
                        type="button"
                        onClick={() => removeEntry(idx)}
                        disabled={form.entries.length <= 1}
                        aria-label={t('customMaps.removeEntry')}
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={addEntry}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-neutral-300 py-1.5 text-xs text-brand-700 hover:border-brand-400 hover:text-brand-900 cursor-pointer"
              >
                <IconPlus className="w-3 h-3" />
                {t('customMaps.addClass')}
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="submit"
              size="sm"
              disabled={submitting || invalidAccess}
              data-testid="add-custom-map"
            >
              {submitLabel}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={closeForm}
              disabled={submitting}
            >
              {t('common:actions.cancel')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};
