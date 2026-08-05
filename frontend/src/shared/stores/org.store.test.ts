import { describe, it, expect, beforeEach, vi } from 'vitest';

const entries = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => entries.get(key) ?? null,
  setItem: (key: string, value: string) => {
    entries.set(key, value);
  },
  removeItem: (key: string) => {
    entries.delete(key);
  },
  clear: () => {
    entries.clear();
  },
});

// The persist middleware grabs `window.localStorage` when the module is first
// evaluated, so the stub above has to be in place before the import runs.
const { useOrgStore } = await import('./org.store');

describe('useOrgStore', () => {
  beforeEach(() => {
    entries.clear();
    useOrgStore.setState({ activeOrgId: null });
  });

  it('starts with no active organization', () => {
    expect(useOrgStore.getInitialState().activeOrgId).toBeNull();
    expect(useOrgStore.getState().activeOrgId).toBeNull();
  });

  it('round-trips the active organization id', () => {
    useOrgStore.getState().setActiveOrgId(4);
    expect(useOrgStore.getState().activeOrgId).toBe(4);

    useOrgStore.getState().setActiveOrgId(null);
    expect(useOrgStore.getState().activeOrgId).toBeNull();
  });

  it('reset clears the selection so it does not follow the next user', () => {
    useOrgStore.getState().setActiveOrgId(4);

    useOrgStore.getState().reset();

    expect(useOrgStore.getState().activeOrgId).toBeNull();
    expect(JSON.parse(localStorage.getItem('active-org') ?? '')).toMatchObject({
      state: { activeOrgId: null },
    });
  });

  it('persists the active organization under the "active-org" key', () => {
    useOrgStore.getState().setActiveOrgId(9);

    const raw = localStorage.getItem('active-org');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? '')).toMatchObject({ state: { activeOrgId: 9 } });
  });
});
