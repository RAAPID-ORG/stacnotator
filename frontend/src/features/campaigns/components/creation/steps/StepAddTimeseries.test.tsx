import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CampaignCreate,
  CustomIndexOut,
  TimeseriesCreate,
  TimeseriesOptionsOut,
  TimeseriesOut,
} from '~/api/client';
import { renderWithQuery } from '~/shared/testing/renderWithQuery';
import { DEFAULT_TIMESERIES_WINDOW_NAME } from '~/shared/utils/constants';
import { validateTimeseriesStep } from '../../../utils/campaignValidation';
import { StepAddTimeseries } from './StepAddTimeseries';

vi.mock('~/api/client/sdk.gen', async () => ({
  ...(await vi.importActual<typeof import('~/api/client/sdk.gen')>('~/api/client/sdk.gen')),
  getTimeseriesCreationOptions: vi.fn(),
  previewCustomIndex: vi.fn(),
}));

import { getTimeseriesCreationOptions, previewCustomIndex } from '~/api/client/sdk.gen';

const options: TimeseriesOptionsOut = {
  sources: [
    {
      key: 'sentinel',
      label: 'Sentinel-2',
      coverage: '2015-present',
      resolution_m: 10,
      description: 'Optical imagery',
      bands: ['blue', 'green', 'red', 'rededge1', 'nir'],
      index_keys: ['ndvi', 'ndwi'],
    },
    {
      key: 'landsat',
      label: 'Landsat',
      coverage: '1984-present',
      resolution_m: 30,
      description: 'Optical imagery',
      bands: ['blue', 'green', 'red', 'nir'],
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
const savedSeries: TimeseriesOut = {
  id: 5,
  campaign_id: 1,
  name: 'Saved NDVI',
  window_id: 9,
  window_name: 'Vegetation',
  start_ym: '202001',
  end_ym: '202012',
  data_source: 'sentinel',
  ts_type: 'ndvi',
  index: options.indices[0],
};

const redEdge: CustomIndexOut = {
  key: 'CIre',
  label: 'CIre',
  formula: 'NIR / RedEdge1 - 1',
  domain_min: 0,
  domain_max: 10,
  reference_lines: [],
  source_keys: ['sentinel'],
};

function Editor({ existingTimeseries = [] }: { existingTimeseries?: TimeseriesOut[] }) {
  const [form, setForm] = useState(initialForm);
  const [saved, setSaved] = useState(existingTimeseries);
  return (
    <StepAddTimeseries
      items={form.timeseries_configs ?? []}
      onChange={(timeseries_configs) => {
        const next = { ...form, timeseries_configs };
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

async function openEditor(existingTimeseries: TimeseriesOut[] = []) {
  renderWithQuery(<Editor existingTimeseries={existingTimeseries} />);
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Add series' })[0]).toHaveProperty(
      'disabled',
      false
    )
  );
}

async function createPanel(name: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Add panel' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'New panel name' }), name);
  await userEvent.click(screen.getByRole('button', { name: 'Create panel' }));
  return screen.getByRole('region', { name: `${name.trim()} panel` });
}

const seriesNames = (scope: HTMLElement) =>
  within(scope).queryAllByRole('textbox', { name: 'Series name' });

const lastConfigs = (): TimeseriesCreate[] => onChange.mock.lastCall?.[0].timeseries_configs ?? [];

const preview = (data: CustomIndexOut) =>
  vi.mocked(previewCustomIndex).mockResolvedValue({
    data,
    error: undefined,
    request: new Request('http://localhost'),
    response: new Response(),
  });

describe('Panel-first timeseries setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onRenameExistingPanel.mockResolvedValue(undefined);
    vi.mocked(getTimeseriesCreationOptions).mockResolvedValue({ data: options } as Awaited<
      ReturnType<typeof getTimeseriesCreationOptions>
    >);
  });

  it('starts with an empty default panel and asks for nothing until a series is added', async () => {
    await openEditor();
    const group = screen.getByRole('region', { name: `${DEFAULT_TIMESERIES_WINDOW_NAME} panel` });
    expect(seriesNames(group)).toHaveLength(0);
    expect(within(group).getByText('No series in this panel yet.')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    expect(validateTimeseriesStep(initialForm).isValid).toBe(true);

    await userEvent.click(within(group).getByRole('button', { name: 'Add series' }));
    await userEvent.type(seriesNames(group)[0], 'Vegetation');
    expect(lastConfigs()).toEqual([
      expect.objectContaining({ name: 'Vegetation', window_name: DEFAULT_TIMESERIES_WINDOW_NAME }),
    ]);
  });

  it('keeps all panels visible and adds and removes series only within their panel', async () => {
    await openEditor();
    const vegetation = await createPanel(' Vegetation ');
    await userEvent.type(seriesNames(vegetation)[0], 'Sentinel NDVI');
    await userEvent.click(within(vegetation).getByRole('button', { name: 'Add series' }));
    await userEvent.type(seriesNames(vegetation)[1], 'Landsat NDVI');
    const water = await createPanel('Water');
    await userEvent.type(seriesNames(water)[0], 'NDWI');
    expect(screen.getAllByRole('region')).toHaveLength(3);
    expect(lastConfigs().map((ts) => ts.window_name)).toEqual([
      'Vegetation',
      'Vegetation',
      'Water',
    ]);

    await userEvent.click(within(vegetation).getAllByRole('button', { name: 'Remove series' })[0]);
    await userEvent.type(seriesNames(water)[0], ' water');
    expect(lastConfigs().map((ts) => ts.name)).toEqual(['Landsat NDVI', 'NDWI water']);
  });

  it('can remove every new series without making any required', async () => {
    await openEditor();
    const group = screen.getByRole('region', { name: `${DEFAULT_TIMESERIES_WINDOW_NAME} panel` });
    await userEvent.click(within(group).getByRole('button', { name: 'Add series' }));
    await userEvent.click(within(group).getByRole('button', { name: 'Add series' }));
    expect(seriesNames(group)).toHaveLength(2);
    await userEvent.click(within(group).getAllByRole('button', { name: 'Remove series' })[0]);
    await userEvent.click(within(group).getByRole('button', { name: 'Remove series' }));
    expect(seriesNames(group)).toHaveLength(0);
    expect(validateTimeseriesStep(onChange.mock.lastCall?.[0]).isValid).toBe(true);
  });

  it('renames the empty default panel and adds new series under the new name', async () => {
    await openEditor();
    await userEvent.click(
      screen.getByRole('button', { name: `Rename ${DEFAULT_TIMESERIES_WINDOW_NAME} panel` })
    );
    const name = screen.getByRole('textbox', { name: 'Panel name' });
    await userEvent.clear(name);
    await userEvent.type(name, ' Vegetation {Enter}');
    const panel = screen.getByRole('region', { name: 'Vegetation panel' });
    expect(
      screen.queryByRole('region', { name: `${DEFAULT_TIMESERIES_WINDOW_NAME} panel` })
    ).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(within(panel).getByRole('button', { name: 'Add series' }));
    expect(lastConfigs()[0].window_name).toBe('Vegetation');
  });

  it('renames all new series together and uses the new name for additional series', async () => {
    await openEditor();
    const panel = await createPanel('Vegetation');
    await userEvent.type(seriesNames(panel)[0], 'NDVI');
    await userEvent.click(within(panel).getByRole('button', { name: 'Add series' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Rename Vegetation panel' }));
    const name = screen.getByRole('textbox', { name: 'Panel name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Greenness');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    const renamed = screen.getByRole('region', { name: 'Greenness panel' });
    await userEvent.click(within(renamed).getByRole('button', { name: 'Add series' }));
    expect(lastConfigs().map((ts) => ts.window_name)).toEqual([
      'Greenness',
      'Greenness',
      'Greenness',
    ]);
    expect(screen.queryByRole('region', { name: 'Vegetation panel' })).toBeNull();
  });

  it('rejects blank and duplicate renames and cancels without changing the panel', async () => {
    await openEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Add panel' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New panel name' }), 'Water');
    await userEvent.click(screen.getByRole('button', { name: 'Create panel' }));
    const panel = screen.getByRole('region', { name: `${DEFAULT_TIMESERIES_WINDOW_NAME} panel` });
    onChange.mockClear();
    await userEvent.click(
      within(panel).getByRole('button', { name: `Rename ${DEFAULT_TIMESERIES_WINDOW_NAME} panel` })
    );
    const name = screen.getByRole('textbox', { name: 'Panel name' });
    await userEvent.clear(name);
    expect(within(panel).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    await userEvent.type(name, ' Water ');
    expect(screen.getByRole('alert').textContent).toMatch(/already exists/);
    expect(within(panel).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    await userEvent.keyboard('{Escape}');
    expect(within(panel).queryByRole('textbox', { name: 'Panel name' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('persists saved-panel renames and moves unsaved series in the same panel', async () => {
    await openEditor([savedSeries]);
    const panel = screen.getByRole('region', { name: 'Vegetation panel' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Add series' }));
    await userEvent.type(seriesNames(panel)[0], 'New NDVI');
    await userEvent.click(within(panel).getByRole('button', { name: 'Rename Vegetation panel' }));
    const name = screen.getByRole('textbox', { name: 'Panel name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Greenness{Enter}');
    const renamed = await screen.findByRole('region', { name: 'Greenness panel' });
    expect(onRenameExistingPanel).toHaveBeenCalledWith('Vegetation', 'Greenness');
    expect(within(renamed).getByText('Saved NDVI')).toBeTruthy();
    expect(seriesNames(renamed)[0]).toHaveProperty('value', 'New NDVI');
    expect(lastConfigs()[0].window_name).toBe('Greenness');
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
    const panels = screen.getAllByRole('region').length;
    await userEvent.click(screen.getByRole('button', { name: 'Add panel' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New panel name' }), ' Water ');
    expect(screen.getByRole('alert').textContent).toMatch(/already exists/);
    expect(screen.getByRole('button', { name: 'Create panel' })).toHaveProperty('disabled', true);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByRole('region')).toHaveLength(panels);
  });

  it('shows saved and new series together and preserves source-specific index selection', async () => {
    await openEditor([savedSeries]);
    const group = screen.getByRole('region', { name: 'Vegetation panel' });
    expect(within(group).getByText('Saved NDVI')).toBeTruthy();
    await userEvent.click(within(group).getByRole('button', { name: 'Add series' }));
    const source = within(group).getByRole('combobox', { name: 'Data source' });
    await userEvent.selectOptions(source, 'sentinel');
    await userEvent.selectOptions(within(group).getByRole('combobox', { name: 'Index' }), 'ndwi');
    await userEvent.selectOptions(source, 'landsat');
    expect(within(group).queryByRole('option', { name: 'NDWI' })).toBeNull();
    expect(lastConfigs()[0]).toMatchObject({
      window_name: 'Vegetation',
      data_source: 'landsat',
      ts_type: '',
    });
    await userEvent.click(within(group).getByRole('button', { name: 'Remove Saved NDVI' }));
    expect(onRemoveExisting).toHaveBeenCalledWith(5);
  });

  it('offers the custom indices already used on a source for reuse there', async () => {
    const saved = {
      ...savedSeries,
      ts_type: 'CIre',
      expression: 'nir / rededge1 - 1',
      index: redEdge,
    };
    await openEditor([saved]);
    const group = screen.getByRole('region', { name: 'Vegetation panel' });
    await userEvent.click(within(group).getByRole('button', { name: 'Add series' }));
    const source = within(group).getByRole('combobox', { name: 'Data source' });
    await userEvent.selectOptions(source, 'sentinel');
    await userEvent.selectOptions(within(group).getByRole('combobox', { name: 'Index' }), 'CIre');
    expect(lastConfigs()[0]).toMatchObject({
      ts_type: 'CIre',
      expression: 'nir / rededge1 - 1',
      domain_min: 0,
      domain_max: 10,
    });
    await userEvent.selectOptions(source, 'landsat');
    expect(within(group).queryByRole('option', { name: 'CIre' })).toBeNull();
    expect(lastConfigs()[0]).toMatchObject({ ts_type: '', expression: null });
  });

  it('defines a custom index from the index picker and selects it', async () => {
    preview(redEdge);
    await openEditor();
    const group = screen.getByRole('region', { name: `${DEFAULT_TIMESERIES_WINDOW_NAME} panel` });
    await userEvent.click(within(group).getByRole('button', { name: 'Add series' }));
    await userEvent.selectOptions(
      within(group).getByRole('combobox', { name: 'Data source' }),
      'sentinel'
    );
    await userEvent.selectOptions(
      within(group).getByRole('combobox', { name: 'Index' }),
      '+ Custom index...'
    );
    await userEvent.type(within(group).getByRole('textbox', { name: 'Index name' }), 'CIre');
    await userEvent.type(
      within(group).getByRole('textbox', { name: 'Formula' }),
      'nir / rededge1 - 1'
    );
    await waitFor(() =>
      expect(screen.getByTestId('custom-index-preview').textContent).toBe('NIR / RedEdge1 - 1')
    );
    await userEvent.click(within(group).getByRole('button', { name: 'Add index' }));

    expect(lastConfigs()[0]).toMatchObject({
      ts_type: 'CIre',
      expression: 'nir / rededge1 - 1',
      domain_min: -1,
      domain_max: 1,
    });
    await userEvent.click(within(group).getByRole('button', { name: 'Edit CIre' }));
    expect(within(group).getByRole('textbox', { name: 'Formula' })).toHaveProperty(
      'value',
      'nir / rededge1 - 1'
    );
  });

  it('shows why the backend refused a formula and keeps it unsaved', async () => {
    // The generated factories throw the error body, as FastAPI sends it.
    vi.mocked(previewCustomIndex).mockRejectedValue({
      detail: [{ loc: ['body'], msg: "Value error, Unknown band 'nri'", type: 'value_error' }],
    });
    await openEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Add series' }));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Data source' }),
      'sentinel'
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Index' }),
      '+ Custom index...'
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Index name' }), 'Bad');
    await userEvent.type(screen.getByRole('textbox', { name: 'Formula' }), 'nri');
    expect(await screen.findByText("Unknown band 'nri'")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add index' })).toHaveProperty('disabled', true);
  });

  it('will not give a series an index its source cannot compute', async () => {
    preview(redEdge);
    await openEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Add series' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Data source' }), 'landsat');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Index' }),
      '+ Custom index...'
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Index name' }), 'CIre');
    await userEvent.type(screen.getByRole('textbox', { name: 'Formula' }), 'nir / rededge1 - 1');
    expect(
      await screen.findByText('Landsat does not have the bands this formula reads.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add index' })).toHaveProperty('disabled', true);
  });
});
