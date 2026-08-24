import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { CampaignOut, LabelBase, LabellingPolicy, ProjectUserOut } from '~/api/client';
import {
  updateCampaignBboxMutation,
  updateCampaignFormFieldsMutation,
  updateCampaignGuideMutation,
  updateCampaignLabelsMutation,
  updateEmbeddingYearMutation,
  updateLabellingPolicyMutation,
  updateResearchSharingMutation,
  updateSampleExtentMutation,
} from '~/api/queries';
import { useRefreshCampaign } from '~/features/campaigns/hooks/useCampaign';
import { projectPath } from '~/app/routes';
import { BoundingBoxEditor } from '~/features/campaigns/components/BoundingBoxEditor';
import { FormFieldsEditor } from '~/features/campaigns/components/FormFieldsEditor';
import { LabelsEditor } from '~/features/campaigns/components/LabelsEditor';
import {
  diffFormFields,
  validateFormFields,
  type FormField,
} from '~/features/campaigns/utils/formFields';
import { LabellingPolicyEditor } from '~/features/campaigns/components/LabellingPolicyEditor';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Button, Field, Input, Select, Switch, Textarea } from '~/shared/ui/forms';

const LIST_FORMATTER = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

interface Props {
  campaign: CampaignOut;
  campaignName: string;
  setCampaignName: (s: string) => void;
  saving: boolean;
  onSaveName: () => void;
  onOpenDelete: () => void;
  projectUsers: ProjectUserOut[];
}

export const GeneralSettingsTab: React.FC<Props> = ({
  campaign,
  campaignName,
  setCampaignName,
  saving,
  onSaveName,
  onOpenDelete,
  projectUsers,
}) => {
  const showAlert = useLayoutStore((s) => s.showAlert);
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  const refreshCampaign = useRefreshCampaign(campaign.id);

  // Every editor below saves one slice of the campaign and then re-reads it,
  // which is also what keeps the page header and the sidebar honest.
  const path = { campaign_id: campaign.id };
  const saved = (errorMessage: string, message: string) => ({
    meta: { errorMessage },
    onSuccess: () => {
      void refreshCampaign();
      showAlert(message, 'success');
    },
  });

  // Embedding year local state
  const currentYear = new Date().getFullYear();
  const [embeddingYear, setEmbeddingYear] = useState<number | null>(
    campaign.settings.embedding_year ?? null
  );
  const saveEmbeddingYear = useMutation({
    ...updateEmbeddingYearMutation(),
    meta: { errorMessage: 'Failed to update embedding year' },
    onSuccess: (result) => {
      void refreshCampaign();
      showAlert(
        result.embeddings_recomputed
          ? `Embeddings recomputed for ${embeddingYear}`
          : 'Embedding year updated',
        'success'
      );
    },
  });
  const savingEmbeddingYear = saveEmbeddingYear.isPending;

  const embeddingYearChanged = embeddingYear !== (campaign.settings.embedding_year ?? null);

  const [guideMarkdown, setGuideMarkdown] = useState(campaign.settings.guide_markdown ?? '');
  const saveGuide = useMutation({
    ...updateCampaignGuideMutation(),
    ...saved('Failed to update guide', 'Campaign guide updated'),
  });
  const savingGuide = saveGuide.isPending;
  const guideChanged = guideMarkdown !== (campaign.settings.guide_markdown ?? '');

  // Labels editor local draft. Adds (new id) and renames (existing id, new
  // name) are allowed; deletes are blocked by the editor and the backend.
  const [labelsDraft, setLabelsDraft] = useState<LabelBase[]>(campaign.settings.labels);
  const saveLabels = useMutation({
    ...updateCampaignLabelsMutation(),
    ...saved('Failed to update labels', 'Labels updated'),
  });
  const savingLabels = saveLabels.isPending;
  const labelsChanged = JSON.stringify(labelsDraft) !== JSON.stringify(campaign.settings.labels);
  const labelsAreValid =
    labelsDraft.every((l) => l.name.trim().length > 0) &&
    new Set(labelsDraft.map((l) => l.name.trim().toLowerCase())).size === labelsDraft.length;
  const renamedLabels = labelsDraft.filter((l) => {
    const original = campaign.settings.labels.find((o) => o.id === l.id);
    return original && original.name !== l.name;
  });

  const handleSaveLabels = async () => {
    if (!labelsChanged || !labelsAreValid) return;
    if (renamedLabels.length > 0) {
      const ok = await showConfirmDialog({
        title: 'Rename existing labels?',
        description:
          `Renaming labels affects how existing annotations display - the underlying ` +
          `label IDs stay the same, so no data is lost, but every annotation tagged ` +
          `with ${renamedLabels.length === 1 ? 'this label' : 'these labels'} will ` +
          `now show the new name everywhere (review, exports, statistics).`,
        confirmText: 'Yes, rename',
        cancelText: 'Cancel',
      });
      if (!ok) return;
    }
    saveLabels.mutate({ path, body: { labels: labelsDraft } });
  };

  // Custom form fields local draft. Edits (same id) and adds (new id) are
  // allowed; a removed field is deleted on save together with every answer
  // recorded for it, and the backend rejects reshaping a field that already
  // has stored answers.
  const [formFieldsDraft, setFormFieldsDraft] = useState<FormField[]>(
    campaign.settings.form_fields ?? []
  );
  const saveFormFields = useMutation({
    ...updateCampaignFormFieldsMutation(),
    ...saved('Failed to update form fields', 'Form fields updated'),
  });
  const savingFormFields = saveFormFields.isPending;
  const savedFormFields = useMemo(
    () => campaign.settings.form_fields ?? [],
    [campaign.settings.form_fields]
  );
  const formFieldsChanged = JSON.stringify(formFieldsDraft) !== JSON.stringify(savedFormFields);
  const formFieldErrors = validateFormFields(formFieldsDraft);
  const formFieldsDiff = useMemo(
    () => diffFormFields(savedFormFields, formFieldsDraft),
    [savedFormFields, formFieldsDraft]
  );

  const handleSaveFormFields = async () => {
    if (!formFieldsChanged || formFieldErrors.length > 0) return;
    const { edited: editedFormFields, deleted: deletedFormFields } = formFieldsDiff;
    // Deletion is the destructive case, so it owns the dialog when both apply.
    if (deletedFormFields.length > 0) {
      const names = deletedFormFields.map((f) => `"${f.title.trim() || `field ${f.id}`}"`);
      const ok = await showConfirmDialog({
        title: `Delete ${names.length === 1 ? 'form field' : `${names.length} form fields`}?`,
        description:
          `Saving deletes ${LIST_FORMATTER.format(names)} and permanently deletes every answer ` +
          `annotators have recorded for ${names.length === 1 ? 'it' : 'them'} across all ` +
          `annotations in this campaign. This cannot be undone.`,
        confirmText: 'Delete and save',
        cancelText: 'Cancel',
        isDangerous: true,
      });
      if (!ok) return;
    } else if (editedFormFields.length > 0) {
      const ok = await showConfirmDialog({
        title: 'Edit existing form fields?',
        description:
          `Editing fields affects how existing annotations display - the underlying ` +
          `field IDs stay the same, so stored answers are kept, but annotators will ` +
          `see the updated ${editedFormFields.length === 1 ? 'question' : 'questions'} ` +
          `everywhere (annotation view, review, exports).`,
        confirmText: 'Yes, save changes',
        cancelText: 'Cancel',
      });
      if (!ok) return;
    }
    saveFormFields.mutate({ path, body: { form_fields: formFieldsDraft } });
  };

  // Labelling policy local draft.
  const [policyDraft, setPolicyDraft] = useState<LabellingPolicy>(
    campaign.settings.labelling_policy
  );
  const savePolicy = useMutation({
    ...updateLabellingPolicyMutation(),
    meta: { errorMessage: 'Failed to update labelling access' },
    onSuccess: (policy) => {
      // The server normalises the audiences, so the draft follows what it stored.
      setPolicyDraft(policy);
      void refreshCampaign();
      showAlert('Labelling access updated', 'success');
    },
  });
  const savingPolicy = savePolicy.isPending;
  const policyChanged =
    JSON.stringify(policyDraft) !== JSON.stringify(campaign.settings.labelling_policy);

  const handleSavePolicy = async () => {
    if (!policyChanged) return;
    const noOne = { kinds: [], user_ids: [] };
    savePolicy.mutate({
      path,
      // PATCH replaces the whole policy, so every axis must be present.
      body: {
        explore: policyDraft.explore ?? noOne,
        unassigned_tasks: policyDraft.unassigned_tasks ?? noOne,
        assigned_tasks: policyDraft.assigned_tasks ?? noOne,
        complete_assigned: policyDraft.complete_assigned ?? noOne,
        // Its own default is "campaign admins", not "no one", so an unset
        // draft must not be sent as an empty audience.
        ...(policyDraft.modify_others ? { modify_others: policyDraft.modify_others } : {}),
      },
    });
  };

  // Sample extent local state
  const [sampleExtent, setSampleExtent] = useState<string>(
    campaign.settings.sample_extent_meters != null
      ? String(campaign.settings.sample_extent_meters)
      : ''
  );
  const saveExtent = useMutation({
    ...updateSampleExtentMutation(),
    ...saved('Failed to update sample extent', 'Sample extent updated'),
  });
  const savingExtent = saveExtent.isPending;
  const saveResearchSharing = useMutation({
    ...updateResearchSharingMutation(),
    meta: { errorMessage: 'Failed to update research sharing' },
    onSuccess: refreshCampaign,
  });
  const savingResearchSharing = saveResearchSharing.isPending;
  const parsedExtent = sampleExtent.trim() === '' ? null : Number(sampleExtent);
  const extentValid = parsedExtent === null || (Number.isFinite(parsedExtent) && parsedExtent > 0);
  const extentChanged = parsedExtent !== (campaign.settings.sample_extent_meters ?? null);
  const handleSaveGuide = () => {
    if (!guideChanged) return;
    saveGuide.mutate({ path, body: { guide_markdown: guideMarkdown || null } });
  };

  const handleResearchSharing = (research_sharing: boolean) =>
    saveResearchSharing.mutate(
      { path, body: { research_sharing } },
      {
        onSuccess: () =>
          showAlert(
            research_sharing
              ? 'Annotations from this campaign may now be published as research data'
              : 'Research sharing turned off',
            'success'
          ),
      }
    );

  const handleSaveExtent = () => {
    if (!extentChanged || !extentValid) return;
    saveExtent.mutate({ path, body: { sample_extent_meters: parsedExtent } });
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

    saveEmbeddingYear.mutate({ path, body: { embedding_year: embeddingYear } });
  };

  const [bboxDraft, setBboxDraft] = useState({
    bbox_west: campaign.settings.bbox_west,
    bbox_south: campaign.settings.bbox_south,
    bbox_east: campaign.settings.bbox_east,
    bbox_north: campaign.settings.bbox_north,
  });
  const saveBbox = useMutation({
    ...updateCampaignBboxMutation(),
    ...saved('Failed to save settings', 'Campaign settings updated successfully'),
  });
  const savingBbox = saveBbox.isPending;
  const bboxChanged =
    bboxDraft.bbox_west !== campaign.settings.bbox_west ||
    bboxDraft.bbox_south !== campaign.settings.bbox_south ||
    bboxDraft.bbox_east !== campaign.settings.bbox_east ||
    bboxDraft.bbox_north !== campaign.settings.bbox_north;

  const handleSaveBbox = () => {
    if (!bboxChanged) return;
    saveBbox.mutate({ path, body: bboxDraft });
  };

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
          <h2 className="section-heading">Research data sharing</h2>
          <p className="section-description">
            Allow the annotations created in this campaign to be published as open research data,
            without any annotator's name. Off by default. Turning it off stops future releases -
            anything already published cannot be recalled. See the Terms of Service.
          </p>
        </div>
        <Switch
          checked={campaign.settings.research_sharing}
          onChange={handleResearchSharing}
          disabled={savingResearchSharing}
          label="Publishable as research data"
        />
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
          value={bboxDraft}
          onChange={(updates) => setBboxDraft((current) => ({ ...current, ...updates }))}
        />
        <Button onClick={handleSaveBbox} disabled={savingBbox || !bboxChanged}>
          Save settings
        </Button>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">Sample extent</h2>
          <p className="section-description">
            Defines the exact size of a sample point. If lat/lon is the exact coordinate, the sample
            extent defines the dimensions around this centroid that constitute the actual sample.
            This helps to have a shared understanding of which area / pixels belong to a sample
            point. Leave empty if tasks were uploaded as polygons or if no extent should be
            visualized.
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

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">Annotation labels</h2>
          <p className="section-description">
            The class names annotators choose from when labeling. You can add new labels and rename
            existing ones; renaming requires confirmation since it affects how prior annotations
            display. Deleting labels is not supported (it would orphan existing annotations).
          </p>
        </div>
        <LabelsEditor
          value={labelsDraft}
          onChange={setLabelsDraft}
          showGeometryType
          disableDelete
        />
        <div className="flex items-center gap-3 mt-3">
          <Button
            type="button"
            onClick={() => void handleSaveLabels()}
            disabled={!labelsChanged || !labelsAreValid || savingLabels}
          >
            {savingLabels ? 'Saving…' : 'Save labels'}
          </Button>
          {labelsChanged && (
            <button
              type="button"
              onClick={() => setLabelsDraft(campaign.settings.labels)}
              disabled={savingLabels}
              className="text-sm text-neutral-500 hover:text-neutral-700 underline underline-offset-4"
            >
              Discard
            </button>
          )}
          {!labelsAreValid && (
            <span className="text-xs text-red-600">Label names must be non-empty and unique.</span>
          )}
        </div>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">Custom form fields</h2>
          <p className="section-description">
            Additional questions annotators answer per annotation. You can add new fields and edit
            existing ones; editing requires confirmation since it affects how prior answers display.
            Deleting a field also deletes every answer recorded for it, so it asks first. A
            field&apos;s type or options can only change while it has no answers yet.
          </p>
        </div>
        <FormFieldsEditor value={formFieldsDraft} onChange={setFormFieldsDraft} />
        <div className="flex items-center gap-3 mt-3">
          <Button
            type="button"
            onClick={() => void handleSaveFormFields()}
            disabled={!formFieldsChanged || formFieldErrors.length > 0 || savingFormFields}
          >
            {savingFormFields ? 'Saving…' : 'Save fields'}
          </Button>
          {formFieldsChanged && (
            <button
              type="button"
              onClick={() => setFormFieldsDraft(campaign.settings.form_fields ?? [])}
              disabled={savingFormFields}
              className="text-sm text-neutral-500 hover:text-neutral-700 underline underline-offset-4"
            >
              Discard
            </button>
          )}
          {formFieldErrors.length > 0 && (
            <span className="text-xs text-red-600">{formFieldErrors[0]}</span>
          )}
        </div>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">Labelling access</h2>
          <p className="section-description">
            Control who may label what, and whose labels count toward completing a task. Members and
            visibility are managed at the project level -{' '}
            <Link
              to={`${projectPath(campaign.project_id)}?tab=members`}
              className="text-brand-700 underline underline-offset-4 hover:text-brand-600"
            >
              open project members
            </Link>
            .
          </p>
        </div>
        <LabellingPolicyEditor
          value={policyDraft}
          onChange={setPolicyDraft}
          isPublic={campaign.is_public ?? false}
          members={projectUsers}
        />
        <div className="flex items-center gap-3 mt-3">
          <Button
            type="button"
            onClick={() => void handleSavePolicy()}
            disabled={!policyChanged || savingPolicy}
          >
            {savingPolicy ? 'Saving…' : 'Save labelling access'}
          </Button>
          {policyChanged && (
            <button
              type="button"
              onClick={() => setPolicyDraft(campaign.settings.labelling_policy)}
              disabled={savingPolicy}
              className="text-sm text-neutral-500 hover:text-neutral-700 underline underline-offset-4"
            >
              Discard
            </button>
          )}
        </div>
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

      <section className="pt-6 mt-6 border-t border-red-200">
        <h2 className="text-sm font-semibold text-red-700 mb-4">Danger zone</h2>
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
