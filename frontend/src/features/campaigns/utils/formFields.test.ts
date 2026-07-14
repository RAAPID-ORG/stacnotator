import { describe, it, expect } from 'vitest';
import type { SelectFormField, NumberFormField, TextFormField, DateFormField } from '~/api/client';
import {
  formFieldSlug,
  validateFormFields,
  formFieldsAreValid,
  type FormField,
} from './formFields';

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

const NUMBER: NumberFormField = {
  id: 2,
  title: 'Count',
  required: false,
  type: 'number',
};

const TEXT: TextFormField = {
  id: 3,
  title: 'Notes',
  required: false,
  type: 'text',
};

const DATE: DateFormField = {
  id: 4,
  title: 'Observed on',
  required: false,
  type: 'date',
};

describe('formFieldSlug', () => {
  it('lowercases and collapses non-alnum runs to a single underscore', () => {
    expect(formFieldSlug('Cloud Cover %')).toBe('cloud_cover');
  });

  it('strips leading and trailing separators', () => {
    expect(formFieldSlug('  Hello World!!  ')).toBe('hello_world');
  });

  it('treats different punctuation as the same separator', () => {
    expect(formFieldSlug('Foo-Bar')).toBe(formFieldSlug('Foo_Bar'));
    expect(formFieldSlug('Foo-Bar')).toBe(formFieldSlug('foo bar'));
  });
});

describe('validateFormFields', () => {
  it('accepts an empty list', () => {
    expect(validateFormFields([])).toEqual([]);
  });

  it('accepts a well-formed mix of field types', () => {
    const fields: FormField[] = [SELECT, NUMBER, TEXT, DATE];
    expect(validateFormFields(fields)).toEqual([]);
    expect(formFieldsAreValid(fields)).toBe(true);
  });

  it('flags a blank title', () => {
    const fields: FormField[] = [{ ...TEXT, title: '   ' }];
    const errors = validateFormFields(fields);
    expect(errors).toContain('Field 3 needs a title.');
  });

  it('flags duplicate field ids', () => {
    const fields: FormField[] = [TEXT, { ...NUMBER, id: TEXT.id }];
    expect(validateFormFields(fields)).toContain('Field ids must be unique.');
  });

  it('flags duplicate title slugs even when casing/punctuation differ', () => {
    const fields: FormField[] = [
      { ...TEXT, id: 1, title: 'Cloud Cover' },
      { ...NUMBER, id: 2, title: 'cloud-cover' },
    ];
    expect(validateFormFields(fields)).toContain('Field titles must be unique.');
  });

  it('flags a select field with no options', () => {
    const fields: FormField[] = [{ ...SELECT, options: [] }];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"Condition" needs at least one option.');
  });

  it('flags a select field with a blank option name', () => {
    const fields: FormField[] = [
      {
        ...SELECT,
        options: [
          { id: 10, name: 'Good' },
          { id: 20, name: '  ' },
        ],
      },
    ];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"Condition" has an option with no name.');
  });

  it('flags duplicate option ids on a select field', () => {
    const fields: FormField[] = [
      {
        ...SELECT,
        options: [
          { id: 10, name: 'Good' },
          { id: 10, name: 'Bad' },
        ],
      },
    ];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"Condition" has duplicate option ids.');
  });

  it('flags a multiselect field the same way as select', () => {
    const fields: FormField[] = [{ ...SELECT, type: 'multiselect', options: [] }];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"Condition" needs at least one option.');
  });

  it('flags a number field where min exceeds max', () => {
    const fields: FormField[] = [{ ...NUMBER, min: 10, max: 5 }];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"Count" has a min greater than its max.');
  });

  it('allows min equal to max', () => {
    const fields: FormField[] = [{ ...NUMBER, min: 5, max: 5 }];
    expect(validateFormFields(fields)).toEqual([]);
  });

  it('flags a slider without both bounds set', () => {
    const fields: FormField[] = [{ ...NUMBER, slider: true, min: 0, max: null }];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"Count" needs both min and max to render as a slider.');
  });

  it('accepts a slider once both bounds are set', () => {
    const fields: FormField[] = [{ ...NUMBER, slider: true, min: 0, max: 100 }];
    expect(validateFormFields(fields)).toEqual([]);
  });

  it('falls back to a generic label when the title is blank', () => {
    const fields: FormField[] = [{ ...SELECT, title: '', options: [] }];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"field 1" needs at least one option.');
  });
});
