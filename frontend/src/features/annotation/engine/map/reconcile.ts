import type BaseLayer from 'ol/layer/Base';
import { createLayer, destroyLayer, updateLayer } from './olLayerFactory';
import type { LayerId, LayerSpec } from './types';

/**
 * How many raster layers stay mounted but hidden. A retained layer holds its
 * loaded tiles, so this is really a bound on resident tile memory; past it the
 * least recently shown layer is destroyed.
 */
export const MAX_RETAINED_LAYERS = 16;

/** Spec fields a caller can change without the layer being rebuilt. */
export type LayerField =
  | 'slot'
  | 'url'
  | 'auth'
  | 'attribution'
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
  | { type: 'restore'; id: LayerId; spec: LayerSpec; changed: LayerField[] }
  | { type: 'update'; id: LayerId; spec: LayerSpec; changed: LayerField[] }
  | { type: 'retain'; id: LayerId; replacementId?: LayerId }
  | { type: 'remove'; id: LayerId };

/** What the diff needs to know about a layer that is already on the map. */
export interface MountedSpec {
  spec: LayerSpec;
  /** Hidden, kept for its loaded tiles, and the only eviction candidate. */
  retained: boolean;
}

export interface MountedLayer extends MountedSpec {
  layer: BaseLayer;
}

/** Where reconciled layers live. `ol/Map` satisfies this. */
export interface LayerHost {
  addLayer(layer: BaseLayer): void;
  removeLayer(layer: BaseLayer): unknown;
}

/** Only tile rasters are worth keeping: their cost is the tiles, not the layer. */
function retainable(spec: LayerSpec): boolean {
  return spec.kind === 'raster';
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
    push('slot', prev.slot === next.slot);
    push('url', prev.url === next.url);
    push('auth', prev.auth === next.auth);
    push('attribution', prev.attribution === next.attribution);
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
 * Retained ids from least to most recently shown: `current` is kept in that
 * order by `applyLayerOps`, and the layers retiring in this pass were on screen
 * until now, so they rank last.
 */
function evictable(
  current: ReadonlyMap<LayerId, MountedSpec>,
  returning: ReadonlySet<LayerId>,
  retiring: readonly LayerId[]
): LayerId[] {
  const stale: LayerId[] = [];
  for (const [id, entry] of current) {
    if (entry.retained && !returning.has(id)) stale.push(id);
  }
  return [...stale, ...retiring];
}

/**
 * Ops are ordered so the incoming layers reach the map before the outgoing ones
 * are hidden: switching to a layer whose tiles are already loaded never shows a
 * frame with neither of them. A kind change is the one remove that has to come
 * first, so its id is never claimed twice.
 */
export function reconcile(
  current: ReadonlyMap<LayerId, MountedSpec>,
  next: readonly LayerSpec[],
  retainLimit: number = MAX_RETAINED_LAYERS
): LayerOp[] {
  const nextById = new Map(next.map((spec) => [spec.id, spec]));
  const replacementBySlot = new Map<string, LayerId>();
  for (const spec of next) {
    if (spec.kind === 'raster' && spec.slot) replacementBySlot.set(spec.slot, spec.id);
  }
  const rebuilt: LayerOp[] = [];
  const adds: LayerOp[] = [];
  const restores: LayerOp[] = [];
  const updates: LayerOp[] = [];
  const drops: LayerOp[] = [];
  const retiring: LayerId[] = [];

  for (const [id, entry] of current) {
    const spec = nextById.get(id);
    if (spec) {
      if (spec.kind !== entry.spec.kind) rebuilt.push({ type: 'remove', id });
      continue;
    }
    if (entry.retained) continue;
    if (retainable(entry.spec)) retiring.push(id);
    else drops.push({ type: 'remove', id });
  }

  for (const spec of next) {
    const entry = current.get(spec.id);
    if (!entry || entry.spec.kind !== spec.kind) {
      adds.push({ type: 'add', spec });
      continue;
    }
    const changed = changedFields(entry.spec, spec);
    if (entry.retained) restores.push({ type: 'restore', id: spec.id, spec, changed });
    else if (changed.length > 0) updates.push({ type: 'update', id: spec.id, spec, changed });
  }

  const candidates = evictable(current, new Set(nextById.keys()), retiring);
  const evicted = new Set(candidates.slice(0, Math.max(0, candidates.length - retainLimit)));

  return [
    ...rebuilt,
    ...adds,
    ...restores,
    ...updates,
    ...retiring
      .filter((id) => !evicted.has(id))
      .map((id): LayerOp => {
        const spec = current.get(id)?.spec;
        const replacementId =
          spec?.kind === 'raster' && spec.slot ? replacementBySlot.get(spec.slot) : undefined;
        return { type: 'retain', id, replacementId };
      }),
    ...drops,
    ...[...evicted].map((id): LayerOp => ({ type: 'remove', id })),
  ];
}

/** Re-inserting moves an entry to the end, which is the recently-shown end. */
function touch(mounted: Map<LayerId, MountedLayer>, id: LayerId, entry: MountedLayer): void {
  mounted.delete(id);
  mounted.set(id, entry);
}

export function applyLayerOps(
  host: LayerHost,
  mounted: Map<LayerId, MountedLayer>,
  ops: readonly LayerOp[],
  lifecycle: {
    retireLayer?: (layerId: LayerId, layer: BaseLayer, replacement?: BaseLayer) => void;
  }
): void {
  for (const op of ops) {
    if (op.type === 'add') {
      const layer = createLayer(op.spec);
      host.addLayer(layer);
      mounted.set(op.spec.id, { spec: op.spec, layer, retained: false });
      continue;
    }

    const entry = mounted.get(op.id);
    if (!entry) continue;

    switch (op.type) {
      case 'restore':
        updateLayer(entry.layer, op.spec, op.changed);
        entry.spec = op.spec;
        entry.retained = false;
        entry.layer.setVisible(op.spec.visible ?? true);
        break;
      case 'update':
        updateLayer(entry.layer, op.spec, op.changed);
        entry.spec = op.spec;
        break;
      case 'retain':
        entry.retained = true;
        if (lifecycle.retireLayer) {
          const replacement = op.replacementId ? mounted.get(op.replacementId)?.layer : undefined;
          lifecycle.retireLayer(op.id, entry.layer, replacement);
        } else entry.layer.setVisible(false);
        touch(mounted, op.id, entry);
        break;
      case 'remove':
        host.removeLayer(entry.layer);
        destroyLayer(entry.layer);
        mounted.delete(op.id);
        break;
    }
  }
}
