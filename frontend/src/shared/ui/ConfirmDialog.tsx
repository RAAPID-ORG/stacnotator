import { useState } from 'react';
import { Button } from './forms';
import { AnimatedDialog } from './motion';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
  isLoading?: boolean;
  showDontAskAgain?: boolean;
  onConfirm: (dontAskAgain?: boolean) => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmDialog = ({
  isOpen,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDangerous = false,
  isLoading = false,
  showDontAskAgain = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const handleConfirm = async () => {
    await onConfirm(showDontAskAgain ? dontAskAgain : undefined);
    setDontAskAgain(false);
  };

  const handleCancel = () => {
    setDontAskAgain(false);
    onCancel();
  };

  return (
    <AnimatedDialog
      open={isOpen}
      backdropClassName="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-[1000]"
      panelClassName="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 border border-neutral-200"
    >
      <div className="p-6">
        <h2 className="text-base font-semibold text-neutral-900 mb-1.5">{title}</h2>
        {description && (
          <p className="text-sm text-neutral-600 mb-5 leading-relaxed">{description}</p>
        )}
        {showDontAskAgain && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
              className="w-4 h-4 rounded border-neutral-300 text-brand-700 focus:ring-brand-600 cursor-pointer"
            />
            <span className="text-xs text-neutral-600">Don&apos;t ask again this session</span>
          </label>
        )}
      </div>

      <div className="border-t border-neutral-100 flex gap-2 p-4 justify-end bg-neutral-50/50 rounded-b-xl">
        <Button variant="secondary" onClick={handleCancel} disabled={isLoading}>
          {cancelText}
        </Button>
        <Button
          variant={isDangerous ? 'danger' : 'primary'}
          onClick={handleConfirm}
          disabled={isLoading}
          leading={
            isLoading ? (
              <div className="w-4 h-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : undefined
          }
        >
          {confirmText}
        </Button>
      </div>
    </AnimatedDialog>
  );
};
