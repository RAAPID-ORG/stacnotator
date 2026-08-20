import { describe, it, expect, vi } from 'vitest';

vi.mock('~/api/tilerToken', () => ({ ensureTilerSession: vi.fn() }));

import { ensureTilerSession } from '~/api/tilerToken';
import { TilePreloader, tileUrlsForExtent, type PreloadImage } from './preloader';
import type { Bbox } from './types';

const WORLD: Bbox = [-179, -85, 179, 85];

class FakeImage implements PreloadImage {
  crossOrigin: string | null = null;
  fetchPriority: 'high' | 'low' | 'auto' = 'auto';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly srcHistory: string[] = [];

  get src(): string {
    return this.srcHistory[this.srcHistory.length - 1] ?? '';
  }
  set src(value: string) {
    this.srcHistory.push(value);
  }

  succeed(): void {
    this.onload?.();
  }
  fail(): void {
    this.onerror?.();
  }
}

function harness(maxConcurrent: number) {
  const images: FakeImage[] = [];
  const preloader = new TilePreloader({
    maxConcurrent,
    createImage: () => {
      const image = new FakeImage();
      images.push(image);
      return image;
    },
  });
  return { images, preloader };
}

/** Let the queued ensureSessionFor promises settle so pending loads start. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('tileUrlsForExtent', () => {
  it('expands the template over the tile range at the rounded zoom', () => {
    expect(tileUrlsForExtent('https://t/{z}/{x}/{y}.png', WORLD, 0)).toEqual([
      'https://t/0/0/0.png',
    ]);
    expect(tileUrlsForExtent('https://t/{z}/{x}/{y}.png', WORLD, 1)).toHaveLength(4);
  });
});

describe('TilePreloader queue', () => {
  it('loads higher-priority groups first', async () => {
    const { images, preloader } = harness(1);
    preloader.enqueueMany([
      {
        priority: 5,
        groupId: 'later',
        urlTemplate: 'https://b/{z}/{x}/{y}',
        extent: WORLD,
        zoom: 0,
      },
      { priority: 1, groupId: 'now', urlTemplate: 'https://a/{z}/{x}/{y}', extent: WORLD, zoom: 0 },
    ]);
    await flush();

    expect(images).toHaveLength(1);
    expect(images[0].src).toBe('https://a/0/0/0');

    images[0].succeed();
    await flush();
    expect(images[1].src).toBe('https://b/0/0/0');
    preloader.dispose();
  });

  it('marks preload requests low priority', async () => {
    const { images, preloader } = harness(1);
    preloader.enqueue({
      priority: 1,
      groupId: 'g',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 0,
    });
    await flush();
    expect(images[0].fetchPriority).toBe('low');
    preloader.dispose();
  });

  it('never enqueues the same url twice', async () => {
    const { images, preloader } = harness(4);
    const job = {
      priority: 1,
      groupId: 'g',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 0,
    };
    preloader.enqueue(job);
    preloader.enqueue({ ...job });
    await flush();
    expect(images).toHaveLength(1);
    preloader.dispose();
  });

  it('pauses without aborting in-flight loads', async () => {
    const { images, preloader } = harness(1);
    preloader.enqueueMany([
      { priority: 1, groupId: 'g', urlTemplate: 'https://a/{z}/{x}/{y}', extent: WORLD, zoom: 1 },
    ]);
    await flush();
    expect(images).toHaveLength(1);

    preloader.pause();
    expect(preloader.isPaused).toBe(true);
    expect(images[0].srcHistory).toEqual(['https://a/1/0/0']);

    images[0].succeed();
    await flush();
    expect(images).toHaveLength(1);
    expect(preloader.queueSize).toBe(3);

    preloader.resume();
    await flush();
    expect(images).toHaveLength(2);
    preloader.dispose();
  });

  it('clears the queue and ignores stale completions', async () => {
    const { images, preloader } = harness(1);
    preloader.enqueue({
      priority: 1,
      groupId: 'g',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 1,
    });
    await flush();

    preloader.clear();
    expect(preloader.queueSize).toBe(0);
    expect(images[0].srcHistory).toHaveLength(1);

    images[0].fail();
    await flush();
    expect(images).toHaveLength(1);
    preloader.dispose();
  });

  it('cancels stale in-flight work but preserves URLs shared by the foreground', async () => {
    const { images, preloader } = harness(4);
    preloader.enqueue({
      priority: 1,
      groupId: 'old-task',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 1,
    });
    await flush();
    preloader.pause();
    const keep = new Set([images[0].src]);

    preloader.cancelInflightExcept(keep);

    expect(images[0].srcHistory).toEqual([keep.values().next().value]);
    expect(images.slice(1).every((image) => image.src === '')).toBe(true);
    preloader.dispose();
  });
});

describe('TilePreloader groups', () => {
  it('drops a group on abort', async () => {
    const { preloader } = harness(1);
    preloader.enqueue({
      priority: 1,
      groupId: 'slice-7',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 2,
    });
    await flush();
    expect(preloader.queueSize).toBe(15);

    preloader.abort('slice-7');
    expect(preloader.queueSize).toBe(0);
    preloader.dispose();
  });
});

describe('TilePreloader progress', () => {
  it('counts every settled tile, loaded or errored, against its group total', async () => {
    const { images, preloader } = harness(4);
    preloader.enqueue({
      priority: 1,
      groupId: 'g',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 1,
    });
    await flush();
    expect(preloader.progress().get('g')).toEqual({ done: 0, total: 4 });

    images[0].succeed();
    images[1].fail();
    await flush();

    expect(preloader.progress().get('g')).toEqual({ done: 2, total: 4 });
    preloader.dispose();
  });

  it('drops the abandoned remainder so an aborted group still reads complete', async () => {
    const { images, preloader } = harness(1);
    preloader.enqueue({
      priority: 1,
      groupId: 'g',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 2,
    });
    await flush();
    expect(preloader.progress().get('g')).toEqual({ done: 0, total: 16 });

    preloader.abort('g');
    images[0].succeed();
    await flush();

    expect(preloader.progress().get('g')).toEqual({ done: 1, total: 1 });
    preloader.dispose();
  });

  it('forgets group counts when a new focus clears the queue', async () => {
    const { preloader } = harness(1);
    preloader.enqueue({
      priority: 1,
      groupId: 'g',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 1,
    });
    await flush();

    preloader.clear();

    expect(preloader.progress().size).toBe(0);
    preloader.dispose();
  });

  it('counts a tile already fetched this cycle as warm instead of dropping it', async () => {
    const { images, preloader } = harness(4);
    const job = {
      priority: 1,
      groupId: 'first',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 1,
    };
    preloader.enqueue(job);
    await flush();
    images.forEach((image) => image.succeed());
    await flush();

    preloader.clear();
    preloader.enqueue({ ...job, groupId: 'again' });
    await flush();

    expect(preloader.progress().get('again')).toEqual({ done: 4, total: 4 });
    expect(images).toHaveLength(4);
    preloader.dispose();
  });

  it('drops a cancelled tile from the warm set so it is fetched again later', async () => {
    const { images, preloader } = harness(4);
    const job = {
      priority: 1,
      groupId: 'g',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 1,
    };
    preloader.enqueue(job);
    await flush();

    preloader.cancelInflightExcept(new Set());
    preloader.clear();
    preloader.enqueue({ ...job, groupId: 'retry' });
    await flush();

    expect(preloader.progress().get('retry')).toEqual({ done: 0, total: 4 });
    expect(images).toHaveLength(8);
    preloader.dispose();
  });

  it('notifies on enqueue and on each settled tile', async () => {
    const { images, preloader } = harness(4);
    const onProgress = vi.fn();
    preloader.onProgress = onProgress;

    preloader.enqueue({
      priority: 1,
      groupId: 'g',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 1,
    });
    await flush();
    expect(onProgress).toHaveBeenCalledTimes(1);

    images[0].succeed();
    await flush();
    expect(onProgress).toHaveBeenCalledTimes(2);
    preloader.dispose();
  });
});

describe('TilePreloader warm set', () => {
  // Browsing to another date inside the same task clears the queue and
  // re-enqueues the same neighbourhood. Tiles that were still waiting were
  // never fetched, so they must not come back already counted as done.
  it('does not count tiles that only ever sat in the queue as warm', async () => {
    const { preloader } = harness(1);
    const job = {
      priority: 1,
      groupId: 'g',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 1,
    };
    preloader.enqueue(job);
    await flush();
    expect(preloader.progress().get('g')).toEqual({ done: 0, total: 4 });

    preloader.clear();
    preloader.enqueue(job);
    await flush();

    // One tile was in flight when the queue was cleared; the other three never
    // left it, so only that one may read as already warm.
    expect(preloader.progress().get('g')).toEqual({ done: 1, total: 4 });
    preloader.dispose();
  });

  it('forgets aborted tiles too, so a re-enqueued group starts cold', async () => {
    const { preloader } = harness(0);
    const job = {
      priority: 1,
      groupId: 'g',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 1,
    };
    preloader.enqueue(job);
    preloader.abort('g');
    preloader.enqueue(job);
    await flush();

    expect(preloader.progress().get('g')).toEqual({ done: 0, total: 4 });
    preloader.dispose();
  });
});

describe('TilePreloader credentials', () => {
  it('refreshes the tiler session only for credentialed tiles', async () => {
    const refreshToken = vi.mocked(ensureTilerSession);
    refreshToken.mockClear().mockResolvedValue(undefined);
    const images: FakeImage[] = [];
    const preloader = new TilePreloader({
      maxConcurrent: 4,
      createImage: () => {
        const image = new FakeImage();
        images.push(image);
        return image;
      },
    });

    preloader.enqueue({
      priority: 1,
      groupId: 'public',
      urlTemplate: 'https://osm/{z}/{x}/{y}.png',
      extent: WORLD,
      zoom: 0,
      tileProvider: 'mpc',
    });
    await flush();
    expect(refreshToken).not.toHaveBeenCalled();
    expect(images[0].crossOrigin).toBe('anonymous');

    preloader.enqueue({
      priority: 1,
      groupId: 'ours',
      urlTemplate: 'https://tiler/{z}/{x}/{y}.png',
      extent: WORLD,
      zoom: 0,
      tileProvider: 'planet',
    });
    await flush();
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(images[1].crossOrigin).toBe('use-credentials');
    preloader.dispose();
  });
});
