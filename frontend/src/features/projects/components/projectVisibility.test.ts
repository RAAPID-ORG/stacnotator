import { describe, expect, it } from 'vitest';
import { LEAVE_PUBLIC_WARNING, requiresLeavePublicConfirm } from './projectVisibility';

/** ProjectSettingsSection defers updateProject behind a ConfirmDialog showing
 *  LEAVE_PUBLIC_WARNING exactly when this predicate is true. */
describe('requiresLeavePublicConfirm', () => {
  it('confirms leaving public for either narrower scope', () => {
    expect(requiresLeavePublicConfirm('public', 'organization')).toBe(true);
    expect(requiresLeavePublicConfirm('public', 'private')).toBe(true);
  });

  it('never confirms transitions that do not leave public', () => {
    expect(requiresLeavePublicConfirm('private', 'public')).toBe(false);
    expect(requiresLeavePublicConfirm('private', 'organization')).toBe(false);
    expect(requiresLeavePublicConfirm('organization', 'private')).toBe(false);
    expect(requiresLeavePublicConfirm('organization', 'public')).toBe(false);
    expect(requiresLeavePublicConfirm('public', 'public')).toBe(false);
  });

  it('warns about the stripped anyone audience', () => {
    expect(LEAVE_PUBLIC_WARNING).toContain('"anyone" audience');
  });
});
