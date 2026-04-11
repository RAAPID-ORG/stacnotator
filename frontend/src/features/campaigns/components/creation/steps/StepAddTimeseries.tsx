import { useEffect, useState } from 'react';
import {
  getTimeseriesCreationOptions,
  type CampaignCreate,
  type TimeSeriesCreate,
  type TimeSeriesOptionsOut,
} from '~/api/client';
import { useLayoutStore } from '~/features/layout/layout.store';
import { inputMonthToYYYYMM, yyyymmToInputMonth } from '~/shared/utils/utility';
import { MonthPicker } from './imagery/MonthPicker';

const emptyTimeseries = (): TimeSeriesCreate => ({
  name: '',
  start_ym: '',
  end_ym: '',
  data_source: '',
  provider: '',
  ts_type: '',
});

export const StepAddTimeseries = ({
  form,
  setForm,
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
}) => {
  const [tsOptions, setTsOptions] = useState<TimeSeriesOptionsOut | null>(null);
  const items = form.timeseries_configs ?? [];
  const showAlert = useLayoutStore((state) => state.showAlert);

  const setItems = (next: TimeSeriesCreate[]) => {
    setForm({
      ...form,
      timeseries_configs: next.length > 0 ? next : [],
    });
  };

  const updateItem = (index: number, updates: Partial<TimeSeriesCreate>) => {
    const next = [...items];
    next[index] = { ...next[index], ...updates };
    setItems(next);
  };

  const addItem = () => {
    setItems([...items, emptyTimeseries()]);
  };

  const removeItem = (index: number) => {
    const next = items.filter((_, i) => i !== index);
    setItems(next);
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data } = await getTimeseriesCreationOptions();
        setTsOptions(data!);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load timeseries options';
        showAlert(message, 'error');
        console.error(err);
      }
    };
    fetchData();
  }, [showAlert]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs text-neutral-500">
          This is optional. Add one or more time series if temporal context helps annotators make
          decisions.
        </p>
        <div className="flex items-start gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
          <svg
            className="w-4 h-4 shrink-0 mt-0.5 text-blue-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
            />
          </svg>
          <span>
            Currently only NDVI is supported. Custom band combinations will be available in a future
            update. If you need a different index now, please reach out to the maintainers.
          </span>
        </div>
      </div>

      {items.map((i, index) => (
        <div key={index} className="rounded-lg border border-neutral-300 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-neutral-900">{i.name || 'Timeseries Config'}</h4>
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="text-sm text-red-500 hover:text-red-700 transition-colors cursor-pointer"
            >
              Remove
            </button>
          </div>

          <input
            placeholder="Timeseries name"
            value={i.name}
            onChange={(e) => updateItem(index, { name: e.target.value })}
            className="w-full border border-neutral-300 rounded-md px-2.5 py-1.5 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 outline-none transition-colors"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Start Date</label>
              <MonthPicker
                value={yyyymmToInputMonth(i.start_ym)}
                onChange={(v) => updateItem(index, { start_ym: inputMonthToYYYYMM(v) })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">End Date</label>
              <MonthPicker
                value={yyyymmToInputMonth(i.end_ym)}
                onChange={(v) => updateItem(index, { end_ym: inputMonthToYYYYMM(v) })}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Data Source</label>
              <select
                value={i.data_source}
                onChange={(e) => updateItem(index, { data_source: e.target.value })}
                className="w-full border border-neutral-300 rounded-md px-2.5 py-1.5 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 outline-none transition-colors"
              >
                <option value="">Select Data Source</option>
                {tsOptions?.data_sources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Provider</label>
              <select
                value={i.provider}
                onChange={(e) => updateItem(index, { provider: e.target.value })}
                className="w-full border border-neutral-300 rounded-md px-2.5 py-1.5 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 outline-none transition-colors"
              >
                <option value="">Select Provider</option>
                {tsOptions?.providers.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Type</label>
              <select
                value={i.ts_type}
                onChange={(e) => updateItem(index, { ts_type: e.target.value })}
                className="w-full border border-neutral-300 rounded-md px-2.5 py-1.5 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 outline-none transition-colors"
              >
                <option value="">Select Type</option>
                {tsOptions?.ts_types.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ))}

      <div>
        <button
          type="button"
          onClick={addItem}
          className="rounded-md border text-neutral-700 border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 cursor-pointer"
        >
          + Add Timeseries
        </button>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-neutral-500">
          No timeseries added yet. Click add timeseries to setup a new timeseries configuration.
        </p>
      )}
    </div>
  );
};
