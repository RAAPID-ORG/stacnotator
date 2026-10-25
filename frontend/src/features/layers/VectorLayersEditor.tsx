import { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Input, Button, IconButton } from '~/shared/ui/forms';
import { IconTrash } from '~/shared/ui/Icons';
import { type VectorLayerOut } from '~/api/client';
import { vectorLayerApi, type OverlayOwnerKind } from './overlayOwner';

const NO_LAYERS: VectorLayerOut[] = [];

interface FormState {
  name: string;
  pmtiles_url: string;
  source_layer: string;
  color: string;
}

const defaultForm = (): FormState => ({
  name: '',
  pmtiles_url: '',
  source_layer: '',
  color: '#3b82f6',
});

interface VectorLayersEditorProps {
  ownerKind: OverlayOwnerKind;
  ownerId: number;
  /** Replaces the default blurb, which describes what these do in the
   *  annotator - not what they do everywhere they can be set up. */
  description?: string;
}

export const VectorLayersEditor = ({
  ownerKind,
  ownerId,
  description,
}: VectorLayersEditorProps) => {
  const { t } = useTranslation(['campaigns', 'common']);
  const api = useMemo(() => vectorLayerApi(ownerKind, ownerId), [ownerKind, ownerId]);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(defaultForm());
  const [showForm, setShowForm] = useState(false);

  const {
    data: layers = NO_LAYERS,
    isError: layersFailed,
    refetch: refetchLayers,
  } = useQuery({
    queryKey: api.queryKey,
    queryFn: async () => (await api.list()).data ?? NO_LAYERS,
    // As above: an empty list is a usable editor, an alert is just noise.
    // No toast: the list reports its own failure, as in CustomMapsEditor. Silence
    // here is indistinguishable from having no layers.
    meta: { errorMessage: t('vectorLayers.loadFailed'), showUser: false },
  });

  const reloadLayers = () => queryClient.invalidateQueries({ queryKey: api.queryKey });

  const create = useMutation({
    mutationFn: api.create,
    meta: { errorMessage: t('vectorLayers.addFailed') },
    onSuccess: () => {
      setForm(defaultForm());
      setShowForm(false);
      void reloadLayers();
    },
  });
  const submitting = create.isPending;

  const remove = useMutation({
    mutationFn: api.remove,
    meta: { errorMessage: t('vectorLayers.deleteFailed') },
    onSuccess: reloadLayers,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({
      name: form.name,
      pmtiles_url: form.pmtiles_url,
      source_layer: form.source_layer.trim() || null,
      color: form.color,
    });
  };

  const handleDelete = (layerId: number) => remove.mutate(layerId);

  // Rendered as a subsection of the settings "Overlays" section (ImagerySetup
  // owns the section header), alongside the raster-layers subsection.
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            {t('vectorLayers.title')}
          </h4>
          <p className="text-xs text-neutral-500 mt-0.5">
            {description ?? t('vectorLayers.description')}
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
          >
            {t('vectorLayers.add')}
          </button>
        )}
      </div>

      {layersFailed ? (
        <div className="flex items-center gap-3 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          <span className="flex-1">{t('vectorLayers.loadError')}</span>
          <button
            type="button"
            onClick={() => void refetchLayers()}
            className="font-medium underline underline-offset-2 hover:text-red-900"
          >
            {t('vectorLayers.tryAgain')}
          </button>
        </div>
      ) : layers.length === 0 && !showForm ? (
        <p className="text-xs text-neutral-400 italic">{t('vectorLayers.empty')}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
          {layers.map((l) => (
            <li
              key={l.id}
              data-testid="vector-layer-row"
              className="py-2.5 flex items-center gap-3"
            >
              <span
                className="w-3.5 h-3.5 rounded-sm flex-shrink-0 border border-black/10"
                style={{ backgroundColor: l.color }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-900 truncate">
                  {l.name}
                  {l.source_layer ? (
                    <span className="ml-1.5 text-xs font-normal text-neutral-400">
                      · {l.source_layer}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-neutral-500 truncate font-mono">{l.pmtiles_url}</p>
              </div>
              <IconButton
                tone="danger"
                onClick={() => handleDelete(l.id)}
                aria-label={t('vectorLayers.deleteLayer')}
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
                placeholder={t('vectorLayers.namePlaceholder')}
                required
                data-testid="vector-layer-name"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                {t('vectorLayers.sourceLayer')}{' '}
                <span className="text-neutral-400">{t('optional')}</span>
              </label>
              <Input
                size="sm"
                type="text"
                value={form.source_layer}
                onChange={(e) => setForm((f) => ({ ...f, source_layer: e.target.value }))}
                placeholder={t('vectorLayers.allLayers')}
                data-testid="vector-layer-source-layer"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              {t('vectorLayers.url')}
            </label>
            <Input
              size="sm"
              type="text"
              value={form.pmtiles_url}
              onChange={(e) => setForm((f) => ({ ...f, pmtiles_url: e.target.value }))}
              placeholder="https://example.com/predictions.pmtiles"
              required
              pattern="https?://\S+"
              title={t('vectorLayers.urlInvalid')}
              data-testid="vector-layer-url"
              className="font-mono text-[11px]"
            />
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-neutral-500 leading-snug list-disc list-inside">
              <li>
                <Trans
                  t={t}
                  i18nKey="vectorLayers.hints.archive"
                  components={{ strong: <strong className="font-medium text-neutral-600" /> }}
                />
              </li>
              <li>{t('vectorLayers.hints.https')}</li>
              <li>{t('vectorLayers.hints.sourceLayer')}</li>
            </ul>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              {t('vectorLayers.colour')}
            </label>
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
              className="h-8 w-12 rounded border border-neutral-300 cursor-pointer p-0.5 bg-white"
              title={t('vectorLayers.layerColour')}
              data-testid="vector-layer-color"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" size="sm" disabled={submitting} data-testid="add-vector-layer">
              {submitting ? t('vectorLayers.adding') : t('vectorLayers.addLayer')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setShowForm(false);
                setForm(defaultForm());
              }}
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
