/**
 * Per-device colour tweaks to a custom map, layered over the campaign's render config.
 *
 * The backend bakes colours into `tile_url` as viz query params at registration time
 * (see `custom_maps/render.py`), so a local override has to re-stamp those params on the
 * URL template client-side. `COLOR_PARAMS` below mirrors what that module emits, and a
 * backend test (`test_colour_carrying_params_are_the_ones_the_frontend_rewrites`) fails if
 * the two drift apart. `mode` is never overridable.
 */
import type { CategoricalEntry, RenderConfig } from '~/api/client';
import type { ColormapName } from '~/shared/utils/customMapColormaps';

export interface RenderOverride {
  colormap_name?: ColormapName;
  rescale?: [number, number];
  entries?: CategoricalEntry[];
}

const COLOR_PARAMS = ['rescale', 'colormap_name', 'colormap'];

export function effectiveRenderConfig(
  config: RenderConfig,
  override: RenderOverride | undefined
): RenderConfig {
  if (!override) return config;
  const next = { ...config };
  if (override.colormap_name !== undefined) next.colormap_name = override.colormap_name;
  if (override.rescale !== undefined) next.rescale = override.rescale;
  if (override.entries !== undefined) next.entries = override.entries;
  return next;
}

export function isCustomized(config: RenderConfig, override: RenderOverride | undefined): boolean {
  if (!override) return false;
  return JSON.stringify(effectiveRenderConfig(config, override)) !== JSON.stringify(config);
}

/**
 * Re-stamp the colour params of a server-built tile URL from a local override, falling back
 * to the server's URL whenever the result would not render.
 *
 * Deliberately string-splices rather than using `new URL`, which would percent-encode the
 * `{z}/{x}/{y}` placeholders and stop OpenLayers substituting them.
 */
export function applyRenderOverride(
  tileUrl: string,
  config: RenderConfig,
  override: RenderOverride | undefined
): string {
  if (!override) return tileUrl;
  const eff = effectiveRenderConfig(config, override);

  const qIdx = tileUrl.indexOf('?');
  const path = qIdx === -1 ? tileUrl : tileUrl.slice(0, qIdx);
  const params = new URLSearchParams(qIdx === -1 ? '' : tileUrl.slice(qIdx + 1));
  for (const p of COLOR_PARAMS) params.delete(p);

  if (eff.mode === 'continuous') {
    if (!eff.colormap_name || !eff.rescale) return tileUrl;
    params.set('rescale', `${eff.rescale[0]},${eff.rescale[1]}`);
    params.set('colormap_name', eff.colormap_name);
  } else {
    const colormap = buildColormap(eff.entries ?? []);
    if (!colormap) return tileUrl;
    params.set('colormap', colormap);
  }

  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
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

const byte = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);

function hexToRgba(color: string): [number, number, number, number] | null {
  const h = color.startsWith('#') ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return null;
  const full = h.length === 6 ? `${h}ff` : h;
  return [byte(full, 0), byte(full, 2), byte(full, 4), byte(full, 6)];
}
