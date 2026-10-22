import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '~/shared/ui/forms';
import { IS_LOCAL_AUTH } from '~/features/auth';
import { firebaseAuth } from '~/features/auth/adapters/firebase/firebaseApp';
import {
  apiBaseUrl,
  isAllowedSdkCallback,
  submitHandoff,
  type SdkHandoff,
} from '../utils/sdkCallback';

function buildHandoff(): SdkHandoff | null {
  const apiUrl = apiBaseUrl(import.meta.env.VITE_API_BASE_URL ?? '', window.location.origin);
  if (IS_LOCAL_AUTH) return { mode: 'local', apiUrl };
  const user = firebaseAuth?.currentUser;
  const apiKey = firebaseAuth?.app.options.apiKey;
  if (!user || !apiKey) return null;
  return { mode: 'firebase', apiKey, refreshToken: user.refreshToken, apiUrl };
}

export function SdkAuthPage() {
  const { t } = useTranslation(['auth', 'common']);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const callback = searchParams.get('callback') ?? '';

  if (!isAllowedSdkCallback(callback)) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-neutral-900 mb-3">{t('sdk.invalidTitle')}</h1>
          <p className="text-neutral-600">
            <Trans
              t={t}
              i18nKey="sdk.invalidBody"
              components={{ code: <code className="text-sm bg-neutral-100 px-1 rounded" /> }}
            />
          </p>
        </div>
      </div>
    );
  }

  const port = new URL(callback).port || '80';

  const authorize = () => {
    const handoff = buildHandoff();
    if (!handoff) {
      setFailed(true);
      return;
    }
    submitHandoff(callback, handoff);
  };

  return (
    <div className="flex-1 flex items-center justify-center py-16" data-testid="sdk-auth-page">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-neutral-900 mb-3">{t('sdk.title')}</h1>
        <p className="text-neutral-600 mb-6">{t('sdk.body', { port })}</p>
        <p className="text-sm text-neutral-500 mb-8">
          <Trans t={t} i18nKey="sdk.onlyContinue" components={{ code: <code /> }} />
        </p>
        {failed && <p className="text-sm text-red-600 mb-4">{t('sdk.sessionFailed')}</p>}
        <div className="space-y-3">
          <Button variant="primary" className="w-full" onClick={authorize}>
            {t('sdk.authorize')}
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => navigate('/')}>
            {t('common:actions.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
