import { useState } from 'react';
import type { CampaignCreate, ImageryCreate } from '~/api/client';
import { emptyImagery, IMAGERY_PRESETS } from '~/features/campaigns/utils/imageryPresets';
import { ImageryEditor } from '../../ImageryEditor';


export const StepImagery = ({
  form,
  setForm,
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
}) => {
  const [selectedPreset, setSelectedPreset] = useState<string>('custom');
  const items = form.imagery_configs ?? [];

  const setItems = (next: ImageryCreate[]) => {
    setForm({
      ...form,
      imagery_configs: next.length > 0 ? next : null,
    });
  };

  const updateItem = (index: number, updates: Partial<ImageryCreate>) => {
    const next = [...items];
    next[index] = { ...next[index], ...updates };
    setItems(next);
  };

  const addItem = () => {
    const preset = IMAGERY_PRESETS.find((p) => p.id === selectedPreset);
    const newItem: ImageryCreate = preset
      ? { ...preset.template, start_ym: '', end_ym: '' }
      : emptyImagery();

    setItems([...items, newItem]);
    setSelectedPreset('custom'); // Reset to custom after adding
  };

  const removeItem = (index: number) => {
    const next = items.filter((_, i) => i !== index);
    setItems(next);
  };

  return (
    <div className="space-y-6">
      {items.map((i, index) => (
        <ImageryEditor
          key={index}
          value={i}
          onChange={(updates) => updateItem(index, updates)}
          onRemove={() => removeItem(index)}
        />
      ))}

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <select
            value={selectedPreset}
            onChange={(e) => setSelectedPreset(e.target.value)}
            className="flex-1 border border-neutral-300 rounded-md px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          >
            <option value="custom">Custom Configuration</option>
            {IMAGERY_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addItem}
            className="rounded-md border text-neutral-700 border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 cursor-pointer whitespace-nowrap"
          >
            + Add imagery
          </button>
        </div>

        {selectedPreset !== 'custom' && (
          <p className="text-xs text-neutral-600 italic">
            Preset "{IMAGERY_PRESETS.find((p) => p.id === selectedPreset)?.label}" will be added.
            You can customize it after adding.
          </p>
        )}
      </div>

      {items.length === 0 && (
        <p className="text-sm text-neutral-500">
          No imagery added yet. Select a preset or custom configuration and click "Add imagery".
        </p>
      )}
    </div>
  );
};
