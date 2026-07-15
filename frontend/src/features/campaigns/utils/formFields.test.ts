import { describe, it, expect } from 'vitest';
import type {
  CategoryFormField,
  NumberFormField,
  TextFormField,
  DateFormField,
} from '~/api/client';
import {
  formFieldSlug,
  validateFormFields,
  formFieldsAreValid,
  type FormField,
} from './formFields';

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
    const fields: FormField[] = [CATEGORY, NUMBER, TEXT, DATE];
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

  it('flags a category field with no options', () => {
    const fields: FormField[] = [{ ...CATEGORY, options: [] }];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"Condition" needs at least one option.');
  });

  it('flags a category field with a blank option name', () => {
    const fields: FormField[] = [
      {
        ...CATEGORY,
        options: [
          { id: 10, name: 'Good' },
          { id: 20, name: '  ' },
        ],
      },
    ];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"Condition" has an option with no name.');
  });

  it('flags duplicate option ids on a category field', () => {
    const fields: FormField[] = [
      {
        ...CATEGORY,
        options: [
          { id: 10, name: 'Good' },
          { id: 10, name: 'Bad' },
        ],
      },
    ];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"Condition" has duplicate option ids.');
  });

  it('flags a multicategory field the same way as category', () => {
    const fields: FormField[] = [{ ...CATEGORY, type: 'multicategory', options: [] }];
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
    const fields: FormField[] = [{ ...CATEGORY, title: '', options: [] }];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"field 1" needs at least one option.');
  });

  it('flags a title over 200 characters', () => {
    const title = 'x'.repeat(201);
    const fields: FormField[] = [{ ...TEXT, title }];
    const errors = validateFormFields(fields);
    expect(errors).toContain(`"${title}" title must not exceed 200 characters.`);
  });

  it('accepts a title at exactly 200 characters', () => {
    const fields: FormField[] = [{ ...TEXT, title: 'x'.repeat(200) }];
    expect(validateFormFields(fields)).toEqual([]);
  });

  it('flags a description over 2000 characters', () => {
    const fields: FormField[] = [{ ...TEXT, description: 'x'.repeat(2001) }];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"Notes" description must not exceed 2000 characters.');
  });

  it('accepts a description at exactly 2000 characters', () => {
    const fields: FormField[] = [{ ...TEXT, description: 'x'.repeat(2000) }];
    expect(validateFormFields(fields)).toEqual([]);
  });

  it('flags an option name over 200 characters', () => {
    const fields: FormField[] = [{ ...CATEGORY, options: [{ id: 10, name: 'x'.repeat(201) }] }];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"Condition" has an option name longer than 200 characters.');
  });

  it('accepts an option name at exactly 200 characters', () => {
    const fields: FormField[] = [{ ...CATEGORY, options: [{ id: 10, name: 'x'.repeat(200) }] }];
    expect(validateFormFields(fields)).toEqual([]);
  });

  it('flags more than 200 options on a category field', () => {
    const options = Array.from({ length: 201 }, (_, i) => ({ id: i, name: `opt${i}` }));
    const fields: FormField[] = [{ ...CATEGORY, options }];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"Condition" may not have more than 200 options.');
  });

  it('accepts exactly 200 options on a category field', () => {
    const options = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `opt${i}` }));
    const fields: FormField[] = [{ ...CATEGORY, options }];
    expect(validateFormFields(fields)).toEqual([]);
  });

  it('flags more than 100 fields', () => {
    const fields: FormField[] = Array.from({ length: 101 }, (_, i) => ({
      ...TEXT,
      id: i,
      title: `Field ${i}`,
    }));
    const errors = validateFormFields(fields);
    expect(errors).toContain('A form may not have more than 100 fields.');
  });

  it('accepts exactly 100 fields', () => {
    const fields: FormField[] = Array.from({ length: 100 }, (_, i) => ({
      ...TEXT,
      id: i,
      title: `Field ${i}`,
    }));
    expect(validateFormFields(fields)).toEqual([]);
  });
});
