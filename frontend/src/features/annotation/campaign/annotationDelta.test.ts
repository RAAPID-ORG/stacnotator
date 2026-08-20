import { describe, expect, it } from 'vitest';
import {
  deltaIds,
  deltaWrites,
  emptyDelta,
  pendingCount,
  rotate,
  withDeletes,
  withWrites,
  type DeltaWrite,
} from './annotationDelta';

const point = (x: number): GeoJSON.Geometry => ({ type: 'Point', coordinates: [x, 0] });

const write = (id: number, over: Partial<DeltaWrite> = {}): DeltaWrite => ({
  id,
  labelId: 1,
  geometry: point(id),
  origin: 'local',
  ...over,
});

describe('annotation delta', () => {
  it('draws what was written and hides what was deleted', () => {
    const delta = withDeletes(withWrites(emptyDelta(), [write(1), write(2)]), [2]);

    expect(deltaWrites(delta).map((w) => w.id)).toEqual([1]);
    // Both are the delta's business: the deleted one is still in the tiles.
    expect(deltaIds(delta)).toEqual(new Set([1, 2]));
  });

  it('keeps the newest geometry for an annotation written twice', () => {
    const delta = withWrites(emptyDelta(), [write(1), write(1, { geometry: point(9) })]);

    expect(pendingCount(delta)).toBe(1);
    expect(deltaWrites(delta)[0].geometry).toEqual(point(9));
  });

  it('leaves our own work ours when the poll hands it back', () => {
    const delta = withWrites(withWrites(emptyDelta(), [write(1)]), [
      write(1, { origin: 'remote' }),
    ]);

    expect(deltaWrites(delta)[0].origin).toBe('local');
  });

  it('does not resurrect an annotation we deleted', () => {
    const delta = withWrites(withDeletes(emptyDelta(), [1]), [write(1, { origin: 'remote' })]);

    expect(deltaWrites(delta)).toEqual([]);
    expect(deltaIds(delta)).toEqual(new Set([1]));
  });

  // The refetch it belongs to is still in flight, so dropping it on the spot is
  // what would make that refetch blink.
  it('keeps drawing the retired generation until the one after it', () => {
    const first = rotate(withWrites(emptyDelta(), [write(1)]));
    expect(deltaWrites(first).map((w) => w.id)).toEqual([1]);
    expect(pendingCount(first)).toBe(0);

    const second = rotate(withWrites(first, [write(2)]));
    expect(deltaWrites(second).map((w) => w.id)).toEqual([2]);
  });

  it('lets a newer write win over the retired copy of the same annotation', () => {
    const rotated = rotate(withWrites(emptyDelta(), [write(1)]));
    const delta = withWrites(rotated, [write(1, { geometry: point(9) })]);

    expect(deltaWrites(delta)).toHaveLength(1);
    expect(deltaWrites(delta)[0].geometry).toEqual(point(9));
  });
});
