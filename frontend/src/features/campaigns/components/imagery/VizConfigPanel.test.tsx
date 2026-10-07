import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { AssetInfo } from './collectionPresets';
import type { VizParams } from './types';
import { VizConfigPanel } from './VizConfigPanel';

const COG = 'image/tiff; application=geotiff; profile=cloud-optimized';
const single = (title: string): AssetInfo => ({ title, type: COG, roles: ['data'] });

let latest: VizParams;
const renderPanel = (availableAssets: Record<string, AssetInfo>) => {
  const Harness = () => {
    const [params, setParams] = useState<VizParams>({
      assets: [],
      assetAsBand: false,
      rescale: '',
    });
    latest = params;
    return (
      <VizConfigPanel
        collectionId="private-composites"
        availableAssets={availableAssets}
        vizParams={params}
        onChange={setParams}
      />
    );
  };
  render(<Harness />);
};

const click = (name: string | RegExp) => userEvent.click(screen.getByRole('button', { name }));

describe('VizConfigPanel band picker', () => {
  it('picks RGB from the bands of a multiband asset beside single-band sidecars', async () => {
    renderPanel({
      reflectance: {
        title: 'Surface reflectance',
        type: COG,
        roles: ['data'],
        bands: ['B02', 'B03', 'B04', 'B08'].map((name) => ({ name })),
      },
      'clear-count': { title: 'Clear observations', type: COG, roles: ['metadata'] },
    });

    await click(/Surface reflectance/);
    for (const band of ['B04', 'B03', 'B02']) await click(band);

    expect(latest).toMatchObject({ assets: ['reflectance'], bidx: [3, 2, 1] });
  });

  it('still combines single-band assets into RGB', async () => {
    renderPanel({ B04: single('Red'), B03: single('Green'), B02: single('Blue') });

    for (const band of ['Red', 'Green', 'Blue']) await click(band);

    expect(latest).toMatchObject({ assets: ['B04', 'B03', 'B02'], assetAsBand: true });
    expect(latest.bidx).toBeUndefined();
  });
});
