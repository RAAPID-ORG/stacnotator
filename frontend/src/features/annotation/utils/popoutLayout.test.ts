import { describe, it, expect } from 'vitest';
import { withoutKeys, mergeLayoutChange, packItem, scaleWidthToScreen } from './popoutLayout';
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

describe('packItem', () => {
  it('places the first card at the top left with the given size', () => {
    expect(packItem([], 'controls', { w: 20, h: 12 })).toEqual([
      { i: 'controls', x: 0, y: 0, w: 20, h: 12 },
    ]);
  });

  it('fills the first free slot to the right of existing cards', () => {
    const screen: Layout = [
      { i: 'controls', x: 0, y: 0, w: 20, h: 12 },
      { i: '7', x: 20, y: 0, w: 10, h: 20 },
    ];
    const result = packItem(screen, 'minimap', { w: 15, h: 10 });
    expect(result).toContainEqual({ i: 'minimap', x: 30, y: 0, w: 15, h: 10 });
  });

  it('fills a gap left by a returned card before opening a new row', () => {
    const screen: Layout = [
      { i: 'a', x: 0, y: 0, w: 20, h: 10 },
      // gap at x 20..40
      { i: 'b', x: 40, y: 0, w: 20, h: 10 },
      { i: 'c', x: 0, y: 10, w: 60, h: 10 },
    ];
    const result = packItem(screen, 'minimap', { w: 20, h: 10 });
    expect(result).toContainEqual({ i: 'minimap', x: 20, y: 0, w: 20, h: 10 });
  });

  it('starts a fresh row when no slot fits', () => {
    const screen: Layout = [{ i: 'a', x: 0, y: 0, w: 60, h: 10 }];
    const result = packItem(screen, 'minimap', { w: 30, h: 10 });
    expect(result).toContainEqual({ i: 'minimap', x: 0, y: 10, w: 30, h: 10 });
  });

  it('clamps cards wider than the grid', () => {
    expect(packItem([], 'wide', { w: 90, h: 10 })).toEqual([
      { i: 'wide', x: 0, y: 0, w: 60, h: 10 },
    ]);
  });

  it('is a no-op when the card is already on the screen', () => {
    const screen: Layout = [{ i: 'controls', x: 5, y: 5, w: 20, h: 12 }];
    expect(packItem(screen, 'controls', { w: 1, h: 1 })).toBe(screen);
  });
});

describe('scaleWidthToScreen', () => {
  it('keeps the pixel width when the screen canvas is narrower', () => {
    // 16 cols of an 1800px canvas = 480px = 24 cols of a 1200px screen.
    expect(scaleWidthToScreen(16, 1800, 1200)).toBe(24);
  });

  it('caps at the full grid width', () => {
    expect(scaleWidthToScreen(50, 2400, 800)).toBe(60);
  });

  it('never collapses below a usable minimum', () => {
    expect(scaleWidthToScreen(4, 800, 2400)).toBe(4);
  });

  it('passes through when a measurement is missing', () => {
    expect(scaleWidthToScreen(16, 0, 1200)).toBe(16);
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
