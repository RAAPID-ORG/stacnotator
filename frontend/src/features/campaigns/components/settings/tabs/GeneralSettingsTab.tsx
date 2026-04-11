import React, { useState } from 'react';
import type { CampaignOut, CampaignSettingsCreate } from '~/api/client';
import {
  updateCampaignGuide,
  updateCampaignVisibility,
  updateEmbeddingYear,
  updateSampleExtent,
} from '~/api/client';
import { BoundingBoxEditor } from '~/features/campaigns/components/BoundingBoxEditor';
import { LabelsEditor } from '~/features/campaigns/components/LabelsEditor';
import { useLayoutStore } from '~/features/layout/layout.store';
import { Button, Field, Input, Select, Textarea } from '~/shared/ui/forms';

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

  // Sample extent local state
  const [sampleExtent, setSampleExtent] = useState<string>(
    campaign.settings.sample_extent_meters != null
      ? String(campaign.settings.sample_extent_meters)
      : ''
  );
  const [savingExtent, setSavingExtent] = useState(false);
  const parsedExtent = sampleExtent.trim() === '' ? null : Number(sampleExtent);
  const extentValid = parsedExtent === null || (Number.isFinite(parsedExtent) && parsedExtent > 0);
  const extentChanged = parsedExtent !== (campaign.settings.sample_extent_meters ?? null);
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

  const handleSaveExtent = async () => {
    if (!extentChanged || !extentValid) return;
    try {
      setSavingExtent(true);
      await updateSampleExtent({
        path: { campaign_id: campaign.id },
        body: { sample_extent_meters: parsedExtent },
      });
      if (onCampaignUpdated) {
        onCampaignUpdated({
          ...campaign,
          settings: { ...campaign.settings, sample_extent_meters: parsedExtent },
        });
      }
      showAlert('Sample extent updated', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update sample extent';
      showAlert(msg, 'error');
    } finally {
      setSavingExtent(false);
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
  // Each section is just spacing + a top hairline. The parent
  // CampaignSettingsPage already provides the white surface; nothing here
  // adds another card.
  const sectionCls =
    'space-y-3 pt-6 mt-6 first:mt-0 first:pt-0 border-t border-neutral-100 first:border-t-0';

  return (
    <div id="tab-general" role="tabpanel">
      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">Campaign name</h2>
          <p className="section-description">The display name shown across the app.</p>
        </div>
        <div className="flex gap-3 items-end">
          <div className="flex-1 max-w-md">
            <Input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              disabled={saving}
            />
          </div>
          <Button onClick={onSaveName} disabled={saving || campaignName === campaign.name}>
            Save
          </Button>
        </div>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">Campaign guide</h2>
          <p className="section-description">
            Markdown document shown to annotators via the book icon in the annotation toolbar.
          </p>
        </div>
        <Textarea
          value={guideMarkdown}
          onChange={(e) => setGuideMarkdown(e.target.value)}
          disabled={savingGuide}
          rows={10}
          className="font-mono"
          placeholder="# Campaign Guide&#10;&#10;Write instructions for annotators here using Markdown..."
        />
        <Button onClick={handleSaveGuide} disabled={savingGuide || !guideChanged}>
          {savingGuide ? 'Saving…' : 'Save guide'}
        </Button>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">Bounding box</h2>
          <p className="section-description">
            The geographic area where imagery can be loaded. All annotation tasks must fall within
            this region.
          </p>
        </div>
        <BoundingBoxEditor
          value={{
            bbox_west: campaign.settings.bbox_west,
            bbox_south: campaign.settings.bbox_south,
            bbox_east: campaign.settings.bbox_east,
            bbox_north: campaign.settings.bbox_north,
          }}
          onChange={(updates) => onUpdateSettings(updates)}
        />
        <Button onClick={onSaveSettings} disabled={saving}>
          Save settings
        </Button>
      </section>

      {/* Sample Extent - task mode only */}
      {campaign.mode === 'tasks' && (
        <section className={sectionCls}>
          <div>
            <h2 className="section-heading">Sample extent</h2>
            <p className="section-description">
              Size of the area around each task centroid that should be annotated. This is shown as
              a rectangle on the map during annotation. Leave empty if tasks were uploaded as
              polygons or if no extent overlay is needed.
            </p>
          </div>
          <div className="flex gap-3 items-end">
            <Field
              label="Extent (meters)"
              error={!extentValid ? 'Must be a positive number' : undefined}
              className="w-56"
            >
              <Input
                type="number"
                min="1"
                step="1"
                value={sampleExtent}
                onChange={(e) => setSampleExtent(e.target.value)}
                disabled={savingExtent}
                placeholder="e.g. 100"
                invalid={!extentValid}
              />
            </Field>
            <Button
              onClick={handleSaveExtent}
              disabled={savingExtent || !extentChanged || !extentValid}
            >
              {savingExtent ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </section>
      )}

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">Annotation labels</h2>
          <p className="section-description">
            The class names annotators choose from when labeling. Labels cannot be changed after
            creation to preserve data consistency.
          </p>
        </div>
        <LabelsEditor
          value={campaign.settings.labels}
          onChange={() => {}}
          readOnly={true}
          showGeometryType={campaign.mode === 'open'}
        />
      </section>

      {/* Embedding Year */}
      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">Satellite embedding year</h2>
          <p className="section-description">
            The year from which satellite embeddings are sourced for KNN-based label validation.
            Changing this will recompute all embeddings for the campaign.
            {!campaign.settings.embedding_year && (
              <span className="block mt-1 text-amber-700 font-medium">
                No embedding year set - KNN-embeddings (AEF) based validation is currently
                unavailable for annotators.
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-3 items-end">
          <Field label="Year" className="w-48">
            <Select
              value={embeddingYear ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                setEmbeddingYear(val === '' ? null : parseInt(val, 10));
              }}
              disabled={savingEmbeddingYear}
            >
              <option value="">None (validation disabled)</option>
              {Array.from({ length: currentYear - 2016 }, (_, i) => currentYear - i).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            onClick={handleSaveEmbeddingYear}
            disabled={savingEmbeddingYear || !embeddingYearChanged}
            leading={
              savingEmbeddingYear ? (
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
              ) : undefined
            }
          >
            {savingEmbeddingYear ? 'Recomputing…' : 'Save'}
          </Button>
        </div>
      </section>

      {/* Danger zone keeps a visual marker (red top hairline + red heading)
          but no nested card - it sits as the last section of the surface. */}
      <section className="pt-6 mt-6 border-t border-red-200">
        <h2 className="text-sm font-semibold text-red-700 mb-4">Danger zone</h2>
        <div className="flex items-start justify-between gap-4 py-3 border-b border-red-100">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-neutral-900">Campaign visibility</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              {campaign.is_public
                ? 'This campaign is public. Anyone can view and annotate it.'
                : 'This campaign is private. Only members can access it.'}
            </p>
          </div>
          <Button
            variant={campaign.is_public ? 'danger' : 'secondary'}
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
                showAlert(
                  newValue ? 'Campaign is now public' : 'Campaign is now private',
                  'success'
                );
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Failed to update visibility';
                showAlert(msg, 'error');
              }
            }}
          >
            {campaign.is_public ? 'Make private' : 'Make public'}
          </Button>
        </div>
        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-neutral-900">Delete campaign</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Once you delete a campaign, there is no going back.
            </p>
          </div>
          <Button variant="danger" onClick={onOpenDelete}>
            Delete campaign
          </Button>
        </div>
      </section>
    </div>
  );
};

export default GeneralSettingsTab;
