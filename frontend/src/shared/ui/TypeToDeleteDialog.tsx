import { useEffect, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button, Input } from './forms';
import { IconWarning } from './Icons';
import { AnimatedDialog } from './motion';
import { Spinner } from './Spinner';

interface TypeToDeleteDialogProps {
  isOpen: boolean;
  /** What is being deleted; typing it exactly unlocks the button. */
  name: string;
  title: string;
  /** What goes with it, said before the name is asked for. */
  children: ReactNode;
  confirmText: string;
  isLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirms a deletion nothing can undo by having the person type its name. */
export const TypeToDeleteDialog = ({
  isOpen,
  name,
  title,
  children,
  confirmText,
  isLoading,
  onConfirm,
  onCancel,
}: TypeToDeleteDialogProps) => {
  const { t } = useTranslation('common');
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (isOpen) setTyped('');
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
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">{title}</h3>
            <div className="text-sm text-neutral-600 space-y-3">
              {children}
              <p className="pt-2">
                <Trans
                  t={t}
                  i18nKey="typeToDelete.typeToConfirm"
                  values={{ name }}
                  components={{ name: <strong className="font-mono text-neutral-900" /> }}
                />
              </p>
            </div>
            <div className="mt-3">
              <Input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={isLoading}
                placeholder={t('typeToDelete.placeholder')}
                autoFocus
              />
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-neutral-100 flex gap-2 p-4 justify-end bg-neutral-50/50">
        <Button variant="secondary" onClick={onCancel} disabled={isLoading}>
          {t('actions.cancel')}
        </Button>
        <Button
          variant="danger"
          onClick={onConfirm}
          disabled={typed !== name || isLoading}
          leading={isLoading ? <Spinner size="xs" variant="white" /> : undefined}
        >
          {confirmText}
        </Button>
      </div>
    </AnimatedDialog>
  );
};
