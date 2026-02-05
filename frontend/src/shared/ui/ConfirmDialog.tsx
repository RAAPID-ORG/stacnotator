export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
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
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  if (!isOpen) return null;

  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 animate-scale-in">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-brand-800 mb-2">{title}</h2>
          {description && <p className="text-sm text-gray-600 mb-6">{description}</p>}
        </div>

        <div className="border-t border-gray-200 flex gap-3 p-4 justify-end">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${
              isDangerous ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-500 hover:bg-brand-700'
            }`}
          >
            {isLoading && (
              <div className="w-4 h-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
            )}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
