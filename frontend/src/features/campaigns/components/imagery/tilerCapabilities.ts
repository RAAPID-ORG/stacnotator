import type { TilerOption } from '~/api/client';
import i18n from '~/shared/i18n';

/** Temporal compositing methods, in the order the wizard offers them. MPC's own tile
 *  endpoint only ever returns the first valid pixel; everything past it is computed by a
 *  self-hosted titiler-pgstac tiler, so it needs one that can serve the catalog. */
export const COMPOSITING_METHODS = [
  { value: 'first', label: 'tiler.methods.first' },
  { value: 'mean', label: 'tiler.methods.mean' },
  { value: 'median', label: 'tiler.methods.median' },
  { value: 'max', label: 'tiler.methods.max' },
  { value: 'min', label: 'tiler.methods.min' },
  { value: 'ndvi_best', label: 'tiler.methods.ndviBest' },
] as const;

const FIRST_VALID_ONLY = ['first'];

const originOf = (url: string): string => {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return '';
  }
};

/** The hosted tiler that would render tiles for `catalogUrl`, or undefined when the
 *  organization has none that can. Mirrors the backend's `registry.serving_tiler`: a
 *  catalog hosted on a platform tiler is served by that tiler, anything else (MPC,
 *  StacIndex, a user-supplied URL) has to be ingested first. */
export const servingTiler = (
  catalogUrl: string,
  pinned: string | null | undefined,
  tilers: TilerOption[]
): TilerOption | undefined => {
  const hosted = tilers.filter((t) => t.kind === 'hosted');
  const own = hosted.find((t) => t.stac_url && originOf(t.stac_url) === originOf(catalogUrl));
  if (own) return own;
  const ingesting = hosted.filter((t) => t.allows_ingest);
  return (
    ingesting.find((t) => t.name === pinned) ?? ingesting.find((t) => t.is_default) ?? ingesting[0]
  );
};

/** Compositing methods available when `tiler` renders the tiles. */
export const compositingMethods = (tiler: TilerOption | undefined): string[] =>
  tiler ? COMPOSITING_METHODS.map((m) => m.value) : FIRST_VALID_ONLY;

export const noTilerNote = () => i18n.t('imagery:tiler.noTilerNote');
