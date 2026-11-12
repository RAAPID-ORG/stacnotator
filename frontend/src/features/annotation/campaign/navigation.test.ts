import { describe, it, expect } from 'vitest';
import { makeTaskRow } from '../testing/fixtures';
import { nextIndex, prevIndex } from './tasks';

const list = (n: number) =>
  Array.from({ length: n }, (_, i) => makeTaskRow({ id: i, annotation_number: i + 1 }));

describe('nextIndex', () => {
  it('advances by one', () => {
    expect(nextIndex(list(3), 0)).toBe(1);
  });

  it('wraps from the last index back to 0', () => {
    expect(nextIndex(list(3), 2)).toBe(0);
  });

  it('stays put when the visible list is empty', () => {
    expect(nextIndex(list(0), 5)).toBe(5);
  });
});

describe('prevIndex', () => {
  it('steps back by one', () => {
    expect(prevIndex(list(3), 2)).toBe(1);
  });

  it('stops at the first index rather than wrapping', () => {
    expect(prevIndex(list(3), 0)).toBe(0);
  });

  it('stays put when the visible list is empty', () => {
    expect(prevIndex(list(0), 5)).toBe(5);
  });
});
