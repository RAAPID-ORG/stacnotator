/**
 * What the annotation tiles do not show yet.
 *
 * Tiles are rendered by PostGIS and cached for an hour, so a write only reaches
 * them when the tile URL's version changes and the whole viewport is
 * refreshed - which drops every loaded tile. So a write is kept here and drawn
 * over the tiles, and the tiles are only refreshed once the delta has grown
 * past `TILE_REFRESH_AFTER`.
 *
 * `settled` is the generation the last refresh covered. It keeps being drawn
 * until the generation after it retires it: the tiles carrying those shapes are
 * still on their way, and something has to draw them meanwhile.
 */

export type DeltaOrigin = 'local' | 'remote';

export interface DeltaWrite {
  id: number;
  labelId: number | null;
  geometry: GeoJSON.Geometry;
  /** 'remote' means another annotator made it and we picked it up while
   *  polling; the map marks those out until they are part of the tiles. */
  origin: DeltaOrigin;
}

/** `null` is a deletion: the id is known, its geometry is gone. */
type DeltaValue = DeltaWrite | null;

export interface AnnotationDelta {
  /** Written since the last refresh. Drawn from here, hidden in the tiles. */
  pending: ReadonlyMap<number, DeltaValue>;
  /** The generation the last refresh covered, still drawn until the next one. */
  settled: ReadonlyMap<number, DeltaValue>;
}

/** How many writes ride in the delta before the tiles are refreshed. Past this
 *  the overlay is doing the tile layer's job: many features, none of them
 *  clipped or simplified, re-read on every write. */
export const TILE_REFRESH_AFTER = 400;

export const emptyDelta = (): AnnotationDelta => ({ pending: new Map(), settled: new Map() });

export const pendingCount = (delta: AnnotationDelta): number => delta.pending.size;

/**
 * Add writes. A local write always wins the origin: something we drew stays
 * ours even when the poll hands it back, and a shape we deleted is not
 * resurrected by a poll that ran before the delete landed.
 */
export function withWrites(delta: AnnotationDelta, writes: DeltaWrite[]): AnnotationDelta {
  if (writes.length === 0) return delta;
  const pending = new Map(delta.pending);
  for (const write of writes) {
    const existing = pending.get(write.id);
    if (existing === null) continue;
    pending.set(write.id, {
      ...write,
      origin: existing?.origin === 'local' ? 'local' : write.origin,
    });
  }
  return { ...delta, pending };
}

export function withDeletes(delta: AnnotationDelta, ids: readonly number[]): AnnotationDelta {
  if (ids.length === 0) return delta;
  const pending = new Map(delta.pending);
  for (const id of ids) pending.set(id, null);
  return { ...delta, pending };
}

/** Retire the generation the tiles now carry and start collecting the next. */
export const rotate = (delta: AnnotationDelta): AnnotationDelta => ({
  pending: new Map(),
  settled: delta.pending,
});

/** Everything the overlay draws, pending over settled. */
export function deltaWrites(delta: AnnotationDelta): DeltaWrite[] {
  const merged = new Map<number, DeltaValue>([...delta.settled, ...delta.pending]);
  return [...merged.values()].filter((write): write is DeltaWrite => write !== null);
}

/** Every id the delta owns - written or deleted, either generation. The tiles
 *  hide all of them, so nothing is drawn twice and nothing deleted lingers. */
export const deltaIds = (delta: AnnotationDelta): Set<number> =>
  new Set([...delta.settled.keys(), ...delta.pending.keys()]);
