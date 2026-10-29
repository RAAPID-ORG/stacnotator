import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from './errorHandler';

describe('extractErrorMessage', () => {
  it('drops the pydantic "Value error, " prefix from validation messages', () => {
    const body = {
      detail: [{ msg: 'Value error, Field titles must be unique', loc: [], type: 'value_error' }],
    };
    expect(extractErrorMessage(body)).toBe('Field titles must be unique');
  });
});
