import { authManager } from '~/auth/index';

export function ApprovalPendingScreen() {
  const handleLogout = async () => {
    try {
      await authManager.logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-neutral-50">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md">
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
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-2 bg-brand-500 text-white rounded hover:bg-brand-700 cursor-pointer"
            >
              Refresh Status
            </button>

            <button
              onClick={handleLogout}
              className="w-full px-4 py-2 bg-white border border-neutral-300 text-neutral-700 rounded hover:bg-neutral-50 cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
