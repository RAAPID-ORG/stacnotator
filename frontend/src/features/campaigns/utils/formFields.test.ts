import { describe, it, expect } from 'vitest';
import type {
  CategoryFormField,
  NumberFormField,
  TextFormField,
  DateFormField,
} from '~/api/client';
import { formFieldSlug, validateFormFields, diffFormFields, type FormField } from './formFields';

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
});

describe('validateFormFields', () => {
  it('accepts an empty list', () => {
    expect(validateFormFields([])).toEqual([]);
  });

  it('accepts a well-formed mix of field types', () => {
    expect(validateFormFields([CATEGORY, NUMBER, TEXT, DATE])).toEqual([]);
  });

  it('flags a blank title', () => {
    const fields: FormField[] = [{ ...TEXT, title: '   ' }];
    const errors = validateFormFields(fields);
    expect(errors).toContain('Field 3 needs a title.');
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

  it('falls back to a generic label when the title is blank', () => {
    const fields: FormField[] = [{ ...CATEGORY, title: '', options: [] }];
    const errors = validateFormFields(fields);
    expect(errors).toContain('"field 1" needs at least one option.');
  });
});

describe('diffFormFields', () => {
  it('reports no changes for an identical draft', () => {
    const fields: FormField[] = [CATEGORY, NUMBER];
    expect(diffFormFields(fields, [...fields])).toEqual({ added: [], edited: [], deleted: [] });
  });

  it('reports a field dropped from the draft as deleted', () => {
    const diff = diffFormFields([CATEGORY, NUMBER], [CATEGORY]);
    expect(diff.deleted).toEqual([NUMBER]);
    expect(diff.added).toEqual([]);
    expect(diff.edited).toEqual([]);
  });

  it('reports a new id as added, not edited', () => {
    const diff = diffFormFields([CATEGORY], [CATEGORY, NUMBER]);
    expect(diff.added).toEqual([NUMBER]);
    expect(diff.edited).toEqual([]);
    expect(diff.deleted).toEqual([]);
  });

  it('reports a same-id content change as edited', () => {
    const renamed = { ...CATEGORY, title: 'State' };
    const diff = diffFormFields([CATEGORY], [renamed]);
    expect(diff.edited).toEqual([renamed]);
    expect(diff.deleted).toEqual([]);
  });

  it('separates a delete from an add even when they swap positions', () => {
    // Replacing a field is a delete + add, never an edit: the new field has
    // its own id, so the old field's stored answers are not carried over.
    const diff = diffFormFields([CATEGORY], [NUMBER]);
    expect(diff.deleted).toEqual([CATEGORY]);
    expect(diff.added).toEqual([NUMBER]);
    expect(diff.edited).toEqual([]);
  });

  it('handles clearing every field', () => {
    const diff = diffFormFields([CATEGORY, NUMBER], []);
    expect(diff.deleted).toEqual([CATEGORY, NUMBER]);
  });

  it('treats reordering alone as no change', () => {
    const diff = diffFormFields([CATEGORY, NUMBER], [NUMBER, CATEGORY]);
    expect(diff).toEqual({ added: [], edited: [], deleted: [] });
  });
});
