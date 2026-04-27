/**
 * Manages a short-lived HMAC token for authenticated tiler access.
 * The token is issued by the backend and verified by the tiler.
 *
 * Wraps the generated `getTilerToken` SDK call with module-scoped caching
 * (1h TTL) and inflight-promise deduplication so the cold-start tile burst
 * collapses into a single backend hit.
 */

import { getTilerToken as fetchTilerTokenFromApi } from './client';

let cachedToken: string | null = null;
let tokenExpiry = 0;
let inflight: Promise<string> | null = null;

// Refresh 60s before actual expiry to avoid race conditions
const REFRESH_BUFFER_S = 60;

export async function getTilerToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (cachedToken && now < tokenExpiry - REFRESH_BUFFER_S) {
    return cachedToken;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await fetchTilerTokenFromApi();
      // Backend route has no response_model, so the generated type is `unknown`.
      const body = data as { token: string; expires_in: number } | undefined;
      if (error || !body) {
        throw new Error('Failed to get tiler token');
      }
      cachedToken = body.token;
      tokenExpiry = Date.now() / 1000 + body.expires_in;
      return cachedToken;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function clearTilerToken(): void {
  cachedToken = null;
  tokenExpiry = 0;
  inflight = null;
}
