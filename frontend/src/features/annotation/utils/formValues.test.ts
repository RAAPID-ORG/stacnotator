import { describe, it, expect } from 'vitest';
import type { SelectFormField, NumberFormField, TextFormField } from '~/api/client';
import {
  setFieldValue,
  toggleMultiOption,
  applySelectOption,
  missingRequiredFields,
  formatMissingFieldsTitle,
  hydrateFormValues,
  type FormValues,
} from './formValues';

const SELECT: SelectFormField = {
  id: 1,
  title: 'Condition',
  required: false,
  type: 'select',
  options: [
    { id: 10, name: 'Good' },
    { id: 20, name: 'Bad' },
  ],
};

const MULTISELECT: SelectFormField = {
  id: 2,
  title: 'Tags',
  required: false,
  type: 'multiselect',
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

const REQUIRED_MULTISELECT: SelectFormField = {
  id: 5,
  title: 'Required Tags',
  required: true,
  type: 'multiselect',
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

  it('deletes the key when value is an empty array', () => {
    const values: FormValues = { '2': [10, 20] };
    const next = setFieldValue(values, 2, []);
    expect(next).toEqual({});
  });

  it('setting null on a key that is already absent is a no-op producing a new object', () => {
    const values: FormValues = { '1': 10 };
    const next = setFieldValue(values, 99, null);
    expect(next).toEqual({ '1': 10 });
    expect(next).not.toBe(values);
  });

  it('leaves the input object reference untouched (immutability)', () => {
    const values: FormValues = { '1': 10 };
    const frozen = Object.freeze({ ...values });
    expect(() => setFieldValue(frozen, 1, 30)).not.toThrow();
  });
});

describe('toggleMultiOption', () => {
  it('adds an option id to an absent key', () => {
    const values: FormValues = {};
    const next = toggleMultiOption(values, MULTISELECT, 10);
    expect(next).toEqual({ '2': [10] });
  });

  it('adds an option id and keeps the result sorted ascending', () => {
    const values: FormValues = { '2': [20] };
    const next = toggleMultiOption(values, MULTISELECT, 10);
    expect(next).toEqual({ '2': [10, 20] });
  });

  it('removes an option id that is already present', () => {
    const values: FormValues = { '2': [10, 20] };
    const next = toggleMultiOption(values, MULTISELECT, 10);
    expect(next).toEqual({ '2': [20] });
  });

  it('removing the last option id deletes the key entirely', () => {
    const values: FormValues = { '2': [10] };
    const next = toggleMultiOption(values, MULTISELECT, 10);
    expect(next).toEqual({});
    expect('2' in next).toBe(false);
  });

  it('does not mutate the input', () => {
    const values: FormValues = { '2': [10] };
    toggleMultiOption(values, MULTISELECT, 20);
    expect(values).toEqual({ '2': [10] });
  });
});

describe('applySelectOption', () => {
  it('selects an option on an empty select field', () => {
    const next = applySelectOption({}, SELECT, 10);
    expect(next).toEqual({ '1': 10 });
  });

  it('deselects a select field option that is already the current value', () => {
    const values: FormValues = { '1': 10 };
    const next = applySelectOption(values, SELECT, 10);
    expect(next).toEqual({});
  });

  it('replaces the current value when selecting a different select option', () => {
    const values: FormValues = { '1': 10 };
    const next = applySelectOption(values, SELECT, 20);
    expect(next).toEqual({ '1': 20 });
  });

  it('toggles a multiselect field the same way toggleMultiOption does', () => {
    const values: FormValues = { '2': [10] };
    const next = applySelectOption(values, MULTISELECT, 20);
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

  it('treats an empty array as missing even if the key is present', () => {
    const fields = [REQUIRED_MULTISELECT];
    const missing = missingRequiredFields(fields, { '5': [] });
    expect(missing).toEqual([REQUIRED_MULTISELECT]);
  });

  it('non-required fields are never reported as missing', () => {
    const fields = [SELECT, NUMBER];
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
    expect(formatMissingFieldsTitle([REQUIRED_TEXT, REQUIRED_MULTISELECT])).toBe(
      'Missing required: Notes, Required Tags'
    );
  });
});

describe('hydrateFormValues', () => {
  it('narrows null to an empty object', () => {
    expect(hydrateFormValues(null)).toEqual({});
  });

  it('narrows undefined to an empty object', () => {
    expect(hydrateFormValues(undefined)).toEqual({});
  });

  it('passes through a valid dict unchanged', () => {
    const raw = { '1': 10, '3': 'hello', '2': [10, 20] };
    expect(hydrateFormValues(raw)).toEqual(raw);
  });

  it('passes through a daterange value unchanged', () => {
    const raw = { '6': { start: '2024-01-01', end: '2024-01-31' } };
    expect(hydrateFormValues(raw)).toEqual(raw);
  });

  it('falls back to an empty object for non-object input', () => {
    expect(hydrateFormValues('not an object')).toEqual({});
    expect(hydrateFormValues(42)).toEqual({});
    expect(hydrateFormValues([1, 2, 3])).toEqual({});
  });
});
