import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  type CampaignCreate,
  type SpectralIndexOut,
  type TimeSeriesCreate,
  type TimeSeriesOptionsOut,
} from '~/api/client';
import { getTimeseriesCreationOptionsOptions } from '~/api/queries';
import { inputMonthToYYYYMM, yyyymmToInputMonth } from '~/shared/utils/utility';
import { Button, DateField, Input, Select } from '~/shared/ui/forms';
import { IconCheck, IconClose } from '~/shared/ui/Icons';
import { DEFAULT_TIMESERIES_WINDOW_NAME } from '~/shared/utils/constants';

// Select sentinel for "create a new window" - distinct from any real window
// name and from '' (which is the default window).
const NEW_WINDOW = ' new';

const emptyTimeseries = (): TimeSeriesCreate => ({
  name: '',
  window_name: DEFAULT_TIMESERIES_WINDOW_NAME,
  start_ym: '',
  end_ym: '',
  data_source: '',
  provider: '',
  ts_type: '',
});

/** What the chosen source can compute, in the registry's order. Empty until a
 *  source is picked, which is what keeps an index the source has no bands for
 *  from being offered at all. */
function availableIndices(
  options: TimeSeriesOptionsOut | null,
  sourceKey: string
): SpectralIndexOut[] {
  const source = options?.sources.find((s) => s.key === sourceKey);
  if (!options || !source) return [];
  return options.indices.filter((index) => source.index_keys.includes(index.key));
}

export const StepAddTimeseries = ({
  form,
  setForm,
  knownWindowNames = [],
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
  /** Window names that already exist (e.g. from saved series) so they can be
   *  picked without retyping. Names used by the configs being edited are added
   *  automatically. */
  knownWindowNames?: string[];
}) => {
  const { data: tsOptions = null } = useQuery({
    ...getTimeseriesCreationOptionsOptions(),
    meta: { errorMessage: 'Failed to load timeseries options' },
  });
  // Per-item flag: user is typing the name of a brand-new window (vs picking an
  // existing one). Kept out of the item so an empty name still reads as default.
  const [newWindowFor, setNewWindowFor] = useState<Record<number, boolean>>({});
  const items = form.timeseries_configs ?? [];

  // The windows a series can be grouped into: the default window plus every
  // window that already exists (from saved series or the configs being edited).
  const windowOptions = Array.from(
    new Set(
      [
        DEFAULT_TIMESERIES_WINDOW_NAME,
        ...knownWindowNames,
        ...items.map((i) => i.window_name ?? ''),
      ]
        .map((name) => name.trim())
        .filter((name) => !!name)
    )
  );

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

  // With a single provider there is nothing to choose, so a new series is given
  // it outright; the provider select only appears once there are alternatives.
  const soleProvider = tsOptions?.providers.length === 1 ? tsOptions.providers[0] : '';

  const addItem = () => {
    setItems([...items, { ...emptyTimeseries(), provider: soleProvider }]);
  };

  const removeItem = (index: number) => {
    const next = items.filter((_, i) => i !== index);
    setItems(next);
  };

  /** Switching source drops an index the new one cannot compute, so the form
   *  never holds a pairing the backend would reject. */
  const selectSource = (index: number, sourceKey: string) => {
    const stillOffered = availableIndices(tsOptions, sourceKey).some(
      (candidate) => candidate.key === items[index].ts_type
    );
    updateItem(index, {
      data_source: sourceKey,
      ts_type: stillOffered ? items[index].ts_type : '',
    });
  };

  const selectNewWindow = (index: number) => {
    setNewWindowFor((m) => ({ ...m, [index]: true }));
    updateItem(index, { window_name: '' });
  };

  const closeNewWindow = (index: number, keep: boolean) => {
    setNewWindowFor((m) => ({ ...m, [index]: false }));
    if (!keep) updateItem(index, { window_name: DEFAULT_TIMESERIES_WINDOW_NAME });
  };

  return (
    <div className="space-y-6">
      <p className="text-xs text-neutral-500">
        This is optional. Add one or more time series if temporal context helps annotators make
        decisions. Which indices are on offer depends on the bands the source carries. Each source
        reads a single pixel at its own resolution, so two sources at the same point cover different
        ground and their values are not directly comparable.
      </p>

      {items.map((i, index) => {
        const source = tsOptions?.sources.find((s) => s.key === i.data_source);
        const chosenIndex = availableIndices(tsOptions, i.data_source).find(
          (candidate) => candidate.key === i.ts_type
        );
        return (
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

            <Input
              size="sm"
              placeholder="Timeseries name"
              value={i.name}
              onChange={(e) => updateItem(index, { name: e.target.value })}
            />

            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Window</label>
              {newWindowFor[index] ? (
                <div className="flex items-center gap-1">
                  <Input
                    size="sm"
                    autoFocus
                    placeholder="New window name"
                    value={i.window_name ?? ''}
                    onChange={(e) => updateItem(index, { window_name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') closeNewWindow(index, true);
                      if (e.key === 'Escape') closeNewWindow(index, false);
                    }}
                  />
                  <button
                    type="button"
                    className="h-8 w-8 flex items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 disabled:hover:bg-brand-600 shrink-0"
                    title="Confirm window"
                    aria-label="Confirm window"
                    disabled={!i.window_name?.trim()}
                    onClick={() => closeNewWindow(index, true)}
                  >
                    <IconCheck className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    className="h-8 w-8 flex items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:text-neutral-800 hover:border-neutral-300 shrink-0"
                    title="Cancel"
                    aria-label="Cancel new window"
                    onClick={() => closeNewWindow(index, false)}
                  >
                    <IconClose className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <Select
                  size="sm"
                  value={i.window_name?.trim() || DEFAULT_TIMESERIES_WINDOW_NAME}
                  onChange={(e) => {
                    if (e.target.value === NEW_WINDOW) selectNewWindow(index);
                    else updateItem(index, { window_name: e.target.value });
                  }}
                >
                  {windowOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  <option value={NEW_WINDOW}>+ New window…</option>
                </Select>
              )}
              <p className="text-xs text-neutral-400">
                Series in the same window are shown together in one panel on the annotation page.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-neutral-700">Start Date</label>
                <DateField
                  size="sm"
                  granularity="month"
                  value={yyyymmToInputMonth(i.start_ym)}
                  onChange={(e) =>
                    updateItem(index, { start_ym: inputMonthToYYYYMM(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-neutral-700">End Date</label>
                <DateField
                  size="sm"
                  granularity="month"
                  value={yyyymmToInputMonth(i.end_ym)}
                  onChange={(e) =>
                    updateItem(index, { end_ym: inputMonthToYYYYMM(e.target.value) })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-neutral-700">Data source</label>
                <Select
                  size="sm"
                  value={i.data_source}
                  onChange={(e) => selectSource(index, e.target.value)}
                >
                  <option value="">Select data source</option>
                  {tsOptions?.sources.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label} ({option.coverage})
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-neutral-700">Index</label>
                <Select
                  size="sm"
                  value={i.ts_type}
                  disabled={!i.data_source}
                  onChange={(e) => updateItem(index, { ts_type: e.target.value })}
                >
                  <option value="">
                    {i.data_source ? 'Select index' : 'Pick a data source first'}
                  </option>
                  {availableIndices(tsOptions, i.data_source).map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {source && (
              <p className="text-xs text-neutral-400">
                {source.coverage}, {source.resolution_m} m. {source.description}
              </p>
            )}
            {chosenIndex && (
              <p className="text-xs text-neutral-600 font-mono break-words">
                {chosenIndex.formula}
              </p>
            )}

            {tsOptions && tsOptions.providers.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs text-neutral-700">Provider</label>
                <Select
                  size="sm"
                  value={i.provider}
                  onChange={(e) => updateItem(index, { provider: e.target.value })}
                >
                  <option value="">Select provider</option>
                  {tsOptions.providers.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        );
      })}

      <div>
        <Button variant="secondary" onClick={addItem} disabled={!tsOptions}>
          + Add Timeseries
        </Button>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-neutral-500">
          No timeseries added yet. Click add timeseries to setup a new timeseries configuration.
        </p>
      )}
    </div>
  );
};
