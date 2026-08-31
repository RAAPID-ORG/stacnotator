export const LEGAL_DOCS = [
  { key: 'terms', title: 'Terms' },
  { key: 'privacy', title: 'Privacy' },
] as const;

export type LegalKey = (typeof LEGAL_DOCS)[number]['key'];

export const legalPath = (key: LegalKey) => `/legal/${key}`;

const isLegalKey = (value: string): value is LegalKey =>
  LEGAL_DOCS.some((doc) => doc.key === value);

/** The document a path names, or null when it is not a legal page. Kept free of the
 * markdown imports so the entry bundle can match the path without pulling them in. */
export const legalKeyFromPath = (pathname: string): LegalKey | null => {
  const key = /^\/legal\/([a-z]+)\/?$/.exec(pathname)?.[1];
  return key && isLegalKey(key) ? key : null;
};
