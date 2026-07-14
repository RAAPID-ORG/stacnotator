import { describe, it, expect } from 'vitest';
import { withoutKeys, mergeLayoutChange } from './popoutLayout';
import type { Layout } from 'react-grid-layout';

const layout: Layout = [
  { i: 'main', x: 0, y: 0, w: 40, h: 20 },
  { i: 'controls', x: 40, y: 0, w: 20, h: 20 },
  { i: '7', x: 0, y: 20, w: 10, h: 9 },
];

describe('withoutKeys', () => {
  it('removes popped items from the grid layout', () => {
    const result = withoutKeys(layout, new Set(['controls']));
    expect(result.map((it) => it.i)).toEqual(['main', '7']);
  });

  it('returns the same reference when nothing is popped', () => {
    expect(withoutKeys(layout, new Set())).toBe(layout);
  });
});

describe('mergeLayoutChange', () => {
  it('re-adds the popped item slot after a grid rearrangement', () => {
    const next: Layout = [
      { i: 'main', x: 0, y: 0, w: 60, h: 20 },
      { i: '7', x: 0, y: 20, w: 10, h: 9 },
    ];
    const merged = mergeLayoutChange(next, layout, new Set(['controls']));
    expect(merged).toContainEqual({ i: 'controls', x: 40, y: 0, w: 20, h: 20 });
    expect(merged).toHaveLength(3);
  });

  it('round-trips: withheld then merged layout keeps every original key', () => {
    const popped = new Set(['controls', '7']);
    const gridView = withoutKeys(layout, popped);
    const merged = mergeLayoutChange(gridView, layout, popped);
    expect(new Set(merged.map((it) => it.i))).toEqual(new Set(['main', 'controls', '7']));
  });

  it('does not duplicate an item the grid already reports again', () => {
    const merged = mergeLayoutChange(layout, layout, new Set(['controls']));
    expect(merged.filter((it) => it.i === 'controls')).toHaveLength(1);
  });

  it('passes the layout through untouched when nothing is popped', () => {
    const next: Layout = [{ i: 'main', x: 0, y: 0, w: 60, h: 20 }];
    expect(mergeLayoutChange(next, layout, new Set())).toBe(next);
  });

  it('tolerates a null previous layout', () => {
    const next: Layout = [{ i: 'main', x: 0, y: 0, w: 60, h: 20 }];
    expect(mergeLayoutChange(next, null, new Set(['controls']))).toBe(next);
  });
});
