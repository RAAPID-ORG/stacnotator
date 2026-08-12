import { describe, it, expect } from 'vitest';
import { EMPTY_TILE_THRESHOLD, classifyEmpty, emptyTileStats } from './stats';

describe('classifyEmpty', () => {
  it('needs the full error threshold before calling a source empty', () => {
    expect(classifyEmpty({ errors: 3, successes: 0, empties: 0 })).toBe(false);
    expect(classifyEmpty({ errors: EMPTY_TILE_THRESHOLD, successes: 0, empties: 0 })).toBe(true);
  });

  it('is never empty once a tile has loaded', () => {
    expect(classifyEmpty({ errors: 4, successes: 1, empties: 0 })).toBe(false);
    expect(classifyEmpty({ errors: 99, successes: 1, empties: 0 })).toBe(false);
  });

  it('trusts an explicit HTTP 204 empty flag immediately', () => {
    expect(classifyEmpty({ errors: 0, successes: 0, empties: 1 })).toBe(true);
    expect(classifyEmpty({ errors: 0, successes: 5, empties: 1 })).toBe(true);
  });

  it('is not empty with no observations at all', () => {
    expect(classifyEmpty(emptyTileStats())).toBe(false);
  });
});
