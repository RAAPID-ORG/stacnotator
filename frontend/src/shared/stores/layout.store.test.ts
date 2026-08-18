import { afterEach, describe, expect, it } from 'vitest';
import { useLayoutStore } from './layout.store';

afterEach(() => useLayoutStore.getState().cancelConfirmDialog());

describe('global confirmation', () => {
  it('resolves the pending request with the dialog answer', async () => {
    const answer = useLayoutStore.getState().showConfirmDialog({ title: 'Continue?' });

    useLayoutStore.getState().resolveConfirmDialog(true);

    await expect(answer).resolves.toBe(true);
    expect(useLayoutStore.getState().confirmDialog).toBeNull();
  });

  it('cancels the previous request when another takes the dialog slot', async () => {
    const first = useLayoutStore.getState().showConfirmDialog({ title: 'First' });
    const second = useLayoutStore.getState().showConfirmDialog({ title: 'Second' });

    await expect(first).resolves.toBe(false);
    expect(useLayoutStore.getState().confirmDialog?.title).toBe('Second');

    useLayoutStore.getState().cancelConfirmDialog();
    await expect(second).resolves.toBe(false);
  });
});
