import { IconTrash } from '~/shared/ui/Icons';
import type { Basemap } from './types';
import { emptyBasemap } from './types';
import type { ImageryController } from './controller';

interface BasemapListProps {
  controller: ImageryController;
}

const inputClass =
  'h-8 px-2.5 border border-neutral-300 rounded-md bg-white focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 transition-colors disabled:bg-neutral-50 disabled:text-neutral-500';

export const BasemapList = ({ controller }: BasemapListProps) => {
  const basemaps = controller.state.basemaps;
  const readOnly = !controller.capabilities.canEditBasemaps;

  const update = (next: Basemap[]) => void controller.setBasemaps(next);
  const addBasemap = () => update([...basemaps, emptyBasemap()]);
  const removeBasemap = (id: string) => update(basemaps.filter((b) => b.id !== id));
  const updateBasemap = (id: string, patch: Partial<Basemap>) =>
    update(basemaps.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Basemaps</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Background reference layers shown beneath imagery in every view.
            {readOnly && (
              <span className="block text-amber-600 mt-0.5">
                Basemap editing on an existing campaign is not yet supported.
              </span>
            )}
          </p>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={addBasemap}
            className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
          >
            + Add basemap
          </button>
        )}
      </div>

      {basemaps.length === 0 ? (
        <p className="text-xs text-neutral-400 italic">No basemaps configured.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
          {basemaps.map((bm) => (
            <li key={bm.id} className="flex items-center gap-3 py-2">
              <input
                type="text"
                value={bm.name}
                disabled={readOnly}
                onChange={(e) => updateBasemap(bm.id, { name: e.target.value })}
                placeholder="Name"
                className={`${inputClass} w-40 text-xs`}
              />
              <input
                type="text"
                value={bm.url}
                disabled={readOnly}
                onChange={(e) => updateBasemap(bm.id, { url: e.target.value })}
                placeholder="https://.../{z}/{x}/{y}.png"
                className={`${inputClass} flex-1 text-[11px] font-mono text-neutral-700`}
              />
              <input
                type="number"
                min={0}
                max={24}
                value={bm.maxNativeZoom ?? ''}
                disabled={readOnly}
                onChange={(e) => {
                  const v = e.target.value;
                  updateBasemap(bm.id, { maxNativeZoom: v === '' ? undefined : Number(v) });
                }}
                placeholder="Max z"
                title="Deepest zoom the provider serves. Past this, the deepest tile is upscaled instead of fetched. Leave empty for unlimited."
                className={`${inputClass} w-20 text-xs`}
              />
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => removeBasemap(bm.id)}
                  className="text-neutral-400 hover:text-red-600 transition-colors cursor-pointer p-1 shrink-0"
                  aria-label="Remove basemap"
                  title="Remove basemap"
                >
                  <IconTrash className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
