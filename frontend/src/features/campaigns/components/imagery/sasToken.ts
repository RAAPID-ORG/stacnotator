import type { CollectionItem, ImagerySource, StacBrowserCollectionData } from './types';

/** Reading an Azure SAS token the admin pastes for a private catalog, so the form can say
 *  straight away whether it will be accepted and when it runs out. The server checks the
 *  same rules again; this is only the immediate feedback. */

export type SasReading = { token: string; expiresAt: Date } | { error: string };

const READ_ONLY = new Set(['r', 'l']);

export function readSasToken(raw: string, now = new Date()): SasReading {
  const token = raw.trim().replace(/^\?/, '');
  if (token.includes('://')) return { error: 'Paste only the SAS token, not a URL' };
  const params = new URLSearchParams(token);
  if (!params.get('sig')) return { error: 'This is not a SAS token: it has no signature (sig)' };
  if (params.has('ss') || params.has('srt')) {
    return { error: 'Account SAS tokens are not accepted; create one for the container instead' };
  }
  const permissions = [...(params.get('sp') ?? '')];
  if (!permissions.length || permissions.some((p) => !READ_ONLY.has(p))) {
    return { error: 'The SAS token must grant read (and optionally list) only' };
  }
  if ((params.get('spr') ?? 'https') !== 'https') {
    return { error: 'The SAS token must be limited to HTTPS' };
  }
  const expiry = params.get('se');
  if (!expiry) return { error: 'The SAS token must have an expiry (se)' };
  const expiresAt = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(expiry) ? expiry : `${expiry}Z`);
  if (Number.isNaN(expiresAt.getTime())) {
    return { error: "The SAS token's expiry (se) is not a valid date" };
  }
  if (expiresAt <= now) return { error: 'This SAS token has already expired' };
  return { token, expiresAt };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** From this close to expiry on, admins are warned. */
export const EXPIRY_WARNING_DAYS = 3;

export function daysUntil(expiresAt: Date | string, now = new Date()): number {
  return Math.floor((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS);
}

/** "expires 12 Oct 2026 (in 6 days)", "expired 3 Oct 2026". */
export function describeExpiry(expiresAt: Date | string, now = new Date()): string {
  const date = new Date(expiresAt);
  const label = date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  if (date <= now) return `expired ${label}`;
  const days = daysUntil(date, now);
  const left = days < 1 ? 'today' : days === 1 ? 'in 1 day' : `in ${days} days`;
  return `expires ${label} (${left})`;
}

export function expiresSoon(expiresAt: Date | string | null | undefined, now = new Date()) {
  return expiresAt != null && daysUntil(expiresAt, now) < EXPIRY_WARNING_DAYS;
}

type PrivateCollection = CollectionItem & { data: StacBrowserCollectionData };

export const privateCollections = (source: ImagerySource): PrivateCollection[] =>
  source.collections.filter(
    (c): c is PrivateCollection =>
      c.data.type === 'stac_browser' && !!(c.data.storageAccess || c.data.sasToken)
  );

/** The soonest a source's private-catalog access runs out, if it reads any. */
export const sourceAccessExpiry = (source: ImagerySource): string | null =>
  privateCollections(source)
    .map((c) => c.data.storageAccess?.expiresAt)
    .filter((at): at is string => !!at)
    .sort()[0] ?? null;
