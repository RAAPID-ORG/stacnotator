import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  type CustomIndexIn,
  type CustomIndexOut,
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

/** What the chosen source can compute, built-ins in the registry's order and the
 *  campaign's own apart. Empty until a source is picked, which is what keeps an index
 *  the source has no bands for from being offered at all. */
function availableIndices(
  options: TimeseriesOptionsOut | null,
  customIndices: CustomIndexOut[],
  sourceKey: string
): { builtIn: SpectralIndexOut[]; custom: CustomIndexOut[] } {
  const source = options?.sources.find((s) => s.key === sourceKey);
  if (!options || !source) return { builtIn: [], custom: [] };
  return {
    builtIn: options.indices.filter((index) => source.index_keys.includes(index.key)),
    custom: customIndices.filter((index) => index.source_keys.includes(sourceKey)),
  };
}

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
  customIndices,
  onSaveCustomIndex,
  onRemoveCustomIndex,
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
  customIndices: CustomIndexOut[];
  onSaveCustomIndex: (
    body: CustomIndexIn,
    original: string | null,
    described: CustomIndexOut
  ) => Promise<void>;
  onRemoveCustomIndex: (name: string) => void;
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
  // The new series whose custom index is being defined (editing: null) or edited.
  const [defining, setDefining] = useState<{ index: number; editing: string | null } | null>(null);

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

  /** Switching source drops an index the new one cannot compute, so the form
   *  never holds a pairing the backend would reject. */
  const selectSource = (index: number, sourceKey: string) => {
    const { builtIn, custom } = availableIndices(tsOptions, customIndices, sourceKey);
    const stillOffered = [...builtIn, ...custom].some(
      (candidate) => candidate.key === items[index]?.ts_type
    );
    if (!stillOffered && defining?.index === index) setDefining(null);
    updateItem(index, {
      data_source: sourceKey,
      ts_type: stillOffered ? items[index].ts_type : '',
    });
  };

  const saveCustomIndex = async (
    index: number,
    body: CustomIndexIn,
    original: string | null,
    described: CustomIndexOut
  ) => {
    await onSaveCustomIndex(body, original, described);
    setDefining(null);
    if (original === null) {
      updateItem(index, { ts_type: described.key });
    } else if (original !== described.key) {
      setItems(
        items.map((series) =>
          series.ts_type === original ? { ...series, ts_type: described.key } : series
        )
      );
    }
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
    const offered = availableIndices(tsOptions, customIndices, i.data_source);
    const chosenCustom = offered.custom.find((custom) => custom.key === i.ts_type);
    const chosenIndex =
      chosenCustom ?? offered.builtIn.find((candidate) => candidate.key === i.ts_type);
    const definingHere = defining?.index === index ? defining : null;
    const editingCustom = definingHere?.editing
      ? (customIndices.find((custom) => custom.key === definingHere.editing) ?? null)
      : null;

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
              value={definingHere && !definingHere.editing ? NEW_CUSTOM_INDEX : i.ts_type}
              disabled={!i.data_source}
              onChange={(e) => {
                if (e.target.value === NEW_CUSTOM_INDEX) {
                  setDefining({ index, editing: null });
                  return;
                }
                if (definingHere) setDefining(null);
                updateItem(index, { ts_type: e.target.value });
              }}
            >
              <option value="">
                {i.data_source
                  ? t('timeseriesStep.selectIndex')
                  : t('timeseriesStep.pickSourceFirst')}
              </option>
              {[...offered.builtIn, ...offered.custom].map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
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
            editing={editingCustom}
            takenNames={customIndices
              .map((custom) => custom.key)
              .filter((name) => name !== definingHere.editing)}
            canDelete={
              !!editingCustom &&
              !existingTimeseries.some((ts) => ts.ts_type === editingCustom.key) &&
              !items.some(
                (series, other) => other !== index && series.ts_type === editingCustom.key
              )
            }
            onSave={(body, described) =>
              saveCustomIndex(index, body, definingHere.editing, described)
            }
            onDelete={() => {
              if (!editingCustom) return;
              onRemoveCustomIndex(editingCustom.key);
              setDefining(null);
              updateItem(index, { ts_type: '' });
            }}
            onCancel={() => setDefining(null)}
          />
        ) : (
          (chosenIndex || source) && (
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-neutral-500">
              {chosenIndex && (
                <span className="font-mono text-neutral-700 break-all">{chosenIndex.formula}</span>
              )}
              {chosenCustom && (
                <button
                  type="button"
                  className="text-brand-600 hover:text-brand-700 hover:underline underline-offset-4 cursor-pointer"
                  onClick={() => setDefining({ index, editing: chosenCustom.key })}
                >
                  {t('customIndices.edit', { name: chosenCustom.label })}
                </button>
              )}
              {source && (
                <span>
                  {chosenIndex && '· '}
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
