import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useAccountStore } from '~/features/account/account.store';
import { authManager, AUTH_PROVIDERS } from '~/features/auth/index';

export function EmailVerificationScreen() {
  const { auth } = useAuth();
  const fetchAccount = useAccountStore((s) => s.fetchAccount);
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = async () => {
    setChecking(true);
    setError(null);
    try {
      await auth.getIdToken(true);
      // Reset the flag before retrying
      useAccountStore.setState({ emailNotVerified: false });
      await fetchAccount();
    } catch {
      setError('Email not yet verified. Please check your inbox and try again.');
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError(null);
    setResendSuccess(false);
    try {
      const emailProvider = authManager.getProvider(AUTH_PROVIDERS.EMAIL);
      if (emailProvider && 'sendVerificationEmail' in emailProvider) {
        await (
          emailProvider as { sendVerificationEmail: () => Promise<void> }
        ).sendVerificationEmail();
      }
      setResendSuccess(true);
    } catch {
      setError('Failed to resend verification email. Please try again later.');
    } finally {
      setResending(false);
    }
  };

  const handleSignOut = async () => {
    await auth.logout();
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-neutral-50">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>

        <h1 className="text-xl font-semibold text-neutral-800 mb-2">Verify your email</h1>

        <p className="text-sm text-neutral-600 mb-6">
          We sent a verification link to your email address. Please check your inbox (and spam
          folder) and click the link to verify your account.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        {resendSuccess && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
            Verification email sent! Check your inbox.
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleRefresh}
            disabled={checking}
            className="w-full px-4 py-2 bg-brand-500 text-white rounded hover:bg-brand-700 disabled:opacity-50 cursor-pointer transition-colors"
          >
            {checking ? 'Checking...' : "I've verified my email"}
          </button>

          <button
            onClick={handleResend}
            disabled={resending}
            className="w-full px-4 py-2 border border-brand-300 text-brand-700 rounded hover:bg-brand-50 disabled:opacity-50 cursor-pointer transition-colors"
          >
            {resending ? 'Sending...' : 'Resend verification email'}
          </button>

          <button
            onClick={handleSignOut}
            className="w-full px-4 py-2 text-neutral-600 hover:text-neutral-800 text-sm cursor-pointer transition-colors"
          >
            Sign out and use a different account
          </button>
        </div>
      </div>
    </div>
  );
}
