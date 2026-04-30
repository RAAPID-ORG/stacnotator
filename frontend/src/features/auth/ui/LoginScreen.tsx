import { useState, useMemo } from 'react';
import { authManager, AUTH_PROVIDERS } from 'src/features/auth/index';
import { PasswordRequirementsList, passwordMeetsAllRequirements } from './PasswordRequirements';
import { Button, Field, Input } from '~/shared/ui/forms';

type AuthMode = 'login' | 'register' | 'forgot-password';

export function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const passwordMeetsRequirements = useMemo(() => {
    return passwordMeetsAllRequirements(password);
  }, [password]);

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setError(null);
      const googleProvider = authManager.getProvider(AUTH_PROVIDERS.GOOGLE);
      if (!googleProvider) {
        throw new Error('Google auth not configured');
      }
      await googleProvider.login();
    } catch {
      setError('Google login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      setError('Please enter email and password.');
      return;
    }

    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (mode === 'register' && !passwordMeetsRequirements) {
      setError('Password does not meet all requirements.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const emailProvider = authManager.getProvider(AUTH_PROVIDERS.EMAIL);
      if (!emailProvider) {
        throw new Error('Email auth not configured');
      }

      if (mode === 'register') {
        await emailProvider.register?.(email, password);
      } else {
        await emailProvider.login(email, password);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '';
      if (errorMessage.includes('auth/weak-password')) {
        setError('Password is too weak. Please use a stronger password.');
      } else if (errorMessage.includes('auth/invalid-email')) {
        setError('Please enter a valid email address.');
      } else if (mode === 'register') {
        setError(
          'Registration failed. Please try again or sign in if you already have an account.'
        );
      } else {
        setError('Invalid email or password.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError('Please enter your email address.');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const emailProvider = authManager.getProvider(AUTH_PROVIDERS.EMAIL);
      if (!emailProvider?.sendPasswordResetEmail) {
        throw new Error('Password reset not supported');
      }
      await emailProvider.sendPasswordResetEmail(email);
      setResetEmailSent(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('auth/user-not-found') || msg.includes('auth/invalid-email')) {
        // Don't reveal whether the email exists - show success anyway
        setResetEmailSent(true);
      } else {
        setError('Failed to send reset email. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setResetEmailSent(false);
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center">
      <div className="bg-white border border-neutral-200 rounded-xl shadow-sm p-8 w-full max-w-md">
        <h1 className="text-xl font-semibold text-brand-800 mb-4">
          {mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Reset password'}
        </h1>

        {!(mode === 'forgot-password' && resetEmailSent) && (
          <p className="text-sm text-brand-600 mb-6">
            {mode === 'login'
              ? 'Please sign in to continue.'
              : mode === 'register'
                ? 'Create a new account to get started.'
                : "Enter your email and we'll send you a reset link."}
          </p>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        {mode === 'forgot-password' && resetEmailSent ? (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
            If an account exists for <strong>{email}</strong>, a password reset email has been sent.
            Check your inbox and follow the link to reset your password.
          </div>
        ) : null}

        {mode === 'forgot-password' ? (
          !resetEmailSent && (
            <form onSubmit={handlePasswordReset} className="space-y-4 mb-4">
              <Field label="Email">
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  placeholder="Enter your email"
                />
              </Field>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
          )
        ) : (
          <form onSubmit={handleEmailSubmit} className="space-y-4 mb-4">
            <Field label="Email">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder="Enter your email"
              />
            </Field>

            <Field label="Password">
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                placeholder="Enter your password"
              />
              {mode === 'register' && <PasswordRequirementsList password={password} />}
            </Field>

            {mode === 'register' && (
              <Field label="Confirm password">
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  placeholder="Confirm your password"
                />
              </Field>
            )}

            <button
              type="submit"
              disabled={loading || (mode === 'register' && !passwordMeetsRequirements)}
              className="w-full inline-flex items-center justify-center h-9 px-4 text-sm font-medium bg-brand-600 text-white rounded-md shadow-sm hover:bg-brand-700 disabled:bg-neutral-300 disabled:text-neutral-500 disabled:shadow-none disabled:cursor-not-allowed transition-colors"
            >
              {loading
                ? mode === 'login'
                  ? 'Signing in…'
                  : 'Creating account…'
                : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}
            </button>

            {mode === 'login' && (
              <button
                type="button"
                onClick={() => {
                  setMode('forgot-password');
                  setError(null);
                  setPassword('');
                  setResetEmailSent(false);
                }}
                disabled={loading}
                className="w-full text-center text-sm text-brand-700 hover:text-brand-900 font-medium disabled:opacity-50 cursor-pointer"
              >
                Forgot your password?
              </button>
            )}
          </form>
        )}

        {mode !== 'forgot-password' && (
          <>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-brand-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-brand-700">or</span>
              </div>
            </div>

            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full px-4 py-2 bg-white border border-brand-300 text-brand-700 rounded hover:bg-brand-50 disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Signing in…' : 'Continue with Google'}
            </button>
          </>
        )}

        <p className="mt-6 text-center text-sm text-brand-600">
          {mode === 'forgot-password' ? (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                setResetEmailSent(false);
              }}
              disabled={loading}
              className="text-brand-700 hover:text-brand-900 font-medium disabled:opacity-50 cursor-pointer"
            >
              Back to sign in
            </button>
          ) : (
            <>
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                type="button"
                onClick={toggleMode}
                disabled={loading}
                className="text-brand-700 hover:text-brand-900 font-medium disabled:opacity-50 cursor-pointer"
              >
                {mode === 'login' ? 'Register' : 'Sign in'}
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
