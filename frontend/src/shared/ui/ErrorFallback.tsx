import { useNavigate } from 'react-router-dom';

interface ErrorFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

export const ErrorFallback = ({ error, resetErrorBoundary }: ErrorFallbackProps) => {
  const navigate = useNavigate();

  const handleGoHome = () => {
    navigate('/');
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

        {/* Error Message */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-brand-800">Something went wrong</h1>
          <p className="text-gray-600">
            We encountered an unexpected error. Don't worry, your data is safe.
          </p>
        </div>

        {/* Error Details (collapsible) */}
        <details className="bg-gray-50 rounded-lg p-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-brand-600">
            Technical details
          </summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs font-mono text-gray-600 break-all">{error.message}</p>
            {error.stack && (
              <pre className="text-xs text-gray-500 overflow-auto max-h-40 mt-2 p-2 bg-white rounded border border-gray-200">
                {error.stack}
              </pre>
            )}
          </div>
        </details>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={resetErrorBoundary}
            className="flex-1 px-4 py-2.5 bg-brand-500 text-white rounded-lg hover:bg-brand-700 transition-colors font-medium"
          >
            Try again
          </button>
          <button
            onClick={handleGoHome}
            className="flex-1 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            Go to home
          </button>
        </div>

        {/* Help Text */}
        <p className="text-center text-xs text-gray-500">
          If this problem persists, please contact support or try refreshing the page.
        </p>
      </div>
    </div>
  );
};
