import { Trans, useTranslation } from 'react-i18next';
import { IconTrash } from '~/shared/ui/Icons';
import { Tooltip } from '~/shared/ui/Tooltip';
import { Input } from '~/shared/ui/forms';
import type { Basemap } from './types';
import { emptyBasemap } from './types';
import type { ImageryController } from './controller';
import { ApiKeyField } from './ApiKeyField';

interface BasemapListProps {
  controller: ImageryController;
}

export const BasemapList = ({ controller }: BasemapListProps) => {
  const { t } = useTranslation('imagery');
  const basemaps = controller.state.basemaps;

  const update = (next: Basemap[]) => void controller.setBasemaps(next);
  const addBasemap = () => update([...basemaps, emptyBasemap()]);
  const removeBasemap = (id: string) => update(basemaps.filter((b) => b.id !== id));
  const updateBasemap = (id: string, patch: Partial<Basemap>) =>
    update(basemaps.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="section-heading flex items-center gap-1">
            {t('basemaps.title')}
            <Tooltip text={t('basemaps.tooltip')} />
          </h3>
          <p className="section-description">
            <Trans
              t={t}
              i18nKey="basemaps.description"
              values={{ placeholder: '{api_key}' }}
              components={{ code: <code className="font-mono bg-neutral-100 px-0.5 rounded" /> }}
            />
          </p>
        </div>
        <button
          type="button"
          onClick={addBasemap}
          className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
        >
          {t('basemaps.add')}
        </button>
      </div>

      {basemaps.length === 0 ? (
        <p className="text-xs text-neutral-400 italic">{t('basemaps.empty')}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
          {basemaps.map((bm) => (
            <li key={bm.id} className="py-2">
              <div className="flex items-center gap-3">
                <Input
                  size="sm"
                  type="text"
                  value={bm.name}
                  onChange={(e) => updateBasemap(bm.id, { name: e.target.value })}
                  placeholder={t('basemaps.namePlaceholder')}
                  className="!w-40"
                />
                <Input
                  size="sm"
                  type="text"
                  value={bm.url}
                  onChange={(e) => updateBasemap(bm.id, { url: e.target.value })}
                  placeholder="https://.../{z}/{x}/{y}.png"
                  className="flex-1 text-[11px] font-mono text-neutral-700"
                />
                <Input
                  size="sm"
                  type="number"
                  min={0}
                  max={24}
                  value={bm.maxNativeZoom ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateBasemap(bm.id, { maxNativeZoom: v === '' ? undefined : Number(v) });
                  }}
                  placeholder={t('basemaps.maxZoomPlaceholder')}
                  title={t('basemaps.maxZoomTitle')}
                  className="!w-20"
                />
                <button
                  type="button"
                  onClick={() => removeBasemap(bm.id)}
                  className="text-neutral-400 hover:text-red-600 transition-colors cursor-pointer p-1 shrink-0"
                  aria-label={t('basemaps.remove')}
                  title={t('basemaps.remove')}
                >
                  <IconTrash className="w-3.5 h-3.5" />
                </button>
              </div>
              {bm.url.includes('{api_key}') && (
                <div className="mt-2 max-w-sm">
                  <ApiKeyField
                    projectId={controller.projectId}
                    configured={bm.hasApiKey}
                    organizationApiKeyId={bm.organizationApiKeyId}
                    apiKey={bm.apiKey}
                    onChange={(choice) => updateBasemap(bm.id, choice)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
