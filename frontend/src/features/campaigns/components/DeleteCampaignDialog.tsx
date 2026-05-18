import { useState, useEffect } from 'react';
import { Button, Input } from '~/shared/ui/forms';
import { AnimatedDialog } from '~/shared/ui/motion';

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
            <svg
              className="w-6 h-6 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">Delete Campaign</h3>
            <div className="text-sm text-neutral-600 space-y-3">
              <p>
                This action <strong>cannot be undone</strong>. This will permanently delete the
                campaign <strong className="text-neutral-900">"{campaignName}"</strong> and all
                associated data:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>All annotation tasks</li>
                <li>All user annotations</li>
                <li>All imagery configurations</li>
                <li>All timeseries configurations</li>
                <li>All campaign settings</li>
              </ul>
              <p className="pt-2">
                Please type <strong className="font-mono text-neutral-900">{campaignName}</strong>{' '}
                to confirm:
              </p>
            </div>
            <div className="mt-3">
              <Input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={isLoading}
                placeholder="Type campaign name here"
                autoFocus
              />
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-neutral-100 flex gap-2 p-4 justify-end bg-neutral-50/50">
        <Button variant="secondary" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={onConfirm}
          disabled={!isValid || isLoading}
          leading={
            isLoading ? (
              <div className="w-4 h-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : undefined
          }
        >
          Delete campaign
        </Button>
      </div>
    </AnimatedDialog>
  );
};
