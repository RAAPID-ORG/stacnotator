import { IconTrash } from '~/shared/ui/Icons';
import { Tooltip } from '~/shared/ui/Tooltip';
import { Input } from '~/shared/ui/forms';
import type { Basemap } from './types';
import { emptyBasemap } from './types';
import type { ImageryController } from './controller';
import { ApiKeyField } from './ApiKeyField';
import { isRealId } from './draftSync';
import { setBasemapApiKey } from '~/api/client';

interface BasemapListProps {
  controller: ImageryController;
}

export const BasemapList = ({ controller }: BasemapListProps) => {
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
          <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-1">
            Basemaps
            <Tooltip text="If a provider requires an API key, put {api_key} in the URL where the value goes - e.g. https://tiles.planet.com/basemaps/v1/planet-tiles/global_monthly_2024_01_mosaic/gmap/{z}/{x}/{y}.png?api_key={api_key}. Save the basemap, then enter the key below - it is stored encrypted on the server and attached when tiles are fetched through the backend (never exposed to annotators)." />
          </h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Background reference layers shown beneath imagery in every view. Use{' '}
            <code className="font-mono bg-neutral-100 px-0.5 rounded">{'{api_key}'}</code> in the
            URL for providers that require authentication.
          </p>
        </div>
        <button
          type="button"
          onClick={addBasemap}
          className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
        >
          + Add basemap
        </button>
      </div>

      {basemaps.length === 0 ? (
        <p className="text-xs text-neutral-400 italic">No basemaps configured.</p>
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
                  placeholder="Name"
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
                  placeholder="Max z"
                  title="Deepest zoom the provider serves. Past this, the deepest tile is upscaled instead of fetched. Leave empty for unlimited."
                  className="!w-20"
                />
                <button
                  type="button"
                  onClick={() => removeBasemap(bm.id)}
                  className="text-neutral-400 hover:text-red-600 transition-colors cursor-pointer p-1 shrink-0"
                  aria-label="Remove basemap"
                  title="Remove basemap"
                >
                  <IconTrash className="w-3.5 h-3.5" />
                </button>
              </div>
              {bm.url.includes('{api_key}') && (
                <ApiKeyField
                  persisted={controller.campaignId != null && isRealId(bm.id)}
                  hasApiKey={bm.hasApiKey}
                  onSave={async (value) => {
                    if (controller.campaignId == null) return false;
                    const { error } = await setBasemapApiKey({
                      path: { campaign_id: controller.campaignId, basemap_id: Number(bm.id) },
                      body: { value },
                    });
                    return !error;
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
