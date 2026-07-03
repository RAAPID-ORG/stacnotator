// The SDK login flow hands long-lived credentials to a localhost server the
// SDK spins up. Only loopback callback targets are acceptable - anything else
// would let a crafted link exfiltrate the user's refresh token.
export function isAllowedSdkCallback(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  return url.protocol === 'http:' && isLoopback && url.pathname === '/callback';
}

export type SdkHandoff =
  | { mode: 'local'; apiUrl: string }
  | { mode: 'firebase'; apiKey: string; refreshToken: string; apiUrl: string };

// The app and the API are different origins in dev (5173 vs 8000) and in
// production (static web app vs container app), so the page must tell the SDK
// where /api actually lives. Relative or empty bases resolve to the app origin.
export function apiBaseUrl(configuredBase: string, appOrigin: string): string {
  return new URL(configuredBase || '/', appOrigin).toString().replace(/\/$/, '');
}

// A top-level form POST (not fetch) so the tab navigates to the SDK's
// "login complete" page and no CORS preflight is involved.
export function submitHandoff(callbackUrl: string, handoff: SdkHandoff): void {
  const fields: Record<string, string> =
    handoff.mode === 'local'
      ? { mode: 'local', api_url: handoff.apiUrl }
      : {
          mode: 'firebase',
          api_key: handoff.apiKey,
          refresh_token: handoff.refreshToken,
          api_url: handoff.apiUrl,
        };

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = callbackUrl;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
