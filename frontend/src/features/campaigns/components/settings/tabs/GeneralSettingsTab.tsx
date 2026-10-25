import React, { useMemo, useState } from 'react';
import { Spinner } from '~/shared/ui/Spinner';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { CampaignOut, LabelBase, LabellingPolicy, ProjectUserOut } from '~/api/client';
import { updateCampaignMutation } from '~/api/queries';
import { useRefreshCampaign } from '~/features/campaigns/hooks/campaignQueries';
import { projectPath } from '~/app/routes';
import { BoundingBoxEditor } from '~/features/layers/BoundingBoxEditor';
import { FormFieldsEditor } from '~/features/campaigns/components/FormFieldsEditor';
import { labelNamesError } from '~/features/campaigns/utils/campaignValidation';
import { LabelsEditor } from '~/features/campaigns/components/LabelsEditor';
import {
  diffFormFields,
  validateFormFields,
  type FormField,
} from '~/features/campaigns/utils/formFields';
import { LabellingPolicyEditor } from '~/features/campaigns/components/LabellingPolicyEditor';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Button, Field, Input, Select, Switch, Textarea } from '~/shared/ui/forms';

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
  const { t, i18n } = useTranslation(['campaigns', 'common']);
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
    ...updateCampaignMutation(),
    meta: { errorMessage: t('generalTab.errors.embeddingYear') },
    onSuccess: refreshCampaign,
  });
  const savingEmbeddingYear = saveEmbeddingYear.isPending;

  const embeddingYearChanged = embeddingYear !== (campaign.settings.embedding_year ?? null);

  const [guideMarkdown, setGuideMarkdown] = useState(campaign.settings.guide_markdown ?? '');
  const saveGuide = useMutation({
    ...updateCampaignMutation(),
    ...saved(t('generalTab.errors.guide'), t('generalTab.toasts.guideUpdated')),
  });
  const savingGuide = saveGuide.isPending;
  const guideChanged = guideMarkdown !== (campaign.settings.guide_markdown ?? '');

  // Labels editor local draft. Adds (new id) and renames (existing id, new
  // name) are allowed; deletes are blocked by the editor and the backend.
  const [labelsDraft, setLabelsDraft] = useState<LabelBase[]>(campaign.settings.labels);
  const saveLabels = useMutation({
    ...updateCampaignMutation(),
    ...saved(t('generalTab.errors.labels'), t('generalTab.toasts.labelsUpdated')),
  });
  const savingLabels = saveLabels.isPending;
  const labelsChanged = JSON.stringify(labelsDraft) !== JSON.stringify(campaign.settings.labels);
  const labelsError = labelNamesError(labelsDraft);
  const labelsAreValid = labelsError === null;
  const renamedLabels = labelsDraft.filter((l) => {
    const original = campaign.settings.labels.find((o) => o.id === l.id);
    return original && original.name !== l.name;
  });

  const handleSaveLabels = async () => {
    if (!labelsChanged || !labelsAreValid) return;
    if (renamedLabels.length > 0) {
      const ok = await showConfirmDialog({
        title: t('generalTab.renameLabels.title'),
        description: t('generalTab.renameLabels.description', { count: renamedLabels.length }),
        confirmText: t('generalTab.renameLabels.confirm'),
        cancelText: t('common:actions.cancel'),
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
    campaign.settings.form_fields
  );
  const saveFormFields = useMutation({
    ...updateCampaignMutation(),
    ...saved(t('generalTab.errors.formFields'), t('generalTab.toasts.formFieldsUpdated')),
  });
  const savingFormFields = saveFormFields.isPending;
  const savedFormFields = useMemo(
    () => campaign.settings.form_fields,
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
      const names = deletedFormFields.map(
        (f) => `"${f.title.trim() || t('validation.formFields.fallbackName', { id: f.id })}"`
      );
      const listFormatter = new Intl.ListFormat(i18n.language, {
        style: 'long',
        type: 'conjunction',
      });
      const ok = await showConfirmDialog({
        title: t('generalTab.deleteFields.title', { count: names.length }),
        description: t('generalTab.deleteFields.description', {
          count: names.length,
          names: listFormatter.format(names),
        }),
        confirmText: t('generalTab.deleteFields.confirm'),
        cancelText: t('common:actions.cancel'),
        isDangerous: true,
      });
      if (!ok) return;
    } else if (editedFormFields.length > 0) {
      const ok = await showConfirmDialog({
        title: t('generalTab.editFields.title'),
        description: t('generalTab.editFields.description', { count: editedFormFields.length }),
        confirmText: t('generalTab.editFields.confirm'),
        cancelText: t('common:actions.cancel'),
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
    ...updateCampaignMutation(),
    meta: { errorMessage: t('generalTab.errors.policy') },
    onSuccess: (updated) => {
      // The server normalises the audiences, so the draft follows what it stored.
      setPolicyDraft(updated.settings.labelling_policy);
      void refreshCampaign();
      showAlert(t('generalTab.toasts.policyUpdated'), 'success');
    },
  });
  const savingPolicy = savePolicy.isPending;
  const policyChanged =
    JSON.stringify(policyDraft) !== JSON.stringify(campaign.settings.labelling_policy);

  const handleSavePolicy = async () => {
    if (!policyChanged) return;
    savePolicy.mutate({ path, body: { labelling_policy: policyDraft } });
  };

  // Sample extent local state
  const [sampleExtent, setSampleExtent] = useState<string>(
    campaign.settings.sample_extent_meters != null
      ? String(campaign.settings.sample_extent_meters)
      : ''
  );
  const saveExtent = useMutation({
    ...updateCampaignMutation(),
    ...saved(t('generalTab.errors.extent'), t('generalTab.toasts.extentUpdated')),
  });
  const savingExtent = saveExtent.isPending;
  const saveResearchSharing = useMutation({
    ...updateCampaignMutation(),
    meta: { errorMessage: t('generalTab.errors.researchSharing') },
    onSuccess: refreshCampaign,
  });
  const savingResearchSharing = saveResearchSharing.isPending;
  const saveTaskOutput = useMutation({
    ...updateCampaignMutation(),
    ...saved(t('generalTab.errors.taskOutput'), t('generalTab.toasts.taskOutputUpdated')),
  });
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
              ? t('generalTab.toasts.researchOn')
              : t('generalTab.toasts.researchOff'),
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
        title: t('generalTab.recompute.title'),
        description: t('generalTab.recompute.description', {
          from: campaign.settings.embedding_year,
          to: embeddingYear,
        }),
        confirmText: t('generalTab.recompute.confirm'),
        cancelText: t('common:actions.cancel'),
        isDangerous: true,
      });
      if (!confirmed) return;
    }

    saveEmbeddingYear.mutate(
      { path, body: { embedding_year: embeddingYear } },
      {
        // The saved campaign says whether a run started: a new year with tasks to
        // fetch for does, clearing the year or a campaign without tasks does not.
        onSuccess: (saved) =>
          showAlert(
            saved.embedding_status === 'registering'
              ? t('generalTab.toasts.embeddingsRecomputed', { year: embeddingYear })
              : t('generalTab.toasts.embeddingYearUpdated'),
            'success'
          ),
      }
    );
  };

  const [bboxDraft, setBboxDraft] = useState({
    bbox_west: campaign.settings.bbox_west,
    bbox_south: campaign.settings.bbox_south,
    bbox_east: campaign.settings.bbox_east,
    bbox_north: campaign.settings.bbox_north,
  });
  const saveBbox = useMutation({
    ...updateCampaignMutation(),
    ...saved(t('generalTab.errors.bbox'), t('generalTab.toasts.bboxUpdated')),
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
          <h2 className="section-heading">{t('generalTab.name.title')}</h2>
          <p className="section-description">{t('generalTab.name.description')}</p>
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
            {t('common:actions.save')}
          </Button>
        </div>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">{t('generalTab.guide.title')}</h2>
          <p className="section-description">{t('generalTab.guide.description')}</p>
        </div>
        <Textarea
          value={guideMarkdown}
          onChange={(e) => setGuideMarkdown(e.target.value)}
          disabled={savingGuide}
          rows={10}
          className="font-mono"
          placeholder={t('generalTab.guide.placeholder')}
        />
        <Button onClick={handleSaveGuide} disabled={savingGuide || !guideChanged}>
          {savingGuide ? t('settingsPage.saving') : t('generalTab.guide.save')}
        </Button>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">{t('generalTab.research.title')}</h2>
          <p className="section-description">{t('generalTab.research.description')}</p>
        </div>
        <Switch
          checked={campaign.settings.research_sharing}
          onChange={handleResearchSharing}
          disabled={savingResearchSharing}
          label={t('generalTab.research.label')}
        />
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">{t('generalTab.taskOutput.title')}</h2>
          <p className="section-description">{t('generalTab.taskOutput.description')}</p>
        </div>
        <Field label={t('generalTab.taskOutput.label')} className="w-72">
          <Select
            value={campaign.settings.task_output}
            onChange={(e) =>
              saveTaskOutput.mutate({
                path,
                body: { task_output: e.target.value === 'draw' ? 'draw' : 'classify' },
              })
            }
            disabled={saveTaskOutput.isPending}
          >
            <option value="classify">{t('generalTab.taskOutput.classify')}</option>
            <option value="draw">{t('generalTab.taskOutput.draw')}</option>
          </Select>
        </Field>
      </section>

      <section className={sectionCls}>
        <BoundingBoxEditor
          value={bboxDraft}
          onChange={(updates) => setBboxDraft((current) => ({ ...current, ...updates }))}
        />
        <Button onClick={handleSaveBbox} disabled={savingBbox || !bboxChanged}>
          {t('generalTab.saveSettings')}
        </Button>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">{t('generalTab.extent.title')}</h2>
          <p className="section-description">{t('generalTab.extent.description')}</p>
        </div>
        <div className="flex gap-3 items-end">
          <Field
            label={t('generalTab.extent.label')}
            error={!extentValid ? t('sampling.spacingError') : undefined}
            className="w-56"
          >
            <Input
              type="number"
              min="1"
              step="1"
              value={sampleExtent}
              onChange={(e) => setSampleExtent(e.target.value)}
              disabled={savingExtent}
              placeholder={t('generalTab.extent.placeholder')}
              invalid={!extentValid}
            />
          </Field>
          <Button
            onClick={handleSaveExtent}
            disabled={savingExtent || !extentChanged || !extentValid}
          >
            {savingExtent ? t('settingsPage.saving') : t('common:actions.save')}
          </Button>
        </div>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">{t('generalTab.labels.title')}</h2>
          <p className="section-description">{t('generalTab.labels.description')}</p>
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
            {savingLabels ? t('settingsPage.saving') : t('generalTab.labels.save')}
          </Button>
          {labelsChanged && (
            <button
              type="button"
              onClick={() => setLabelsDraft(campaign.settings.labels)}
              disabled={savingLabels}
              className="text-sm text-neutral-500 hover:text-neutral-700 underline underline-offset-4"
            >
              {t('settingsPage.discard')}
            </button>
          )}
          {labelsError && <span className="text-xs text-red-600">{labelsError}</span>}
        </div>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">{t('generalTab.formFields.title')}</h2>
          <p className="section-description">{t('generalTab.formFields.description')}</p>
        </div>
        <FormFieldsEditor value={formFieldsDraft} onChange={setFormFieldsDraft} />
        <div className="flex items-center gap-3 mt-3">
          <Button
            type="button"
            onClick={() => void handleSaveFormFields()}
            disabled={!formFieldsChanged || formFieldErrors.length > 0 || savingFormFields}
          >
            {savingFormFields ? t('settingsPage.saving') : t('generalTab.formFields.save')}
          </Button>
          {formFieldsChanged && (
            <button
              type="button"
              onClick={() => setFormFieldsDraft(campaign.settings.form_fields)}
              disabled={savingFormFields}
              className="text-sm text-neutral-500 hover:text-neutral-700 underline underline-offset-4"
            >
              {t('settingsPage.discard')}
            </button>
          )}
          {formFieldErrors.length > 0 && (
            <span className="text-xs text-red-600">{formFieldErrors[0]}</span>
          )}
        </div>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">{t('wizard.access.title')}</h2>
          <p className="section-description">
            <Trans
              t={t}
              i18nKey="generalTab.policy.description"
              components={{
                link: (
                  <Link
                    to={`${projectPath(campaign.project_id)}?tab=members`}
                    className="text-brand-700 underline underline-offset-4 hover:text-brand-600"
                  />
                ),
              }}
            />
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
            {savingPolicy ? t('settingsPage.saving') : t('generalTab.policy.save')}
          </Button>
          {policyChanged && (
            <button
              type="button"
              onClick={() => setPolicyDraft(campaign.settings.labelling_policy)}
              disabled={savingPolicy}
              className="text-sm text-neutral-500 hover:text-neutral-700 underline underline-offset-4"
            >
              {t('settingsPage.discard')}
            </button>
          )}
        </div>
      </section>

      {/* Embedding Year */}
      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">{t('wizard.settings.embeddingTitle')}</h2>
          <p className="section-description">
            {t('generalTab.embedding.description')}
            {!campaign.settings.embedding_year && (
              <span className="block mt-1 text-amber-700 font-medium">
                {t('generalTab.embedding.notSet')}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-3 items-end">
          <Field label={t('generalTab.embedding.year')} className="w-48">
            <Select
              value={embeddingYear ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                setEmbeddingYear(val === '' ? null : parseInt(val, 10));
              }}
              disabled={savingEmbeddingYear}
            >
              <option value="">{t('wizard.settings.embeddingNone')}</option>
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
            leading={savingEmbeddingYear ? <Spinner size="xs" variant="white" /> : undefined}
          >
            {savingEmbeddingYear ? t('generalTab.embedding.recomputing') : t('common:actions.save')}
          </Button>
        </div>
      </section>

      <section className="pt-6 mt-6 border-t border-red-200">
        <h2 className="text-sm font-semibold text-red-700 mb-4">{t('generalTab.danger.title')}</h2>
        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-neutral-900">{t('deleteDialog.confirm')}</h3>
            <p className="text-xs text-neutral-500 mt-0.5">{t('generalTab.danger.description')}</p>
          </div>
          <Button variant="danger" onClick={onOpenDelete}>
            {t('deleteDialog.confirm')}
          </Button>
        </div>
      </section>
    </div>
  );
};
