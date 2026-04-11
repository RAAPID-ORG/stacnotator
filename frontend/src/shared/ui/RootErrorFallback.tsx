/**
 * Root-level error fallback for errors that occur outside the Router context
 * This is a simple component that doesn't use routing hooks
 */
interface RootErrorFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

export const RootErrorFallback = ({ error, resetErrorBoundary }: RootErrorFallbackProps) => {
  const handleReload = () => {
    window.location.href = '/';
    resetErrorBoundary();
  };

  // RootErrorFallback runs OUTSIDE the Router context, so it can't import
  // anything that uses router hooks. The Button primitive is router-agnostic
  // but to keep this file standalone we render a plain styled <button>.
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4"
      style={{ background: 'rgb(245, 242, 234)' }}
    >
      <div className="max-w-lg w-full bg-white border border-neutral-200 rounded-xl shadow-sm p-8 space-y-6">
        {/* Error icon */}
        <div className="flex justify-center">
          <div className="w-12 h-12 bg-red-50 border border-red-100 rounded-full flex items-center justify-center">
            <svg
              className="w-6 h-6 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
        </div>

        <div className="text-center space-y-1.5">
          <h1 className="text-lg font-semibold text-neutral-900">Application error</h1>
          <p className="text-sm text-neutral-600">
            Something went wrong while loading the application.
          </p>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <h2 className="text-xs font-semibold text-red-800 mb-1">Error details</h2>
          <p className="text-xs text-red-700 font-mono break-words">{error.message}</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleReload}
            type="button"
            className="flex-1 inline-flex items-center justify-center h-9 px-4 text-sm font-medium bg-brand-600 text-white rounded-md shadow-sm hover:bg-brand-700 transition-colors"
          >
            Go to home
          </button>
          <button
            onClick={resetErrorBoundary}
            type="button"
            className="flex-1 inline-flex items-center justify-center h-9 px-4 text-sm font-medium bg-white text-neutral-700 border border-neutral-300 rounded-md shadow-sm hover:bg-neutral-50 transition-colors"
          >
            Try again
          </button>
        </div>

        <p className="text-center text-xs text-neutral-500 pt-2 border-t border-neutral-100">
          If the problem persists, contact support or check the browser console for more details.
        </p>
      </div>
    </div>
  );
};
