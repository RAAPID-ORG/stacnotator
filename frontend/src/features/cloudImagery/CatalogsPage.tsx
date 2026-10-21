import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CollectionList, CollectionOut, DiscoveredObject, ImportOut } from '~/api/client';
import {
  createCollectionMutation,
  deleteCollectionMutation,
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
import { IconQuestion, IconUploadFilled } from '~/shared/ui/Icons';
import { Tooltip } from '~/shared/ui/Tooltip';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import {
  assignAssets,
  buildSelection,
  timeFromPath,
  parseTimeCsv,
  toImportFile,
  type TimeInput,
  type SelectionRow,
} from './importFiles';
import { BulkAssetNames } from './BulkAssetNames';

// Azure public-cloud region names: https://learn.microsoft.com/azure/reliability/regions-list
const STORAGE_REGIONS = [
  ['australiacentral', 'Australia Central'],
  ['australiacentral2', 'Australia Central 2'],
  ['australiaeast', 'Australia East'],
  ['australiasoutheast', 'Australia Southeast'],
  ['austriaeast', 'Austria East'],
  ['belgiumcentral', 'Belgium Central'],
  ['brazilsouth', 'Brazil South'],
  ['brazilsoutheast', 'Brazil Southeast'],
  ['canadacentral', 'Canada Central'],
  ['canadaeast', 'Canada East'],
  ['centralindia', 'Central India'],
  ['centralus', 'Central US'],
  ['chilecentral', 'Chile Central'],
  ['denmarkeast', 'Denmark East'],
  ['eastasia', 'East Asia'],
  ['eastus', 'East US'],
  ['eastus2', 'East US 2'],
  ['francecentral', 'France Central'],
  ['francesouth', 'France South'],
  ['germanynorth', 'Germany North'],
  ['germanywestcentral', 'Germany West Central'],
  ['indiasouthcentral', 'India South Central'],
  ['indonesiacentral', 'Indonesia Central'],
  ['israelcentral', 'Israel Central'],
  ['italynorth', 'Italy North'],
  ['japaneast', 'Japan East'],
  ['japanwest', 'Japan West'],
  ['koreacentral', 'Korea Central'],
  ['koreasouth', 'Korea South'],
  ['malaysiawest', 'Malaysia West'],
  ['mexicocentral', 'Mexico Central'],
  ['newzealandnorth', 'New Zealand North'],
  ['northcentralus', 'North Central US'],
  ['northeurope', 'North Europe'],
  ['norwayeast', 'Norway East'],
  ['norwaywest', 'Norway West'],
  ['polandcentral', 'Poland Central'],
  ['qatarcentral', 'Qatar Central'],
  ['southafricanorth', 'South Africa North'],
  ['southafricawest', 'South Africa West'],
  ['southcentralus', 'South Central US'],
  ['southindia', 'South India'],
  ['southeastasia', 'Southeast Asia'],
  ['spaincentral', 'Spain Central'],
  ['swedencentral', 'Sweden Central'],
  ['switzerlandnorth', 'Switzerland North'],
  ['switzerlandwest', 'Switzerland West'],
  ['uaecentral', 'UAE Central'],
  ['uaenorth', 'UAE North'],
  ['uksouth', 'UK South'],
  ['ukwest', 'UK West'],
  ['westcentralus', 'West Central US'],
  ['westeurope', 'West Europe'],
  ['westindia', 'West India'],
  ['westus', 'West US'],
  ['westus2', 'West US 2'],
  ['westus3', 'West US 3'],
] as const;

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

const SETUP_STEPS = [
  'Connect storage',
  'Select files and dates',
  'Index files',
  'Configure display',
];

const CatalogStep = ({
  number,
  description,
  children,
  upcoming = false,
}: {
  number: number;
  description: string;
  children?: React.ReactNode;
  upcoming?: boolean;
}) => (
  <section
    className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
    aria-label={`Step ${number}: ${SETUP_STEPS[number - 1]}`}
  >
    <header className={`flex items-start gap-3 px-4 py-3 ${upcoming ? '' : 'bg-neutral-50'}`}>
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          upcoming ? 'bg-neutral-100 text-neutral-400' : 'bg-brand-100 text-brand-700'
        }`}
      >
        {number}
      </span>
      <div className="min-w-0">
        <h3
          className={`text-sm font-semibold ${upcoming ? 'text-neutral-500' : 'text-neutral-900'}`}
        >
          {SETUP_STEPS[number - 1]}
        </h3>
        <p className="mt-0.5 text-xs text-neutral-500">{description}</p>
      </div>
    </header>
    {children && <div className="space-y-3 border-t border-neutral-200 p-4">{children}</div>}
  </section>
);

const managementListKey = (projectId: number) =>
  listCollectionsQueryKey({ query: { project_id: projectId, include_drafts: true } });

const STATUS_LABEL: Record<CollectionOut['status'], string> = {
  draft: 'Draft: choose files to index',
  importing: 'Indexing',
  ready: 'Ready',
  failed: 'Indexing failed',
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
  const queryClient = useQueryClient();
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
          <p className="section-description">Your own GeoTIFFs for use in this project.</p>
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
          onCreated={(created) => {
            queryClient.setQueryData<CollectionList>(managementListKey(projectId), (previous) => ({
              items: [...(previous?.items ?? []).filter((c) => c.id !== created.id), created],
            }));
            setCreating(false);
            setActiveId(created.id);
          }}
        />
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-neutral-800">Catalogs</h3>
        <ErrorText error={catalogs.error} />
        {activeId !== null &&
          catalogs.data &&
          !catalogs.data.items.some((c) => c.id === activeId) && (
            <p role="alert" className="text-xs text-red-600">
              The selected catalog is no longer available in this project.
            </p>
          )}
        {catalogs.data?.items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-8 text-center">
            <p className="text-sm text-neutral-600">No catalogs in this project yet.</p>
            <p className="mt-1 text-xs text-neutral-500">
              Choose New catalog to connect to cloud storage and index GeoTIFFs.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {catalogs.data?.items.map((c) => (
              <li
                key={c.id}
                data-testid="cloud-catalog-row"
                className="scroll-mt-16 px-3 py-2.5 text-sm"
              >
                <div
                  data-testid="cloud-catalog-summary"
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="break-words font-medium text-neutral-900">{c.title}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ${STATUS_TONE[c.status]}`}
                    >
                      {STATUS_LABEL[c.status]}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {c.item_count ?? 0} {c.item_count === 1 ? 'item' : 'items'}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-expanded={activeId === c.id}
                    aria-controls={activeId === c.id ? `catalog-editor-${c.id}` : undefined}
                    onClick={() => setActiveId(activeId === c.id ? null : c.id)}
                  >
                    {activeId === c.id ? 'Close' : 'Edit'}
                  </Button>
                </div>
                {activeId === c.id && (
                  <CatalogWorkspace
                    key={c.id}
                    collectionId={c.id}
                    projectId={projectId}
                    onDeleted={() => setActiveId(null)}
                  />
                )}
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
  onCreated: (created: CollectionOut) => void;
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
      { onSuccess: onCreated }
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
      <section className="space-y-4 p-5">
        <p className="text-xs text-neutral-500">
          Connect storage → Select files → Index files → Configure display
        </p>
        <CatalogStep
          number={1}
          description="Give your catalog a name and connect the Azure folder containing your GeoTIFFs."
        >
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
              No tiler that can index files is enabled for this organization. Ask a platform
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
            <select
              className={selectClass}
              value={dataRegion}
              onChange={(e) => setDataRegion(e.target.value)}
            >
              <option value="">Not specified</option>
              {STORAGE_REGIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <SasTokenField value={sas} onChange={setSas} />
          <ErrorText error={create.error} />
          <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
            <Button onClick={submit} disabled={!canSubmit}>
              Create catalog
            </Button>
            <Button variant="quiet" onClick={onCancel} disabled={create.isPending}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-neutral-500">
            Next: choose the files to index and set their dates.
          </p>
        </CatalogStep>
      </section>
    </Modal>
  );
};

const CatalogWorkspace = ({
  collectionId,
  projectId,
  onDeleted,
}: {
  collectionId: number;
  projectId: number;
  onDeleted: () => void;
}) => {
  const workspaceRef = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  const remove = useMutation({
    ...deleteCollectionMutation(),
    meta: inPlace('Failed to delete catalog'),
    onSuccess: () => {
      onDeleted();
      queryClient.removeQueries({
        queryKey: getCollectionQueryKey({ path: { collection_id: collectionId } }),
      });
      void queryClient.invalidateQueries({ queryKey: managementListKey(projectId) });
      void queryClient.invalidateQueries({
        queryKey: listCollectionsQueryKey({ query: { project_id: projectId } }),
      });
    },
  });
  const detail = useQuery({
    ...getCollectionOptions({ path: { collection_id: collectionId } }),
    meta: inPlace('Failed to load catalog'),
  });
  const [startedImport, setStartedImport] = useState<number | null>(null);
  const importId = startedImport ?? detail.data?.import_id ?? null;
  const collection = detail.data;
  useEffect(() => {
    if (detail.isSuccess)
      workspaceRef.current?.parentElement?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
  }, [collectionId, detail.isSuccess]);

  if (detail.error) return <ErrorText error={detail.error} />;
  if (!collection) return <p className="text-xs text-neutral-500">Loading catalog…</p>;

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: getCollectionQueryKey({ path: { collection_id: collectionId } }),
    });
    queryClient.invalidateQueries({ queryKey: managementListKey(projectId) });
  };

  return (
    <section
      ref={workspaceRef}
      id={`catalog-editor-${collectionId}`}
      className="motion-fade-in mt-3 space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-neutral-500">Catalog setup</p>
          <h3 className="break-words text-sm font-semibold text-neutral-900">{collection.title}</h3>
        </div>
        <Button
          size="sm"
          variant="dangerQuiet"
          disabled={remove.isPending}
          onClick={async () => {
            const confirmed = await showConfirmDialog({
              title: `Delete "${collection.title}"?`,
              description: 'This removes the catalog, not the original files in cloud storage.',
              confirmText: 'Delete',
              isDangerous: true,
            });
            if (confirmed) remove.mutate({ path: { collection_id: collectionId } });
          }}
        >
          Delete catalog
        </Button>
      </div>
      <ErrorText error={remove.error} />
      <CatalogStep
        number={1}
        description="Storage connection saved. Your original files stay in Azure."
      >
        <CatalogDetails collection={collection} onSaved={refresh} />
      </CatalogStep>
      {collection.status === 'draft' && startedImport === null && (
        <SelectFiles
          collection={collection}
          onStarted={(started) => {
            setStartedImport(started.id);
            refresh();
          }}
        />
      )}
      {(collection.status !== 'draft' || startedImport !== null) && (
        <>
          <CatalogStep number={2} description="File selection and dates submitted for indexing." />
          <CatalogStep
            number={3}
            description={
              collection.status === 'ready'
                ? 'Indexing complete. File metadata is ready for visualization.'
                : 'Read file metadata and build the catalog. You can leave this page while indexing runs.'
            }
          >
            {importId !== null && <ImportProgress importId={importId} onSettled={refresh} />}
          </CatalogStep>
        </>
      )}
      <CatalogStep
        number={4}
        upcoming={collection.status !== 'ready'}
        description={
          collection.status === 'ready'
            ? 'Your catalog is ready to use. Review detected bands and optionally save visualization presets.'
            : 'Available after indexing: review detected bands and choose how your imagery is displayed.'
        }
      >
        {collection.status === 'ready' && (
          <>
            <IndexedBands collection={collection} onSaved={refresh} />
            <VisualizationSettings key={collection.id} collection={collection} onSaved={refresh} />
          </>
        )}
      </CatalogStep>
    </section>
  );
};

const CatalogDetails = ({
  collection,
  onSaved,
}: {
  collection: CollectionOut;
  onSaved: () => void;
}) => {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(collection.status === 'failed');
  const [title, setTitle] = useState(collection.title);
  const [sas, setSas] = useState('');
  const sasReading = sas.trim() ? readSasToken(sas) : null;
  const save = useMutation({
    ...updateCollectionMutation(),
    meta: inPlace('Failed to save catalog details'),
    onSuccess: (saved) => {
      queryClient.setQueryData(
        getCollectionQueryKey({ path: { collection_id: collection.id } }),
        saved
      );
      setSas('');
      setEditing(false);
      onSaved();
    },
  });
  const expires = collection.storage_access?.expires_at;
  const expired = !!expires && new Date(expires).getTime() < Date.now();
  return (
    <div className="min-w-0 space-y-3">
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
            ? 'The SAS token has expired; imagery and indexing fail until it is replaced.'
            : `SAS token ${describeExpiry(expires)}`}
        </p>
      )}
      {collection.status === 'failed' && (
        <p className="text-xs text-red-700">
          If storage access caused the failure, edit the catalog to replace the SAS token, save,
          then retry indexing in step 3.
        </p>
      )}
      {editing ? (
        <fieldset className="space-y-3" disabled={save.isPending}>
          <Field label="Catalog title">
            <Input
              size="sm"
              value={title}
              maxLength={200}
              onChange={(e) => {
                save.reset();
                setTitle(e.target.value);
              }}
            />
          </Field>
          <SasTokenField
            value={sas}
            onChange={(value) => {
              save.reset();
              setSas(value);
            }}
            configured={!!collection.storage_access}
            expiresAt={expires ?? null}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!title.trim() || (!!sasReading && 'error' in sasReading) || save.isPending}
              onClick={() =>
                save.mutate({
                  path: { collection_id: collection.id },
                  body: {
                    title: title.trim(),
                    ...(sasReading && 'token' in sasReading
                      ? { storage_access: { kind: 'azure_sas' as const, secret: sasReading.token } }
                      : {}),
                  },
                })
              }
            >
              {save.isPending ? 'Saving…' : 'Save catalog'}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                save.reset();
                setSas('');
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </fieldset>
      ) : (
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            save.reset();
            setTitle(collection.title);
            setSas('');
            setEditing(true);
          }}
        >
          Edit catalog
        </Button>
      )}
      <ErrorText error={save.error} />
      {save.isSuccess && (
        <p role="status" className="text-xs text-green-700">
          Catalog saved.
        </p>
      )}
    </div>
  );
};

const SelectFiles = ({
  collection,
  onStarted,
}: {
  collection: CollectionOut;
  onStarted: (started: ImportOut) => void;
}) => {
  const [cursor, setCursor] = useState<string | null>(null);
  const [rows, setRows] = useState<Map<string, SelectionRow>>(new Map());
  const selected = new Map([...rows].filter(([, row]) => row.selected));
  const selection = buildSelection(selected.values());
  const [problems, setProblems] = useState<Map<string, string>>(new Map());
  const [pattern, setPattern] = useState('(\\d{4}-\\d{2}-\\d{2})');
  const [matchingOnly, setMatchingOnly] = useState(false);
  const [csv, setCsv] = useState('');
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvError, setCsvError] = useState('');
  const [csvReading, setCsvReading] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const discovered = useQuery({
    ...discoverObjectsOptions({
      path: { collection_id: collection.id },
      query: { limit: 200, cursor },
    }),
    meta: inPlace('Failed to list storage files'),
  });
  const start = useMutation({
    ...startImportMutation(),
    meta: inPlace('Failed to start indexing'),
  });

  useEffect(() => {
    if (!discovered.data) return;
    setRows((previous) => {
      const next = new Map(previous);
      for (const object of discovered.data.objects) {
        if (!next.has(object.path)) {
          next.set(object.path, {
            object,
            time: { kind: 'instant', value: '' },
            selected: true,
          });
        }
      }
      return next;
    });
  }, [discovered.data]);

  const update = (path: string, change: (row: SelectionRow) => SelectionRow) =>
    setRows((prev) => {
      const row = prev.get(path);
      if (!row) return prev;
      return new Map(prev).set(path, change(row));
    });

  const toggle = (object: DiscoveredObject, on: boolean) =>
    update(object.path, (row) => ({ ...row, selected: on }));

  const setTime = (path: string, time: TimeInput) => update(path, (row) => ({ ...row, time }));

  const applyPattern = () => {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      setBulkError('The pattern is not a valid regular expression');
      return;
    }
    const missed: string[] = [];
    const next = new Map(rows);
    rows.forEach((row, path) => {
      if (!matchingOnly && !row.selected) return;
      const matches = regex.test(path);
      const time = timeFromPath(path, regex);
      next.set(path, { ...row, selected: matchingOnly ? matches : row.selected });
      if (time) next.set(path, { ...next.get(path)!, time });
      if (!time && (!matchingOnly || matches)) missed.push(path);
    });
    setRows(next);
    setBulkError(missed.length ? `No date found in: ${missed.join(', ')}` : '');
  };

  const applyCsv = () => {
    const { times, errors } = parseTimeCsv(csv);
    const objects = new Map(discovered.data?.objects.map((o) => [o.path, o]) ?? []);
    const next = new Map(rows);
    times.forEach((time, path) => {
      const object = next.get(path)?.object ?? objects.get(path);
      if (object) {
        const existing = next.get(path);
        const result = toImportFile(object, time);
        if (!result.ok) errors.push(`${path}: ${result.error}`);
        else next.set(path, { ...existing, object, time, selected: true });
      } else errors.push(`${path} is not among the listed files`);
    });
    setCsvError(errors.join('; '));
    if (!errors.length) {
      setRows(next);
      setCsvOpen(false);
    }
  };

  const submit = () => {
    setProblems(selection.problems);
    if (selection.problems.size > 0 || selection.files.length === 0) return;
    start.mutate(
      { path: { collection_id: collection.id }, body: { files: selection.files } },
      { onSuccess: onStarted }
    );
  };

  const applyAssetNames = (result: ReturnType<typeof assignAssets>) => {
    setBulkError(result.errors.join('\n'));
    if (!result.errors.length) setRows(result.rows);
  };

  return (
    <>
      <CatalogStep
        number={2}
        description="Choose files, set dates, and name their assets. Bulk tools below are optional."
      >
        <div className="flex items-start gap-2">
          <details className="min-w-0 flex-1 space-y-2 text-xs">
            <summary className="cursor-pointer text-neutral-700">
              <span className="inline-flex items-center gap-1 align-middle">
                <span>Extract dates from filenames (optional)</span>
                <Tooltip
                  text={
                    'Example: flight_2026-01-05.tif\nPattern: (\\d{4}-\\d{2}-\\d{2})\nExtracted date: 2026-01-05\n\nThe first capture group supplies a date in YYYY-MM-DD format. Click Apply to fill dates. For a date range, use Interval in the table.'
                  }
                >
                  <button
                    type="button"
                    aria-label="Date extraction example"
                    className="inline-flex items-center text-neutral-500"
                    onClick={(e) => e.preventDefault()}
                  >
                    <IconQuestion />
                  </button>
                </Tooltip>
              </span>
            </summary>
            <Field label="Date from file path (regular expression)">
              <div className="flex gap-2">
                <Input size="sm" value={pattern} onChange={(e) => setPattern(e.target.value)} />
                <Button size="sm" variant="secondary" onClick={applyPattern}>
                  Apply
                </Button>
              </div>
            </Field>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={matchingOnly}
                onChange={(e) => setMatchingOnly(e.target.checked)}
              />
              Auto-select matching entries only
            </label>
          </details>
        </div>
        <BulkAssetNames rows={rows} onApply={applyAssetNames} />
        <p className="text-xs text-neutral-500">
          Files with the same date or identical interval are grouped into one item automatically.
          Each file in an item needs a different asset name.
        </p>
        <p className="text-xs text-neutral-500">
          Band counts and names are detected from each file during indexing. No need to enter them.
        </p>
        {bulkError && (
          <p role="alert" className="whitespace-pre-line text-xs text-red-600">
            {bulkError}
          </p>
        )}
        <ErrorText error={discovered.error} />
        {discovered.isPending && <p className="text-xs text-neutral-500">Listing files…</p>}
        {discovered.data && discovered.data.objects.length === 0 && (
          <p className="text-xs text-neutral-500">No files under this prefix.</p>
        )}
        {discovered.data && discovered.data.objects.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-1">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label="Select all files"
                      checked={rows.size > 0 && selected.size === rows.size}
                      ref={(element) => {
                        if (element)
                          element.indeterminate = selected.size > 0 && selected.size < rows.size;
                      }}
                      onChange={(e) => {
                        const select = e.target.checked;
                        setRows(
                          (previous) =>
                            new Map(
                              [...previous].map(([path, row]) => [
                                path,
                                { ...row, selected: select },
                              ])
                            )
                        );
                      }}
                    />
                    File
                  </label>
                </th>
                <th className="px-2">Asset name</th>
                <th className="pr-3">Size</th>
                <th className="w-1 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    Date
                    <Tooltip text="Times are in UTC.">
                      <button type="button" aria-label="Time zone" className="text-neutral-500">
                        <IconQuestion />
                      </button>
                    </Tooltip>
                    <Tooltip text="Upload dates from CSV">
                      <button
                        type="button"
                        aria-label="Upload dates from CSV"
                        className="text-neutral-500 hover:text-neutral-800"
                        onClick={() => {
                          setCsvError('');
                          setCsvOpen(true);
                        }}
                      >
                        <IconUploadFilled />
                      </button>
                    </Tooltip>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {discovered.data.objects.map((object) => {
                const row = selected.get(object.path);
                const p = object.path;
                return (
                  <tr key={p} data-testid="cloud-object-row" className="border-t align-middle">
                    <td className="py-1">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={p}
                          checked={!!row}
                          onChange={(e) => toggle(object, e.target.checked)}
                        />
                        <span className="break-all font-mono" title={p}>
                          {p.split('/').pop()}
                        </span>
                      </label>
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        size="sm"
                        className="h-[28px]"
                        style={{ width: 144 }}
                        aria-label={`Asset name for ${p}`}
                        disabled={!row}
                        value={rows.get(p)?.assetKey ?? 'data'}
                        onChange={(e) => update(p, (r) => ({ ...r, assetKey: e.target.value }))}
                      />
                    </td>
                    <td className="whitespace-nowrap pr-3">{(object.size / 1e6).toFixed(1)} MB</td>
                    <td className="space-y-1 py-1">
                      {row && (
                        <TimeFields
                          path={p}
                          time={row.time}
                          onChange={(time) => setTime(p, time)}
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
        {csvOpen && (
          <Modal
            title="Upload dates from CSV"
            maxWidth="max-w-lg"
            onClose={() => setCsvOpen(false)}
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="quiet" onClick={() => setCsvOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={applyCsv} disabled={!csv.trim() || csvReading}>
                  Apply dates
                </Button>
              </div>
            }
          >
            <div className="space-y-3 p-5 text-xs">
              <p className="text-neutral-500">
                Use path,date or path,start,end, with dates in YYYY-MM-DD format. Paths must match
                listed files.
              </p>
              <Input
                type="file"
                accept=".csv,text/csv"
                aria-label="Date CSV file"
                disabled={csvReading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setCsvReading(true);
                  setCsvError('');
                  setCsv('');
                  try {
                    setCsv(await file.text());
                  } catch {
                    setCsvError('Could not read this CSV file. Try choosing it again.');
                  } finally {
                    setCsvReading(false);
                  }
                }}
              />
              <Field label="Or paste CSV">
                <textarea
                  className={textareaClass}
                  rows={5}
                  value={csv}
                  disabled={csvReading}
                  onChange={(e) => setCsv(e.target.value)}
                />
              </Field>
              {csvError && (
                <p role="alert" className="text-red-600">
                  {csvError}
                </p>
              )}
            </div>
          </Modal>
        )}
      </CatalogStep>
      <CatalogStep
        number={3}
        description="Check your selection, then index the files. Band metadata is detected automatically."
      >
        <ErrorText error={start.error} />
        <p className="text-xs text-neutral-500">
          {selected.size} {selected.size === 1 ? 'file' : 'files'} selected · {selection.itemCount}{' '}
          {selection.itemCount === 1 ? 'dated item' : 'dated items'}
        </p>
        <Button onClick={submit} disabled={selected.size === 0 || start.isPending}>
          Index selected
        </Button>
      </CatalogStep>
    </>
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
  <div className="inline-flex min-w-max items-center gap-2 align-middle">
    <div className="flex shrink-0 items-center gap-1">
      {time.kind === 'instant' ? (
        <Input
          size="sm"
          data-testid={`time-instant-${path}`}
          aria-label={`Date for ${path}`}
          className="h-[28px] shrink-0"
          style={{ width: 128 }}
          placeholder="YYYY-MM-DD"
          value={time.value}
          onChange={(e) => onChange({ kind: 'instant', value: e.target.value })}
        />
      ) : (
        <>
          <Input
            size="sm"
            data-testid={`time-start-${path}`}
            aria-label={`Start for ${path}`}
            className="h-[28px] shrink-0"
            style={{ width: 128 }}
            placeholder="Start date"
            value={time.start}
            onChange={(e) => onChange({ ...time, start: e.target.value })}
          />
          <span className="text-neutral-400" aria-hidden="true">
            –
          </span>
          <Input
            size="sm"
            data-testid={`time-end-${path}`}
            aria-label={`End for ${path}`}
            className="h-[28px] shrink-0"
            style={{ width: 128 }}
            placeholder="End date"
            value={time.end}
            onChange={(e) => onChange({ ...time, end: e.target.value })}
          />
        </>
      )}
    </div>
    <label className="flex shrink-0 items-center gap-1">
      <input
        type="checkbox"
        data-testid={`time-mode-${path}`}
        aria-label={`Interval for ${path}`}
        checked={time.kind === 'interval'}
        onChange={(e) => {
          const start = time.kind === 'instant' ? time.value : time.start;
          onChange(
            e.target.checked
              ? { kind: 'interval', start, end: '' }
              : { kind: 'instant', value: start }
          );
        }}
      />
      Interval
    </label>
  </div>
);

const STATUS_TEXT: Record<ImportOut['status'], string> = {
  registering: 'Indexing',
  failed: 'Failed',
  ready: 'Ready',
};

const ImportProgress = ({ importId, onSettled }: { importId: number; onSettled: () => void }) => {
  const queryClient = useQueryClient();
  const key = getImportQueryKey({ path: { import_id: importId } });
  const progress = useQuery({
    ...getImportOptions({ path: { import_id: importId } }),
    meta: inPlace('Failed to load indexing progress'),
    refetchInterval: (query) => (query.state.data?.status === 'registering' ? 2000 : false),
  });
  const retry = useMutation({
    ...retryImportMutation(),
    meta: inPlace('Failed to retry indexing'),
  });
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
    <div className="space-y-3">
      <ErrorText error={progress.error} />
      {job && (
        <>
          <p className="text-xs">
            <span data-testid="cloud-import-status">{STATUS_TEXT[job.status]}</span>{' '}
            <span className="text-neutral-500">
              {job.completed} of {job.total} files
            </span>
          </p>
          <progress
            aria-label="Indexed files"
            className="h-2 w-full accent-brand-600"
            value={job.completed}
            max={Math.max(job.total, 1)}
          />
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
              Retry indexing
            </Button>
          )}
          <ErrorText error={retry.error} />
        </>
      )}
    </div>
  );
};

const IndexedBands = ({
  collection,
  onSaved,
}: {
  collection: CollectionOut;
  onSaved: () => void;
}) => {
  const queryClient = useQueryClient();
  const [names, setNames] = useState<Record<string, string[]> | null>(null);
  const assets = Object.entries(collection.item_assets ?? {});
  const save = useMutation({
    ...updateCollectionMutation(),
    meta: inPlace('Failed to save band names'),
    onSuccess: (saved) => {
      queryClient.setQueryData(
        getCollectionQueryKey({ path: { collection_id: collection.id } }),
        saved
      );
      setNames(null);
      onSaved();
    },
  });
  if (!assets.length) return null;

  return (
    <div className="space-y-2 text-xs" aria-label="Detected bands">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-neutral-800">Assets and bands</h3>
        <Button
          size="sm"
          variant="quiet"
          disabled={!assets.some(([, asset]) => asset.bands?.length)}
          onClick={() => {
            save.reset();
            setNames(
              Object.fromEntries(
                assets
                  .filter(([, asset]) => asset.bands?.length)
                  .map(([key, asset]) => [key, asset.bands!.map((band) => band.name)])
              )
            );
          }}
        >
          Edit band names
        </Button>
      </div>
      {assets.map(([key, asset]) => (
        <p key={key} className="break-words text-neutral-600">
          <span className="font-medium">{key}</span>
          {' · '}
          {asset.bands?.length
            ? `${asset.bands.length} ${asset.bands.length === 1 ? 'band' : 'bands'}: ${asset.bands.map((band) => band.name).join(', ')}`
            : 'Band metadata unavailable'}
        </p>
      ))}
      {names && (
        <Modal
          title="Edit band names"
          maxWidth="max-w-lg"
          onClose={() => {
            if (!save.isPending) setNames(null);
          }}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="quiet" disabled={save.isPending} onClick={() => setNames(null)}>
                Cancel
              </Button>
              <Button
                disabled={
                  save.isPending ||
                  Object.values(names)
                    .flat()
                    .some((name) => !name.trim())
                }
                onClick={() =>
                  save.mutate({
                    path: { collection_id: collection.id },
                    body: { band_names: names },
                  })
                }
              >
                Save band names
              </Button>
            </div>
          }
        >
          <div className="space-y-4 p-5 text-xs">
            <p className="text-neutral-500">
              Bands were detected from the indexed files. These names label the catalog's
              visualization controls; the source files and band order stay unchanged.
            </p>
            {Object.entries(names).map(([key, bands]) => (
              <fieldset key={key} className="space-y-2" disabled={save.isPending}>
                <legend className="font-medium text-neutral-800">
                  {key} · {bands.length} {bands.length === 1 ? 'band' : 'bands'}
                </legend>
                {bands.map((name, index) => (
                  <label key={index} className="flex items-center gap-3">
                    <span className="w-14 shrink-0 text-neutral-500">Band {index + 1}</span>
                    <Input
                      size="sm"
                      className="min-w-0 flex-1"
                      aria-label={`${key} band ${index + 1}`}
                      maxLength={100}
                      value={name}
                      onChange={(e) =>
                        setNames({
                          ...names,
                          [key]: bands.map((current, i) =>
                            i === index ? e.target.value : current
                          ),
                        })
                      }
                    />
                  </label>
                ))}
              </fieldset>
            ))}
            <ErrorText error={save.error} />
          </div>
        </Modal>
      )}
    </div>
  );
};

const VisualizationSettings = ({
  collection,
  onSaved,
}: {
  collection: CollectionOut;
  onSaved: () => void;
}) => {
  const queryClient = useQueryClient();
  const [presets, setPresets] = useState<NamedVizParams[]>(() => catalogPresets(collection));
  const managedAssets = useManagedAssets(presets, collection.id);
  const [active, setActive] = useState(0);
  const save = useMutation({
    ...updateCollectionMutation(),
    meta: inPlace('Failed to save visualization settings'),
  });
  const changePresets = (next: NamedVizParams[]) => {
    save.reset();
    setPresets(next);
  };

  const submit = () =>
    save.mutate(
      {
        path: { collection_id: collection.id },
        body: {
          visualizations: presets.map((p) => ({
            name: p.name,
            viz_params: toVizParamsPayload(p.vizParams),
          })),
        },
      },
      {
        onSuccess: (saved) => {
          queryClient.setQueryData(
            getCollectionQueryKey({ path: { collection_id: collection.id } }),
            saved
          );
          onSaved();
        },
      }
    );

  return (
    <fieldset className="space-y-3 border-t border-neutral-200 pt-4" disabled={save.isPending}>
      <h3 className="text-sm font-semibold text-neutral-800">Visualization presets</h3>
      <p className="text-xs text-neutral-500">
        Presets are suggestions: a campaign copies them when it adds this catalog, so editing them
        here never changes a campaign that already uses it.
      </p>
      {presets.length === 0 ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => changePresets([{ name: 'True Color', vizParams: emptyVizParams() }])}
        >
          Add a visualization preset
        </Button>
      ) : (
        <>
          <ErrorText error={managedAssets.error} />
          {managedAssets.legacy && (
            <ManagedBandCountField
              bandCount={managedAssets.bandCount}
              onChange={(count) => {
                save.reset();
                managedAssets.setBandCount(count);
              }}
            />
          )}
          <VizTabs
            visualizations={presets}
            activeIndex={active}
            onActiveIndexChange={setActive}
            collectionId={`cloud-${collection.id}`}
            availableAssets={managedAssets.assets}
            showCompositing={false}
            onParamsChange={(i, vizParams) =>
              changePresets(presets.map((p, j) => (j === i ? { ...p, vizParams } : p)))
            }
            onNameChange={(i, name) =>
              changePresets(presets.map((p, j) => (j === i ? { ...p, name } : p)))
            }
            onAdd={() =>
              changePresets([
                ...presets,
                { name: `Preset ${presets.length + 1}`, vizParams: emptyVizParams() },
              ])
            }
            onRemove={(i) => {
              changePresets(presets.filter((_, j) => j !== i));
              setActive(0);
            }}
          />
        </>
      )}
      <ErrorText error={save.error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={submit} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
        {save.isSuccess && (
          <p role="status" className="text-xs text-green-700">
            Visualization settings saved.
          </p>
        )}
      </div>
    </fieldset>
  );
};
