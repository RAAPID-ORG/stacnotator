import { Trans, useTranslation } from 'react-i18next';
import { TypeToDeleteDialog } from '~/shared/ui/TypeToDeleteDialog';

interface DeleteCampaignDialogProps {
  isOpen: boolean;
  campaignName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const DeleteCampaignDialog = ({
  isOpen,
  campaignName,
  onConfirm,
  onCancel,
  isLoading = false,
}: DeleteCampaignDialogProps) => {
  const { t } = useTranslation('campaigns');
  return (
    <TypeToDeleteDialog
      isOpen={isOpen}
      name={campaignName}
      title={t('deleteDialog.title')}
      confirmText={t('deleteDialog.confirm')}
      isLoading={isLoading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        <Trans
          t={t}
          i18nKey="deleteDialog.warning"
          values={{ name: campaignName }}
          components={{ strong: <strong />, name: <strong className="text-neutral-900" /> }}
        />
      </p>
      <ul className="list-disc list-inside space-y-1 ml-2">
        <li>{t('deleteDialog.items.tasks')}</li>
        <li>{t('deleteDialog.items.annotations')}</li>
        <li>{t('deleteDialog.items.imagery')}</li>
        <li>{t('deleteDialog.items.timeseries')}</li>
        <li>{t('deleteDialog.items.settings')}</li>
      </ul>
    </TypeToDeleteDialog>
  );
};
