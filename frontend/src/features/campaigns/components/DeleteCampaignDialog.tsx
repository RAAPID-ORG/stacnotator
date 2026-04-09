import { useState, useEffect } from 'react';

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-[9999] animate-fade-in">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 animate-scale-in">
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
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={isLoading}
                placeholder="Type campaign name here"
                className="mt-3 w-full border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                autoFocus
              />
            </div>
          </div>
        </div>
        <div className="border-t border-neutral-200 flex gap-3 p-4 justify-end">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!isValid || isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading && (
              <div className="w-4 h-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
            )}
            Delete Campaign
          </button>
        </div>
      </div>
    </div>
  );
};
