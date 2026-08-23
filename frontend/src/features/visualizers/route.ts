/** The viewer's address. Kept free of every other import so the entry bundle
 *  can recognise a visualizer URL without pulling the page in. */

const SLUG = /^\/v\/([A-Za-z0-9_-]{6,32})\/?$/;

export const visualizerPath = (slug: string) => `/v/${slug}`;

export const visualizerSlugFromPath = (pathname: string): string | null =>
  SLUG.exec(pathname)?.[1] ?? null;

export const visualizerUrl = (slug: string) => `${window.location.origin}${visualizerPath(slug)}`;

/** Reviewing feedback happens on the published map itself, so that a remark is
 *  read over the imagery it was made about. */
export const FEEDBACK_HASH = '#feedback';

export const visualizerFeedbackPath = (slug: string) => `${visualizerPath(slug)}${FEEDBACK_HASH}`;
