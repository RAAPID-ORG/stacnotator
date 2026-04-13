import { useNavigate } from 'react-router-dom';
import { Button } from './forms';

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
    <div className="min-h-screen w-full flex items-center justify-center p-4">
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

        {/* Error message */}
        <div className="text-center space-y-1.5">
          <h1 className="text-lg font-semibold text-neutral-900">Something went wrong</h1>
          <p className="text-sm text-neutral-600">
            We encountered an unexpected error. Your data is safe.
          </p>
        </div>

        {/* Collapsible technical details */}
        <details className="bg-neutral-50 border border-neutral-100 rounded-md p-3">
          <summary className="cursor-pointer text-xs font-medium text-neutral-700 hover:text-neutral-900">
            Technical details
          </summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs font-mono text-neutral-600 break-all">{error.message}</p>
            {error.stack && (
              <pre className="text-[10px] text-neutral-500 overflow-auto max-h-40 mt-2 p-2 bg-white rounded border border-neutral-100">
                {error.stack}
              </pre>
            )}
          </div>
        </details>

        <div className="flex gap-2">
          <Button onClick={resetErrorBoundary} className="flex-1">
            Try again
          </Button>
          <Button variant="secondary" onClick={handleGoHome} className="flex-1">
            Go to home
          </Button>
        </div>

        <p className="text-center text-xs text-neutral-500">
          If this problem persists, please contact support or try refreshing the page.
        </p>
      </div>
    </div>
  );
};
