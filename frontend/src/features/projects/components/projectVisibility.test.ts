import { describe, expect, it } from 'vitest';
import { LEAVE_PUBLIC_WARNING, visibilityConfirm } from './projectVisibility';

/** ProjectSettingsSection defers updateProject behind a ConfirmDialog with
 *  exactly the copy this helper returns; null means the switch applies
 *  directly. */
describe('visibilityConfirm', () => {
  it('confirms going public from either narrower scope, without danger styling', () => {
    for (const from of ['private', 'organization'] as const) {
      const confirm = visibilityConfirm(from, 'public');
      expect(confirm?.confirmText).toBe('Make public');
      expect(confirm?.isDangerous).toBe(false);
    }
  });

  it('confirms leaving public as destructive, naming the target scope', () => {
    expect(visibilityConfirm('public', 'organization')).toMatchObject({
      confirmText: 'Restrict to organization',
      isDangerous: true,
    });
    expect(visibilityConfirm('public', 'private')).toMatchObject({
      confirmText: 'Make private',
      isDangerous: true,
    });
  });

  it('lets switches between the narrower scopes apply directly', () => {
    expect(visibilityConfirm('private', 'organization')).toBeNull();
    expect(visibilityConfirm('organization', 'private')).toBeNull();
    expect(visibilityConfirm('public', 'public')).toBeNull();
  });

  it('warns about the stripped anyone audience', () => {
    expect(LEAVE_PUBLIC_WARNING).toContain('"anyone" audience');
  });
});
