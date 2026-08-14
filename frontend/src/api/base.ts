/**
 * Where the backend is, for URLs the browser resolves on its own.
 *
 * Most calls go through the generated client, which is configured with this base. Tile
 * URLs cannot: they are handed to OpenLayers as strings, so they have to carry the base
 * themselves. A root-relative `/api/...` only works when the API shares the app's origin
 * (production, behind the Static Web App). In the dev stack the app is served by Vite on
 * :5173 while the API is on :8000, and a relative path there reaches the dev server,
 * which answers every unknown path with `index.html` - a 200 (then 304) that no tile
 * layer can decode.
 */

/** Configured API origin, without a trailing slash. Empty when same-origin. */
export const apiBase = (): string => (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/** Absolute URL for a backend path, or the path itself when the API is same-origin. */
export const apiUrl = (path: string): string => `${apiBase()}${path}`;
