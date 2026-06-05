import { authManager } from '../core/authManager';
import { handleError } from '~/shared/utils/errorHandler';
import { Button } from '~/shared/ui/forms';
import { AuthCard } from './AuthCard';

export function ApprovalPendingScreen() {
  const handleLogout = async () => {
    try {
      await authManager.logout();
    } catch (error) {
      handleError(error, 'Logout failed');
    }
  };

  return (
    <AuthCard>
      <div className="text-center">
        <div className="mb-4">
          <svg
            className="w-16 h-16 text-amber-500 mx-auto"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        <h1 className="text-2xl font-semibold text-neutral-900 mb-3">Approval Pending</h1>

        <p className="text-neutral-600 mb-6">
          Your account has been created successfully! Please wait for an administrator to approve
          your access.
        </p>

        <p className="text-sm text-neutral-500 mb-8">
          You will receive an email notification once your account is approved. You can also try
          refreshing this page later.
        </p>

        <div className="space-y-3">
          <Button variant="primary" className="w-full" onClick={() => window.location.reload()}>
            Refresh Status
          </Button>

          <Button variant="secondary" className="w-full" onClick={handleLogout}>
            Sign Out
          </Button>
        </div>
      </div>
    </AuthCard>
  );
}
