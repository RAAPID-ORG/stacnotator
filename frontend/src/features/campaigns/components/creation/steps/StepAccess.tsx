import { useTranslation } from 'react-i18next';
import type { CampaignCreate, ProjectUserOut } from '~/api/client';
import { useAccountStore } from '~/shared/stores/account.store';
import { LabellingPolicyEditor } from '~/features/campaigns/components/LabellingPolicyEditor';
import { DEFAULT_LABELLING_POLICY } from '~/features/campaigns/utils/labellingPolicy';

export const StepAccess = ({
  form,
  setForm,
  projectIsPublic,
  members,
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
  /** The owning project's visibility - campaigns have none of their own, and
   *  it gates the 'anyone' audience in the labelling policy. */
  projectIsPublic: boolean;
  members: ProjectUserOut[];
}) => {
  const { t } = useTranslation('campaigns');
  const account = useAccountStore((s) => s.account);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="section-heading">{t('wizard.access.title')}</h3>
        <p className="section-description">{t('wizard.access.description')}</p>
        <p className="text-xs text-neutral-500">{t('wizard.access.rulesHint')}</p>
      </div>

      <LabellingPolicyEditor
        value={form.labelling_policy ?? DEFAULT_LABELLING_POLICY}
        onChange={(labelling_policy) => setForm({ ...form, labelling_policy })}
        isPublic={projectIsPublic}
        members={members}
        defaultSelectedMemberIds={account ? [account.id] : undefined}
        membersHint={t('wizard.access.membersHint')}
      />
    </div>
  );
};
