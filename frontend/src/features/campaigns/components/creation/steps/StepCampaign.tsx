import { useTranslation } from 'react-i18next';
import type { CampaignCreate } from '~/api/client';
import { Field, Input } from '~/shared/ui/forms';

export const StepCampaign = ({
  form,
  setForm,
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
}) => {
  const { t } = useTranslation('campaigns');
  return (
    <Field
      label={t('wizard.campaign.nameLabel')}
      hint={t('wizard.campaign.nameHint')}
      htmlFor="campaign-name"
      required
    >
      <Input
        id="campaign-name"
        placeholder={t('wizard.campaign.namePlaceholder')}
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
    </Field>
  );
};
