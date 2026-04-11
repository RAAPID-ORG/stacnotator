import type { Basemap } from './types';
import { emptyBasemap } from './types';
import { IconTrash } from '~/shared/ui/Icons';
import { Tooltip } from './Tooltip';

interface BasemapEditorProps {
  basemaps: Basemap[];
  onChange: (basemaps: Basemap[]) => void;
}

export const BasemapEditor = ({ basemaps, onChange }: BasemapEditorProps) => {
  const addBasemap = () => {
    onChange([...basemaps, emptyBasemap()]);
  };

  const updateBasemap = (id: string, updates: Partial<Basemap>) => {
    onChange(basemaps.map((b) => (b.id === id ? { ...b, ...updates } : b)));
  };

  const removeBasemap = (id: string) => {
    onChange(basemaps.filter((b) => b.id !== id));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-neutral-900 flex items-center gap-1">
            Basemaps
            <Tooltip text="Static reference layers (e.g. OpenStreetMap, satellite basemaps) not tied to the timeline. Shown as background layers in every view." />
          </h4>
          <p className="text-xs text-neutral-500 mt-0.5">
            Optional XYZ tile layers used as background reference.
          </p>
        </div>
        <button
          type="button"
          onClick={addBasemap}
          className="rounded-md border text-neutral-700 border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 cursor-pointer"
        >
          + Add Basemap
        </button>
      </div>

      {basemaps.length === 0 && (
        <p className="text-xs text-neutral-400 italic">No basemaps configured.</p>
      )}

      {basemaps.map((basemap) => (
        <div
          key={basemap.id}
          className="flex gap-2 items-start p-2 rounded border border-neutral-200 bg-white"
        >
          <div className="flex-1 space-y-2">
            <input
              type="text"
              placeholder="Basemap name (e.g. OSM, Satellite)"
              value={basemap.name}
              onChange={(e) => updateBasemap(basemap.id, { name: e.target.value })}
              className="w-full border border-neutral-300 rounded-md px-2.5 py-1.5 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 outline-none transition-colors text-sm"
            />
            <input
              type="text"
              placeholder="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              value={basemap.url}
              onChange={(e) => updateBasemap(basemap.id, { url: e.target.value })}
              className="w-full border border-neutral-300 rounded-md px-2.5 py-1.5 text-xs font-mono focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 outline-none transition-colors"
            />
          </div>
          <button
            type="button"
            onClick={() => removeBasemap(basemap.id)}
            className="text-red-400 hover:text-red-600 transition-colors cursor-pointer p-1"
          >
            <IconTrash className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
