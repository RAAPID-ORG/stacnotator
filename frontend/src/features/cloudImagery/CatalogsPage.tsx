import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CollectionOut, DiscoveredObject, ImportOut } from '~/api/client';
import {
  createCollectionMutation,
  discoverObjectsOptions,
  getCollectionOptions,
  getCollectionQueryKey,
  getImportOptions,
  getImportQueryKey,
  getProjectTilersOptions,
  listCollectionsOptions,
  listCollectionsQueryKey,
  retryImportMutation,
  startImportMutation,
  updateCollectionMutation,
} from '~/api/queries';
import { SasTokenField } from '~/features/campaigns/components/imagery/SasTokenField';
import { VizTabs } from '~/features/campaigns/components/imagery/VizTabs';
import { toVizParamsPayload } from '~/features/campaigns/components/imagery/draftSync';
import {
  catalogPresets,
  ManagedBandCountField,
  useManagedAssets,
} from '~/features/campaigns/components/imagery/managedCatalog';
import { describeExpiry, readSasToken } from '~/features/campaigns/components/imagery/sasToken';
import type { NamedVizParams } from '~/features/campaigns/components/imagery/types';
import { emptyVizParams } from '~/features/campaigns/components/imagery/types';
import { Button, Input, selectClass, textareaClass } from '~/shared/ui/forms';
import { Modal } from '~/shared/ui/Modal';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import {
  dateFromPath,
  parseTimeCsv,
  toImportFile,
  type ImportFile,
  type TimeInput,
} from './importFiles';

// Every load and action on this page shows its own failure where it happened.
const inPlace = (errorMessage: string) => ({ errorMessage, showUser: false });

const ErrorText = ({ error }: { error: unknown }) =>
  error ? (
    <p role="alert" className="text-xs text-red-600">
      {extractErrorMessage(error)}
    </p>
  ) : null;

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1">
    <span className="text-xs font-medium text-neutral-700">{label}</span>
    {children}
  </label>
);

const managementListKey = (projectId: number) =>
  listCollectionsQueryKey({ query: { project_id: projectId, include_drafts: true } });

const STATUS_LABEL: Record<CollectionOut['status'], string> = {
  draft: 'Draft: choose files to import',
  importing: 'Importing',
  ready: 'Ready',
  failed: 'Import failed',
};

const STATUS_TONE: Record<CollectionOut['status'], string> = {
  draft: 'bg-neutral-100 text-neutral-700',
  importing: 'bg-blue-50 text-blue-700',
  ready: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-700',
};

/** The old standalone address: lands on the project Settings tab that now hosts the
 *  catalogs, keeping the selected catalog and any other query parameters. */
export const CatalogsPage = () => {
  const { projectId } = useParams();
  const [params] = useSearchParams();
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) return <Navigate to="/" replace />;
  const next = new URLSearchParams(params);
  next.set('tab', 'settings');
  return <Navigate to={`/projects/${id}?${next}`} replace />;
};

export const CatalogsSection = ({ projectId }: { projectId: number }) => {
  const sectionRef = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (hash === '#imagery') sectionRef.current?.scrollIntoView({ block: 'start' });
  }, [hash]);
  const selected = Number(params.get('catalog'));
  const activeId = Number.isInteger(selected) && selected > 0 ? selected : null;
  const setActiveId = (id: number | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id === null) next.delete('catalog');
        else next.set('catalog', String(id));
        return next;
      },
      { replace: true }
    );
  const [creating, setCreating] = useState(false);
  const catalogs = useQuery({
    ...listCollectionsOptions({ query: { project_id: projectId, include_drafts: true } }),
    meta: inPlace('Failed to load catalogs'),
  });

  return (
    <section
      id="imagery"
      ref={sectionRef}
      className="scroll-mt-6 space-y-5"
      aria-labelledby="imagery-catalogs-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 id="imagery-catalogs-heading" className="section-heading">
            Imagery catalogs
          </h2>
          <p className="section-description">
            Your own GeoTIFFs for use in this project.
          </p>
        </div>
        {!creating && (
          <Button
            size="sm"
            onClick={() => {
              setCreating(true);
              setActiveId(null);
            }}
          >
            New catalog
          </Button>
        )}
      </div>

      {creating && (
        <CreateCatalog
          projectId={projectId}
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setActiveId(id);
          }}
        />
      )}

      {activeId !== null && (
        <CatalogWorkspace key={activeId} collectionId={activeId} projectId={projectId} />
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-neutral-800">Catalogs</h3>
        <ErrorText error={catalogs.error} />
        {catalogs.data?.items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-8 text-center">
            <p className="text-sm text-neutral-600">No catalogs in this project yet.</p>
            <p className="mt-1 text-xs text-neutral-500">
              Choose New catalog to connect to cloudstorage and import GeoTIFFs.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {catalogs.data?.items.map((c) => (
              <li
                key={c.id}
                data-testid="cloud-catalog-row"
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="break-words font-medium text-neutral-900">{c.title}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${STATUS_TONE[c.status]}`}
                  >
                    {STATUS_LABEL[c.status]}
                  </span>
                  <span className="text-xs text-neutral-500">{c.item_count ?? 0} files</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => setActiveId(c.id)}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

/** Hosted tilers of the project that can import files, with the one to preselect. */
const useIngestTilers = (projectId: number) => {
  const project = useQuery({
    ...getProjectTilersOptions({ path: { project_id: projectId } }),
    meta: inPlace('Failed to load project tilers'),
  });
  const hosted = (project.data?.tilers ?? []).filter((t) => t.kind === 'hosted' && t.allows_ingest);
  return {
    names: hosted.map((t) => t.name),
    preferred: hosted.find((t) => t.is_default)?.name,
    error: project.error,
  };
};

const CreateCatalog = ({
  projectId,
  onCancel,
  onCreated,
}: {
  projectId: number;
  onCancel: () => void;
  onCreated: (id: number) => void;
}) => {
  const ingest = useIngestTilers(projectId);
  const [title, setTitle] = useState('');
  const [tiler, setTiler] = useState('');
  const [containerUrl, setContainerUrl] = useState('');
  const [prefix, setPrefix] = useState('');
  const [dataRegion, setDataRegion] = useState('');
  const [sas, setSas] = useState('');
  const create = useMutation({
    ...createCollectionMutation(),
    meta: inPlace('Failed to create catalog'),
  });
  const chosenTiler = tiler || ingest.preferred || ingest.names[0] || '';
  const sasReading = sas.trim() ? readSasToken(sas) : null;
  const canSubmit =
    !!title.trim() &&
    !!containerUrl.trim() &&
    !!chosenTiler &&
    !!sasReading &&
    'token' in sasReading &&
    !create.isPending;

  const submit = () => {
    if (!sasReading || !('token' in sasReading)) return;
    create.mutate(
      {
        body: {
          title: title.trim(),
          project_id: projectId,
          tiler: chosenTiler,
          container_url: containerUrl.trim(),
          prefix: prefix.trim(),
          storage_access: { kind: 'azure_sas', secret: sasReading.token },
          data_region: dataRegion.trim() || null,
        },
      },
      { onSuccess: (created) => onCreated(created.id) }
    );
  };

  return (
    <Modal
      title="New catalog"
      onClose={() => {
        if (!create.isPending) onCancel();
      }}
      maxWidth="max-w-xl"
    >
      <section className="space-y-3 p-5">
        <h3 className="text-sm font-semibold text-neutral-800">1. Connect storage</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            <Input size="sm" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Tiler">
            <select
              className={selectClass}
              value={chosenTiler}
              onChange={(e) => setTiler(e.target.value)}
            >
              {ingest.names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ErrorText error={ingest.error} />
        {!ingest.error && ingest.names.length === 0 && (
          <p role="alert" className="text-xs text-amber-700">
            No tiler that can import files is enabled for this organization. Ask a platform
            administrator to grant one.
          </p>
        )}
        <Field label="Container URL">
          <Input
            size="sm"
            value={containerUrl}
            onChange={(e) => setContainerUrl(e.target.value)}
            placeholder="https://account.blob.core.windows.net/container"
          />
        </Field>
        <Field label="Path prefix">
          <Input size="sm" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </Field>
        <Field label="Storage region (optional)">
          <Input
            size="sm"
            value={dataRegion}
            onChange={(e) => setDataRegion(e.target.value)}
            placeholder="e.g. westeurope"
          />
        </Field>
        <SasTokenField value={sas} onChange={setSas} />
        <ErrorText error={create.error} />
        <div className="flex gap-2">
          <Button onClick={submit} disabled={!canSubmit}>
            Create catalog
          </Button>
          <Button variant="quiet" onClick={onCancel} disabled={create.isPending}>
            Cancel
          </Button>
        </div>
      </section>
    </Modal>
  );
};

const CatalogWorkspace = ({
  collectionId,
  projectId,
}: {
  collectionId: number;
  projectId: number;
}) => {
  const queryClient = useQueryClient();
  const detail = useQuery({
    ...getCollectionOptions({ path: { collection_id: collectionId } }),
    meta: inPlace('Failed to load catalog'),
  });
  const [startedImport, setStartedImport] = useState<number | null>(null);
  const importId = startedImport ?? detail.data?.import_id ?? null;
  const collection = detail.data;

  if (detail.error) return <ErrorText error={detail.error} />;
  if (!collection) return <p className="text-xs text-neutral-500">Loading catalog…</p>;

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: getCollectionQueryKey({ path: { collection_id: collectionId } }),
    });
    queryClient.invalidateQueries({ queryKey: managementListKey(projectId) });
  };

  return (
    <section className="space-y-4 border border-neutral-200 rounded-lg p-4">
      <CatalogHeader collection={collection} />
      {importId !== null && <ImportProgress importId={importId} onSettled={refresh} />}
      {(collection.status === 'ready' || collection.status === 'failed') && (
        <CatalogSettings key={collection.id} collection={collection} onSaved={refresh} />
      )}
      {collection.status === 'draft' && startedImport === null && (
        <SelectFiles
          collection={collection}
          onStarted={(started) => {
            setStartedImport(started.id);
            refresh();
          }}
        />
      )}
    </section>
  );
};

const CatalogHeader = ({ collection }: { collection: CollectionOut }) => {
  const expires = collection.storage_access?.expires_at;
  const expired = !!expires && new Date(expires).getTime() < Date.now();
  return (
    <div className="min-w-0 space-y-1">
      <h3 className="break-words text-sm font-semibold text-neutral-900">{collection.title}</h3>
      <p className="break-all text-xs text-neutral-500 font-mono">
        {collection.container_url}/{collection.prefix}
      </p>
      <p className="text-xs text-neutral-500">
        Storage region: {collection.data_region ?? 'not given'} · Tiler {collection.tiler}, region:{' '}
        {collection.tiler_region ?? 'unknown'}
      </p>
      {expires && (
        <p className={`text-xs ${expired ? 'text-red-600' : 'text-neutral-500'}`}>
          {expired
            ? 'The SAS token has expired; imagery and imports fail until it is replaced.'
            : `SAS token ${describeExpiry(expires)}`}
        </p>
      )}
    </div>
  );
};

type Row = { object: DiscoveredObject; time: TimeInput };

const SelectFiles = ({
  collection,
  onStarted,
}: {
  collection: CollectionOut;
  onStarted: (started: ImportOut) => void;
}) => {
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, Row>>(new Map());
  const [problems, setProblems] = useState<Map<string, string>>(new Map());
  const [pattern, setPattern] = useState('(\\d{4}-?\\d{2}-?\\d{2})');
  const [csv, setCsv] = useState('');
  const [bulkError, setBulkError] = useState('');
  const discovered = useQuery({
    ...discoverObjectsOptions({
      path: { collection_id: collection.id },
      query: { limit: 200, cursor },
    }),
    meta: inPlace('Failed to list storage files'),
  });
  const start = useMutation({ ...startImportMutation(), meta: inPlace('Failed to start import') });

  const update = (path: string, change: (row: Row) => Row) =>
    setSelected((prev) => {
      const row = prev.get(path);
      if (!row) return prev;
      return new Map(prev).set(path, change(row));
    });

  const toggle = (object: DiscoveredObject, on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (on) next.set(object.path, { object, time: { kind: 'instant', value: '' } });
      else next.delete(object.path);
      return next;
    });

  const applyPattern = () => {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      setBulkError('The pattern is not a valid regular expression');
      return;
    }
    const missed: string[] = [];
    selected.forEach((row, path) => {
      const day = dateFromPath(path, regex);
      if (day) update(path, (r) => ({ ...r, time: { kind: 'instant', value: day } }));
      else missed.push(path);
    });
    setBulkError(missed.length ? `No date found in: ${missed.join(', ')}` : '');
  };

  const applyCsv = () => {
    const { times, errors } = parseTimeCsv(csv);
    const objects = new Map(discovered.data?.objects.map((o) => [o.path, o]) ?? []);
    setSelected((prev) => {
      const next = new Map(prev);
      times.forEach((time, path) => {
        const object = next.get(path)?.object ?? objects.get(path);
        if (object) next.set(path, { object, time });
        else errors.push(`${path} is not among the listed files`);
      });
      return next;
    });
    setBulkError(errors.join('; '));
  };

  const submit = () => {
    const files: ImportFile[] = [];
    const found = new Map<string, string>();
    selected.forEach((row, path) => {
      const result = toImportFile(row.object, row.time);
      if (result.ok) files.push(result.file);
      else found.set(path, result.error);
    });
    setProblems(found);
    if (found.size > 0 || files.length === 0) return;
    start.mutate(
      { path: { collection_id: collection.id }, body: { files } },
      { onSuccess: onStarted }
    );
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-neutral-800">2. Select files and set dates</h3>
      <ErrorText error={discovered.error} />
      {discovered.isPending && <p className="text-xs text-neutral-500">Listing files…</p>}
      {discovered.data && discovered.data.objects.length === 0 && (
        <p className="text-xs text-neutral-500">No files under this prefix.</p>
      )}
      {discovered.data && discovered.data.objects.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="py-1">File</th>
              <th>Size</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {discovered.data.objects.map((object) => {
              const row = selected.get(object.path);
              const p = object.path;
              return (
                <tr key={p} data-testid="cloud-object-row" className="border-t align-top">
                  <td className="py-1">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={p}
                        checked={!!row}
                        onChange={(e) => toggle(object, e.target.checked)}
                      />
                      <span className="font-mono">{p}</span>
                    </label>
                  </td>
                  <td>{(object.size / 1e6).toFixed(1)} MB</td>
                  <td className="space-y-1">
                    {row && (
                      <TimeFields
                        path={p}
                        time={row.time}
                        onChange={(time) => update(p, (r) => ({ ...r, time }))}
                      />
                    )}
                    {problems.get(p) && <p className="text-red-600">{problems.get(p)}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="flex gap-2">
        {cursor !== null && (
          <Button size="sm" variant="secondary" onClick={() => setCursor(null)}>
            First page
          </Button>
        )}
        {discovered.data?.next_cursor && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCursor(discovered.data.next_cursor ?? null)}
          >
            Next page
          </Button>
        )}
      </div>
      <details className="text-xs space-y-2">
        <summary className="cursor-pointer text-neutral-700">Set many dates at once</summary>
        <Field label="Date from file path (regular expression)">
          <div className="flex gap-2">
            <Input size="sm" value={pattern} onChange={(e) => setPattern(e.target.value)} />
            <Button size="sm" variant="secondary" onClick={applyPattern}>
              Apply to selected
            </Button>
          </div>
        </Field>
        <Field label="Dates as CSV (path,datetime or path,start,end)">
          <textarea
            className={textareaClass}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
        </Field>
        <Button size="sm" variant="secondary" onClick={applyCsv}>
          Apply CSV
        </Button>
        {bulkError && <p className="text-red-600">{bulkError}</p>}
      </details>
      <p className="text-xs text-neutral-500">
        Times are UTC unless they carry a timezone. A date alone means the whole UTC day.
      </p>
      <ErrorText error={start.error} />
      <Button onClick={submit} disabled={selected.size === 0 || start.isPending}>
        Import selected
      </Button>
    </div>
  );
};

const TimeFields = ({
  path,
  time,
  onChange,
}: {
  path: string;
  time: TimeInput;
  onChange: (time: TimeInput) => void;
}) => (
  <div className="flex flex-wrap items-center gap-1">
    <select
      data-testid={`time-mode-${path}`}
      aria-label={`Time kind for ${path}`}
      className={selectClass}
      value={time.kind}
      onChange={(e) =>
        onChange(
          e.target.value === 'interval'
            ? { kind: 'interval', start: '', end: '' }
            : { kind: 'instant', value: '' }
        )
      }
    >
      <option value="instant">instant</option>
      <option value="interval">interval</option>
    </select>
    {time.kind === 'instant' ? (
      <Input
        size="sm"
        data-testid={`time-instant-${path}`}
        aria-label={`Time for ${path}`}
        placeholder="2026-01-12T10:20:00Z or 2026-01-12"
        value={time.value}
        onChange={(e) => onChange({ kind: 'instant', value: e.target.value })}
      />
    ) : (
      <>
        <Input
          size="sm"
          data-testid={`time-start-${path}`}
          aria-label={`Start for ${path}`}
          placeholder="start"
          value={time.start}
          onChange={(e) => onChange({ ...time, start: e.target.value })}
        />
        <Input
          size="sm"
          data-testid={`time-end-${path}`}
          aria-label={`End for ${path}`}
          placeholder="end"
          value={time.end}
          onChange={(e) => onChange({ ...time, end: e.target.value })}
        />
      </>
    )}
  </div>
);

const STATUS_TEXT: Record<ImportOut['status'], string> = {
  registering: 'Importing',
  failed: 'Failed',
  ready: 'Ready',
};

const ImportProgress = ({ importId, onSettled }: { importId: number; onSettled: () => void }) => {
  const queryClient = useQueryClient();
  const key = getImportQueryKey({ path: { import_id: importId } });
  const progress = useQuery({
    ...getImportOptions({ path: { import_id: importId } }),
    meta: inPlace('Failed to load import progress'),
    refetchInterval: (query) => (query.state.data?.status === 'registering' ? 2000 : false),
  });
  const retry = useMutation({ ...retryImportMutation(), meta: inPlace('Failed to retry import') });
  const job = progress.data;
  const status = job?.status;
  const settled = useRef(onSettled);
  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    settled.current = onSettled;
  }, [onSettled]);
  useEffect(() => {
    const previous = lastStatus.current;
    lastStatus.current = status;
    if (previous === 'registering' && status !== undefined && status !== 'registering') {
      settled.current();
    }
  }, [status]);

  return (
    <div className="space-y-2 rounded-md bg-neutral-50 p-3">
      <h3 className="text-sm font-semibold text-neutral-800">3. Import</h3>
      <ErrorText error={progress.error} />
      {job && (
        <>
          <p className="text-xs">
            <span data-testid="cloud-import-status">{STATUS_TEXT[job.status]}</span>{' '}
            <span className="text-neutral-500">
              {job.completed} of {job.total} files
            </span>
          </p>
          {job.status !== 'ready' && (
            <ul className="space-y-1">
              {job.errors.map((issue, i) => (
                <li key={i} data-testid="cloud-import-error" className="text-xs text-red-600">
                  {issue.path ? <span className="font-mono">{issue.path}</span> : null}
                  {issue.path ? ': ' : ''}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          {job.retryable && job.status === 'failed' && (
            <Button
              size="sm"
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate(
                  { path: { import_id: importId } },
                  {
                    onSuccess: (next) => {
                      queryClient.setQueryData(key, next);
                      onSettled();
                    },
                  }
                )
              }
            >
              Retry import
            </Button>
          )}
          <ErrorText error={retry.error} />
        </>
      )}
    </div>
  );
};

const CatalogSettings = ({
  collection,
  onSaved,
}: {
  collection: CollectionOut;
  onSaved: () => void;
}) => {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(collection.title);
  const [presets, setPresets] = useState<NamedVizParams[]>(() => catalogPresets(collection));
  const managedAssets = useManagedAssets(presets);
  const [active, setActive] = useState(0);
  const [sas, setSas] = useState('');
  const save = useMutation({
    ...updateCollectionMutation(),
    meta: inPlace('Failed to save catalog'),
  });
  const sasReading = sas.trim() ? readSasToken(sas) : null;

  const submit = () =>
    save.mutate(
      {
        path: { collection_id: collection.id },
        body: {
          title: title.trim(),
          visualizations: presets.map((p) => ({
            name: p.name,
            viz_params: toVizParamsPayload(p.vizParams),
          })),
          ...(sasReading && 'token' in sasReading
            ? { storage_access: { kind: 'azure_sas' as const, secret: sasReading.token } }
            : {}),
        },
      },
      {
        onSuccess: (saved) => {
          setSas('');
          queryClient.setQueryData(
            getCollectionQueryKey({ path: { collection_id: collection.id } }),
            saved
          );
          onSaved();
        },
      }
    );

  return (
    <details className="space-y-3" open={collection.status === 'failed'}>
      <summary className="cursor-pointer text-sm font-semibold text-neutral-800">
        Catalog settings
      </summary>
      {collection.status === 'failed' && (
        <p className="text-xs text-neutral-600">
          If the import failed because the storage could not be read, replace the SAS token below,
          save, then retry the import.
        </p>
      )}
      <p className="text-xs text-neutral-500">
        Presets are suggestions: a campaign copies them when it adds this catalog, so editing them
        here never changes a campaign that already uses it.
      </p>
      <Field label="Catalog title">
        <Input size="sm" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {presets.length === 0 ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setPresets([{ name: 'True Color', vizParams: emptyVizParams() }])}
        >
          Add a visualization preset
        </Button>
      ) : (
        <>
          <ManagedBandCountField
            bandCount={managedAssets.bandCount}
            onChange={managedAssets.setBandCount}
          />
          <VizTabs
            visualizations={presets}
            activeIndex={active}
            onActiveIndexChange={setActive}
            collectionId={`cloud-${collection.id}`}
            availableAssets={managedAssets.assets}
            showCompositing={false}
            onParamsChange={(i, vizParams) =>
              setPresets((prev) => prev.map((p, j) => (j === i ? { ...p, vizParams } : p)))
            }
            onNameChange={(i, name) =>
              setPresets((prev) => prev.map((p, j) => (j === i ? { ...p, name } : p)))
            }
            onAdd={() =>
              setPresets((prev) => [
                ...prev,
                { name: `Preset ${prev.length + 1}`, vizParams: emptyVizParams() },
              ])
            }
            onRemove={(i) => {
              setPresets((prev) => prev.filter((_, j) => j !== i));
              setActive(0);
            }}
          />
        </>
      )}
      <SasTokenField
        value={sas}
        onChange={setSas}
        configured={!!collection.storage_access}
        expiresAt={collection.storage_access?.expires_at ?? null}
      />
      <ErrorText error={save.error} />
      <Button size="sm" onClick={submit} disabled={!title.trim() || save.isPending}>
        Save changes
      </Button>
    </details>
  );
};
