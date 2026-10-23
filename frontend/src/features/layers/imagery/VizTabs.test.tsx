import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { NamedVizParams } from './types';
import { VizTabs } from './VizTabs';

describe('VizTabs visualization identity', () => {
  it('does not reuse a calculated-band draft after deleting the active tab', async () => {
    const Harness = () => {
      const [visualizations, setVisualizations] = useState<NamedVizParams[]>([
        {
          name: 'NDVI',
          vizParams: {
            assets: ['data'],
            assetAsBand: false,
            rescale: '-1,1',
            expression: '(data_b2-data_b1)/(data_b2+data_b1)',
          },
        },
        {
          name: 'RGB',
          vizParams: { assets: ['data'], bidx: [3, 2, 1], assetAsBand: false, rescale: '0,3000' },
        },
      ]);
      return (
        <VizTabs
          visualizations={visualizations}
          activeIndex={0}
          onActiveIndexChange={() => {}}
          collectionId="private"
          availableAssets={{
            data: {
              title: 'Reflectance',
              type: 'image/tiff',
              roles: ['data'],
              bands: ['Red', 'Green', 'Blue'].map((name) => ({ name })),
            },
          }}
          showCompositing={false}
          onParamsChange={(index, vizParams) =>
            setVisualizations((previous) =>
              previous.map((viz, i) => (i === index ? { ...viz, vizParams } : viz))
            )
          }
          onRemove={(index) =>
            setVisualizations((previous) => previous.filter((_, i) => i !== index))
          }
        />
      );
    };
    render(<Harness />);
    await userEvent.clear(screen.getByLabelText('Band formula'));
    expect(screen.getByLabelText('Band formula')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove NDVI' }));
    expect((screen.getByRole('radio', { name: /^RGB/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Red (R) band') as HTMLSelectElement).value).toBe('3');
    expect(screen.queryByLabelText('Band formula')).toBeNull();
  });
});
