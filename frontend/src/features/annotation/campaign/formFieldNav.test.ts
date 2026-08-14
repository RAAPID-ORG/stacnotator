import { describe, it, expect, vi } from 'vitest';
import type { CategoryFormField } from '~/api/client';
import type { FormField } from '../campaign/annotation';
import {
  cycleFieldIndex,
  handleFormFieldKey,
  isLabelGroupActive,
  LABEL_FIELD_INDEX,
} from './annotation';
import type { FormValues } from './annotation';

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

describe('isLabelGroupActive', () => {
  it('marks the label group on entry, before any Tab has moved the index', () => {
    expect(isLabelGroupActive(null, 3)).toBe(true);
  });

  it('marks the label group once Tab wraps back onto it', () => {
    expect(isLabelGroupActive(LABEL_FIELD_INDEX, 3)).toBe(true);
  });

  it('does not mark it while a custom field holds the digits', () => {
    expect(isLabelGroupActive(0, 3)).toBe(false);
    expect(isLabelGroupActive(2, 3)).toBe(false);
  });

  it('marks nothing when there are no custom fields to cycle through', () => {
    expect(isLabelGroupActive(null, 0)).toBe(false);
    expect(isLabelGroupActive(LABEL_FIELD_INDEX, 0)).toBe(false);
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
