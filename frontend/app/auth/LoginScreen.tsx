import { useState, useMemo } from 'react';
import { authManager, AUTH_PROVIDERS } from '~/auth/index';

type AuthMode = 'login' | 'register';

interface PasswordRequirement {
  label: string;
  test: (password: string) => boolean;
}

const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'One number', test: (p) => /[0-9]/.test(p) },
  { label: 'One special character', test: (p) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p) },
];

function PasswordRequirementIndicator({ requirement, password }: { requirement: PasswordRequirement; password: string }) {
  const met = password.length > 0 && requirement.test(password);
  const partial = password.length > 0 && !met;
  
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className={`w-4 h-4 rounded-full flex items-center justify-center ${
        met ? 'bg-brand-500' : partial ? 'bg-neutral-300' : 'bg-neutral-200'
      }`}>
        {met && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <span className={met ? 'text-brand-700' : 'text-neutral-600'}>
        {requirement.label}
      </span>
    </div>
  );
}

export function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const passwordMeetsRequirements = useMemo(() => {
    return PASSWORD_REQUIREMENTS.every(req => req.test(password));
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
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      if (errorMessage.includes('auth/email-already-in-use')) {
        setError('This email is already registered. Please login instead.');
      } else if (errorMessage.includes('auth/invalid-credential') || errorMessage.includes('auth/wrong-password')) {
        setError('Invalid email or password.');
      } else if (errorMessage.includes('auth/user-not-found')) {
        setError('No account found with this email. Please register first.');
      } else if (errorMessage.includes('auth/weak-password')) {
        setError('Password is too weak. Please use a stronger password.');
      } else if (errorMessage.includes('auth/invalid-email')) {
        setError('Please enter a valid email address.');
      } else {
        setError(mode === 'register' ? 'Registration failed. Please try again.' : 'Login failed. Please try again.');
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
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-neutral-50">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md">
        <h1 className="text-xl font-semibold text-brand-800 mb-4">
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </h1>

        <p className="text-sm text-brand-600 mb-6">
          {mode === 'login' ? 'Please sign in to continue.' : 'Create a new account to get started.'}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleEmailSubmit} className="space-y-4 mb-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-brand-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 border border-brand-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
              placeholder="Enter your email"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-brand-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 border border-brand-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
              placeholder="Enter your password"
            />
            
            {mode === 'register' && password.length > 0 && (
              <div className="mt-3 p-3 bg-neutral-50 rounded border border-neutral-200">
                <p className="text-xs font-medium text-brand-700 mb-2">Password must contain:</p>
                <div className="space-y-1.5">
                  {PASSWORD_REQUIREMENTS.map((req, idx) => (
                    <PasswordRequirementIndicator key={idx} requirement={req} password={password} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {mode === 'register' && (
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-brand-700 mb-1">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                className="w-full px-3 py-2 border border-brand-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
                placeholder="Confirm your password"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (mode === 'register' && !passwordMeetsRequirements)}
            className="w-full px-4 py-2 bg-brand-500 text-white rounded hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            {loading ? (mode === 'login' ? 'Signing in…' : 'Creating account…') : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-brand-300"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-brand-500">or</span>
          </div>
        </div>

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full px-4 py-2 bg-white border border-brand-300 text-brand-700 rounded hover:bg-brand-50 disabled:opacity-50 cursor-pointer"
        >
          {loading ? 'Signing in…' : 'Continue with Google'}
        </button>

        <p className="mt-6 text-center text-sm text-brand-600">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={toggleMode}
            disabled={loading}
            className="text-brand-500 hover:text-brand-700 font-medium disabled:opacity-50 cursor-pointer"
          >
            {mode === 'login' ? 'Register' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
