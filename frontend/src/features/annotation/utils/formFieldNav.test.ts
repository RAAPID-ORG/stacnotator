import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SelectFormField, NumberFormField, TextFormField } from '~/api/client';
import {
  applyFieldDigit,
  cycleFieldIndex,
  digitTargetsOption,
  optionIdForDigit,
  fieldDigitAction,
  LABEL_FIELD_INDEX,
} from './formFieldNav';
import type { FormValues } from './formValues';

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

  it('cycles forward through the label slot, the full field range, and back to null', () => {
    let idx: number | null = null;
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(LABEL_FIELD_INDEX);
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(0);
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(1);
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(2);
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBeNull();
    idx = cycleFieldIndex(idx, 3, 1);
    expect(idx).toBe(LABEL_FIELD_INDEX);
  });

  it('cycles backward through the full field range, the label slot, and back to null', () => {
    let idx: number | null = null;
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(2);
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(1);
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(0);
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(LABEL_FIELD_INDEX);
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBeNull();
    idx = cycleFieldIndex(idx, 3, -1);
    expect(idx).toBe(2);
  });

  it('single field cycles null -> label -> 0 -> null', () => {
    expect(cycleFieldIndex(null, 1, 1)).toBe(LABEL_FIELD_INDEX);
    expect(cycleFieldIndex(LABEL_FIELD_INDEX, 1, 1)).toBe(0);
    expect(cycleFieldIndex(0, 1, 1)).toBeNull();
    expect(cycleFieldIndex(null, 1, -1)).toBe(0);
    expect(cycleFieldIndex(0, 1, -1)).toBe(LABEL_FIELD_INDEX);
    expect(cycleFieldIndex(LABEL_FIELD_INDEX, 1, -1)).toBeNull();
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

describe('fieldDigitAction', () => {
  it('toggles the matching option on a select field', () => {
    expect(fieldDigitAction(SELECT, 2)).toEqual({ kind: 'toggleOption', optionId: 20 });
  });

  it('toggles the matching option on a multiselect field', () => {
    expect(fieldDigitAction(MULTISELECT, 1)).toEqual({ kind: 'toggleOption', optionId: 10 });
  });

  it('is a no-op when the digit is beyond the option count', () => {
    expect(fieldDigitAction(SELECT, 9)).toEqual({ kind: 'none' });
  });

  it('is a no-op for digit 0 on an option field', () => {
    expect(fieldDigitAction(SELECT, 0)).toEqual({ kind: 'none' });
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

  it('toggle path: calls setValues with the option applied, for a select field', () => {
    const setValues = vi.fn();
    const values: FormValues = {};

    applyFieldDigit(SELECT, '2', values, setValues);

    expect(setValues).toHaveBeenCalledTimes(1);
    expect(setValues).toHaveBeenCalledWith({ '1': 20 });
  });

  it('toggle path: calls setValues with the option toggled off, for a multiselect field', () => {
    const setValues = vi.fn();
    const values: FormValues = { '2': [10] };

    applyFieldDigit(MULTISELECT, '1', values, setValues);

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

    applyFieldDigit(SELECT, '9', values, setValues);

    expect(setValues).not.toHaveBeenCalled();
  });
});
