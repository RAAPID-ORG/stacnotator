import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CampaignCreate,
  TimeSeriesCreate,
  TimeSeriesOptionsOut,
  TimeSeriesOut,
} from '~/api/client';
import { renderWithQuery } from '~/shared/testing/renderWithQuery';
import { DEFAULT_TIMESERIES_WINDOW_NAME } from '~/shared/utils/constants';
import { validateTimeseriesStep } from '../../../utils/campaignValidation';
import { StepAddTimeseries } from './StepAddTimeseries';

vi.mock('~/api/client/sdk.gen', async () => ({
  ...(await vi.importActual<typeof import('~/api/client/sdk.gen')>('~/api/client/sdk.gen')),
  getTimeseriesCreationOptions: vi.fn(),
}));

import { getTimeseriesCreationOptions } from '~/api/client/sdk.gen';

const options: TimeSeriesOptionsOut = {
  providers: ['gee'],
  sources: [
    {
      key: 'sentinel',
      label: 'Sentinel-2',
      coverage: '2015-present',
      resolution_m: 10,
      description: 'Optical imagery',
      index_keys: ['ndvi', 'ndwi'],
    },
    {
      key: 'landsat',
      label: 'Landsat',
      coverage: '1984-present',
      resolution_m: 30,
      description: 'Optical imagery',
      index_keys: ['ndvi'],
    },
  ],
  indices: [
    {
      key: 'ndvi',
      label: 'NDVI',
      formula: '(NIR - RED) / (NIR + RED)',
      domain_min: -1,
      domain_max: 1,
      reference_lines: [0],
    },
    {
      key: 'ndwi',
      label: 'NDWI',
      formula: '(GREEN - NIR) / (GREEN + NIR)',
      domain_min: -1,
      domain_max: 1,
      reference_lines: [0],
    },
  ],
};

const initialForm: CampaignCreate = {
  name: 'Campaign',
  project_id: 1,
  settings: { labels: [], bbox_west: 0, bbox_south: 0, bbox_east: 1, bbox_north: 1 },
  timeseries_configs: [],
};
const onChange = vi.fn();
const onRemoveExisting = vi.fn();
const onRenameExistingPanel = vi.fn();
const savedSeries: TimeSeriesOut = {
  id: 5,
  campaign_id: 1,
  name: 'Saved NDVI',
  window_name: 'Vegetation',
  start_ym: '202001',
  end_ym: '202012',
  data_source: 'sentinel',
  provider: 'gee',
  ts_type: 'ndvi',
  index: options.indices[0],
};

function Editor({ existingTimeseries = [] }: { existingTimeseries?: TimeSeriesOut[] }) {
  const [form, setForm] = useState(initialForm);
  const [saved, setSaved] = useState(existingTimeseries);
  return (
    <StepAddTimeseries
      form={form}
      setForm={(next) => {
        onChange(next);
        setForm(next);
      }}
      existingTimeseries={saved}
      onRemoveExisting={onRemoveExisting}
      onRenameExistingPanel={async (oldName, newName) => {
        await onRenameExistingPanel(oldName, newName);
        setSaved((series) =>
          series.map((item) =>
            item.window_name === oldName ? { ...item, window_name: newName } : item
          )
        );
      }}
    />
  );
}

async function openEditor(existingTimeseries: TimeSeriesOut[] = []) {
  renderWithQuery(<Editor existingTimeseries={existingTimeseries} />);
  await waitFor(() =>
    expect(
      (
        screen.getAllByRole('button', {
          name: /\+ Add (another )?timeseries/,
        })[0] as HTMLButtonElement
      ).disabled
    ).toBe(false)
  );
}

async function createPanel(name: string) {
  await userEvent.click(screen.getByRole('button', { name: '+ Add Panel' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'New panel name' }), name);
  await userEvent.click(screen.getByRole('button', { name: 'Create panel' }));
  return screen.getByRole('region', { name: `${name.trim()} panel` });
}

describe('Panel-first timeseries setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onRenameExistingPanel.mockResolvedValue(undefined);
    vi.mocked(getTimeseriesCreationOptions).mockResolvedValue({ data: options } as Awaited<
      ReturnType<typeof getTimeseriesCreationOptions>
    >);
  });

  it('opens an optional blank series in the default panel and preserves focus when editing it', async () => {
    await openEditor();
    const group = screen.getByRole('region', { name: `${DEFAULT_TIMESERIES_WINDOW_NAME} panel` });
    expect(within(group).getAllByRole('textbox', { name: 'Timeseries name' })).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(validateTimeseriesStep(initialForm).isValid).toBe(true);
    expect(screen.getByText(/Panels organize timeseries/)).toBeTruthy();
    await userEvent.type(
      within(group).getByRole('textbox', { name: 'Timeseries name' }),
      'Vegetation'
    );
    expect(onChange.mock.lastCall?.[0].timeseries_configs).toEqual([
      expect.objectContaining({
        name: 'Vegetation',
        window_name: DEFAULT_TIMESERIES_WINDOW_NAME,
        provider: 'gee',
      }),
    ]);
    expect(screen.queryByRole('combobox', { name: 'Window' })).toBeNull();
  });

  it('keeps all panels visible and adds and removes series only within their panel', async () => {
    await openEditor();
    const vegetation = await createPanel(' Vegetation ');
    await userEvent.type(
      within(vegetation).getByRole('textbox', { name: 'Timeseries name' }),
      'Sentinel NDVI'
    );
    await userEvent.click(
      within(vegetation).getByRole('button', { name: '+ Add another timeseries' })
    );
    await userEvent.type(
      within(vegetation).getAllByRole('textbox', { name: 'Timeseries name' })[1],
      'Landsat NDVI'
    );
    const water = await createPanel('Water');
    await userEvent.type(within(water).getByRole('textbox', { name: 'Timeseries name' }), 'NDWI');
    expect(screen.getAllByRole('region')).toHaveLength(3);
    expect(
      onChange.mock.lastCall?.[0].timeseries_configs.map((ts: TimeSeriesCreate) => ts.window_name)
    ).toEqual(['Vegetation', 'Vegetation', 'Water']);
    await userEvent.click(within(vegetation).getAllByRole('button', { name: 'Remove' })[0]);
    await userEvent.type(within(water).getByRole('textbox', { name: 'Timeseries name' }), ' water');
    expect(
      onChange.mock.lastCall?.[0].timeseries_configs.map((ts: TimeSeriesCreate) => ts.name)
    ).toEqual(['Landsat NDVI', 'NDWI water']);
  });

  it('adds another open series and can remove all series without making them required', async () => {
    await openEditor();
    const group = screen.getByRole('region', { name: `${DEFAULT_TIMESERIES_WINDOW_NAME} panel` });
    await userEvent.click(within(group).getByRole('button', { name: '+ Add another timeseries' }));
    expect(within(group).getAllByRole('textbox', { name: 'Timeseries name' })).toHaveLength(2);
    await userEvent.click(within(group).getAllByRole('button', { name: 'Remove' })[0]);
    await userEvent.click(within(group).getByRole('button', { name: 'Remove' }));
    expect(within(group).queryByRole('textbox')).toBeNull();
    expect(within(group).getByRole('button', { name: '+ Add timeseries' })).toBeTruthy();
    expect(validateTimeseriesStep(onChange.mock.lastCall?.[0]).isValid).toBe(true);
  });

  it('renames the initial blank panel without creating a required timeseries', async () => {
    await openEditor();
    await userEvent.click(
      screen.getByRole('button', { name: `Rename ${DEFAULT_TIMESERIES_WINDOW_NAME} panel` })
    );
    const name = screen.getByRole('textbox', { name: 'Panel name' });
    await userEvent.clear(name);
    await userEvent.type(name, ' Vegetation {Enter}');
    const panel = screen.getByRole('region', { name: 'Vegetation panel' });
    expect(screen.queryByRole('region', { name: `${DEFAULT_TIMESERIES_WINDOW_NAME} panel` })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Timeseries name' }), 'NDVI');
    expect(onChange.mock.lastCall?.[0].timeseries_configs[0].window_name).toBe('Vegetation');
  });

  it('renames all new series together and uses the new name for additional series', async () => {
    await openEditor();
    const panel = await createPanel('Vegetation');
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Timeseries name' }), 'NDVI');
    await userEvent.click(within(panel).getByRole('button', { name: '+ Add another timeseries' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Rename Vegetation panel' }));
    const name = screen.getByRole('textbox', { name: 'Panel name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Greenness');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    const renamed = screen.getByRole('region', { name: 'Greenness panel' });
    await userEvent.click(within(renamed).getByRole('button', { name: '+ Add another timeseries' }));
    expect(onChange.mock.lastCall?.[0].timeseries_configs.map((ts: TimeSeriesCreate) => ts.window_name))
      .toEqual(['Greenness', 'Greenness', 'Greenness']);
    expect(screen.queryByRole('region', { name: 'Vegetation panel' })).toBeNull();
  });

  it('rejects blank and duplicate renames and cancels without changing the panel', async () => {
    await openEditor();
    const panel = await createPanel('Vegetation');
    await createPanel('Water');
    await userEvent.click(within(panel).getByRole('button', { name: 'Rename Vegetation panel' }));
    const name = screen.getByRole('textbox', { name: 'Panel name' });
    await userEvent.clear(name);
    expect((within(panel).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(name, ' Water ');
    expect(screen.getByRole('alert').textContent).toMatch(/already exists/);
    expect((within(panel).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(within(panel).queryByRole('textbox', { name: 'Panel name' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('persists saved-panel renames and moves unsaved series in the same panel', async () => {
    await openEditor([savedSeries]);
    const panel = screen.getByRole('region', { name: 'Vegetation panel' });
    await userEvent.click(within(panel).getByRole('button', { name: '+ Add another timeseries' }));
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Timeseries name' }), 'New NDVI');
    await userEvent.click(within(panel).getByRole('button', { name: 'Rename Vegetation panel' }));
    const name = screen.getByRole('textbox', { name: 'Panel name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Greenness{Enter}');
    const renamed = await screen.findByRole('region', { name: 'Greenness panel' });
    expect(onRenameExistingPanel).toHaveBeenCalledWith('Vegetation', 'Greenness');
    expect(within(renamed).getByText('Saved NDVI')).toBeTruthy();
    expect((within(renamed).getByRole('textbox', { name: 'Timeseries name' }) as HTMLInputElement).value)
      .toBe('New NDVI');
    expect(onChange.mock.lastCall?.[0].timeseries_configs[0].window_name).toBe('Greenness');
    expect(screen.queryByRole('region', { name: 'Vegetation panel' })).toBeNull();
  });

  it('keeps the original saved panel and exposes an error when renaming fails', async () => {
    onRenameExistingPanel.mockRejectedValueOnce(new Error('Rename failed'));
    await openEditor([savedSeries]);
    const panel = screen.getByRole('region', { name: 'Vegetation panel' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Rename Vegetation panel' }));
    const name = screen.getByRole('textbox', { name: 'Panel name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Greenness{Enter}');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not rename/);
    expect(within(panel).getByText('Saved NDVI')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Greenness panel' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects duplicate panel names and allows cancelling panel creation', async () => {
    await openEditor();
    await createPanel('Water');
    await userEvent.click(screen.getByRole('button', { name: '+ Add Panel' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New panel name' }), ' Water ');
    expect(screen.getByRole('alert').textContent).toMatch(/already exists/);
    expect(
      (screen.getByRole('button', { name: 'Create panel' }) as HTMLButtonElement).disabled
    ).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByRole('region')).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows saved and new series together and preserves source-specific index selection', async () => {
    await openEditor([savedSeries]);
    const group = screen.getByRole('region', { name: 'Vegetation panel' });
    expect(within(group).getByText('Saved NDVI')).toBeTruthy();
    await userEvent.click(within(group).getByRole('button', { name: '+ Add another timeseries' }));
    await userEvent.selectOptions(
      within(group).getByRole('combobox', { name: 'Data source' }),
      'sentinel'
    );
    await userEvent.selectOptions(within(group).getByRole('combobox', { name: 'Index' }), 'ndwi');
    await userEvent.selectOptions(
      within(group).getByRole('combobox', { name: 'Data source' }),
      'landsat'
    );
    expect(within(group).queryByRole('option', { name: 'NDWI' })).toBeNull();
    expect(onChange.mock.lastCall?.[0].timeseries_configs[0]).toMatchObject({
      window_name: 'Vegetation',
      data_source: 'landsat',
      ts_type: '',
      provider: 'gee',
    });
    await userEvent.click(within(group).getAllByRole('button', { name: 'Remove' })[0]);
    expect(onRemoveExisting).toHaveBeenCalledWith(5);
  });
});
