import { afterEach, describe, expect, it } from 'vitest';
import {
  isForegroundLoading,
  resetForegroundLoads,
  setForegroundMapLoading,
} from './foregroundTileLoads';

describe('foreground tile load aggregation', () => {
  afterEach(resetForegroundLoads);

  it('stays active until every visible map has finished loading', () => {
    setForegroundMapLoading('main', true);
    setForegroundMapLoading('window:10', true);

    setForegroundMapLoading('main', false);
    expect(isForegroundLoading()).toBe(true);

    setForegroundMapLoading('window:10', false);
    expect(isForegroundLoading()).toBe(false);
  });

  it('treats repeated OpenLayers load events as idempotent', () => {
    setForegroundMapLoading('window:10', true);
    setForegroundMapLoading('window:10', true);
    setForegroundMapLoading('window:10', false);

    expect(isForegroundLoading()).toBe(false);
  });
});
