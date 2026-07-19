import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsInternal } from '~/features/account/account.store';
import { Spinner } from '~/shared/ui/Spinner';
import { Input, Button, IconButton } from '~/shared/ui/forms';
import { IconTrash, IconPlus, IconPencil, IconExternalLink } from '~/shared/ui/Icons';
import { handleError } from '~/shared/utils/errorHandler';
import { ColormapSelect } from '~/shared/ui/ColormapSelect';
import {
  isColormapName,
  nextCategoricalColor,
  CATEGORICAL_PALETTE,
  type ColormapName,
} from '~/shared/utils/customMapColormaps';
import {
  listCustomMaps,
  createCustomMap,
  updateCustomMap,
  deleteCustomMap,
  type CustomMapOut,
  type CategoricalEntry,
} from '~/api/client';

interface FormState {
  name: string;
  cog_url: string;
  mlops_url: string;
  mode: 'continuous' | 'categorical';
  colormap_name: ColormapName;
  rescale_min: string;
  rescale_max: string;
  entries: Array<{ value: string; color: string; label: string }>;
  max_native_zoom: string;
  internal_storage: boolean;
}

const defaultForm = (): FormState => ({
  name: '',
  cog_url: '',
  mlops_url: '',
  mode: 'continuous',
  colormap_name: 'viridis',
  rescale_min: '0',
  rescale_max: '1',
  entries: [{ value: '1', color: CATEGORICAL_PALETTE[0], label: '' }],
  max_native_zoom: '',
  internal_storage: false,
});

const formFromMap = (m: CustomMapOut): FormState => {
  const rc = m.render_config;
  const entries = rc.entries ?? [];
  return {
    name: m.name,
    cog_url: m.cog_url,
    mlops_url: m.mlops_url ?? '',
    mode: rc.mode,
    colormap_name:
      rc.colormap_name && isColormapName(rc.colormap_name) ? rc.colormap_name : 'viridis',
    rescale_min: rc.rescale ? String(rc.rescale[0]) : '0',
    rescale_max: rc.rescale ? String(rc.rescale[1]) : '1',
    entries: entries.length
      ? entries.map((e) => ({ value: String(e.value), color: e.color, label: e.label ?? '' }))
      : defaultForm().entries,
    max_native_zoom: m.max_native_zoom != null ? String(m.max_native_zoom) : '',
    internal_storage: m.internal_storage ?? false,
  };
};

interface StatusBadgeProps {
  status: CustomMapOut['status'];
  statusError?: CustomMapOut['status_error'];
}

const StatusBadge = ({ status, statusError }: StatusBadgeProps) => {
  if (status === 'registering') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-blue-700">
        <Spinner size="xs" />
        Processing…
      </span>
    );
  }
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        Ready
      </span>
    );
  }
  if (status === 'failed') {
    const errMsg =
      statusError && typeof statusError === 'object' && 'error' in statusError
        ? String((statusError as { error: unknown }).error)
        : 'Processing failed';
    return (
      <span
        className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 cursor-help"
        title={errMsg}
      >
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
      {status}
    </span>
  );
};

interface CustomMapsEditorProps {
  campaignId: number;
}

export const CustomMapsEditor = ({ campaignId }: CustomMapsEditorProps) => {
  const isInternal = useIsInternal();
  const [maps, setMaps] = useState<CustomMapOut[]>([]);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Focus the value field of a freshly added class entry so Enter/Add keeps the keyboard flow going.
  const entryValueRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const pendingFocus = useRef<number | null>(null);

  useEffect(() => {
    if (pendingFocus.current !== null) {
      entryValueRefs.current[pendingFocus.current]?.focus();
      pendingFocus.current = null;
    }
  }, [form.entries.length]);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(defaultForm());
  };

  const startCreate = () => {
    setForm(defaultForm());
    setEditingId(null);
    setShowForm(true);
  };

  const startEdit = (m: CustomMapOut) => {
    setForm(formFromMap(m));
    setEditingId(m.id);
    setShowForm(true);
  };

  const fetchMaps = useCallback(async () => {
    const { data, error } = await listCustomMaps({ path: { campaign_id: campaignId } });
    if (error) {
      handleError(error, 'Failed to load custom maps', { showUser: false });
      return;
    }
    if (data) setMaps(data);
  }, [campaignId]);

  useEffect(() => {
    fetchMaps();
    return stopPoll;
  }, [fetchMaps]);

  useEffect(() => {
    const anyRegistering = maps.some((m) => m.status === 'registering');
    if (anyRegistering && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const { data } = await listCustomMaps({ path: { campaign_id: campaignId } });
        if (data) {
          setMaps(data);
          if (!data.some((m) => m.status === 'registering')) stopPoll();
        }
      }, 2000);
    } else if (!anyRegistering) {
      stopPoll();
    }
  }, [maps, campaignId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const renderConfig =
        form.mode === 'continuous'
          ? {
              mode: 'continuous' as const,
              colormap_name: form.colormap_name || null,
              rescale:
                form.rescale_min !== '' && form.rescale_max !== ''
                  ? ([Number(form.rescale_min), Number(form.rescale_max)] as [number, number])
                  : null,
            }
          : {
              mode: 'categorical' as const,
              entries: form.entries.map(
                (e): CategoricalEntry => ({
                  value: Number(e.value),
                  color: e.color,
                  label: e.label || undefined,
                })
              ),
            };

      const body = {
        name: form.name,
        cog_url: form.cog_url,
        render_config: renderConfig,
        max_native_zoom: form.max_native_zoom !== '' ? Number(form.max_native_zoom) : null,
        mlops_url: form.mlops_url.trim() !== '' ? form.mlops_url.trim() : null,
        // Omitted for non-internal users so editing a map never downgrades a flag they
        // cannot see; the backend defaults it to false on create and leaves it on update.
        ...(isInternal ? { internal_storage: form.internal_storage } : {}),
      };

      const { error } =
        editingId === null
          ? await createCustomMap({ path: { campaign_id: campaignId }, body })
          : await updateCustomMap({
              path: { campaign_id: campaignId, map_id: editingId },
              body,
            });
      if (error) {
        handleError(error, editingId === null ? 'Failed to add custom map' : 'Failed to save map');
        return;
      }
      closeForm();
      await fetchMaps();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (mapId: number) => {
    const { error } = await deleteCustomMap({
      path: { campaign_id: campaignId, map_id: mapId },
    });
    if (error) {
      handleError(error, 'Failed to delete custom map');
      return;
    }
    setMaps((prev) => prev.filter((m) => m.id !== mapId));
  };

  const updateEntry = (idx: number, patch: Partial<(typeof form.entries)[0]>) =>
    setForm((f) => ({
      ...f,
      entries: f.entries.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    }));

  const addEntry = () =>
    setForm((f) => {
      const entries = [
        ...f.entries,
        { value: '', color: nextCategoricalColor(f.entries.map((e) => e.color)), label: '' },
      ];
      pendingFocus.current = entries.length - 1;
      return { ...f, entries };
    });

  const removeEntry = (idx: number) =>
    setForm((f) => ({ ...f, entries: f.entries.filter((_, i) => i !== idx) }));

  const submitLabel = submitting ? 'Saving…' : editingId === null ? 'Add map' : 'Save map';

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Overlays</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            COG raster overlays displayed in the annotation view.
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={startCreate}
            className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
          >
            + Add map
          </button>
        )}
      </div>

      {maps.length === 0 && !showForm ? (
        <p className="text-xs text-neutral-400 italic">No overlays configured.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
          {maps.map((m) => (
            <li
              key={m.id}
              data-testid="custom-map-row"
              data-status={m.status}
              className="py-2.5 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-sm font-medium text-neutral-900 truncate">{m.name}</p>
                  {m.mlops_url && (
                    <a
                      href={m.mlops_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="custom-map-row-mlops-link"
                      title="Open linked experiment"
                      className="shrink-0 text-neutral-400 hover:text-neutral-700 transition-colors"
                    >
                      <IconExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
                <p className="text-xs text-neutral-500 truncate font-mono">{m.cog_url}</p>
              </div>
              <StatusBadge status={m.status} statusError={m.status_error} />
              <IconButton
                onClick={() => startEdit(m)}
                aria-label="Edit custom map"
                title="Edit"
                data-testid="edit-custom-map"
              >
                <IconPencil className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                tone="danger"
                onClick={() => handleDelete(m.id)}
                aria-label="Delete custom map"
                title="Delete"
              >
                <IconTrash className="w-3.5 h-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mt-4 space-y-4 border border-neutral-200 rounded-lg p-4 bg-neutral-50"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">Name</label>
              <Input
                size="sm"
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="My COG layer"
                required
                data-testid="custom-map-name"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Max native zoom
              </label>
              <Input
                size="sm"
                type="number"
                min={0}
                max={24}
                value={form.max_native_zoom}
                onChange={(e) => setForm((f) => ({ ...f, max_native_zoom: e.target.value }))}
                placeholder="Auto"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">COG URL</label>
            <Input
              size="sm"
              type="text"
              value={form.cog_url}
              onChange={(e) => setForm((f) => ({ ...f, cog_url: e.target.value }))}
              placeholder="https://example.com/data.tif"
              required
              data-testid="custom-map-url"
              className="font-mono text-[11px]"
            />
            <ul
              data-testid="custom-map-url-help"
              className="mt-1.5 space-y-0.5 text-[11px] text-neutral-500 leading-snug list-disc list-inside"
            >
              <li>
                Must be a{' '}
                <strong className="font-medium text-neutral-600">
                  Cloud-Optimized GeoTIFF (COG)
                </strong>{' '}
                - internally tiled with overviews. The browser reads it directly, so a plain GeoTIFF
                means downloading the whole file.
              </li>
              <li>Single-band raster (e.g. a class map or probability layer).</li>
              <li>
                Reachable by this server - a public URL, or one that includes a SAS token. The URL
                is never exposed to annotators.
              </li>
              <li>
                Any projection with a WGS84 datum (UTM zones and EPSG:4326/3857 are all handled).
              </li>
              <li>Not validated automatically - an invalid or non-COG file will not render.</li>
            </ul>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Experiment link <span className="font-normal text-neutral-400">(optional)</span>
            </label>
            <Input
              size="sm"
              type="url"
              value={form.mlops_url}
              onChange={(e) => setForm((f) => ({ ...f, mlops_url: e.target.value }))}
              placeholder="https://mlflow.example.org/#/experiments/7/runs/…"
              data-testid="custom-map-mlops-url"
              className="font-mono text-[11px]"
            />
            <p className="mt-1.5 text-[11px] text-neutral-500 leading-snug">
              Linked from an icon next to the map, e.g. the MLflow run that produced it.
            </p>
          </div>

          {isInternal && (
            <div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.internal_storage}
                  onChange={(e) => setForm((f) => ({ ...f, internal_storage: e.target.checked }))}
                  data-testid="custom-map-internal-storage"
                />
                <span className="text-xs text-neutral-700">
                  <span className="font-medium">Hosted in internal storage</span>
                  <span className="block text-[11px] text-neutral-500 leading-snug">
                    Check this if the file lives in our own Azure storage, so the tiler reads it
                    with its managed identity. Leave unchecked for public or AWS-hosted files.
                  </span>
                </span>
              </label>
            </div>
          )}

          <div>
            <span className="block text-xs font-medium text-neutral-700 mb-1">Render mode</span>
            <div className="flex gap-2">
              {(['continuous', 'categorical'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, mode: m }))}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
                    form.mode === m
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-neutral-600 border-neutral-300 hover:border-neutral-400'
                  }`}
                >
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {form.mode === 'continuous' && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">Colormap</label>
                <ColormapSelect
                  value={form.colormap_name}
                  onChange={(colormap_name) => setForm((f) => ({ ...f, colormap_name }))}
                  className="w-full h-8 px-2.5 text-xs text-neutral-900 bg-white border border-neutral-300 rounded-md focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Rescale min
                </label>
                <Input
                  size="sm"
                  type="number"
                  value={form.rescale_min}
                  onChange={(e) => setForm((f) => ({ ...f, rescale_min: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Rescale max
                </label>
                <Input
                  size="sm"
                  type="number"
                  value={form.rescale_max}
                  onChange={(e) => setForm((f) => ({ ...f, rescale_max: e.target.value }))}
                  placeholder="1"
                />
              </div>
            </div>
          )}

          {form.mode === 'categorical' && (
            <div>
              <span className="block text-xs font-medium text-neutral-700 mb-2">Class entries</span>
              {/* Enter adds the next entry instead of submitting the form, so classes can be typed
                  in one keyboard run; the new entry's value field takes focus (see pendingFocus). */}
              <ul className="space-y-2">
                {form.entries.map((entry, idx) => {
                  const addOnEnter = (e: React.KeyboardEvent) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addEntry();
                  };
                  return (
                    <li key={idx} className="flex items-center gap-2">
                      <Input
                        ref={(el) => {
                          entryValueRefs.current[idx] = el;
                        }}
                        size="sm"
                        type="number"
                        value={entry.value}
                        onChange={(e) => updateEntry(idx, { value: e.target.value })}
                        onKeyDown={addOnEnter}
                        placeholder="Value"
                        className="!w-20"
                      />
                      <input
                        type="color"
                        value={entry.color}
                        onChange={(e) => updateEntry(idx, { color: e.target.value })}
                        className="h-8 w-10 rounded border border-neutral-300 cursor-pointer p-0.5 bg-white"
                        title="Color"
                      />
                      <Input
                        size="sm"
                        type="text"
                        value={entry.label}
                        onChange={(e) => updateEntry(idx, { label: e.target.value })}
                        onKeyDown={addOnEnter}
                        placeholder="Label (optional)"
                        className="flex-1"
                      />
                      <IconButton
                        tone="danger"
                        type="button"
                        onClick={() => removeEntry(idx)}
                        disabled={form.entries.length <= 1}
                        aria-label="Remove entry"
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={addEntry}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-neutral-300 py-1.5 text-xs text-brand-700 hover:border-brand-400 hover:text-brand-900 cursor-pointer"
              >
                <IconPlus className="w-3 h-3" />
                Add class
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" size="sm" disabled={submitting} data-testid="add-custom-map">
              {submitLabel}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={closeForm}
              disabled={submitting}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
};
