import { describe, it, expect } from 'vitest';
import type { CategoryFormField, NumberFormField, TextFormField } from '~/api/client';
import {
  setFieldValue,
  toggleMultiOption,
  applyCategoryOption,
  missingRequiredFields,
  formatMissingFieldsTitle,
  isDateRangeValue,
  formValuesEqual,
  type FormValues,
} from './formValues';

const CATEGORY: CategoryFormField = {
  id: 1,
  title: 'Condition',
  required: false,
  type: 'category',
  options: [
    { id: 10, name: 'Good' },
    { id: 20, name: 'Bad' },
  ],
};

const MULTICATEGORY: CategoryFormField = {
  id: 2,
  title: 'Tags',
  required: false,
  type: 'multicategory',
  options: [
    { id: 10, name: 'A' },
    { id: 20, name: 'B' },
    { id: 30, name: 'C' },
  ],
};

const REQUIRED_TEXT: TextFormField = {
  id: 3,
  title: 'Notes',
  required: true,
  type: 'text',
};

const NUMBER: NumberFormField = {
  id: 4,
  title: 'Count',
  required: false,
  type: 'number',
};

const REQUIRED_MULTICATEGORY: CategoryFormField = {
  id: 5,
  title: 'Required Tags',
  required: true,
  type: 'multicategory',
  options: [{ id: 10, name: 'A' }],
};

describe('setFieldValue', () => {
  it('adds a new key without mutating the input', () => {
    const values: FormValues = {};
    const next = setFieldValue(values, 1, 10);
    expect(next).toEqual({ '1': 10 });
    expect(values).toEqual({});
  });

  it('replaces an existing key with a new object', () => {
    const values: FormValues = { '1': 10 };
    const next = setFieldValue(values, 1, 20);
    expect(next).toEqual({ '1': 20 });
    expect(next).not.toBe(values);
  });

  it('deletes the key when value is null', () => {
    const values: FormValues = { '1': 10, '2': 20 };
    const next = setFieldValue(values, 1, null);
    expect(next).toEqual({ '2': 20 });
    expect(next).not.toBe(values);
  });

  it('deletes the key when value is an empty string', () => {
    const values: FormValues = { '3': 'hello' };
    const next = setFieldValue(values, 3, '');
    expect(next).toEqual({});
  });

  it('deletes the key when value is a whitespace-only string', () => {
    const values: FormValues = { '3': 'hello' };
    const next = setFieldValue(values, 3, '   ');
    expect(next).toEqual({});
  });

  it('deletes the key when value is an empty array', () => {
    const values: FormValues = { '2': [10, 20] };
    const next = setFieldValue(values, 2, []);
    expect(next).toEqual({});
  });
});

describe('toggleMultiOption', () => {
  it('adds an option id to an absent key', () => {
    const values: FormValues = {};
    const next = toggleMultiOption(values, MULTICATEGORY, 10);
    expect(next).toEqual({ '2': [10] });
  });

  it('adds an option id and keeps the result sorted ascending', () => {
    const values: FormValues = { '2': [20] };
    const next = toggleMultiOption(values, MULTICATEGORY, 10);
    expect(next).toEqual({ '2': [10, 20] });
  });

  it('removes an option id that is already present', () => {
    const values: FormValues = { '2': [10, 20] };
    const next = toggleMultiOption(values, MULTICATEGORY, 10);
    expect(next).toEqual({ '2': [20] });
  });

  it('removing the last option id deletes the key entirely', () => {
    const values: FormValues = { '2': [10] };
    const next = toggleMultiOption(values, MULTICATEGORY, 10);
    expect(next).toEqual({});
    expect('2' in next).toBe(false);
  });

  it('does not mutate the input', () => {
    const values: FormValues = { '2': [10] };
    toggleMultiOption(values, MULTICATEGORY, 20);
    expect(values).toEqual({ '2': [10] });
  });
});

describe('applyCategoryOption', () => {
  it('selects an option on an empty category field', () => {
    const next = applyCategoryOption({}, CATEGORY, 10);
    expect(next).toEqual({ '1': 10 });
  });

  it('deselects a category field option that is already the current value', () => {
    const values: FormValues = { '1': 10 };
    const next = applyCategoryOption(values, CATEGORY, 10);
    expect(next).toEqual({});
  });

  it('replaces the current value when selecting a different category option', () => {
    const values: FormValues = { '1': 10 };
    const next = applyCategoryOption(values, CATEGORY, 20);
    expect(next).toEqual({ '1': 20 });
  });

  it('toggles a multicategory field the same way toggleMultiOption does', () => {
    const values: FormValues = { '2': [10] };
    const next = applyCategoryOption(values, MULTICATEGORY, 20);
    expect(next).toEqual({ '2': [10, 20] });
  });
});

describe('missingRequiredFields', () => {
  it('returns required fields whose key is absent', () => {
    const fields = [REQUIRED_TEXT, NUMBER];
    const missing = missingRequiredFields(fields, {});
    expect(missing).toEqual([REQUIRED_TEXT]);
  });

  it('returns an empty array when all required fields are present', () => {
    const fields = [REQUIRED_TEXT, NUMBER];
    const missing = missingRequiredFields(fields, { '3': 'filled in' });
    expect(missing).toEqual([]);
  });

  it('treats an empty string as missing even if the key is present', () => {
    const fields = [REQUIRED_TEXT];
    const missing = missingRequiredFields(fields, { '3': '' });
    expect(missing).toEqual([REQUIRED_TEXT]);
  });

  it('treats a whitespace-only string as missing (matches backend text stripping)', () => {
    const fields = [REQUIRED_TEXT];
    const missing = missingRequiredFields(fields, { '3': '   ' });
    expect(missing).toEqual([REQUIRED_TEXT]);
  });

  it('treats an empty array as missing even if the key is present', () => {
    const fields = [REQUIRED_MULTICATEGORY];
    const missing = missingRequiredFields(fields, { '5': [] });
    expect(missing).toEqual([REQUIRED_MULTICATEGORY]);
  });

  it('non-required fields are never reported as missing', () => {
    const fields = [CATEGORY, NUMBER];
    const missing = missingRequiredFields(fields, {});
    expect(missing).toEqual([]);
  });

  it('preserves field order in the result', () => {
    const secondRequired: TextFormField = { ...REQUIRED_TEXT, id: 30, title: 'Second' };
    const fields = [REQUIRED_TEXT, secondRequired];
    const missing = missingRequiredFields(fields, {});
    expect(missing).toEqual([REQUIRED_TEXT, secondRequired]);
  });
});

describe('formatMissingFieldsTitle', () => {
  it('lists a single missing field title', () => {
    expect(formatMissingFieldsTitle([REQUIRED_TEXT])).toBe('Missing required: Notes');
  });

  it('joins multiple missing field titles with a comma', () => {
    expect(formatMissingFieldsTitle([REQUIRED_TEXT, REQUIRED_MULTICATEGORY])).toBe(
      'Missing required: Notes, Required Tags'
    );
  });
});

describe('isDateRangeValue', () => {
  it('accepts an object with string start and end', () => {
    expect(isDateRangeValue({ start: '2024-01-01', end: '2024-01-31' })).toBe(true);
  });

  it('rejects an object whose start/end are not strings', () => {
    expect(isDateRangeValue({ start: 1, end: 2 })).toBe(false);
  });

  it('rejects arrays, null, and primitives', () => {
    expect(isDateRangeValue([10, 20])).toBe(false);
    expect(isDateRangeValue(null)).toBe(false);
    expect(isDateRangeValue('2024-01-01')).toBe(false);
    expect(isDateRangeValue(10)).toBe(false);
  });
});

describe('formValuesEqual', () => {
  it('treats key order as irrelevant', () => {
    expect(formValuesEqual({ '1': 10, '2': 'a' }, { '2': 'a', '1': 10 })).toBe(true);
  });

  it('detects a differing scalar', () => {
    expect(formValuesEqual({ '1': 10 }, { '1': 20 })).toBe(false);
  });

  it('detects a differing key set', () => {
    expect(formValuesEqual({ '1': 10 }, { '1': 10, '2': 1 })).toBe(false);
    expect(formValuesEqual({ '1': 10, '2': 1 }, { '1': 10 })).toBe(false);
  });

  it('compares multicategory arrays element-wise', () => {
    expect(formValuesEqual({ '1': [10, 20] }, { '1': [10, 20] })).toBe(true);
    expect(formValuesEqual({ '1': [10, 20] }, { '1': [20, 10] })).toBe(false);
    expect(formValuesEqual({ '1': [10] }, { '1': [10, 20] })).toBe(false);
  });

  it('compares date ranges by both ends', () => {
    const range = { start: '2024-01-01', end: '2024-02-01' };
    expect(formValuesEqual({ '1': { ...range } }, { '1': { ...range } })).toBe(true);
    expect(formValuesEqual({ '1': { ...range } }, { '1': { ...range, end: '2024-03-01' } })).toBe(
      false
    );
  });

  it('two empty answer sets are equal', () => {
    expect(formValuesEqual({}, {})).toBe(true);
  });
});
