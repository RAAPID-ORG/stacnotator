import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureTilerSession,
  expireTilerSession,
  setTilerSessionMinter,
  tileScope,
} from './tilerToken';

describe('tileScope', () => {
  it('reads the scope a credentialed tile is served under', () => {
    expect(tileScope('https://t/scopes/235/searches/s/tiles/1/2/3.png')).toBe('235');
    expect(tileScope('https://t/scopes/visualizer:12/searches/s/tiles/1/2/3.png')).toBe(
      'visualizer:12'
    );
    expect(tileScope('/api/campaigns/235/imagery/slices/9/tiles/4/1/2/3')).toBe('235');
    expect(tileScope('/api/visualizers/12/imagery/basemaps/3/tiles/1/2/3')).toBe('visualizer:12');
    expect(tileScope('https://osm/1/2/3.png')).toBeNull();
  });
});

describe('ensureTilerSession', () => {
  afterEach(() => {
    vi.useRealTimers();
    setTilerSessionMinter(null);
  });

  it('mints once per scope and keeps each scope apart', async () => {
    const minter = vi.fn().mockResolvedValue(3600);
    setTilerSessionMinter(minter);

    await Promise.all([ensureTilerSession('1'), ensureTilerSession('1'), ensureTilerSession('2')]);
    await ensureTilerSession('1');

    expect(minter.mock.calls).toEqual([['1'], ['2']]);
  });

  it('mints again after a failed tile, but not straight after a mint', async () => {
    vi.useFakeTimers();
    const minter = vi.fn().mockResolvedValue(3600);
    setTilerSessionMinter(minter);
    await ensureTilerSession('1');

    expireTilerSession('1');
    await ensureTilerSession('1');
    expect(minter).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    expireTilerSession('1');
    await ensureTilerSession('1');
    expect(minter).toHaveBeenCalledTimes(2);
  });

  it('hands back a failed mint until the cooldown passes', async () => {
    vi.useFakeTimers();
    const minter = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(3600);
    setTilerSessionMinter(minter);

    await expect(ensureTilerSession('1')).rejects.toThrow('down');
    await expect(ensureTilerSession('1')).rejects.toThrow('down');
    expect(minter).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    await ensureTilerSession('1');
    expect(minter).toHaveBeenCalledTimes(2);
  });
});
