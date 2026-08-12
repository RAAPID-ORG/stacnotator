import { describe, it, expect } from 'vitest';
import type { TextFormField, NumberFormField } from '~/api/client';
import { validateForm } from './validate';

const REQUIRED_TEXT: TextFormField = {
  id: 1,
  title: 'Notes',
  required: true,
  type: 'text',
};

const REQUIRED_MULTILINE: TextFormField = {
  id: 2,
  title: 'Description',
  required: true,
  type: 'text',
  multiline: true,
};

const OPTIONAL_NUMBER: NumberFormField = {
  id: 3,
  title: 'Count',
  required: false,
  type: 'number',
};

describe('validateForm', () => {
  it('flags a missing required field', () => {
    expect(validateForm([REQUIRED_TEXT], {})).toEqual({ ok: false, missing: ['Notes'] });
  });

  it('never flags an absent optional field', () => {
    expect(validateForm([OPTIONAL_NUMBER], {})).toEqual({ ok: true, missing: [] });
  });

  it('is ok when every required field is answered', () => {
    const values = { '1': 'filled in', '3': 5 };
    expect(validateForm([REQUIRED_TEXT, OPTIONAL_NUMBER], values)).toEqual({
      ok: true,
      missing: [],
    });
  });

  it('treats a whitespace-only multiline answer as missing', () => {
    expect(validateForm([REQUIRED_MULTILINE], { '2': '   \n  ' })).toEqual({
      ok: false,
      missing: ['Description'],
    });
  });

  it('lists multiple missing titles in field order', () => {
    expect(validateForm([REQUIRED_TEXT, REQUIRED_MULTILINE], {})).toEqual({
      ok: false,
      missing: ['Notes', 'Description'],
    });
  });
});
