import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  type CampaignCreate,
  type SpectralIndexOut,
  type TimeSeriesCreate,
  type TimeSeriesOptionsOut,
  type TimeSeriesOut,
} from '~/api/client';
import { getTimeseriesCreationOptionsOptions } from '~/api/queries';
import { inputMonthToYYYYMM, yyyymmToInputMonth } from '~/shared/utils/utility';
import { Button, DateField, Input, Select } from '~/shared/ui/forms';
import { IconWindow } from '~/shared/ui/Icons';
import { DEFAULT_TIMESERIES_WINDOW_NAME } from '~/shared/utils/constants';

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
  existingTimeseries = [],
  onRemoveExisting,
  onRenameExistingPanel,
  saving = false,
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
  /** Additional existing panels to show even when they have no series. */
  knownWindowNames?: string[];
  existingTimeseries?: TimeSeriesOut[];
  onRemoveExisting?: (id: number) => void;
  onRenameExistingPanel?: (oldName: string, newName: string) => Promise<void>;
  saving?: boolean;
}) => {
  const { data: tsOptions = null } = useQuery({
    ...getTimeseriesCreationOptionsOptions(),
    meta: { errorMessage: 'Failed to load timeseries options' },
  });
  const [addedGroups, setAddedGroups] = useState<string[]>([]);
  const [draftGroups, setDraftGroups] = useState<string[]>([DEFAULT_TIMESERIES_WINDOW_NAME]);
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  const [defaultGroupName, setDefaultGroupName] = useState(DEFAULT_TIMESERIES_WINDOW_NAME);
  const [editingGroup, setEditingGroup] = useState<{ original: string; name: string } | null>(null);
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const items = form.timeseries_configs ?? [];

  const groupName = (name?: string | null) => name?.trim() || DEFAULT_TIMESERIES_WINDOW_NAME;
  const windowOptions = Array.from(
    new Set(
      [
        defaultGroupName,
        ...knownWindowNames,
        ...existingTimeseries.map((i) => groupName(i.window_name)),
        ...items.map((i) => groupName(i.window_name)),
        ...addedGroups,
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

  const updateItem = (index: number, updates: Partial<TimeSeriesCreate>, windowName: string) => {
    if (index === -1) {
      setDraftGroups((groups) => groups.filter((name) => name !== windowName));
      setItems([
        ...items,
        { ...emptyTimeseries(), provider: soleProvider, window_name: windowName, ...updates },
      ]);
      return;
    }
    const next = [...items];
    next[index] = { ...next[index], provider: next[index].provider || soleProvider, ...updates };
    setItems(next);
  };

  // With a single provider there is nothing to choose, so a new series is given
  // it outright; the provider select only appears once there are alternatives.
  const soleProvider = tsOptions?.providers.length === 1 ? tsOptions.providers[0] : '';

  const addItem = (windowName: string, hasDraft: boolean) => {
    const newItem = { ...emptyTimeseries(), provider: soleProvider, window_name: windowName };
    setDraftGroups((groups) => groups.filter((name) => name !== windowName));
    setItems([...items, ...(hasDraft ? [newItem] : []), { ...newItem }]);
  };

  const removeItem = (index: number, windowName: string) => {
    setDraftGroups((groups) => groups.filter((name) => name !== windowName));
    const next = items.filter((_, i) => i !== index);
    setItems(next);
  };

  /** Switching source drops an index the new one cannot compute, so the form
   *  never holds a pairing the backend would reject. */
  const selectSource = (index: number, sourceKey: string, windowName: string) => {
    const stillOffered = availableIndices(tsOptions, sourceKey).some(
      (candidate) => candidate.key === items[index]?.ts_type
    );
    updateItem(
      index,
      {
        data_source: sourceKey,
        ts_type: stillOffered ? items[index].ts_type : '',
      },
      windowName
    );
  };

  const addGroup = () => {
    const name = newGroupName?.trim();
    if (!name || windowOptions.includes(name)) return;
    setAddedGroups([...addedGroups, name]);
    setDraftGroups([...draftGroups, name]);
    setNewGroupName(null);
  };

  const editedName = editingGroup?.name.trim() ?? '';
  const duplicateName =
    !!editingGroup && editedName !== editingGroup.original && windowOptions.includes(editedName);

  const renameGroup = async () => {
    if (!editingGroup || !editedName || duplicateName || renaming || saving) return;
    const oldName = editingGroup.original;
    if (editedName === oldName) {
      setEditingGroup(null);
      return;
    }
    setRenaming(true);
    setRenameError('');
    try {
      if (existingTimeseries.some((item) => groupName(item.window_name) === oldName)) {
        if (!onRenameExistingPanel) {
          setRenameError('Renaming saved panels is unavailable.');
          return;
        }
        await onRenameExistingPanel(oldName, editedName);
      }
      if (defaultGroupName === oldName) setDefaultGroupName(editedName);
      setAddedGroups((groups) =>
        Array.from(
          new Set([...groups.map((name) => (name === oldName ? editedName : name)), editedName])
        )
      );
      setDraftGroups((groups) => groups.map((name) => (name === oldName ? editedName : name)));
      if (items.some((item) => groupName(item.window_name) === oldName)) {
        setItems(
          items.map((item) =>
            groupName(item.window_name) === oldName ? { ...item, window_name: editedName } : item
          )
        );
      }
      setEditingGroup(null);
    } catch {
      setRenameError('Could not rename this panel. Please try again.');
    } finally {
      setRenaming(false);
    }
  };

  return (
    <fieldset className="space-y-6 min-w-0" disabled={renaming || saving}>
      <div>
        <h3 className="section-heading">Optional: Timeseries</h3>
        <p className="section-description">
          Graphs that plot a single pixel&apos;s value over time: at the annotated point the chosen
          spectral index is computed across the date range and drawn as a chart beside the imagery.
        </p>
        <p className="section-description mt-2">
          Panels organize timeseries on the annotation page. All series in a panel appear together.
          For example, put series for 2022 in one panel and series for 2023 in another, so each
          panel shows a manageable date range instead of one extremely long timeseries.
        </p>
        <p className="text-xs text-neutral-500 mt-2">
          Timeseries are optional. Leave the initial blank series untouched to skip them.
        </p>
      </div>

      {windowOptions.map((windowName) => {
        const saved = existingTimeseries.filter((i) => groupName(i.window_name) === windowName);
        const series = items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => groupName(item.window_name) === windowName);
        const hasDraft = draftGroups.includes(windowName) && series.length === 0;
        if (hasDraft)
          series.push({
            item: { ...emptyTimeseries(), window_name: windowName, provider: soleProvider },
            index: -1,
          });
        return (
          <section
            key={windowName}
            aria-label={`${windowName} panel`}
            className="rounded-lg border border-neutral-200 overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 bg-brand-50 border-b border-brand-100">
              <IconWindow className="w-5 h-5 text-brand-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-brand-600">Panel</div>
                {editingGroup?.original === windowName ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Input
                        size="sm"
                        autoFocus
                        aria-label="Panel name"
                        value={editingGroup.name}
                        disabled={renaming || saving}
                        invalid={duplicateName || !!renameError}
                        onChange={(e) => {
                          setEditingGroup({ original: windowName, name: e.target.value });
                          setRenameError('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void renameGroup();
                          }
                          if (e.key === 'Escape' && !renaming) setEditingGroup(null);
                        }}
                      />
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={!editedName || duplicateName || renaming || saving}
                        onClick={() => void renameGroup()}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={renaming || saving}
                        onClick={() => setEditingGroup(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                    {(duplicateName || renameError) && (
                      <p role="alert" className="text-xs text-red-600">
                        {duplicateName ? 'A panel with this name already exists.' : renameError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <h4 className="text-base font-semibold text-neutral-900">{windowName}</h4>
                    <button
                      type="button"
                      aria-label={`Rename ${windowName} panel`}
                      disabled={renaming || saving || (saved.length > 0 && !onRenameExistingPanel)}
                      onClick={() => {
                        setEditingGroup({ original: windowName, name: windowName });
                        setRenameError('');
                      }}
                      className="rounded text-xs text-neutral-500 hover:text-brand-700 hover:underline underline-offset-4 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 disabled:text-neutral-400 disabled:cursor-not-allowed"
                    >
                      Rename
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="px-4 divide-y divide-neutral-200">
              {saved.map((ts) => (
                <div key={ts.id} className="flex items-start justify-between gap-3 py-4">
                  <div>
                    <div className="text-sm font-medium text-neutral-900">{ts.name}</div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      {ts.index?.label ?? ts.ts_type} · {ts.data_source} · {ts.start_ym} –{' '}
                      {ts.end_ym}
                    </div>
                  </div>
                  {onRemoveExisting && (
                    <Button size="sm" variant="quiet" onClick={() => onRemoveExisting(ts.id)}>
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              {series.map(({ item: i, index }, seriesIndex) => {
                const updateSeries = (updates: Partial<TimeSeriesCreate>) =>
                  updateItem(index, updates, windowName);
                const source = tsOptions?.sources.find((s) => s.key === i.data_source);
                const chosenIndex = availableIndices(tsOptions, i.data_source).find(
                  (candidate) => candidate.key === i.ts_type
                );
                return (
                  <div key={index === -1 ? items.length : index} className="py-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-medium text-neutral-500">
                        Series {saved.length + seriesIndex + 1}
                      </h5>
                      <button
                        type="button"
                        onClick={() => removeItem(index, windowName)}
                        className="text-xs text-neutral-400 hover:text-red-600 transition-colors cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>

                    <Input
                      size="sm"
                      placeholder="Timeseries name"
                      aria-label="Timeseries name"
                      value={i.name}
                      onChange={(e) => updateSeries({ name: e.target.value })}
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-neutral-700">Start Date</label>
                        <DateField
                          size="sm"
                          aria-label="Start Date"
                          granularity="month"
                          value={yyyymmToInputMonth(i.start_ym)}
                          onChange={(e) =>
                            updateSeries({ start_ym: inputMonthToYYYYMM(e.target.value) })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-neutral-700">End Date</label>
                        <DateField
                          size="sm"
                          aria-label="End Date"
                          granularity="month"
                          value={yyyymmToInputMonth(i.end_ym)}
                          onChange={(e) =>
                            updateSeries({ end_ym: inputMonthToYYYYMM(e.target.value) })
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-neutral-700">Data source</label>
                        <Select
                          size="sm"
                          aria-label="Data source"
                          value={i.data_source}
                          onChange={(e) => selectSource(index, e.target.value, windowName)}
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
                          aria-label="Index"
                          value={i.ts_type}
                          disabled={!i.data_source}
                          onChange={(e) => updateSeries({ ts_type: e.target.value })}
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
                          aria-label="Provider"
                          onChange={(e) => updateSeries({ provider: e.target.value })}
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
              <div className="py-3">
                <button
                  type="button"
                  className="inline-flex items-center rounded py-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline underline-offset-4 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 disabled:text-neutral-400 disabled:no-underline disabled:cursor-not-allowed"
                  onClick={() => addItem(windowName, hasDraft)}
                  disabled={!tsOptions || renaming || saving}
                >
                  {saved.length + series.length > 0
                    ? '+ Add another timeseries'
                    : '+ Add timeseries'}
                </button>
              </div>
            </div>
          </section>
        );
      })}

      {newGroupName !== null ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              aria-label="New panel name"
              placeholder="New panel name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addGroup();
                }
                if (e.key === 'Escape') setNewGroupName(null);
              }}
            />
            <Button
              onClick={addGroup}
              disabled={!newGroupName.trim() || windowOptions.includes(newGroupName.trim())}
            >
              Create panel
            </Button>
            <Button variant="quiet" onClick={() => setNewGroupName(null)}>
              Cancel
            </Button>
          </div>
          {windowOptions.includes(newGroupName.trim()) && (
            <p role="alert" className="text-xs text-red-600">
              A panel with this name already exists.
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="inline-flex items-center rounded py-1.5 text-xs text-neutral-500 hover:text-neutral-700 hover:underline underline-offset-4 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30"
          onClick={() => setNewGroupName('')}
        >
          + Add Panel
        </button>
      )}
    </fieldset>
  );
};
