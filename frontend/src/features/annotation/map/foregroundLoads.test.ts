import { afterEach, describe, expect, it } from 'vitest';
import { isForegroundLoading, setForegroundMapLoading } from './tileLoading';

/** No reset seam: clearing is just reporting every id idle again. */
const clearLoads = () =>
  ['main', 'window:10', 'window:11'].forEach((id) => setForegroundMapLoading(id, false));

describe('foreground tile load aggregation', () => {
  afterEach(clearLoads);

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
