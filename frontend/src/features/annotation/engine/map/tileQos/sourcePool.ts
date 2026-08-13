import type XYZ from 'ol/source/XYZ';

interface SourceEntry {
  source: XYZ;
  users: number;
}

const sources = new Map<string, SourceEntry>();

/** Share one OL tile/source cache wherever the same raster is visible twice. */
export function acquireRasterSource(key: string, create: () => XYZ): XYZ {
  const existing = sources.get(key);
  if (existing) {
    existing.users++;
    return existing.source;
  }
  const source = create();
  sources.set(key, { source, users: 1 });
  return source;
}

/** Drop the pool's reference once the final layer using a source is destroyed. */
export function releaseRasterSource(key: string): void {
  const entry = sources.get(key);
  if (!entry) return;
  entry.users--;
  if (entry.users === 0) sources.delete(key);
}
