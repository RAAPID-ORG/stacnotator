import { useState, useEffect } from 'react';
import type { ImageryCreate, ImageryVisualizationUrlTemplateCreate } from '~/api/client';
import { yyyymmToInputMonth, inputMonthToYYYYMM } from '~/utils/utility';

interface ImageryEditorProps {
  value: ImageryCreate;
  onChange: (updates: Partial<ImageryCreate>) => void;
  onRemove?: () => void;
  onUpdate?: () => void;
  showUpdateButton?: boolean;
  isExisting?: boolean; // Whether this is an existing imagery (disables temporal fields)
}

export const ImageryEditor = ({
  value,
  onChange,
  onRemove,
  onUpdate,
  showUpdateButton = false,
  isExisting = false,
}: ImageryEditorProps) => {
  const [localValue, setLocalValue] = useState<ImageryCreate>(value);
  const [hasChanges, setHasChanges] = useState(false);

  // Reset local state when value prop changes from parent
  useEffect(() => {
    setLocalValue(value);
    setHasChanges(false);
  }, [value]);

  const update = <K extends keyof ImageryCreate>(key: K, val: ImageryCreate[K]) => {
    const newValue = { ...localValue, [key]: val };
    setLocalValue(newValue);
    setHasChanges(true);

    // If not showing update button, update immediately (for new imagery)
    if (!showUpdateButton) {
      onChange({ [key]: val } as Partial<ImageryCreate>);
    }
  };

  const handleUpdate = () => {
    if (hasChanges && onUpdate) {
      // Send the entire updated value since Partial types are complex with nested objects
      onChange(localValue);
      onUpdate();
      setHasChanges(false);
    }
  };

  const tileTemplates = localValue.visualization_url_templates ?? [];

  const updateTileTemplate = (
    index: number,
    updates: Partial<ImageryVisualizationUrlTemplateCreate>
  ) => {
    const updated = [...tileTemplates];
    updated[index] = { ...updated[index], ...updates };
    update('visualization_url_templates', updated);
  };

  const addTileTemplate = () => {
    update('visualization_url_templates', [...tileTemplates, { name: '', visualization_url: '' }]);
  };

  const removeTileTemplate = (index: number) => {
    const updated = tileTemplates.filter((_, i) => i !== index);
    update('visualization_url_templates', updated);
  };

  return (
    <div className="rounded-lg border border-neutral-300 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-neutral-900">{localValue.name || 'Imagery Config'}</h4>
        <div className="flex items-center gap-2">
          {showUpdateButton && hasChanges && (
            <button
              type="button"
              onClick={handleUpdate}
              className="text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors cursor-pointer"
            >
              Update
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-sm text-red-500 hover:text-red-700 transition-colors cursor-pointer"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <input
        placeholder="Imagery name"
        value={localValue.name}
        onChange={(e) => update('name', e.target.value)}
        className="w-full border-brand-500 border-b focus:border-b focus:border-b-2 outline-none focus:ring-0"
      />

      {isExisting && (
        <p className="text-xs text-neutral-500 italic">
          Note: Temporal settings (dates, windows, slicing) cannot be changed after creation.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-neutral-700">Start Month</label>
          <input
            type="month"
            value={yyyymmToInputMonth(localValue.start_ym)}
            onChange={(e) => update('start_ym', inputMonthToYYYYMM(e.target.value))}
            disabled={isExisting}
            className="w-full border-brand-500 border-b focus:border-b focus:border-b-2 outline-none focus:ring-0 disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-neutral-700">End Month</label>
          <input
            type="month"
            value={yyyymmToInputMonth(localValue.end_ym)}
            onChange={(e) => update('end_ym', inputMonthToYYYYMM(e.target.value))}
            disabled={isExisting}
            className="w-full border-brand-500 border-b focus:border-b focus:border-b-2 outline-none focus:ring-0 disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-neutral-700">Window Interval</label>
          <input
            type="number"
            min="1"
            value={localValue.window_interval ?? ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : undefined;
              update('window_interval', val);
              // Ensure window_unit has a default value if interval is set
              if (val && !localValue.window_unit) {
                update('window_unit', 'months');
              }
            }}
            disabled={isExisting}
            placeholder="Not set"
            className="w-full border-brand-500 border-b focus:border-b focus:border-b-2 outline-none focus:ring-0 disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-neutral-700">Window Unit</label>
          <select
            value={localValue.window_unit ?? ''}
            onChange={(e) => {
              const val = e.target.value as 'weeks' | 'months' | '';
              update('window_unit', val || undefined);
              // Ensure window_interval has a value if unit is set
              if (val && !localValue.window_interval) {
                update('window_interval', 1);
              }
            }}
            disabled={isExisting}
            className="w-full border-brand-500 border-b focus:border-b focus:border-b-2 outline-none focus:ring-0 disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed"
          >
            <option value="">Not set</option>
            <option value="weeks">Weeks</option>
            <option value="months">Months</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-neutral-700">Slicing Interval</label>
          <input
            type="number"
            min="1"
            value={localValue.slicing_interval ?? ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : undefined;
              update('slicing_interval', val);
              // Ensure slicing_unit has a default value if interval is set
              if (val && !localValue.slicing_unit) {
                update('slicing_unit', 'months');
              }
            }}
            disabled={isExisting}
            placeholder="Not set"
            className="w-full border-brand-500 border-b focus:border-b focus:border-b-2 outline-none focus:ring-0 disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-neutral-700">Slicing Unit</label>
          <select
            value={localValue.slicing_unit ?? ''}
            onChange={(e) => {
              const val = e.target.value as 'weeks' | 'months' | '';
              update('slicing_unit', val || undefined);
              // Ensure slicing_interval has a value if unit is set
              if (val && !localValue.slicing_interval) {
                update('slicing_interval', 1);
              }
            }}
            disabled={isExisting}
            className="w-full border-brand-500 border-b focus:border-b focus:border-b-2 outline-none focus:ring-0 disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed"
          >
            <option value="">Not set</option>
            <option value="weeks">Weeks</option>
            <option value="months">Months</option>
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-neutral-700">Registration URL</label>
        <input
          type="url"
          placeholder="https://example.com/register"
          value={localValue.registration_url}
          onChange={(e) => update('registration_url', e.target.value)}
          className="w-full border-brand-500 border-b focus:border-b focus:border-b-2 outline-none focus:ring-0"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-neutral-700">Search Body (JSON)</label>
        <p className="text-xs text-neutral-500 italic">
          Tip: Use <code className="bg-neutral-100 px-1 rounded">{'{startDatetimePlaceholder}'}</code> and{' '}
          <code className="bg-neutral-100 px-1 rounded">{'{endDatetimePlaceholder}'}</code> for temporal
          windowing based on your parameters above. See templates above for examples.
        </p>
        <textarea
          placeholder='{"search_query": "..."}'
          value={localValue.search_body}
          onChange={(e) => update('search_body', e.target.value)}
          rows={6}
          className="w-full border border-brand-500 rounded p-2 focus:border-brand-600 focus:ring-1 focus:ring-brand-500 outline-none font-mono text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-neutral-700">Crosshair Color</label>
          <div className="relative">
            <input
              type="color"
              value={`#${localValue.crosshair_hex6 ?? 'ff0000'}`}
              onChange={(e) => update('crosshair_hex6', e.target.value.replace('#', ''))}
              className="absolute opacity-0 w-6 h-6 cursor-pointer"
              id={`crosshair-color-${localValue.name}`}
            />
            <label
              htmlFor={`crosshair-color-${localValue.name}`}
              className="w-6 h-6 rounded-full border-2 border-neutral-300 cursor-pointer block"
              style={{ backgroundColor: `#${localValue.crosshair_hex6 ?? 'ff0000'}` }}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-neutral-700">Default Zoom</label>
          <input
            type="number"
            value={localValue.default_zoom ?? 10}
            onChange={(e) => update('default_zoom', Number(e.target.value))}
            className="w-full border-brand-500 border-b focus:border-b focus:border-b-2 outline-none focus:ring-0"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-neutral-700 font-medium">Tile Templates</label>
          <button
            type="button"
            onClick={addTileTemplate}
            className="text-xs text-brand-700 transition-colors cursor-pointer"
          >
            + Add Template
          </button>
        </div>
        <div className="space-y-3">
          {tileTemplates.map((template, index) => (
            <div key={index} className="flex gap-2 items-start">
              <div className="flex-1 space-y-1">
                <input
                  type="text"
                  placeholder="e.g., NDVI Composite"
                  value={template.name}
                  onChange={(e) => updateTileTemplate(index, { name: e.target.value })}
                  className="w-full border border-brand-500 rounded p-2 text-xs focus:border-brand-600 focus:ring-1 focus:ring-brand-500 outline-none"
                />
                <input
                  type="text"
                  placeholder="https://tiles.example.com/{search_id}/{z}/{x}/{y}.png?param=value"
                  value={template.visualization_url}
                  onChange={(e) => updateTileTemplate(index, { visualization_url: e.target.value })}
                  className="w-full border border-brand-500 rounded p-2 focus:border-brand-600 focus:ring-1 focus:ring-brand-500 outline-none font-mono text-xs"
                />
              </div>
              <button
                type="button"
                onClick={() => removeTileTemplate(index)}
                className="text-red-500 hover:text-red-700 transition-colors text-xs mt-0.5 cursor-pointer"
              >
                Remove
              </button>
            </div>
          ))}
          {tileTemplates.length === 0 && (
            <p className="text-xs text-neutral-500 italic">
              No tile templates yet. Add one to define imagery visualization options.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
