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

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-brand-50 to-neutral-50 p-4">
      <div className="max-w-lg w-full bg-white rounded-xl shadow-lg p-8 space-y-6">
        {/* Error Icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-red-600"
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

        {/* Error Content */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-gray-900">Application Error</h1>
          <p className="text-gray-600">Something went wrong while loading the application.</p>
        </div>

        {/* Error Details */}
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-red-800 mb-2">Error Details:</h2>
          <p className="text-sm text-red-700 font-mono break-words">{error.message}</p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleReload}
            className="flex-1 bg-brand-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          >
            Go to Home
          </button>
          <button
            onClick={resetErrorBoundary}
            className="flex-1 bg-gray-100 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
          >
            Try Again
          </button>
        </div>

        {/* Additional Help */}
        <div className="text-center pt-4 border-t border-gray-200">
          <p className="text-sm text-gray-500">
            If the problem persists, please contact support or check the browser console for more
            details.
          </p>
        </div>
      </div>
    </div>
  );
};
