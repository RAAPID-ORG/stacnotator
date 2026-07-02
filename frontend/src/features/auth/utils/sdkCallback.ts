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
  | { mode: 'local' }
  | { mode: 'firebase'; apiKey: string; refreshToken: string };

// A top-level form POST (not fetch) so the tab navigates to the SDK's
// "login complete" page and no CORS preflight is involved.
export function submitHandoff(callbackUrl: string, handoff: SdkHandoff): void {
  const fields: Record<string, string> =
    handoff.mode === 'local'
      ? { mode: 'local' }
      : { mode: 'firebase', api_key: handoff.apiKey, refresh_token: handoff.refreshToken };

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
