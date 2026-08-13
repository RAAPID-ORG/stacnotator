import { describe, it, expect } from 'vitest';
import type { AnnotationTaskOut } from '~/api/client';
import { goTo, nextIndex, prevIndex } from './navigation';

const list = (n: number): AnnotationTaskOut[] =>
  Array.from(
    { length: n },
    (_, i) => ({ id: i, annotation_number: i + 1 }) as unknown as AnnotationTaskOut
  );

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

  it('wraps from 0 back to the last index', () => {
    expect(prevIndex(list(3), 0)).toBe(2);
  });

  it('stays put when the visible list is empty', () => {
    expect(prevIndex(list(0), 5)).toBe(5);
  });
});

describe('goTo', () => {
  it('finds the index of a task by annotation number', () => {
    expect(goTo(list(5), 3)).toBe(2);
  });

  it('returns -1 when no visible task has that annotation number', () => {
    expect(goTo(list(3), 99)).toBe(-1);
  });
});
