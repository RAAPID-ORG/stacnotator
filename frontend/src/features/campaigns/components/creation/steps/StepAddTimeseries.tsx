import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  type CustomIndexIn,
  type SpectralIndexOut,
  type TimeseriesCreate,
  type TimeseriesOptionsOut,
  type TimeseriesOut,
} from '~/api/client';
import { getTimeseriesCreationOptionsOptions } from '~/api/queries';
import { inputMonthToYYYYMM, yyyymmToInputMonth } from '~/shared/utils/utility';
import { Button, DateField, IconButton, Input, Select } from '~/shared/ui/forms';
import { IconClose, IconPencil, IconPlus, IconWindow } from '~/shared/ui/Icons';
import { DEFAULT_TIMESERIES_WINDOW_NAME } from '~/shared/utils/constants';
import { CustomIndexForm } from './CustomIndexForm';

// Never a valid index key: custom names start with a letter.
const NEW_CUSTOM_INDEX = '__new_custom__';

const emptyTimeseries = (windowName: string): TimeseriesCreate => ({
  name: '',
  window_name: windowName,
  start_ym: '',
  end_ym: '',
  data_source: '',
  ts_type: '',
});

const NOT_CUSTOM = { expression: null, domain_min: null, domain_max: null };

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

/** A custom index as series fields: its name is the series' ts_type, not its name. */
const seriesFields = ({ name, ...definition }: CustomIndexIn) => ({ ts_type: name, ...definition });

const customOf = (series: TimeseriesCreate): CustomIndexIn | null =>
  series.expression && series.domain_min != null && series.domain_max != null
    ? {
        name: series.ts_type,
        expression: series.expression,
        domain_min: series.domain_min,
        domain_max: series.domain_max,
      }
    : null;

const formatYm = (ym: string) => (ym.length === 6 ? `${ym.slice(0, 4)}-${ym.slice(4)}` : ym);

const textAction =
  'inline-flex items-center gap-1 rounded text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 disabled:text-neutral-400 disabled:cursor-not-allowed';

const Caption = ({ children }: { children: ReactNode }) => (
  <span className="block text-[11px] font-medium text-neutral-500 mb-1">{children}</span>
);

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
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  const [defaultGroupName, setDefaultGroupName] = useState(DEFAULT_TIMESERIES_WINDOW_NAME);
  const [editingGroup, setEditingGroup] = useState<{ original: string; name: string } | null>(null);
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);
  // The new series whose custom index is being defined.
  const [defining, setDefining] = useState<number | null>(null);

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

  /** Custom indices the campaign already uses on a source, offered for reuse there. */
  const allSeries: TimeseriesCreate[] = [
    ...existingTimeseries.map((ts) => ({
      ...ts,
      domain_min: ts.index.domain_min,
      domain_max: ts.index.domain_max,
    })),
    ...items,
  ];
  const customIndices = (sourceKey: string): CustomIndexIn[] => {
    const all = allSeries
      .filter((series) => series.data_source === sourceKey)
      .map(customOf)
      .filter((custom) => custom !== null);
    return all.filter((custom, i) => all.findIndex((c) => c.name === custom.name) === i);
  };

  const updateItem = (index: number, updates: Partial<TimeseriesCreate>) => {
    const next = [...items];
    next[index] = { ...next[index], ...updates };
    setItems(next);
  };

  const addItem = (windowName: string) => setItems([...items, emptyTimeseries(windowName)]);

  const removeItem = (index: number) => {
    setDefining(null);
    setItems(items.filter((_, i) => i !== index));
  };

  /** Switching source drops an index the new one may not compute, so the form
   *  never holds a pairing the backend would reject. */
  const selectSource = (index: number, sourceKey: string) => {
    const stillOffered = availableIndices(tsOptions, sourceKey).some(
      (candidate) => candidate.key === items[index]?.ts_type
    );
    if (defining === index) setDefining(null);
    updateItem(index, {
      data_source: sourceKey,
      ts_type: stillOffered ? items[index].ts_type : '',
      ...NOT_CUSTOM,
    });
  };

  const selectIndex = (index: number, key: string) => {
    if (key === NEW_CUSTOM_INDEX) {
      setDefining(index);
      return;
    }
    setDefining(null);
    const custom = customIndices(items[index].data_source).find((c) => c.name === key);
    updateItem(index, custom ? seriesFields(custom) : { ts_type: key, ...NOT_CUSTOM });
  };

  const addGroup = () => {
    const name = newGroupName?.trim();
    if (!name || windowOptions.includes(name)) return;
    setAddedGroups([...addedGroups, name]);
    setNewGroupName(null);
    setItems([...items, emptyTimeseries(name)]);
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

  const panelHeader = (windowName: string, count: number, hasSaved: boolean) =>
    editingGroup?.original === windowName ? (
      <div className="space-y-1 flex-1">
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            autoFocus
            className="max-w-xs"
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
      <>
        <h4 className="text-sm font-semibold text-neutral-900 truncate">{windowName}</h4>
        <span className="text-xs text-neutral-500">
          {t('timeseriesStep.seriesCount', { count })}
        </span>
        <IconButton
          tone="brand"
          className="ml-auto"
          aria-label={t('timeseriesStep.renamePanelAria', { name: windowName })}
          disabled={renaming || saving || (hasSaved && !onRenameExistingPanel)}
          onClick={() => {
            setEditingGroup({ original: windowName, name: windowName });
            setRenameError('');
          }}
        >
          <IconPencil className="h-4 w-4" />
        </IconButton>
      </>
    );

  const newSeriesRow = (i: TimeseriesCreate, index: number) => {
    const source = tsOptions?.sources.find((s) => s.key === i.data_source);
    const builtIn = availableIndices(tsOptions, i.data_source);
    const custom = customIndices(i.data_source);
    const chosenCustom = customOf(i);
    const formula =
      chosenCustom?.expression ?? builtIn.find((option) => option.key === i.ts_type)?.formula;
    const definingHere = defining === index;

    return (
      <li
        key={index}
        aria-label={t('timeseriesStep.newSeriesAria', {
          name: i.name.trim() || t('timeseriesStep.untitled'),
        })}
        className="@container relative rounded-md border border-brand-100 bg-brand-50/40 p-3 space-y-2"
      >
        <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_8rem_8rem_auto] @3xl:items-end">
          <label className="col-span-2 pr-7 @3xl:col-span-1 @3xl:pr-0">
            <Caption>{t('timeseriesStep.name')}</Caption>
            <Input
              size="sm"
              placeholder={t('timeseriesStep.namePlaceholder')}
              value={i.name}
              onChange={(e) => updateItem(index, { name: e.target.value })}
            />
          </label>
          <label>
            <Caption>{t('timeseriesStep.dataSource')}</Caption>
            <Select
              size="sm"
              value={i.data_source}
              onChange={(e) => selectSource(index, e.target.value)}
            >
              <option value="">{t('timeseriesStep.selectDataSource')}</option>
              {tsOptions?.sources.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <Caption>{t('timeseriesStep.index')}</Caption>
            <Select
              size="sm"
              value={definingHere && !chosenCustom ? NEW_CUSTOM_INDEX : i.ts_type}
              disabled={!i.data_source}
              onChange={(e) => selectIndex(index, e.target.value)}
            >
              <option value="">
                {i.data_source
                  ? t('timeseriesStep.selectIndex')
                  : t('timeseriesStep.pickSourceFirst')}
              </option>
              {builtIn.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
              {custom.map((option) => (
                <option key={option.name} value={option.name}>
                  {option.name}
                </option>
              ))}
              <option value={NEW_CUSTOM_INDEX}>{t('customIndices.new')}</option>
            </Select>
          </label>
          <label>
            <Caption>{t('timeseriesStep.startDate')}</Caption>
            <DateField
              size="sm"
              granularity="month"
              value={yyyymmToInputMonth(i.start_ym)}
              onChange={(e) => updateItem(index, { start_ym: inputMonthToYYYYMM(e.target.value) })}
            />
          </label>
          <label>
            <Caption>{t('timeseriesStep.endDate')}</Caption>
            <DateField
              size="sm"
              granularity="month"
              value={yyyymmToInputMonth(i.end_ym)}
              onChange={(e) => updateItem(index, { end_ym: inputMonthToYYYYMM(e.target.value) })}
            />
          </label>
          <IconButton
            tone="danger"
            className="absolute right-2 top-2 @3xl:static @3xl:mb-2"
            aria-label={t('timeseriesStep.removeSeries')}
            onClick={() => removeItem(index)}
          >
            <IconClose className="h-4 w-4" />
          </IconButton>
        </div>

        {definingHere ? (
          <CustomIndexForm
            bands={source?.bands ?? []}
            sourceKey={i.data_source}
            sourceLabel={source?.label ?? i.data_source}
            initial={chosenCustom}
            others={allSeries
              .filter((_, j) => j !== existingTimeseries.length + index)
              .map(customOf)
              .filter((other) => other !== null)}
            onUse={(index_) => {
              setDefining(null);
              updateItem(index, seriesFields(index_));
            }}
            onCancel={() => setDefining(null)}
          />
        ) : (
          (formula || source) && (
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-neutral-500">
              {formula && <span className="font-mono text-neutral-700 break-all">{formula}</span>}
              {chosenCustom && (
                <button
                  type="button"
                  className="text-brand-600 hover:text-brand-700 hover:underline underline-offset-4 cursor-pointer"
                  onClick={() => setDefining(index)}
                >
                  {t('customIndices.edit', { name: chosenCustom.name })}
                </button>
              )}
              {source && (
                <span>
                  {formula && '· '}
                  {source.label}, {source.resolution_m} m, {source.coverage}
                </span>
              )}
            </p>
          )
        )}
      </li>
    );
  };

  return (
    <fieldset className="space-y-5 min-w-0" disabled={renaming || saving}>
      <div>
        <h3 className="section-heading">{t('timeseriesStep.title')}</h3>
        <p className="section-description">{t('timeseriesStep.description')}</p>
      </div>

      {windowOptions.map((windowName) => {
        const saved = existingTimeseries.filter((i) => groupName(i.window_name) === windowName);
        const series = items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => groupName(item.window_name) === windowName);
        const count = saved.length + series.length;
        return (
          <section
            key={windowName}
            aria-label={t('timeseriesStep.panelAria', { name: windowName })}
            className="rounded-lg border border-neutral-200 bg-white"
          >
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-neutral-200 bg-neutral-50 rounded-t-lg">
              <IconWindow className="h-4 w-4 text-neutral-500 shrink-0" />
              {panelHeader(windowName, count, saved.length > 0)}
            </div>

            <div className="p-3 space-y-2">
              {saved.length > 0 && (
                <ul className="divide-y divide-neutral-100">
                  {saved.map((ts) => (
                    <li key={ts.id} className="flex items-center gap-3 px-1 py-2">
                      <span className="text-sm font-medium text-neutral-900 truncate">
                        {ts.name}
                      </span>
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700">
                        {ts.index.label}
                      </span>
                      <span className="text-xs text-neutral-500 truncate">
                        {tsOptions?.sources.find((s) => s.key === ts.data_source)?.label ??
                          ts.data_source}
                        {' · '}
                        {formatYm(ts.start_ym)} - {formatYm(ts.end_ym)}
                      </span>
                      {onRemoveExisting && (
                        <IconButton
                          tone="danger"
                          className="ml-auto"
                          aria-label={t('timeseriesStep.removeSavedAria', { name: ts.name })}
                          onClick={() => onRemoveExisting(ts.id)}
                        >
                          <IconClose className="h-4 w-4" />
                        </IconButton>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {series.length > 0 && (
                <ul className="space-y-2">
                  {series.map(({ item, index }) => newSeriesRow(item, index))}
                </ul>
              )}

              {count === 0 && (
                <p className="px-1 py-1 text-xs text-neutral-500">
                  {t('timeseriesStep.emptyPanel')}
                </p>
              )}

              <button
                type="button"
                className={`${textAction} px-1 py-1`}
                onClick={() => addItem(windowName)}
                disabled={!tsOptions || renaming || saving}
              >
                <IconPlus className="h-4 w-4" />
                {t('timeseriesStep.addSeries')}
              </button>
            </div>
          </section>
        );
      })}

      {newGroupName !== null ? (
        <div className="rounded-lg border border-dashed border-brand-300 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              autoFocus
              className="max-w-xs"
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
              size="sm"
              onClick={addGroup}
              disabled={!newGroupName.trim() || windowOptions.includes(newGroupName.trim())}
            >
              {t('timeseriesStep.createPanel')}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setNewGroupName(null)}>
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
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-300 py-2.5 text-sm text-neutral-600 hover:border-brand-300 hover:text-brand-700 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30"
          onClick={() => setNewGroupName('')}
        >
          <IconPlus className="h-4 w-4" />
          {t('timeseriesStep.addPanel')}
        </button>
      )}
    </fieldset>
  );
};
