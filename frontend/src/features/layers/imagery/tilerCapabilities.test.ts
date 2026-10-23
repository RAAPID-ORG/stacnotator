import { describe, expect, it } from 'vitest';
import type { TilerOption } from '~/api/client';
import { compositingMethods, servingTiler } from './tilerCapabilities';

const MPC_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1';
const PLATFORM_STAC = 'https://tiles.example.org/stac';

const mpc: TilerOption = { name: 'mpc', kind: 'mpc', is_default: false };
const platform: TilerOption = {
  name: 'platform',
  kind: 'hosted',
  is_default: true,
  stac_url: PLATFORM_STAC,
  allows_ingest: false,
};
const ingesting: TilerOption = {
  name: 'big',
  kind: 'hosted',
  is_default: false,
  allows_ingest: true,
};

describe('servingTiler', () => {
  it('serves a platform catalog from its own tiler', () => {
    expect(servingTiler(`${PLATFORM_STAC}/collections`, null, [mpc, platform])?.name).toBe(
      'platform'
    );
  });

  it('leaves an external catalog unserved without an ingesting tiler', () => {
    expect(servingTiler(MPC_URL, null, [mpc, platform])).toBeUndefined();
  });

  it('switches off a pin that cannot ingest an external catalog', () => {
    expect(servingTiler(MPC_URL, 'platform', [mpc, platform, ingesting])?.name).toBe('big');
  });
});

describe('compositingMethods', () => {
  it('offers only first-valid when no tiler can render the catalog', () => {
    expect(compositingMethods(servingTiler(MPC_URL, null, [mpc]))).toEqual(['first']);
  });

  it('offers the full set once a tiler renders the catalog', () => {
    expect(compositingMethods(servingTiler(MPC_URL, null, [mpc, ingesting]))).toContain('median');
  });
});
