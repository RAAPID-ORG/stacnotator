export interface LoadingOverlayProps {
  visible: boolean;
  text?: string;
}

export const LoadingOverlay = ({ visible, text = 'Loading...' }: LoadingOverlayProps) => {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-40 animate-fade-in">
      <div className="bg-white rounded-lg p-6 shadow-xl flex flex-col items-center gap-2 animate-scale-in">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-brand-600"></div>
        <p className="text-sm text-neutral-600">{text}</p>
      </div>
    </div>
  );
};
