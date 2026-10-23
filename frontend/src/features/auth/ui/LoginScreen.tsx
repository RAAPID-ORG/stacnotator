import { useState, useMemo, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { authManager, AUTH_PROVIDERS } from '~/features/auth/index';
import { PasswordRequirementsList, passwordMeetsAllRequirements } from './PasswordRequirements';
import { Button, Field, Input } from '~/shared/ui/forms';
import { legalPath, type LegalKey } from '~/features/legal/docs';
import { AuthCard } from './AuthCard';
import {
  authErrorMessage,
  isUnknownAccountError,
  SIGN_IN_ERRORS,
} from '../adapters/firebase/errors';

type AuthMode = 'login' | 'register' | 'forgot-password';

const LegalLink = ({ doc, children }: { doc: LegalKey; children?: ReactNode }) => (
  <a
    href={legalPath(doc)}
    target="_blank"
    rel="noreferrer"
    className="underline text-brand-700 hover:text-brand-900"
  >
    {children}
  </a>
);

/** Sits directly under whichever button the user is about to press - courts read a
 * sign-in wrap as accepted only when the notice is next to the action it binds. */
const LegalNotice = () => (
  <p className="text-center text-xs text-brand-500">
    <Trans
      ns="auth"
      i18nKey="login.legalNotice"
      components={{ terms: <LegalLink doc="terms" />, privacy: <LegalLink doc="privacy" /> }}
    />
  </p>
);

export function LoginScreen() {
  const { t } = useTranslation('auth');
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
      setError(t('login.errors.googleFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      setError(t('login.errors.missingCredentials'));
      return;
    }

    if (mode === 'register' && password !== confirmPassword) {
      setError(t('login.errors.passwordsMismatch'));
      return;
    }

    if (mode === 'register' && !passwordMeetsRequirements) {
      setError(t('login.errors.passwordRequirements'));
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
      const fallback =
        mode === 'register'
          ? t('login.errors.registrationFailed')
          : t('login.errors.invalidCredentials');
      setError(authErrorMessage(err, SIGN_IN_ERRORS, fallback));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError(t('login.errors.missingEmail'));
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
      if (isUnknownAccountError(err)) {
        // Don't reveal whether the email exists - show success anyway
        setResetEmailSent(true);
      } else {
        setError(t('login.errors.resetFailed'));
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
    <AuthCard>
      <h1 className="text-xl font-semibold text-brand-800 mb-4">
        {mode === 'login'
          ? t('login.title.login')
          : mode === 'register'
            ? t('login.title.register')
            : t('login.title.forgotPassword')}
      </h1>

      {!(mode === 'forgot-password' && resetEmailSent) && (
        <p className="text-sm text-brand-600 mb-6">
          {mode === 'login'
            ? t('login.intro.login')
            : mode === 'register'
              ? t('login.intro.register')
              : t('login.intro.forgotPassword')}
        </p>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {mode === 'forgot-password' && resetEmailSent ? (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
          <Trans
            t={t}
            i18nKey="login.resetSent"
            values={{ email }}
            components={{ strong: <strong /> }}
          />
        </div>
      ) : null}

      {mode === 'forgot-password' ? (
        !resetEmailSent && (
          <form onSubmit={handlePasswordReset} className="space-y-4 mb-4">
            <Field label={t('login.email')}>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder={t('login.emailPlaceholder')}
              />
            </Field>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? t('login.sending') : t('login.sendResetLink')}
            </Button>
          </form>
        )
      ) : (
        <form onSubmit={handleEmailSubmit} className="space-y-4 mb-4">
          <Field label={t('login.email')}>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder={t('login.emailPlaceholder')}
            />
          </Field>

          <Field label={t('login.password')}>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder={t('login.passwordPlaceholder')}
            />
            {mode === 'register' && <PasswordRequirementsList password={password} />}
          </Field>

          {mode === 'register' && (
            <Field label={t('login.confirmPassword')}>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                placeholder={t('login.confirmPasswordPlaceholder')}
              />
            </Field>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={loading || (mode === 'register' && !passwordMeetsRequirements)}
          >
            {loading
              ? mode === 'login'
                ? t('login.signingIn')
                : t('login.creatingAccount')
              : mode === 'login'
                ? t('login.signIn')
                : t('login.createAccount')}
          </Button>

          <LegalNotice />

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
              {t('login.forgotPasswordLink')}
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
              <span className="px-2 bg-white text-brand-700">{t('login.or')}</span>
            </div>
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full px-4 py-2 bg-white border border-brand-300 text-brand-700 rounded hover:bg-brand-50 disabled:opacity-50 cursor-pointer"
          >
            {loading ? t('login.signingIn') : t('login.continueWithGoogle')}
          </button>

          <div className="mt-3">
            <LegalNotice />
          </div>
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
            {t('login.backToSignIn')}
          </button>
        ) : (
          <>
            {mode === 'login' ? t('login.noAccount') : t('login.haveAccount')}
            <button
              type="button"
              onClick={toggleMode}
              disabled={loading}
              className="text-brand-700 hover:text-brand-900 font-medium disabled:opacity-50 cursor-pointer"
            >
              {mode === 'login' ? t('login.register') : t('login.signIn')}
            </button>
          </>
        )}
      </p>
    </AuthCard>
  );
}
