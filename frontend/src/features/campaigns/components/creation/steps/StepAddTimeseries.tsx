import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  type CampaignCreate,
  type SpectralIndexOut,
  type TimeseriesCreate,
  type TimeseriesOptionsOut,
  type TimeseriesOut,
} from '~/api/client';
import { getTimeseriesCreationOptionsOptions } from '~/api/queries';
import { inputMonthToYYYYMM, yyyymmToInputMonth } from '~/shared/utils/utility';
import { Button, DateField, Input, Select } from '~/shared/ui/forms';
import { IconWindow } from '~/shared/ui/Icons';
import { DEFAULT_TIMESERIES_WINDOW_NAME } from '~/shared/utils/constants';

const emptyTimeseries = (): TimeseriesCreate => ({
  name: '',
  window_name: DEFAULT_TIMESERIES_WINDOW_NAME,
  start_ym: '',
  end_ym: '',
  data_source: '',
  ts_type: '',
});

/** What the chosen source can compute, in the registry's order. Empty until a
 *  source is picked, which is what keeps an index the source has no bands for
 *  from being offered at all. */
function availableIndices(
  options: TimeseriesOptionsOut | null,
  sourceKey: string
): SpectralIndexOut[] {
  const source = options?.sources.find((s) => s.key === sourceKey);
  if (!options || !source) return [];
  return options.indices.filter((index) => source.index_keys.includes(index.key));
}

export const StepAddTimeseries = ({
  items,
  onChange,
  knownWindowNames = [],
  existingTimeseries = [],
  onRemoveExisting,
  onRenameExistingPanel,
  saving = false,
}: {
  /** The series being added. */
  items: TimeseriesCreate[];
  onChange: (items: TimeseriesCreate[]) => void;
  /** Additional existing panels to show even when they have no series. */
  knownWindowNames?: string[];
  existingTimeseries?: TimeseriesOut[];
  onRemoveExisting?: (id: number) => void;
  onRenameExistingPanel?: (oldName: string, newName: string) => Promise<void>;
  saving?: boolean;
}) => {
  const { t } = useTranslation(['campaigns', 'common']);
  const { data: tsOptions = null } = useQuery({
    ...getTimeseriesCreationOptionsOptions(),
    meta: { errorMessage: t('timeseriesStep.loadOptionsFailed') },
  });
  const [addedGroups, setAddedGroups] = useState<string[]>([]);
  const [draftGroups, setDraftGroups] = useState<string[]>([DEFAULT_TIMESERIES_WINDOW_NAME]);
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  const [defaultGroupName, setDefaultGroupName] = useState(DEFAULT_TIMESERIES_WINDOW_NAME);
  const [editingGroup, setEditingGroup] = useState<{ original: string; name: string } | null>(null);
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);

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

  const setItems = onChange;

  const updateItem = (index: number, updates: Partial<TimeseriesCreate>, windowName: string) => {
    if (index === -1) {
      setDraftGroups((groups) => groups.filter((name) => name !== windowName));
      setItems([...items, { ...emptyTimeseries(), window_name: windowName, ...updates }]);
      return;
    }
    const next = [...items];
    next[index] = { ...next[index], ...updates };
    setItems(next);
  };

  const addItem = (windowName: string, hasDraft: boolean) => {
    const newItem = { ...emptyTimeseries(), window_name: windowName };
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
          setRenameError(t('timeseriesStep.renameUnavailable'));
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
      setRenameError(t('timeseriesStep.renameFailed'));
    } finally {
      setRenaming(false);
    }
  };

  return (
    <fieldset className="space-y-6 min-w-0" disabled={renaming || saving}>
      <div>
        <h3 className="section-heading">{t('timeseriesStep.title')}</h3>
        <p className="section-description">{t('timeseriesStep.description')}</p>
        <p className="section-description mt-2">{t('timeseriesStep.panelsDescription')}</p>
        <p className="text-xs text-neutral-500 mt-2">{t('timeseriesStep.optionalHint')}</p>
      </div>

      {windowOptions.map((windowName) => {
        const saved = existingTimeseries.filter((i) => groupName(i.window_name) === windowName);
        const series = items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => groupName(item.window_name) === windowName);
        const hasDraft = draftGroups.includes(windowName) && series.length === 0;
        if (hasDraft)
          series.push({
            item: { ...emptyTimeseries(), window_name: windowName },
            index: -1,
          });
        return (
          <section
            key={windowName}
            aria-label={t('timeseriesStep.panelAria', { name: windowName })}
            className="rounded-lg border border-neutral-200 overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 bg-brand-50 border-b border-brand-100">
              <IconWindow className="w-5 h-5 text-brand-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-brand-600">
                  {t('timeseriesStep.panel')}
                </div>
                {editingGroup?.original === windowName ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Input
                        size="sm"
                        autoFocus
                        aria-label={t('timeseriesStep.panelName')}
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
                        {t('common:actions.save')}
                      </Button>
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={renaming || saving}
                        onClick={() => setEditingGroup(null)}
                      >
                        {t('common:actions.cancel')}
                      </Button>
                    </div>
                    {(duplicateName || renameError) && (
                      <p role="alert" className="text-xs text-red-600">
                        {duplicateName ? t('timeseriesStep.duplicatePanel') : renameError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <h4 className="text-base font-semibold text-neutral-900">{windowName}</h4>
                    <button
                      type="button"
                      aria-label={t('timeseriesStep.renamePanelAria', { name: windowName })}
                      disabled={renaming || saving || (saved.length > 0 && !onRenameExistingPanel)}
                      onClick={() => {
                        setEditingGroup({ original: windowName, name: windowName });
                        setRenameError('');
                      }}
                      className="rounded text-xs text-neutral-500 hover:text-brand-700 hover:underline underline-offset-4 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 disabled:text-neutral-400 disabled:cursor-not-allowed"
                    >
                      {t('timeseriesStep.rename')}
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
                      {t('common:actions.remove')}
                    </Button>
                  )}
                </div>
              ))}
              {series.map(({ item: i, index }, seriesIndex) => {
                const updateSeries = (updates: Partial<TimeseriesCreate>) =>
                  updateItem(index, updates, windowName);
                const source = tsOptions?.sources.find((s) => s.key === i.data_source);
                const chosenIndex = availableIndices(tsOptions, i.data_source).find(
                  (candidate) => candidate.key === i.ts_type
                );
                return (
                  <div key={index === -1 ? items.length : index} className="py-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-medium text-neutral-500">
                        {t('timeseriesStep.series', { number: saved.length + seriesIndex + 1 })}
                      </h5>
                      <button
                        type="button"
                        onClick={() => removeItem(index, windowName)}
                        className="text-xs text-neutral-400 hover:text-red-600 transition-colors cursor-pointer"
                      >
                        {t('common:actions.remove')}
                      </button>
                    </div>

                    <Input
                      size="sm"
                      placeholder={t('timeseriesStep.name')}
                      aria-label={t('timeseriesStep.name')}
                      value={i.name}
                      onChange={(e) => updateSeries({ name: e.target.value })}
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-neutral-700">
                          {t('timeseriesStep.startDate')}
                        </label>
                        <DateField
                          size="sm"
                          aria-label={t('timeseriesStep.startDate')}
                          granularity="month"
                          value={yyyymmToInputMonth(i.start_ym)}
                          onChange={(e) =>
                            updateSeries({ start_ym: inputMonthToYYYYMM(e.target.value) })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-neutral-700">
                          {t('timeseriesStep.endDate')}
                        </label>
                        <DateField
                          size="sm"
                          aria-label={t('timeseriesStep.endDate')}
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
                        <label className="text-xs text-neutral-700">
                          {t('timeseriesStep.dataSource')}
                        </label>
                        <Select
                          size="sm"
                          aria-label={t('timeseriesStep.dataSource')}
                          value={i.data_source}
                          onChange={(e) => selectSource(index, e.target.value, windowName)}
                        >
                          <option value="">{t('timeseriesStep.selectDataSource')}</option>
                          {tsOptions?.sources.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.label} ({option.coverage})
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs text-neutral-700">
                          {t('timeseriesStep.index')}
                        </label>
                        <Select
                          size="sm"
                          aria-label={t('timeseriesStep.index')}
                          value={i.ts_type}
                          disabled={!i.data_source}
                          onChange={(e) => updateSeries({ ts_type: e.target.value })}
                        >
                          <option value="">
                            {i.data_source
                              ? t('timeseriesStep.selectIndex')
                              : t('timeseriesStep.pickSourceFirst')}
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
                    ? t('timeseriesStep.addAnother')
                    : t('timeseriesStep.add')}
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
              aria-label={t('timeseriesStep.newPanelName')}
              placeholder={t('timeseriesStep.newPanelName')}
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
              {t('timeseriesStep.createPanel')}
            </Button>
            <Button variant="quiet" onClick={() => setNewGroupName(null)}>
              {t('common:actions.cancel')}
            </Button>
          </div>
          {windowOptions.includes(newGroupName.trim()) && (
            <p role="alert" className="text-xs text-red-600">
              {t('timeseriesStep.duplicatePanel')}
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="inline-flex items-center rounded py-1.5 text-xs text-neutral-500 hover:text-neutral-700 hover:underline underline-offset-4 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30"
          onClick={() => setNewGroupName('')}
        >
          {t('timeseriesStep.addPanel')}
        </button>
      )}
    </fieldset>
  );
};
