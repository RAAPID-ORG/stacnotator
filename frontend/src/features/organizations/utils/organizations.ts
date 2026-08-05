const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Keeps the persisted org selection honest: an id that is no longer in the
 *  viewer's list (org deleted, access revoked) falls back to the first
 *  available org. An explicit "no organization" (null) is a real choice and
 *  is left alone. */
export const reconcileActiveOrgId = (
  orgIds: number[],
  activeOrgId: number | null
): number | null => {
  if (activeOrgId === null || orgIds.includes(activeOrgId)) return activeOrgId;
  return orgIds[0] ?? null;
};

export interface ParsedEmails {
  emails: string[];
  invalid: string[];
}

/** Splits pasted text on commas/semicolons/whitespace, dedupes
 *  case-insensitively and separates entries that cannot be an address. */
export const parseEmailList = (raw: string): ParsedEmails => {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];

  for (const token of raw.split(/[\s,;]+/)) {
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (EMAIL_PATTERN.test(token)) emails.push(token);
    else invalid.push(token);
  }

  return { emails, invalid };
};
