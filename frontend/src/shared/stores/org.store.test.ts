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
    useOrgStore.setState({ activeOrgId: null, hasChosenOrg: false });
  });

  it('starts with no active organization and no choice made', () => {
    expect(useOrgStore.getInitialState().activeOrgId).toBeNull();
    expect(useOrgStore.getState().activeOrgId).toBeNull();
    expect(useOrgStore.getState().hasChosenOrg).toBe(false);
  });

  it('round-trips the active organization id', () => {
    useOrgStore.getState().setActiveOrgId(4);
    expect(useOrgStore.getState().activeOrgId).toBe(4);

    useOrgStore.getState().setActiveOrgId(null);
    expect(useOrgStore.getState().activeOrgId).toBeNull();
  });

  it('marks any selection as chosen, including "No organization"', () => {
    useOrgStore.getState().setActiveOrgId(null);
    expect(useOrgStore.getState().hasChosenOrg).toBe(true);

    useOrgStore.setState({ hasChosenOrg: false });
    useOrgStore.getState().setActiveOrgId(4);
    expect(useOrgStore.getState().hasChosenOrg).toBe(true);
  });

  it('reset clears selection and marker so the next login re-defaults', () => {
    useOrgStore.getState().setActiveOrgId(4);

    useOrgStore.getState().reset();

    expect(useOrgStore.getState().activeOrgId).toBeNull();
    expect(useOrgStore.getState().hasChosenOrg).toBe(false);
    expect(JSON.parse(localStorage.getItem('active-org') ?? '')).toMatchObject({
      state: { activeOrgId: null, hasChosenOrg: false },
    });
  });

  it('persists the active organization under the "active-org" key', () => {
    useOrgStore.getState().setActiveOrgId(9);

    const raw = localStorage.getItem('active-org');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? '')).toMatchObject({ state: { activeOrgId: 9 } });
  });
});

describe('adoptActiveOrg', () => {
  it('moves the workspace to the organization of the page being viewed', () => {
    useOrgStore.setState({ activeOrgId: 1, hasChosenOrg: true });
    useOrgStore.getState().adoptActiveOrg(2, [1, 2]);
    expect(useOrgStore.getState().activeOrgId).toBe(2);
  });

  it('ignores organizations the viewer does not belong to', () => {
    useOrgStore.setState({ activeOrgId: 1, hasChosenOrg: true });
    useOrgStore.getState().adoptActiveOrg(99, [1, 2]);
    expect(useOrgStore.getState().activeOrgId).toBe(1);
  });

  it('leaves a first-run session marked as chosen once it lands somewhere', () => {
    useOrgStore.setState({ activeOrgId: null, hasChosenOrg: false });
    useOrgStore.getState().adoptActiveOrg(2, [2]);
    expect(useOrgStore.getState()).toMatchObject({ activeOrgId: 2, hasChosenOrg: true });
  });
});
