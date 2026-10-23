import { useState, useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button, Input } from '~/shared/ui/forms';
import { AnimatedDialog } from '~/shared/ui/motion';
import { Spinner } from '~/shared/ui/Spinner';
import { IconWarning } from '~/shared/ui/Icons';

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
  const { t } = useTranslation(['campaigns', 'common']);
  const [inputValue, setInputValue] = useState('');
  const isValid = inputValue === campaignName;

  // Reset input when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setInputValue('');
    }
  }, [isOpen]);

  return (
    <AnimatedDialog
      open={isOpen}
      backdropClassName="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-[9999]"
      panelClassName="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 border border-neutral-200"
    >
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
            <IconWarning className="w-6 h-6 text-red-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">
              {t('deleteDialog.title')}
            </h3>
            <div className="text-sm text-neutral-600 space-y-3">
              <p>
                <Trans
                  t={t}
                  i18nKey="deleteDialog.warning"
                  values={{ name: campaignName }}
                  components={{
                    strong: <strong />,
                    name: <strong className="text-neutral-900" />,
                  }}
                />
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>{t('deleteDialog.items.tasks')}</li>
                <li>{t('deleteDialog.items.annotations')}</li>
                <li>{t('deleteDialog.items.imagery')}</li>
                <li>{t('deleteDialog.items.timeseries')}</li>
                <li>{t('deleteDialog.items.settings')}</li>
              </ul>
              <p className="pt-2">
                <Trans
                  t={t}
                  i18nKey="deleteDialog.typeToConfirm"
                  values={{ name: campaignName }}
                  components={{ name: <strong className="font-mono text-neutral-900" /> }}
                />
              </p>
            </div>
            <div className="mt-3">
              <Input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={isLoading}
                placeholder={t('deleteDialog.placeholder')}
                autoFocus
              />
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-neutral-100 flex gap-2 p-4 justify-end bg-neutral-50/50">
        <Button variant="secondary" onClick={onCancel} disabled={isLoading}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          variant="danger"
          onClick={onConfirm}
          disabled={!isValid || isLoading}
          leading={isLoading ? <Spinner size="xs" variant="white" /> : undefined}
        >
          {t('deleteDialog.confirm')}
        </Button>
      </div>
    </AnimatedDialog>
  );
};
