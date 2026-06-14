/**
 * Manages the short-lived tiler session cookie.
 *
 * Calling the backend's `/auth/tiler-token` sets an `HttpOnly` cookie (the campaign-scoped
 * HS256 token) that the browser then attaches to tile requests automatically. The token
 * value never touches JS or tile URLs. We just track when to refresh the cookie, with
 * module-scoped caching + inflight dedup so the cold-start tile burst is one backend hit.
 */

import { getTilerToken as refreshTilerCookie } from './client';

let cookieExpiry = 0;
let inflight: Promise<void> | null = null;

// Refresh 60s before actual expiry to avoid races.
const REFRESH_BUFFER_S = 60;

/** Ensure a fresh tiler cookie is set. Cheap/cached while the current cookie is valid. */
export async function ensureTilerSession(): Promise<void> {
  const now = Date.now() / 1000;
  if (now < cookieExpiry - REFRESH_BUFFER_S) {
    return;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await refreshTilerCookie();
      const body = data as { expires_in: number } | undefined;
      if (error || !body) {
        throw new Error('Failed to refresh tiler session');
      }
      cookieExpiry = Date.now() / 1000 + body.expires_in;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function clearTilerSession(): void {
  cookieExpiry = 0;
  inflight = null;
}
