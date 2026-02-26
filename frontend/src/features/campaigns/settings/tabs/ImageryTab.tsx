import React from 'react';
import type { ImageryCreate, ImageryOut } from '~/api/client';
import { ImageryEditor } from '~/features/campaigns/components/ImageryEditor';
import { IMAGERY_PRESETS } from '~/features/campaigns/utils/imageryPresets';

interface Props {
  newImagery: ImageryCreate[];
  setNewImagery: (items: ImageryCreate[]) => void;
  selectedPreset: string;
  setSelectedPreset: (s: string) => void;
  imagery: ImageryOut[];
  handleAddImagery: () => Promise<void>;
  handleUpdateImagery: (imageryId: number, updates: Partial<ImageryCreate>) => Promise<void>;
  setDeleteConfirm: (v: { imageryId?: number } | null) => void;
  saving: boolean;
}

export const ImageryTab: React.FC<Props> = ({
  newImagery,
  setNewImagery,
  selectedPreset,
  setSelectedPreset,
  imagery,
  handleAddImagery,
  handleUpdateImagery,
  setDeleteConfirm,
  saving,
}) => {
  return (
    <div id="tab-imagery" role="tabpanel" className="space-y-3">
      <div className="bg-white rounded-lg border border-neutral-300 p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">Add Imagery Sources</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Imagery sources are the satellite or map layers displayed during annotation. Each source
          defines a tile service with a time range and visualisation settings. Use a preset for
          common providers or configure a custom STAC-based source.
        </p>
        <div className="space-y-4">
          {newImagery.map((img, index) => (
            <div key={index} className="p-4">
              <ImageryEditor
                value={img}
                onChange={(updates) => {
                  const updated = newImagery.map((i, idx) =>
                    idx === index ? { ...i, ...updates } : i
                  );
                  setNewImagery(updated);
                }}
                onRemove={() => setNewImagery(newImagery.filter((_, idx) => idx !== index))}
              />
            </div>
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
                onClick={() => {
                  const preset = IMAGERY_PRESETS.find((p) => p.id === selectedPreset);
                  const newItem: ImageryCreate = preset
                    ? { ...preset.template, start_ym: '', end_ym: '' }
                    : ({
                        name: '',
                        start_ym: '',
                        end_ym: '',
                        crosshair_hex6: 'ff0000',
                        default_zoom: 10,
                        window_interval: undefined,
                        window_unit: undefined,
                        registration_url: '',
                        search_body: '',
                        visualization_url_templates: [],
                      } as ImageryCreate);

                  setNewImagery([...newImagery, newItem]);
                  setSelectedPreset('custom');
                }}
                className="px-4 py-2 border border-neutral-300 rounded-lg hover:bg-neutral-100 transition-colors text-neutral-700 whitespace-nowrap"
              >
                + Add
              </button>
            </div>

            {selectedPreset !== 'custom' && (
              <p className="text-xs text-neutral-600 italic">
                Preset "{IMAGERY_PRESETS.find((p) => p.id === selectedPreset)?.label}" will be
                added. You can customize it after adding.
              </p>
            )}
          </div>
        </div>
        {newImagery.length > 0 && (
          <button
            onClick={handleAddImagery}
            disabled={saving}
            className="mt-4 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-200 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            Add {newImagery.length} Imagery Source(s)
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg border border-neutral-300 p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-4">
          Existing Imagery Sources ({imagery.length})
        </h2>
        <div className="space-y-4">
          {imagery.length === 0 ? (
            <p className="text-sm text-neutral-500">No imagery sources added yet</p>
          ) : (
            imagery.map((img) => (
              <ImageryEditor
                key={img.id}
                value={{
                  ...img,
                  search_body:
                    typeof img.search_body === 'string'
                      ? img.search_body
                      : JSON.stringify(img.search_body),
                }}
                onChange={(updates) => handleUpdateImagery(img.id, updates)}
                onUpdate={() => {}}
                onRemove={() => setDeleteConfirm({ imageryId: img.id })}
                showUpdateButton={true}
                isExisting={true}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageryTab;
