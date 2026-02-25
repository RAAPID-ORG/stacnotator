import React from 'react';
import type { CampaignOut, CampaignSettingsCreate } from '~/api/client';
import { BoundingBoxEditor } from '~/features/campaigns/components/BoundingBoxEditor';
import { LabelsEditor } from '~/features/campaigns/components/LabelsEditor';

interface Props {
  campaign: CampaignOut;
  campaignName: string;
  setCampaignName: (s: string) => void;
  saving: boolean;
  onSaveName: () => Promise<void>;
  onSaveSettings: () => Promise<void>;
  onUpdateSettings: (updates: Partial<CampaignSettingsCreate>) => void;
  onOpenDelete: () => void;
}

export const GeneralSettingsTab: React.FC<Props> = ({
  campaign,
  campaignName,
  setCampaignName,
  saving,
  onSaveName,
  onSaveSettings,
  onUpdateSettings,
  onOpenDelete,
}) => {
  return (
    <div id="tab-general" role="tabpanel" className="space-y-3">
      <div className="bg-white rounded-lg border border-neutral-300 p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-">Campaign Name</h2>
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-neutral-700 mb-2">Name</label>
            <input
              type="text"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              disabled={saving}
              className="w-full border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-neutral-100 disabled:cursor-not-allowed"
            />
          </div>
          <button
            onClick={onSaveName}
            disabled={saving || campaignName === campaign.name}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            Save
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-neutral-300 p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">Bounding Box</h2>
        <p className="text-sm text-neutral-500 mb-4">
          The geographic area where imagery can be loaded. All annotation tasks must fall within this region.
        </p>
        <BoundingBoxEditor
          value={{
            bbox_west: campaign.settings.bbox_west,
            bbox_south: campaign.settings.bbox_south,
            bbox_east: campaign.settings.bbox_east,
            bbox_north: campaign.settings.bbox_north,
          }}
          onChange={(updates) => onUpdateSettings(updates)}
        />
        <button
          onClick={onSaveSettings}
          disabled={saving}
          className="mt-4 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-200 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          Save Settings
        </button>
      </div>

      <div className="bg-white rounded-lg border border-neutral-300 p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">Annotation Labels</h2>
        <p className="text-sm text-neutral-500 mb-4">The class names annotators choose from when labeling. Labels cannot be changed after creation to preserve data consistency.</p>
        <LabelsEditor
          value={campaign.settings.labels}
          onChange={() => {}}
          readOnly={true}
          showGeometryType={campaign.mode === 'open'}
        />
      </div>

      <div className="bg-white rounded-lg border border-red-300 p-6">
        <h2 className="text-lg font-semibold text-red-700 mb-2">Danger Zone</h2>
        <p className="text-sm text-neutral-600 mb-4">Once you delete a campaign, there is no going back. Please be certain.</p>
        <button onClick={onOpenDelete} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">Delete This Campaign</button>
      </div>
    </div>
  );
};

export default GeneralSettingsTab;
