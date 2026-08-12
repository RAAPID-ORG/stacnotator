import { describe, it, expect, vi } from 'vitest';
import type { CategoryFormField } from '~/api/client';
import type { FormField } from '~/features/annotation/core/apiTypes';
import {
  applyFieldDigit,
  cycleFieldIndex,
  handleFormFieldKey,
  LABEL_FIELD_INDEX,
} from './formFieldNav';
import type { FormValues } from './formValues';

const TEXT: FormField = { id: 3, title: 'Notes', required: false, type: 'text' };

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

describe('cycleFieldIndex', () => {
  it('fieldCount 0 always returns null, forward and reverse', () => {
    expect(cycleFieldIndex(null, 0, 1)).toBeNull();
    expect(cycleFieldIndex(null, 0, -1)).toBeNull();
    expect(cycleFieldIndex(0, 0, 1)).toBeNull();
  });

  it('enters the cycle from null: forward to the first field, reverse to the last field', () => {
    // On entry the label slot is already the active digit target, so the first
    // Tab advances to a custom field instead of re-highlighting the label slot.
    expect(cycleFieldIndex(null, 3, 1)).toBe(0);
    expect(cycleFieldIndex(null, 3, -1)).toBe(2);
  });

  it('reaches the label slot by wrapping past the last field, not on the first Tab', () => {
    let idx: number | null = null;
    idx = cycleFieldIndex(idx, 2, 1); // -> 0
    idx = cycleFieldIndex(idx, 2, 1); // -> 1 (last)
    idx = cycleFieldIndex(idx, 2, 1); // -> label slot
    expect(idx).toBe(LABEL_FIELD_INDEX);
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
    expect(cycleFieldIndex(null, 1, 1)).toBe(0);
    expect(cycleFieldIndex(LABEL_FIELD_INDEX, 1, 1)).toBe(0);
    expect(cycleFieldIndex(0, 1, 1)).toBe(LABEL_FIELD_INDEX);
    expect(cycleFieldIndex(null, 1, -1)).toBe(0);
    expect(cycleFieldIndex(0, 1, -1)).toBe(LABEL_FIELD_INDEX);
    expect(cycleFieldIndex(LABEL_FIELD_INDEX, 1, -1)).toBe(0);
  });
});

describe('applyFieldDigit', () => {
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

  it('no-op path: does not call setValues when the digit is out of range', () => {
    const setValues = vi.fn();
    const values: FormValues = {};

    applyFieldDigit(CATEGORY, '9', values, setValues);

    expect(setValues).not.toHaveBeenCalled();
  });

  it('typed field: names the field to focus instead of touching the DOM itself', () => {
    const setValues = vi.fn();

    expect(applyFieldDigit(TEXT, '4', {}, setValues)).toBe(TEXT.id);
    expect(setValues).not.toHaveBeenCalled();
    expect(applyFieldDigit(CATEGORY, '2', {}, setValues)).toBeNull();
  });
});

describe('handleFormFieldKey', () => {
  const ctxFor = (fields: FormField[], activeIndex: number | null) => ({
    fields,
    activeIndex,
    values: {} as FormValues,
    setValues: vi.fn(),
    setActiveIndex: vi.fn(),
  });

  it('reports the field to focus on Enter over a typed field, and focuses nothing itself', () => {
    const ctx = ctxFor([TEXT], 0);

    const result = handleFormFieldKey(new KeyboardEvent('keydown', { key: 'Enter' }), ctx);

    expect(result).toEqual({ handled: true, focusFieldId: TEXT.id });
  });

  it('an option field consumes Enter for nothing - there is no input to type into', () => {
    const ctx = ctxFor([CATEGORY], 0);

    const result = handleFormFieldKey(new KeyboardEvent('keydown', { key: 'Enter' }), ctx);

    expect(result).toEqual({ handled: false, focusFieldId: null });
  });

  it('Tab moves the active index and asks for no focus', () => {
    const ctx = ctxFor([TEXT, CATEGORY], null);

    const result = handleFormFieldKey(new KeyboardEvent('keydown', { key: 'Tab' }), ctx);

    expect(result).toEqual({ handled: true, focusFieldId: null });
    expect(ctx.setActiveIndex).toHaveBeenCalledWith(0);
  });

  it('Escape clears the active index', () => {
    const ctx = ctxFor([TEXT], 0);

    const result = handleFormFieldKey(new KeyboardEvent('keydown', { key: 'Escape' }), ctx);

    expect(result).toEqual({ handled: true, focusFieldId: null });
    expect(ctx.setActiveIndex).toHaveBeenCalledWith(null);
  });
});
