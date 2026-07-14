import { describe, it, expect } from 'vitest';
import type { SelectFormField, NumberFormField, TextFormField } from '~/api/client';
import { cycleFieldIndex, digitTargetsOption, optionIdForDigit } from './formFieldNav';

const SELECT: SelectFormField = {
  id: 1,
  title: 'Condition',
  required: false,
  type: 'select',
  options: [
    { id: 10, name: 'Good' },
    { id: 20, name: 'Bad' },
    { id: 30, name: 'Unknown' },
  ],
};

const MULTISELECT: SelectFormField = {
  ...SELECT,
  id: 2,
  type: 'multiselect',
};

const NUMBER: NumberFormField = {
  id: 3,
  title: 'Count',
  required: false,
  type: 'number',
};

const TEXT: TextFormField = {
  id: 4,
  title: 'Notes',
  required: false,
  type: 'text',
};

describe('cycleFieldIndex', () => {
  it('fieldCount 0 always returns null, forward and reverse', () => {
    expect(cycleFieldIndex(null, 0, 1)).toBeNull();
    expect(cycleFieldIndex(null, 0, -1)).toBeNull();
    expect(cycleFieldIndex(0, 0, 1)).toBeNull();
  });

  it('cycles forward through the full range and back to null', () => {
    let idx: number | null = null;
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(0);
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(1);
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(2);
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBeNull();
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(0);
  });

  it('cycles backward through the full range and back to null', () => {
    let idx: number | null = null;
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(2);
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(1);
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(0);
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBeNull();
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(2);
  });

  it('single field cycles null -> 0 -> null', () => {
    expect(cycleFieldIndex(null, 1, 1)).toBe(0);
    expect(cycleFieldIndex(0, 1, 1)).toBeNull();
    expect(cycleFieldIndex(null, 1, -1)).toBe(0);
    expect(cycleFieldIndex(0, 1, -1)).toBeNull();
  });
});

describe('digitTargetsOption', () => {
  it('is true for select fields', () => {
    expect(digitTargetsOption(SELECT)).toBe(true);
  });

  it('is true for multiselect fields', () => {
    expect(digitTargetsOption(MULTISELECT)).toBe(true);
  });

  it('is false for number fields', () => {
    expect(digitTargetsOption(NUMBER)).toBe(false);
  });

  it('is false for text fields', () => {
    expect(digitTargetsOption(TEXT)).toBe(false);
  });
});

describe('optionIdForDigit', () => {
  it('resolves 1-based digits to the corresponding option id', () => {
    expect(optionIdForDigit(SELECT, 1)).toBe(10);
    expect(optionIdForDigit(SELECT, 2)).toBe(20);
    expect(optionIdForDigit(SELECT, 3)).toBe(30);
  });

  it('returns null for a digit beyond the option count', () => {
    expect(optionIdForDigit(SELECT, 4)).toBeNull();
  });

  it('returns null for digit 0 and negative digits', () => {
    expect(optionIdForDigit(SELECT, 0)).toBeNull();
    expect(optionIdForDigit(SELECT, -1)).toBeNull();
  });

  it('returns null for a non-option field', () => {
    expect(optionIdForDigit(NUMBER, 1)).toBeNull();
    expect(optionIdForDigit(TEXT, 1)).toBeNull();
  });
});
