/**
 * Manages the short-lived tile session cookies.
 *
 * Each scope - a campaign, or a visualizer - has its own `HttpOnly` cookie, set by the
 * backend on that scope's tile paths only, so a tile request carries one small cookie
 * however many campaigns exist. The token value never touches JS or tile URLs. We just
 * track when each scope's cookie needs minting again, with inflight dedup so the
 * cold-start tile burst is one backend hit per scope.
 */

import { getCampaignTilerToken } from './client';

/** Sets the cookie for a scope and reports how long it lasts, in seconds. */
export type TilerSessionMinter = (scope: string) => Promise<number>;

const signedInUserMinter: TilerSessionMinter = async (scope) => {
  if (!/^\d+$/.test(scope)) throw new Error(`No tile session for scope ${scope}`);
  const { data, error } = await getCampaignTilerToken({ path: { campaign_id: Number(scope) } });
  if (error || !data) throw new Error('Failed to refresh tiler session');
  return data.expires_in;
};

let minter = signedInUserMinter;

interface Session {
  attemptedAt: number;
  expiry: number;
  // The mint in flight, or one that failed, which is handed back until the cooldown
  // passes so a backend outage is not multiplied by every tile on screen.
  mint: Promise<void> | null;
  failed: boolean;
}

const sessions = new Map<string, Session>();

// Refresh 60s before actual expiry to avoid races.
const REFRESH_BUFFER_S = 60;
// Neither a failing tile nor a failed mint starts a new mint sooner than this
// after the last attempt, so failures cannot turn into a mint per tile.
const REMINT_AFTER_S = 30;

/**
 * Point the tiler session at a different source of cookies.
 *
 * A shared visualizer mints from its own slug, so a visitor with no account
 * still gets tile access - scoped to that visualizer and the layers it links,
 * and nothing else. Passing null restores the signed-in user's own sessions.
 */
export function setTilerSessionMinter(next: TilerSessionMinter | null): void {
  minter = next ?? signedInUserMinter;
  sessions.clear();
}

/** The scope a credentialed tile URL is served under: the `/scopes/<scope>/`
 *  segment of a tiler URL, or the campaign or visualizer of a backend proxy route. */
export function tileScope(url: string): string | null {
  const tiler = /\/scopes\/([^/]+)\/searches\//.exec(url);
  if (tiler) return decodeURIComponent(tiler[1]);
  const campaign = /\/api\/campaigns\/(\d+)\//.exec(url);
  if (campaign) return campaign[1];
  const visualizer = /\/api\/visualizers\/(\d+)\//.exec(url);
  return visualizer ? `visualizer:${visualizer[1]}` : null;
}

/** Ensure a fresh cookie for this scope. Cheap while the current one is valid. */
export function ensureTilerSession(scope: string): Promise<void> {
  const now = Date.now() / 1000;
  const session = sessions.get(scope) ?? { attemptedAt: 0, expiry: 0, mint: null, failed: false };
  sessions.set(scope, session);
  const coolingDown = now - session.attemptedAt < REMINT_AFTER_S;
  if (session.mint && (!session.failed || coolingDown)) return session.mint;
  if (now < session.expiry - REFRESH_BUFFER_S) return Promise.resolve();

  session.attemptedAt = now;
  session.failed = false;
  session.mint = minter(scope).then(
    (expiresIn) => {
      session.expiry = Date.now() / 1000 + expiresIn;
      session.mint = null;
    },
    (err: unknown) => {
      session.failed = true;
      throw err;
    }
  );
  return session.mint;
}

/** A tile in this scope failed: mint again on the next request, in case the
 *  browser no longer holds the cookie we think it does. */
export function expireTilerSession(scope: string): void {
  const session = sessions.get(scope);
  if (session && Date.now() / 1000 - session.attemptedAt >= REMINT_AFTER_S) session.expiry = 0;
}
