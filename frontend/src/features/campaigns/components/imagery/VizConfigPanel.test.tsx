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
const renderPanel = (
  availableAssets: Record<string, AssetInfo>,
  collectionId = 'private-composites',
  initialParams?: VizParams
) => {
  const Harness = () => {
    const [params, setParams] = useState<VizParams>(
      initialParams ?? {
        assets: [],
        assetAsBand: false,
        rescale: '',
      }
    );
    latest = params;
    return (
      <VizConfigPanel
        collectionId={collectionId}
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
  it('shows band mapping only after choosing custom and a rendering type', async () => {
    renderPanel({ data: single('Elevation') });
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    await click('Custom');
    expect(screen.getByRole('radio', { name: /^Single band/ })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: /^Single band/ }));
    await userEvent.selectOptions(screen.getByLabelText('Single band asset'), 'data');
    expect(latest.assets).toEqual(['data']);
    expect(screen.getByLabelText('Color scale')).toBeTruthy();
    expect((screen.getByLabelText('Single band band') as HTMLSelectElement).disabled).toBe(true);
  });

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

    await click('Custom');
    await userEvent.click(screen.getByRole('radio', { name: /^RGB/ }));
    for (const [channel, band] of [
      ['Red (R)', '3'],
      ['Green (G)', '2'],
      ['Blue (B)', '1'],
    ]) {
      await userEvent.selectOptions(screen.getByLabelText(`${channel} asset`), 'reflectance');
      await userEvent.selectOptions(screen.getByLabelText(`${channel} band`), band);
    }

    expect(latest).toMatchObject({ assets: ['reflectance'], bidx: [3, 2, 1] });
  });

  it('still combines single-band assets into RGB', async () => {
    renderPanel({ B04: single('Red'), B03: single('Green'), B02: single('Blue') });

    await click('Custom');
    await userEvent.click(screen.getByRole('radio', { name: /^RGB/ }));
    for (const [channel, asset] of [
      ['Red (R)', 'B04'],
      ['Green (G)', 'B03'],
      ['Blue (B)', 'B02'],
    ]) {
      await userEvent.selectOptions(screen.getByLabelText(`${channel} asset`), asset);
    }

    expect(latest).toMatchObject({ assets: ['B04', 'B03', 'B02'], assetAsBand: true });
    expect(latest.bidx).toBeUndefined();
  });

  it('retains channel positions when channels are configured out of order', async () => {
    renderPanel({ red: single('Red'), green: single('Green'), blue: single('Blue') });
    await click('Custom');
    await userEvent.click(screen.getByRole('radio', { name: /^RGB/ }));
    await userEvent.selectOptions(screen.getByLabelText('Blue (B) asset'), 'blue');
    expect(latest.assets).toEqual([]);
    await userEvent.selectOptions(screen.getByLabelText('Red (R) asset'), 'red');
    await userEvent.selectOptions(screen.getByLabelText('Green (G) asset'), 'green');
    expect(latest.assets).toEqual(['red', 'green', 'blue']);
    await userEvent.selectOptions(screen.getByLabelText('Red (R) asset'), '');
    expect((screen.getByLabelText('Blue (B) asset') as HTMLSelectElement).value).toBe('blue');
  });

  it('distinguishes pre-rendered true color from calculated single-band presets', async () => {
    renderPanel(
      {
        visual: { ...single('True color'), roles: ['visual'] },
        B08: single('NIR'),
        B04: single('Red'),
      },
      'sentinel-2-l2a'
    );
    await click('Use a preset');
    expect(screen.queryByRole('radio')).toBeNull();
    await click('True Color (RGB)');
    expect((screen.getByRole('radio', { name: /^RGB/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Red (R) asset') as HTMLSelectElement).value).toBe('visual');
    expect((screen.getByLabelText('Blue (B) band') as HTMLSelectElement).value).toBe('3');
    expect(latest.assets).toEqual(['visual']);
    expect(latest.bidx).toBeUndefined();
    expect(screen.queryByLabelText('Color scale')).toBeNull();
    await click('NDVI');
    expect((screen.getByRole('radio', { name: /^Single band/ }) as HTMLInputElement).checked).toBe(
      true
    );
    expect(latest.expression).toBe('(B08-B04)/(B08+B04)');
    expect(
      (screen.getByRole('radio', { name: /^Calculate a band/ }) as HTMLInputElement).checked
    ).toBe(true);
    expect((screen.getByLabelText('Band formula') as HTMLInputElement).value).toBe(
      '(B08-B04)/(B08+B04)'
    );
    expect((screen.getByRole('checkbox', { name: 'NIR (B08)' }) as HTMLInputElement).checked).toBe(
      true
    );
    expect((screen.getByRole('checkbox', { name: 'Red (B04)' }) as HTMLInputElement).checked).toBe(
      true
    );
    expect(screen.queryByLabelText('Single band asset')).toBeNull();
    expect((screen.getByLabelText('Display range (min, max)') as HTMLInputElement).value).toBe(
      '-1,1'
    );
    await click('True Color (RGB)');
    expect(latest.expression).toBeUndefined();
    expect(latest.colormapName).toBeUndefined();
    expect(latest.rescale).toBe('');
  });

  it('lets single-band users choose input bands and edit a calculation without advanced options', async () => {
    renderPanel({ B08: single('NIR'), B04: single('Red') });
    await click('Custom');
    await userEvent.click(screen.getByRole('radio', { name: /^Single band/ }));
    await userEvent.click(screen.getByRole('radio', { name: /^Calculate a band/ }));
    expect(screen.queryByLabelText('Single band asset')).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'NIR (B08)' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Red (B04)' }));
    const formula = screen.getByLabelText('Band formula');
    await userEvent.type(formula, '(B08-B04)/(B08+B04)');
    expect(latest).toMatchObject({
      assets: ['B08', 'B04'],
      assetAsBand: true,
      expression: '(B08-B04)/(B08+B04)',
    });
    await userEvent.clear(formula);
    expect(screen.getByLabelText('Band formula')).toBeTruthy();
    await click('Insert B08 into formula');
    await userEvent.type(formula, '-');
    await click('Insert B04 into formula');
    expect(latest.expression).toBe('B08-B04');
  });

  it('uses indexed band references when a calculation includes a multiband asset', async () => {
    renderPanel(
      {
        B08: { ...single('NIR'), bands: [] },
        B04: single('Red'),
        data: {
          ...single('Reflectance'),
          bands: ['Blue', 'Green', 'Red', 'NIR'].map((name) => ({ name })),
        },
      },
      'sentinel-2-l2a'
    );
    await click('Use a preset');
    await click('NDVI');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Reflectance (data)' }));
    expect(latest.assetAsBand).toBe(false);
    expect(latest.expression).toBe('(B08_b1-B04_b1)/(B08_b1+B04_b1)');
    expect(screen.getByRole('button', { name: 'Insert data_b4 into formula' })).toBeTruthy();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Reflectance (data)' }));
    expect(latest.assetAsBand).toBe(true);
    expect(latest.expression).toBe('(B08-B04)/(B08+B04)');
  });

  it('switches between an existing multiband channel and a calculated band without stale indexes', async () => {
    renderPanel({
      data: { ...single('Reflectance'), bands: ['Red', 'NIR'].map((name) => ({ name })) },
    });
    await click('Custom');
    await userEvent.click(screen.getByRole('radio', { name: /^Single band/ }));
    await userEvent.selectOptions(screen.getByLabelText('Single band asset'), 'data');
    await userEvent.selectOptions(screen.getByLabelText('Single band band'), '2');
    expect(latest.bidx).toEqual([2]);
    await userEvent.click(screen.getByRole('radio', { name: /^Calculate a band/ }));
    expect(latest.bidx).toBeUndefined();
    await click('Insert data_b2 into formula');
    expect(latest.expression).toBe('data_b2');
    await userEvent.click(screen.getByRole('radio', { name: /^Use an existing band/ }));
    expect(latest.expression).toBeUndefined();
    expect(screen.getByLabelText('Single band asset')).toBeTruthy();
    expect(screen.queryByLabelText('Band formula')).toBeNull();
  });

  it('uses the same rendering controls to change a visual preset to a single band', async () => {
    renderPanel({ visual: { ...single('True color'), roles: ['visual'] } }, 'sentinel-2-l2a');
    await click('Use a preset');
    await click('True Color (RGB)');
    expect((screen.getByRole('radio', { name: /^RGB/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Blue (B) band') as HTMLSelectElement).value).toBe('3');
    expect(latest.assets).toEqual(['visual']);
    expect(latest.bidx).toBeUndefined();
    await userEvent.click(screen.getByRole('radio', { name: /^Single band/ }));
    expect((screen.getByLabelText('Single band asset') as HTMLSelectElement).value).toBe('visual');
    expect(latest.bidx).toEqual([1]);
    expect(screen.queryByLabelText('Green (G) asset')).toBeNull();
  });

  it('edits saved multiband mappings without changing them on mount', async () => {
    const initial: VizParams = {
      assets: ['data'],
      bidx: [3, 2, 1],
      assetAsBand: false,
      rescale: '0,3000',
    };
    renderPanel(
      {
        data: {
          ...single('Reflectance'),
          bands: ['Blue', 'Green', 'Red'].map((name) => ({ name })),
        },
      },
      'private-composites',
      initial
    );
    expect(latest).toEqual(initial);
    expect((screen.getByLabelText('Red (R) band') as HTMLSelectElement).value).toBe('3');
    await userEvent.selectOptions(screen.getByLabelText('Red (R) band'), '2');
    expect(latest.bidx).toEqual([2, 2, 1]);
    await userEvent.click(screen.getByRole('radio', { name: /^Single band/ }));
    expect(latest.bidx).toEqual([2]);
    expect(screen.queryByLabelText('Green (G) asset')).toBeNull();
  });

  it('keeps NAIP preset band indexes editable without conflicting legacy parameters', async () => {
    renderPanel({ image: single('NAIP image') }, 'naip');
    await click('Use a preset');
    await click('True Color (RGB)');
    expect((screen.getByLabelText('Blue (B) band') as HTMLSelectElement).value).toBe('3');
    await userEvent.selectOptions(screen.getByLabelText('Red (R) band'), '2');
    expect(latest.bidx).toEqual([2, 2, 3]);
    expect(latest.extraParams?.asset_bidx).toBeUndefined();
  });

  it('preserves saved RGB band indexes when metadata is unavailable', async () => {
    const initial: VizParams = {
      assets: ['reflectance'],
      bidx: [6, 4, 2],
      assetAsBand: false,
      rescale: '0,3000',
    };
    renderPanel({}, 'private-composites', initial);
    expect((screen.getByRole('radio', { name: /^RGB/ }) as HTMLInputElement).checked).toBe(true);
    expect(latest).toEqual(initial);
    await click('Advanced Options');
    expect(screen.getByText(/Saved band indexes: 6, 4, 2/)).toBeTruthy();
  });
});
