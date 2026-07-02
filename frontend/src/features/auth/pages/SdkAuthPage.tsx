import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '~/shared/ui/forms';
import { IS_LOCAL_AUTH } from '~/features/auth';
import { firebaseAuth } from '~/features/auth/adapters/firebase/firebaseApp';
import { isAllowedSdkCallback, submitHandoff, type SdkHandoff } from '../utils/sdkCallback';

function buildHandoff(): SdkHandoff | null {
  if (IS_LOCAL_AUTH) return { mode: 'local' };
  const user = firebaseAuth?.currentUser;
  const apiKey = firebaseAuth?.app.options.apiKey;
  if (!user || !apiKey) return null;
  return { mode: 'firebase', apiKey, refreshToken: user.refreshToken };
}

export function SdkAuthPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const callback = searchParams.get('callback') ?? '';

  if (!isAllowedSdkCallback(callback)) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-neutral-900 mb-3">Invalid SDK login link</h1>
          <p className="text-neutral-600">
            This page authorizes the STACNotator Python SDK and can only hand credentials to a local
            process on your own machine. Start the login from Python with{' '}
            <code className="text-sm bg-neutral-100 px-1 rounded">stacnotator.login(url)</code>.
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
        <h1 className="text-2xl font-semibold text-neutral-900 mb-3">
          Authorize the STACNotator SDK
        </h1>
        <p className="text-neutral-600 mb-6">
          A process on your machine (port {port}) is asking to act as your account. Authorizing
          hands it a login token so scripts can read campaign labels and register prediction layers
          without a password.
        </p>
        <p className="text-sm text-neutral-500 mb-8">
          Only continue if you just ran <code>stacnotator.login(...)</code> yourself.
        </p>
        {failed && (
          <p className="text-sm text-red-600 mb-4">
            Could not read your current session. Please reload and try again.
          </p>
        )}
        <div className="space-y-3">
          <Button variant="primary" className="w-full" onClick={authorize}>
            Authorize
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => navigate('/')}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
