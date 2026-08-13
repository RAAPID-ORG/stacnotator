import type { CategoricalEntry, CustomMapOut, RenderConfig } from '~/api/client';
import { isColormapName } from '~/shared/colormaps/colormaps';

export interface RenderOverride {
  colormap_name?: string | null;
  rescale?: [number, number];
  entries?: CategoricalEntry[];
}

/** Same shape as RenderOverride, generalized to any visualization's legend
 *  (not just custom maps) - see usePrefsStore.legendOverrides. */
export type LegendOverride = RenderOverride;

const COLOR_PARAMS = ['rescale', 'colormap_name', 'colormap'];

export function effectiveRenderConfig(
  config: RenderConfig,
  override: RenderOverride | undefined
): RenderConfig {
  if (!override) return config;
  const next = { ...config };
  if (override.colormap_name !== undefined) {
    // Overrides are persisted user prefs, so a name the schema doesn't know
    // reads as "no colormap" rather than reaching the tiler.
    const name = override.colormap_name;
    next.colormap_name = name !== null && isColormapName(name) ? name : null;
  }
  if (override.rescale !== undefined) next.rescale = override.rescale;
  if (override.entries !== undefined) next.entries = override.entries;
  return next;
}

export function isCustomized(config: RenderConfig, override: RenderOverride | undefined): boolean {
  if (!override) return false;
  return JSON.stringify(effectiveRenderConfig(config, override)) !== JSON.stringify(config);
}

const byteAt = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);

function hexToRgba(color: string): [number, number, number, number] | null {
  const h = color.startsWith('#') ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return null;
  const full = h.length === 6 ? `${h}ff` : h;
  return [byteAt(full, 0), byteAt(full, 2), byteAt(full, 4), byteAt(full, 6)];
}

function buildColormap(entries: CategoricalEntry[]): string | null {
  if (entries.length === 0) return null;
  const cmap: Record<string, [number, number, number, number]> = {};
  for (const entry of entries) {
    const rgba = hexToRgba(entry.color);
    if (!rgba) return null;
    cmap[String(Math.trunc(entry.value))] = rgba;
  }
  return JSON.stringify(cmap);
}

type ColorSpec =
  | { mode: 'continuous'; colormap_name: string; rescale: [number, number] }
  | { mode: 'categorical'; entries: CategoricalEntry[] };

/** Re-stamps the COLOR_PARAMS query params of a tile URL template, keeping
 *  the `{z}/{x}/{y}` placeholders unencoded (string-splice, not `new URL`,
 *  which would percent-encode them and stop OpenLayers substituting them). */
function stampColorParams(tileUrl: string, spec: ColorSpec | null): string {
  if (!spec) return tileUrl;

  const qIdx = tileUrl.indexOf('?');
  const path = qIdx === -1 ? tileUrl : tileUrl.slice(0, qIdx);
  const params = new URLSearchParams(qIdx === -1 ? '' : tileUrl.slice(qIdx + 1));
  for (const p of COLOR_PARAMS) params.delete(p);

  if (spec.mode === 'continuous') {
    params.set('rescale', `${spec.rescale[0]},${spec.rescale[1]}`);
    params.set('colormap_name', spec.colormap_name);
  } else {
    const colormap = buildColormap(spec.entries);
    if (!colormap) return tileUrl;
    params.set('colormap', colormap);
  }

  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Custom-map path: merge the override onto the campaign's render_config,
 *  falling back to the server's URL whenever the result would not render. */
export function applyRenderOverride(
  tileUrl: string,
  config: RenderConfig,
  override: RenderOverride | undefined
): string {
  if (!override) return tileUrl;
  const eff = effectiveRenderConfig(config, override);

  if (eff.mode === 'continuous') {
    if (!eff.colormap_name || !eff.rescale) return tileUrl;
    return stampColorParams(tileUrl, {
      mode: 'continuous',
      colormap_name: eff.colormap_name,
      rescale: eff.rescale,
    });
  }
  return stampColorParams(tileUrl, { mode: 'categorical', entries: eff.entries ?? [] });
}

/** Generalized path (no server-baked base config to merge against): used by
 *  `sliceRaster` for regular imagery visualizations. Categorical entries
 *  win over a colormap_name/rescale pair when both are present. */
export function stampLegendOverride(tileUrl: string, override: LegendOverride | undefined): string {
  if (!override) return tileUrl;
  if (override.entries && override.entries.length > 0) {
    return stampColorParams(tileUrl, { mode: 'categorical', entries: override.entries });
  }
  if (override.colormap_name && override.rescale) {
    return stampColorParams(tileUrl, {
      mode: 'continuous',
      colormap_name: override.colormap_name,
      rescale: override.rescale,
    });
  }
  return tileUrl;
}

export function readyCustomMaps(maps: CustomMapOut[]): CustomMapOut[] {
  return maps.filter((m) => m.status === 'ready' && !!m.tile_url);
}
