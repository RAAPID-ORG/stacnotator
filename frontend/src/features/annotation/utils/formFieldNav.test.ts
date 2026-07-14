import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CategoryFormField, NumberFormField, TextFormField } from '~/api/client';
import {
  applyFieldDigit,
  cycleFieldIndex,
  digitTargetsOption,
  optionIdForDigit,
  fieldDigitAction,
  LABEL_FIELD_INDEX,
} from './formFieldNav';
import type { FormValues } from './formValues';

const CATEGORY: CategoryFormField = {
  id: 1,
  title: 'Condition',
  required: false,
  type: 'category',
  options: [
    { id: 10, name: 'Good' },
    { id: 20, name: 'Bad' },
    { id: 30, name: 'Unknown' },
  ],
};

const MULTICATEGORY: CategoryFormField = {
  ...CATEGORY,
  id: 2,
  type: 'multicategory',
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

  it('enters the cycle from null: forward to the label slot, reverse to the last field', () => {
    expect(cycleFieldIndex(null, 3, 1)).toBe(LABEL_FIELD_INDEX);
    expect(cycleFieldIndex(null, 3, -1)).toBe(2);
  });

  it('cycles forward through the label slot and the full field range, wrapping without a null stop', () => {
    let idx: number | null = LABEL_FIELD_INDEX;
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(0);
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(1);
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(2);
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(LABEL_FIELD_INDEX);
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(0);
  });

  it('cycles backward through the full field range and the label slot, wrapping without a null stop', () => {
    let idx: number | null = LABEL_FIELD_INDEX;
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(2);
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(1);
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(0);
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(LABEL_FIELD_INDEX);
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(2);
  });

  it('single field wraps forward and backward directly between label and field 0, never null', () => {
    expect(cycleFieldIndex(null, 1, 1)).toBe(LABEL_FIELD_INDEX);
    expect(cycleFieldIndex(LABEL_FIELD_INDEX, 1, 1)).toBe(0);
    expect(cycleFieldIndex(0, 1, 1)).toBe(LABEL_FIELD_INDEX);
    expect(cycleFieldIndex(null, 1, -1)).toBe(0);
    expect(cycleFieldIndex(0, 1, -1)).toBe(LABEL_FIELD_INDEX);
    expect(cycleFieldIndex(LABEL_FIELD_INDEX, 1, -1)).toBe(0);
  });
});

describe('digitTargetsOption', () => {
  it('is true for category fields', () => {
    expect(digitTargetsOption(CATEGORY)).toBe(true);
  });

  it('is true for multicategory fields', () => {
    expect(digitTargetsOption(MULTICATEGORY)).toBe(true);
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
    expect(optionIdForDigit(CATEGORY, 1)).toBe(10);
    expect(optionIdForDigit(CATEGORY, 2)).toBe(20);
    expect(optionIdForDigit(CATEGORY, 3)).toBe(30);
  });

  it('returns null for a digit beyond the option count', () => {
    expect(optionIdForDigit(CATEGORY, 4)).toBeNull();
  });

  it('returns null for digit 0 and negative digits', () => {
    expect(optionIdForDigit(CATEGORY, 0)).toBeNull();
    expect(optionIdForDigit(CATEGORY, -1)).toBeNull();
  });

  it('returns null for a non-option field', () => {
    expect(optionIdForDigit(NUMBER, 1)).toBeNull();
    expect(optionIdForDigit(TEXT, 1)).toBeNull();
  });
});

describe('fieldDigitAction', () => {
  it('toggles the matching option on a category field', () => {
    expect(fieldDigitAction(CATEGORY, 2)).toEqual({ kind: 'toggleOption', optionId: 20 });
  });

  it('toggles the matching option on a multicategory field', () => {
    expect(fieldDigitAction(MULTICATEGORY, 1)).toEqual({ kind: 'toggleOption', optionId: 10 });
  });

  it('is a no-op when the digit is beyond the option count', () => {
    expect(fieldDigitAction(CATEGORY, 9)).toEqual({ kind: 'none' });
  });

  it('is a no-op for digit 0 on an option field', () => {
    expect(fieldDigitAction(CATEGORY, 0)).toEqual({ kind: 'none' });
  });

  it('focuses the input for number fields regardless of digit', () => {
    expect(fieldDigitAction(NUMBER, 1)).toEqual({ kind: 'focusInput' });
    expect(fieldDigitAction(NUMBER, 0)).toEqual({ kind: 'focusInput' });
  });

  it('focuses the input for text fields', () => {
    expect(fieldDigitAction(TEXT, 5)).toEqual({ kind: 'focusInput' });
  });
});

describe('applyFieldDigit', () => {
  // The vitest environment is 'node', so `document` isn't defined by default;
  // stub the one method focusFormFieldInput calls, matching the browser
  // behaviour of a query with no match (returns null, focus is a no-op).
  beforeEach(() => {
    Object.defineProperty(globalThis, 'document', {
      value: { querySelector: () => null },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true });
  });

  it('toggle path: calls setValues with the option applied, for a category field', () => {
    const setValues = vi.fn();
    const values: FormValues = {};

    applyFieldDigit(CATEGORY, '2', values, setValues);

    expect(setValues).toHaveBeenCalledTimes(1);
    expect(setValues).toHaveBeenCalledWith({ '1': 20 });
  });

  it('toggle path: calls setValues with the option toggled off, for a multicategory field', () => {
    const setValues = vi.fn();
    const values: FormValues = { '2': [10] };

    applyFieldDigit(MULTICATEGORY, '1', values, setValues);

    expect(setValues).toHaveBeenCalledTimes(1);
    expect(setValues).toHaveBeenCalledWith({});
  });

  it('focus path: does not call setValues for a number field (querySelector finds no match, so focus is a no-op)', () => {
    const setValues = vi.fn();
    const values: FormValues = {};

    applyFieldDigit(NUMBER, '5', values, setValues);

    expect(setValues).not.toHaveBeenCalled();
  });

  it('no-op path: does not call setValues when the digit is out of range', () => {
    const setValues = vi.fn();
    const values: FormValues = {};

    applyFieldDigit(CATEGORY, '9', values, setValues);

    expect(setValues).not.toHaveBeenCalled();
  });
});
