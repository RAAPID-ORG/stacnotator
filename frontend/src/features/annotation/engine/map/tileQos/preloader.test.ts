import { describe, it, expect, vi } from 'vitest';
import { TilePreloader, tileUrlsForExtent, type PreloadImage } from './preloader';
import { setTilerTokenRefresher } from './loading';
import type { Bbox } from '../types';

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
    const onGroupEmpty = vi.fn();
    preloader.onGroupEmpty = onGroupEmpty;
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
    expect(onGroupEmpty).not.toHaveBeenCalled();
    preloader.dispose();
  });
});

describe('TilePreloader empty detection', () => {
  it('reports a group empty after the error threshold with no successes', async () => {
    const { images, preloader } = harness(4);
    const onGroupEmpty = vi.fn();
    preloader.onGroupEmpty = onGroupEmpty;
    preloader.enqueue({
      priority: 1,
      groupId: 'slice-7',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 2,
    });
    await flush();

    for (let i = 0; i < 4; i++) {
      images[i].fail();
      await flush();
    }

    expect(onGroupEmpty).toHaveBeenCalledTimes(1);
    expect(onGroupEmpty).toHaveBeenCalledWith('slice-7');
    expect(preloader.queueSize).toBe(0);
    preloader.dispose();
  });

  it('stays quiet when a tile loaded', async () => {
    const { images, preloader } = harness(8);
    const onGroupEmpty = vi.fn();
    preloader.onGroupEmpty = onGroupEmpty;
    preloader.enqueue({
      priority: 1,
      groupId: 'slice-7',
      urlTemplate: 'https://a/{z}/{x}/{y}',
      extent: WORLD,
      zoom: 2,
    });
    await flush();

    images[0].succeed();
    await flush();
    for (let i = 1; i < 6; i++) {
      images[i].fail();
      await flush();
    }

    expect(onGroupEmpty).not.toHaveBeenCalled();
    preloader.dispose();
  });

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

describe('TilePreloader credentials', () => {
  it('falls back to the app-registered tiler refresher', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    setTilerTokenRefresher(refresh);
    const preloader = new TilePreloader({ maxConcurrent: 1, createImage: () => new FakeImage() });

    preloader.enqueue({
      priority: 1,
      groupId: 'ours',
      urlTemplate: 'https://tiler/{z}/{x}/{y}.png',
      extent: WORLD,
      zoom: 0,
      tileProvider: 'planet',
    });
    await flush();

    expect(refresh).toHaveBeenCalledTimes(1);
    preloader.dispose();
    setTilerTokenRefresher(() => Promise.resolve());
  });

  it('refreshes the tiler session only for credentialed tiles', async () => {
    const refreshToken = vi.fn().mockResolvedValue(undefined);
    const images: FakeImage[] = [];
    const preloader = new TilePreloader({
      maxConcurrent: 4,
      refreshToken,
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
