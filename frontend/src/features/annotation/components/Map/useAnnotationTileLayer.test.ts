import { describe, it, expect, vi } from 'vitest';

import {
  createAnnotationDisplayLayer,
  releaseAnnotationTileSource,
} from './useAnnotationTileLayer';
import type { CampaignOutFull } from '~/api/client';

vi.mock('~/features/auth/index', () => ({
  authManager: { getIdToken: () => Promise.resolve('token') },
}));

const campaign = (id: number) => ({ id, settings: { labels: [] } }) as unknown as CampaignOutFull;

const getVersion = () => 0;

describe('annotation tile source sharing', () => {
  it('reuses one source across layers of the same campaign', () => {
    // Task mode builds a WindowMap per collection card. A source each meant the
    // same tile was fetched once per card; one source lets OL's cache dedupe.
    const a = createAnnotationDisplayLayer(campaign(66), {}, getVersion);
    const b = createAnnotationDisplayLayer(campaign(66), {}, getVersion);

    expect(a.getSource()).toBe(b.getSource());

    releaseAnnotationTileSource(66);
    releaseAnnotationTileSource(66);
  });

  it('keeps campaigns isolated', () => {
    const a = createAnnotationDisplayLayer(campaign(1), {}, getVersion);
    const b = createAnnotationDisplayLayer(campaign(2), {}, getVersion);

    expect(a.getSource()).not.toBe(b.getSource());

    releaseAnnotationTileSource(1);
    releaseAnnotationTileSource(2);
  });

  it('drops the source once the last layer releases it', () => {
    const first = createAnnotationDisplayLayer(campaign(9), {}, getVersion);
    const second = createAnnotationDisplayLayer(campaign(9), {}, getVersion);
    releaseAnnotationTileSource(9);

    // Still referenced by `second`, so a new layer must not rebuild the source.
    const third = createAnnotationDisplayLayer(campaign(9), {}, getVersion);
    expect(third.getSource()).toBe(first.getSource());

    releaseAnnotationTileSource(9);
    releaseAnnotationTileSource(9);

    // All refs dropped: the cache entry is gone and a fresh source is built.
    const rebuilt = createAnnotationDisplayLayer(campaign(9), {}, getVersion);
    expect(rebuilt.getSource()).not.toBe(second.getSource());

    releaseAnnotationTileSource(9);
  });
});
