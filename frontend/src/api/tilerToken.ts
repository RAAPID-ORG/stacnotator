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
// The campaign id the current cookie was last minted for. The cookie is a snapshot of the
// user's campaigns at mint time, so entering a campaign we haven't minted for since (just
// created / just joined) needs a re-mint, else the tiler 403s on that campaign's tiles.
let mintedForCampaign: string | null = null;

// Refresh 60s before actual expiry to avoid races.
const REFRESH_BUFFER_S = 60;

/** Ensure a fresh tiler cookie is set. Cheap/cached while the current cookie is valid.
 *  Pass `campaignId` on campaign entry to also re-mint when switching to a campaign not
 *  covered by the current cookie. Many windows entering the same campaign dedupe to one
 *  mint (via inflight + mintedForCampaign). */
export async function ensureTilerSession(campaignId?: string): Promise<void> {
  const now = Date.now() / 1000;
  const stale = now >= cookieExpiry - REFRESH_BUFFER_S;
  const campaignChanged = campaignId != null && campaignId !== mintedForCampaign;
  if (!stale && !campaignChanged) {
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
      if (campaignId != null) mintedForCampaign = campaignId;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function clearTilerSession(): void {
  cookieExpiry = 0;
  inflight = null;
  mintedForCampaign = null;
}
