import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { acceptTerms } from 'src/api/client';
import { useAuth } from '~/app/providers/AuthProvider';
import { useAccountStore } from '~/shared/stores/account.store';
import { Button } from '~/shared/ui/forms';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { LegalBody } from './LegalBody';
import { legalPath } from './docs';

/** Blocks the app until the signed-in user accepts the terms in force: new accounts
 * on their first visit, and everyone else once the version is bumped. */
const TermsGate = ({ version }: { version: string }) => {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const fetchAccount = useAccountStore((s) => s.fetchAccount);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agree = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await acceptTerms({ body: { version } });
      await fetchAccount();
    } catch (e) {
      setError(extractErrorMessage(e, t('legal.acceptFailed')));
      setSubmitting(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-canvas">
      <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 px-4 py-8">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">{t('legal.gateTitle')}</h1>
          <p className="mt-1 text-sm text-neutral-600">
            <Trans
              t={t}
              i18nKey="legal.gateIntro"
              components={{
                link: (
                  <a
                    href={legalPath('privacy')}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-brand-700"
                  />
                ),
              }}
            />
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
          <LegalBody doc="terms" />
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-6">
          <p className="text-xs text-neutral-600">{t('legal.gateConsent', { version })}</p>
          <div className="flex shrink-0 gap-2">
            <Button variant="quiet" onClick={() => auth.logout()} disabled={submitting}>
              {t('legal.signOut')}
            </Button>
            <Button
              variant="primary"
              onClick={agree}
              disabled={submitting}
              data-testid="accept-terms"
            >
              {submitting ? t('status.saving') : t('legal.agree')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TermsGate;
