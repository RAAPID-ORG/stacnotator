/**
 * Manages a short-lived HMAC token for authenticated tiler access.
 * The token is issued by the backend and verified by the tiler.
 */

import { authManager } from '~/features/auth/index';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

let cachedToken: string | null = null;
let tokenExpiry = 0;

// Refresh 60s before actual expiry to avoid race conditions
const REFRESH_BUFFER_S = 60;

export async function getTilerToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (cachedToken && now < tokenExpiry - REFRESH_BUFFER_S) {
    return cachedToken;
  }

  const idToken = await authManager.getIdToken();
  const resp = await fetch(`${API_BASE}/api/auth/tiler-token`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!resp.ok) {
    throw new Error(`Failed to get tiler token: ${resp.status}`);
  }

  const data: { token: string; expires_in: number } = await resp.json();
  cachedToken = data.token;
  tokenExpiry = now + data.expires_in;
  return cachedToken;
}

export function clearTilerToken(): void {
  cachedToken = null;
  tokenExpiry = 0;
}
