import type { LayerId, LayerSpec } from './types';

/** Spec fields a caller can change without the layer being rebuilt. */
export type LayerField =
  | 'url'
  | 'auth'
  | 'attribution'
  | 'trackStats'
  | 'minZoom'
  | 'maxZoom'
  | 'preload'
  | 'idProperty'
  | 'sourceLayers'
  | 'opacity'
  | 'zIndex'
  | 'visible'
  | 'style'
  | 'features'
  | 'hiddenFeatureIds'
  | 'highlightFeatureIds';

export type LayerOp =
  | { type: 'add'; spec: LayerSpec }
  | { type: 'remove'; id: LayerId }
  | { type: 'update'; id: LayerId; spec: LayerSpec; changed: LayerField[] };

/** What MapView keeps per mounted layer; only the spec matters for diffing. */
export interface MountedLayer {
  spec: LayerSpec;
}

function sameStyle(a: unknown, b: unknown): boolean {
  // Style callbacks are compared by identity: callers memoize them, and their
  // output is not knowable here.
  if (typeof a === 'function' || typeof b === 'function') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameIds(a: readonly unknown[] = [], b: readonly unknown[] = []): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Feature collections are compared by element identity: deep-comparing every
 * geometry each render would cost more than the re-render it saves. Callers keep
 * feature objects stable and replace the ones that changed.
 */
function sameFeatures(a: readonly unknown[], b: readonly unknown[]): boolean {
  return sameIds(a, b);
}

function changedFields(prev: LayerSpec, next: LayerSpec): LayerField[] {
  const changed: LayerField[] = [];
  const push = (field: LayerField, equal: boolean) => {
    if (!equal) changed.push(field);
  };

  if (prev.kind === 'raster' && next.kind === 'raster') {
    push('url', prev.url === next.url);
    push('auth', prev.auth === next.auth);
    push('attribution', prev.attribution === next.attribution);
    push('trackStats', prev.trackStats === next.trackStats);
    push('minZoom', prev.minZoom === next.minZoom);
    push('maxZoom', prev.maxZoom === next.maxZoom);
    push('preload', prev.preload === next.preload);
    push('opacity', prev.opacity === next.opacity);
  }
  if (prev.kind === 'vector-tiles' && next.kind === 'vector-tiles') {
    push('url', prev.url === next.url);
    push('idProperty', prev.idProperty === next.idProperty);
    push('sourceLayers', sameIds(prev.sourceLayers, next.sourceLayers));
    push('minZoom', prev.minZoom === next.minZoom);
    push('style', sameStyle(prev.style, next.style));
    push('hiddenFeatureIds', sameIds(prev.hiddenFeatureIds, next.hiddenFeatureIds));
    push('highlightFeatureIds', sameIds(prev.highlightFeatureIds, next.highlightFeatureIds));
  }
  if (prev.kind === 'features' && next.kind === 'features') {
    push('features', sameFeatures(prev.features, next.features));
    push('style', sameStyle(prev.style, next.style));
  }

  push('zIndex', prev.zIndex === next.zIndex);
  push('visible', prev.visible === next.visible);
  return changed;
}

/**
 * Ops are ordered removes, adds, then updates so a caller applying them in
 * sequence never has two layers claiming the same id (a kind change is a remove
 * plus an add).
 */
export function reconcile(
  current: ReadonlyMap<LayerId, MountedLayer>,
  next: readonly LayerSpec[]
): LayerOp[] {
  const nextById = new Map(next.map((spec) => [spec.id, spec]));
  const removes: LayerOp[] = [];
  const adds: LayerOp[] = [];
  const updates: LayerOp[] = [];

  for (const [id, mounted] of current) {
    const spec = nextById.get(id);
    if (!spec || spec.kind !== mounted.spec.kind) removes.push({ type: 'remove', id });
  }

  for (const spec of next) {
    const mounted = current.get(spec.id);
    if (!mounted || mounted.spec.kind !== spec.kind) {
      adds.push({ type: 'add', spec });
      continue;
    }
    const changed = changedFields(mounted.spec, spec);
    if (changed.length > 0) updates.push({ type: 'update', id: spec.id, spec, changed });
  }

  return [...removes, ...adds, ...updates];
}
