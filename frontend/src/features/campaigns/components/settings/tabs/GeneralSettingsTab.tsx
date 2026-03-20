import React, { useState } from 'react';
import type { CampaignOut, CampaignSettingsCreate } from '~/api/client';
import { updateCampaignGuide, updateCampaignVisibility, updateEmbeddingYear } from '~/api/client';
import { BoundingBoxEditor } from '~/features/campaigns/components/BoundingBoxEditor';
import { LabelsEditor } from '~/features/campaigns/components/LabelsEditor';
import { useLayoutStore } from '~/features/layout/layout.store';

interface Props {
  campaign: CampaignOut;
  campaignName: string;
  setCampaignName: (s: string) => void;
  saving: boolean;
  onSaveName: () => Promise<void>;
  onSaveSettings: () => Promise<void>;
  onUpdateSettings: (updates: Partial<CampaignSettingsCreate>) => void;
  onOpenDelete: () => void;
  onCampaignUpdated?: (campaign: CampaignOut) => void;
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
  onCampaignUpdated,
}) => {
  const showAlert = useLayoutStore((s) => s.showAlert);
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);

  // Embedding year local state
  const currentYear = new Date().getFullYear();
  const [embeddingYear, setEmbeddingYear] = useState<number | null>(
    campaign.settings.embedding_year ?? null
  );
  const [savingEmbeddingYear, setSavingEmbeddingYear] = useState(false);

  const embeddingYearChanged = embeddingYear !== (campaign.settings.embedding_year ?? null);

  const [guideMarkdown, setGuideMarkdown] = useState(campaign.settings.guide_markdown ?? '');
  const [savingGuide, setSavingGuide] = useState(false);
  const guideChanged = guideMarkdown !== (campaign.settings.guide_markdown ?? '');

  const handleSaveGuide = async () => {
    if (!guideChanged) return;
    try {
      setSavingGuide(true);
      await updateCampaignGuide({
        path: { campaign_id: campaign.id },
        body: { guide_markdown: guideMarkdown || null },
      });
      if (onCampaignUpdated) {
        onCampaignUpdated({
          ...campaign,
          settings: { ...campaign.settings, guide_markdown: guideMarkdown || null },
        });
      }
      showAlert('Campaign guide updated', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update guide';
      showAlert(msg, 'error');
    } finally {
      setSavingGuide(false);
    }
  };

  const handleSaveEmbeddingYear = async () => {
    if (!embeddingYearChanged) return;

    // Warn the user if changing - this triggers a full recompute
    if (campaign.settings.embedding_year !== null && embeddingYear !== null) {
      const confirmed = await showConfirmDialog({
        title: 'Recompute Embeddings?',
        description: `Changing the embedding year from ${campaign.settings.embedding_year} to ${embeddingYear} will delete all existing embeddings and re-fetch them from the satellite imagery for ${embeddingYear}. This may take a while for large campaigns.`,
        confirmText: 'Recompute',
        cancelText: 'Cancel',
        isDangerous: true,
      });
      if (!confirmed) return;
    }

    try {
      setSavingEmbeddingYear(true);
      const { data } = await updateEmbeddingYear({
        path: { campaign_id: campaign.id },
        body: { embedding_year: embeddingYear },
      });

      if (data?.embeddings_recomputed) {
        const s = data.summary;
        showAlert(
          `Embeddings recomputed for ${embeddingYear}: ${s?.created ?? 0} created, ${s?.skipped ?? 0} skipped, ${s?.failed ?? 0} failed`,
          'success'
        );
      } else {
        showAlert('Embedding year updated', 'success');
      }

      // Propagate the updated embedding_year back to parent
      if (onCampaignUpdated) {
        onCampaignUpdated({
          ...campaign,
          settings: {
            ...campaign.settings,
            embedding_year: data?.embedding_year ?? null,
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update embedding year';
      showAlert(message, 'error');
    } finally {
      setSavingEmbeddingYear(false);
    }
  };
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
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">Campaign Guide</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Markdown document shown to annotators via the book icon in the annotation toolbar.
        </p>
        <textarea
          value={guideMarkdown}
          onChange={(e) => setGuideMarkdown(e.target.value)}
          disabled={savingGuide}
          rows={10}
          className="w-full border border-neutral-300 rounded px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-neutral-100 disabled:cursor-not-allowed resize-y"
          placeholder="# Campaign Guide&#10;&#10;Write instructions for annotators here using Markdown..."
        />
        <button
          onClick={handleSaveGuide}
          disabled={savingGuide || !guideChanged}
          className="mt-3 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
        >
          {savingGuide ? 'Saving…' : 'Save Guide'}
        </button>
      </div>

      <div className="bg-white rounded-lg border border-neutral-300 p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">Bounding Box</h2>
        <p className="text-sm text-neutral-500 mb-4">
          The geographic area where imagery can be loaded. All annotation tasks must fall within
          this region.
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
        <p className="text-sm text-neutral-500 mb-4">
          The class names annotators choose from when labeling. Labels cannot be changed after
          creation to preserve data consistency.
        </p>
        <LabelsEditor
          value={campaign.settings.labels}
          onChange={() => {}}
          readOnly={true}
          showGeometryType={campaign.mode === 'open'}
        />
      </div>

      {/* Embedding Year */}
      <div className="bg-white rounded-lg border border-neutral-300 p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">Satellite Embedding Year</h2>
        <p className="text-sm text-neutral-500 mb-4">
          The year from which satellite embeddings are sourced for KNN-based label validation.
          Changing this will recompute all embeddings for the campaign.
          {!campaign.settings.embedding_year && (
            <span className="block mt-1 text-orange-600 font-medium">
              No embedding year set - KNN-embeddings (AEF) based validation is currently unavailable for annotators.
            </span>
          )}
        </p>
        <div className="flex gap-4 items-end">
          <div className="w-48">
            <label className="block text-sm font-medium text-neutral-700 mb-2">Year</label>
            <select
              value={embeddingYear ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                setEmbeddingYear(val === '' ? null : parseInt(val, 10));
              }}
              disabled={savingEmbeddingYear}
              className="w-full border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-neutral-100 disabled:cursor-not-allowed"
            >
              <option value="">None (validation disabled)</option>
              {Array.from({ length: currentYear - 2016 }, (_, i) => currentYear - i).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleSaveEmbeddingYear}
            disabled={savingEmbeddingYear || !embeddingYearChanged}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {savingEmbeddingYear ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Recomputing…
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-red-300 p-6">
        <h2 className="text-lg font-semibold text-red-700 mb-2">Danger Zone</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-red-200">
            <div>
              <h3 className="text-sm font-medium text-neutral-900">Campaign Visibility</h3>
              <p className="text-sm text-neutral-500">
                {campaign.is_public
                  ? 'This campaign is public. Anyone can view and annotate it.'
                  : 'This campaign is private. Only members can access it.'}
              </p>
            </div>
            <button
              onClick={async () => {
                const newValue = !campaign.is_public;
                const confirmed = await showConfirmDialog({
                  title: newValue ? 'Make Campaign Public?' : 'Make Campaign Private?',
                  description: newValue
                    ? 'This will allow any user to view and add annotations to this campaign. They can only edit or delete their own annotations.'
                    : 'This will restrict access to campaign members only. Non-members will lose access immediately.',
                  confirmText: newValue ? 'Make Public' : 'Make Private',
                  cancelText: 'Cancel',
                  isDangerous: true,
                });
                if (!confirmed) return;
                try {
                  const { data } = await updateCampaignVisibility({
                    path: { campaign_id: campaign.id },
                    body: { is_public: newValue },
                  });
                  if (onCampaignUpdated && data) onCampaignUpdated(data);
                  showAlert(newValue ? 'Campaign is now public' : 'Campaign is now private', 'success');
                } catch (err) {
                  const msg = err instanceof Error ? err.message : 'Failed to update visibility';
                  showAlert(msg, 'error');
                }
              }}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                campaign.is_public
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'border border-red-600 text-red-600 hover:bg-red-50'
              }`}
            >
              {campaign.is_public ? 'Make Private' : 'Make Public'}
            </button>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <h3 className="text-sm font-medium text-neutral-900">Delete Campaign</h3>
              <p className="text-sm text-neutral-500">
                Once you delete a campaign, there is no going back.
              </p>
            </div>
            <button
              onClick={onOpenDelete}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Delete Campaign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GeneralSettingsTab;
