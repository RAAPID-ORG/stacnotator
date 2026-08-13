import { describe, it, expect } from 'vitest';
import { emptyKey, markEmpty, SNAPSHOT_FIELDS } from './types';

describe('emptyKey', () => {
  it('formats collectionId:sliceIndex', () => {
    expect(emptyKey(10, 3)).toBe('10:3');
  });
});

describe('markEmpty', () => {
  it('adds the key when absent', () => {
    const next = markEmpty({}, emptyKey(10, 3));
    expect(next).toEqual({ '10:3': true });
  });

  it('returns the same reference when the key is already marked', () => {
    const prev = { '10:3': true as const };
    expect(markEmpty(prev, emptyKey(10, 3))).toBe(prev);
  });

  it('does not mutate the input', () => {
    const prev = { '1:1': true as const };
    const next = markEmpty(prev, emptyKey(2, 2));
    expect(prev).toEqual({ '1:1': true });
    expect(next).toEqual({ '1:1': true, '2:2': true });
  });
});

describe('SNAPSHOT_FIELDS', () => {
  it('snapshots view navigation but not task-scoped empty results', () => {
    // A per-view snapshot has to carry vector layer + basemap selection,
    // and must exclude the app-wide toggles (crosshair/showAnnotations/
    // viewSync), which live on ImageryNavState but are not per-view.
    expect([...SNAPSHOT_FIELDS].sort()).toEqual(
      ['address', 'overlay', 'overlayOpacity', 'selectedBasemapId', 'showBasemap', 'vector'].sort()
    );
  });

  // Type-level guarantee (see types.ts's SNAPSHOT_FIELD_MAP comment): the
  // map is declared `satisfies Record<keyof ImageryNavState, boolean>`, so
  // adding a field to ImageryNavState without adding it to the map fails
  // `npm run typecheck` - e.g. given
  //   interface ImageryNavState { ...; newField: string }
  // and no matching `newField: true | false` entry in SNAPSHOT_FIELD_MAP,
  // tsc reports:
  //   Property 'newField' is missing in type '{ address: true; ... }' but
  //   required in type 'Record<keyof ImageryNavState, boolean>'.
  // A plain `readonly (keyof ImageryNavState)[]` array (the prior design)
  // does not have this property: it only validates *listed* keys, so an
  // unlisted new field compiles silently and is silently dropped from
  // ViewSnapshot.
});
