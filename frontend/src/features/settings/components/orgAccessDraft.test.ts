import { describe, expect, it } from 'vitest';
import { accessDraftChanges, type AccessDraft } from './orgAccessDraft';

const draft = (overrides: Partial<AccessDraft>): AccessDraft => ({
  organizationId: 1,
  initialTilers: ['tiler-a', 'tiler-b'],
  selectedTilers: ['tiler-a', 'tiler-b'],
  internalStorage: false,
  ...overrides,
});

describe('accessDraftChanges', () => {
  it('reports no changes for an untouched draft', () => {
    expect(accessDraftChanges(draft({}), false)).toEqual({
      tilersChanged: false,
      storageChanged: false,
    });
  });

  it('flags only the tiler save when the selection changed', () => {
    expect(accessDraftChanges(draft({ selectedTilers: ['tiler-a'] }), false)).toEqual({
      tilersChanged: true,
      storageChanged: false,
    });
  });

  it('detects a swapped tiler even when the count matches', () => {
    expect(
      accessDraftChanges(draft({ selectedTilers: ['tiler-a', 'tiler-c'] }), false).tilersChanged
    ).toBe(true);
  });

  it('ignores tiler order', () => {
    expect(
      accessDraftChanges(draft({ selectedTilers: ['tiler-b', 'tiler-a'] }), false).tilersChanged
    ).toBe(false);
  });

  it('flags only the storage save when the toggle changed', () => {
    expect(accessDraftChanges(draft({ internalStorage: true }), false)).toEqual({
      tilersChanged: false,
      storageChanged: true,
    });
  });

  it('flags both when both changed', () => {
    expect(accessDraftChanges(draft({ selectedTilers: [], internalStorage: true }), false)).toEqual(
      { tilersChanged: true, storageChanged: true }
    );
  });
});
