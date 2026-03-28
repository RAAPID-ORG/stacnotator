/**
 * @deprecated This component uses legacy imagery types (ImageryCreate) that no longer exist
 * in the API. The new creation flow uses the step-by-step imagery editor (StepImagery).
 * The settings page now displays imagery sources in a read-only format via ImageryTab.
 * Retained for reference only.
 */
import { useState, useEffect } from 'react';
import { inputMonthToYYYYMM, yyyymmToInputMonth } from '~/shared/utils/utility';
import { MonthPicker } from '~/features/campaigns/components/creation/steps/imagery/MonthPicker';

// Legacy type placeholders - removed from the API client.
type ImageryVisualizationUrlTemplateCreate = { name: string; visualization_url: string };
type ImageryCreate = {
  name: string;
  start_ym: string;
  end_ym: string;
  crosshair_hex6: string;
  default_zoom: number;
  window_interval?: number;
  window_unit?: string;
  slicing_interval?: number;
  slicing_unit?: string;
  registration_url: string;
  search_body: string;
  visualization_url_templates: ImageryVisualizationUrlTemplateCreate[];
};

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

  const renderTooltip = (description: string) => (
    <span className="relative group cursor-help">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-3 h-3 text-neutral-400 group-hover:text-neutral-600 transition-colors"
      >
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.94 6.94a.75.75 0 1 1-1.061-1.061 3 3 0 1 1 2.871 5.026v.345a.75.75 0 0 1-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 1 0 8.94 6.94ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
          clipRule="evenodd"
        />
      </svg>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-64 px-2.5 py-2 bg-neutral-800 text-white text-[11px] leading-relaxed rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 pointer-events-none z-50">
        {description}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-800"></div>
      </div>
    </span>
  );

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

      <div className="space-y-1">
        <label className="text-xs text-neutral-700 flex items-center gap-1">
          Imagery Name
          {renderTooltip('Display name shown to annotators in the imagery selector.')}
        </label>
        <input
          placeholder="Imagery name"
          value={localValue.name}
          onChange={(e) => update('name', e.target.value)}
          className="w-full border-brand-500 border-b focus:border-b focus:border-b-2 outline-none focus:ring-0"
        />
      </div>

      {isExisting && (
        <p className="text-xs text-neutral-500 italic">
          Note: Temporal settings (dates, windows, slicing) cannot be changed after creation.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 flex items-center gap-1">
            Start Month
            {renderTooltip('Start of the imagery availability window (YYYY-MM).')}
          </label>
          <MonthPicker
            value={yyyymmToInputMonth(localValue.start_ym)}
            onChange={(v) => update('start_ym', inputMonthToYYYYMM(v))}
            disabled={isExisting}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 flex items-center gap-1">
            End Month
            {renderTooltip('End of the imagery availability window (YYYY-MM).')}
          </label>
          <MonthPicker
            value={yyyymmToInputMonth(localValue.end_ym)}
            onChange={(v) => update('end_ym', inputMonthToYYYYMM(v))}
            disabled={isExisting}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 flex items-center gap-1">
            Window Interval
            {renderTooltip(
              'Length of each imagery window (map-layer with time range) used in the timeline. Pair with Window Unit.'
            )}
          </label>
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
          <label className="text-xs text-neutral-700 flex items-center gap-1">
            Window Unit
            {renderTooltip('Time unit for the window interval (weeks or months).')}
          </label>
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
          <label className="text-xs text-neutral-700 flex items-center gap-1">
            Slicing Interval
            {renderTooltip('Optional sub-intervals inside each window for finer time steps.')}
          </label>
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
          <label className="text-xs text-neutral-700 flex items-center gap-1">
            Slicing Unit
            {renderTooltip('Time unit for slicing interval (weeks or months).')}
          </label>
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
        <label className="text-xs text-neutral-700 flex items-center gap-1">
          Registration URL
          {renderTooltip(
            'STAC registration endpoint used to create a searchId for this imagery source.'
          )}
        </label>
        <input
          type="url"
          placeholder="https://example.com/register"
          value={localValue.registration_url}
          onChange={(e) => update('registration_url', e.target.value)}
          className="w-full border-brand-500 border-b focus:border-b focus:border-b-2 outline-none focus:ring-0"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-neutral-700 flex items-center gap-1">
          Search Body (JSON)
          {renderTooltip(
            'JSON payload posted to the registration URL. Use date placeholders to inject intervals derived from the window/slicing range.'
          )}
        </label>
        <p className="text-xs text-neutral-500 italic">
          Tip: Use{' '}
          <code className="bg-neutral-100 px-1 rounded">{'{startDatetimePlaceholder}'}</code> and{' '}
          <code className="bg-neutral-100 px-1 rounded">{'{endDatetimePlaceholder}'}</code> for
          temporal windowing based on your parameters above. See templates above for examples.
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
          <label className="text-xs text-neutral-700 flex items-center gap-1">
            Crosshair Color
            {renderTooltip('Color of the crosshair marker used for point annotations.')}
          </label>
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
          <label className="text-xs text-neutral-700 flex items-center gap-1">
            Default Zoom
            {renderTooltip('Initial zoom level shown when the imagery loads.')}
          </label>
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
          <div className="flex items-center gap-1 text-xs text-neutral-700 font-medium">
            <span>Tile Templates</span>
            {renderTooltip(
              'Named tile URL templates. {searchId} will be replaced using the registration response.'
            )}
          </div>
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
                <label className="text-[11px] text-neutral-600 flex items-center gap-1">
                  Template Name
                  {renderTooltip('Short label shown to annotators in the layer list.')}
                </label>
                <input
                  type="text"
                  placeholder="e.g., NDVI Composite"
                  value={template.name}
                  onChange={(e) => updateTileTemplate(index, { name: e.target.value })}
                  className="w-full border border-brand-500 rounded p-2 text-xs focus:border-brand-600 focus:ring-1 focus:ring-brand-500 outline-none"
                />
                <label className="text-[11px] text-neutral-600 flex items-center gap-1">
                  Visualization URL
                  {renderTooltip('Tile URL template. Supports {searchId}, {z}, {x}, {y}.')}
                </label>
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
