import { Trans, useTranslation } from 'react-i18next';
import type { CampaignCreate, CampaignSettingsCreate } from '~/api/client';
import { BoundingBoxEditor } from '../../BoundingBoxEditor';
import { FormFieldsEditor } from '../../FormFieldsEditor';
import { LabelsEditor } from '../../LabelsEditor';
import { Select } from '~/shared/ui/forms';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 2016 }, (_, i) => CURRENT_YEAR - i);

const emptySettings = (): CampaignSettingsCreate => ({
  labels: [],
  bbox_west: 0,
  bbox_south: 0,
  bbox_east: 0,
  bbox_north: 0,
  embedding_year: null,
});
export const StepSettings = ({
  form,
  setForm,
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
}) => {
  const { t } = useTranslation('campaigns');
  const s = form.settings ?? emptySettings();

  const updateSettings = <K extends keyof CampaignSettingsCreate>(
    key: K,
    value: CampaignSettingsCreate[K]
  ) => {
    setForm({
      ...form,
      settings: {
        ...s,
        [key]: value,
      },
    });
  };

  return (
    <div className="space-y-6">
      <BoundingBoxEditor
        value={s}
        onChange={(updates) => {
          setForm({
            ...form,
            settings: {
              ...s,
              ...updates,
            },
          });
        }}
      />

      <div>
        <h3 className="section-heading">{t('wizard.settings.labelsTitle')}</h3>
        <p className="section-description mb-1">{t('wizard.settings.labelsDescription')}</p>
        <p className="text-xs text-neutral-400 mb-3">
          <Trans
            t={t}
            i18nKey="wizard.settings.labelsExample"
            components={{ label: <span className="font-medium" /> }}
          />
        </p>
        <LabelsEditor
          value={s.labels}
          onChange={(labels) => updateSettings('labels', labels)}
          showGeometryType
        />
      </div>

      <div>
        <h3 className="section-heading">
          {t('wizard.settings.formTitle')}
          <span className="ml-1 text-xs font-normal text-neutral-400">{t('optional')}</span>
        </h3>
        <p className="section-description mb-1">{t('wizard.settings.formDescription')}</p>
        <p className="text-xs text-neutral-400 mb-3">
          <Trans
            t={t}
            i18nKey="wizard.settings.formExample"
            components={{ label: <span className="font-medium" />, em: <em /> }}
          />
        </p>
        <FormFieldsEditor
          value={s.form_fields ?? []}
          onChange={(form_fields) => updateSettings('form_fields', form_fields)}
        />
      </div>

      {/* Embedding Year (optional) */}
      <div>
        <h3 className="section-heading">
          {t('wizard.settings.embeddingTitle')}
          <span className="ml-1 text-xs font-normal text-neutral-400">{t('optional')}</span>
        </h3>
        <p className="section-description mb-3">{t('wizard.settings.embeddingDescription')}</p>
        <div className="w-48">
          <Select
            value={s.embedding_year ?? ''}
            onChange={(e) =>
              updateSettings('embedding_year', e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">{t('wizard.settings.embeddingNone')}</option>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
};
