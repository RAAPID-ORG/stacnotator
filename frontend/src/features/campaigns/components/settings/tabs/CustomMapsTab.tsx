import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, inputClass } from '~/shared/ui/forms';
import { IconChevronDown, IconChevronUp, IconTrash } from '~/shared/ui/Icons';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { useLayoutStore } from '~/features/layout/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import {
  type CustomMap,
  type CustomMapVizParams,
  completeCustomMapUpload,
  createCustomMap,
  deleteCustomMap,
  listCustomMaps,
  patchCustomMap,
  uploadToSignedUrl,
} from '~/api/customMaps';
import { CustomMapVizConfig } from './CustomMapVizConfig';

interface Props {
  campaignId: number;
}

const POLL_INTERVAL_MS = 3000;

const STATUS_LABEL: Record<CustomMap['status'], string> = {
  pending: 'Pending',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

const STATUS_CLASS: Record<CustomMap['status'], string> = {
  pending: 'bg-neutral-100 text-neutral-600',
  processing: 'bg-amber-50 text-amber-700',
  ready: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
};

export default function CustomMapsTab({ campaignId }: Props) {
  const showAlert = useLayoutStore((s) => s.showAlert);
  const [customMaps, setCustomMaps] = useState<CustomMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadFraction, setUploadFraction] = useState(0);
  const editingRef = useRef<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await listCustomMaps(campaignId);
      setCustomMaps(data ?? []);
    } catch (err) {
      handleError(err, 'Failed to load custom maps');
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const hasInflight = customMaps.some((m) => m.status === 'pending' || m.status === 'processing');
    if (!hasInflight) return;
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [customMaps, refresh]);

  const submitNew = async () => {
    if (!file || !newName.trim()) {
      showAlert('Pick a file and provide a name', 'warning');
      return;
    }
    setUploading(true);
    setUploadFraction(0);
    let createdId: string | null = null;
    try {
      const { data: created, error: createErr } = await createCustomMap(campaignId, {
        name: newName.trim(),
        original_filename: file.name,
      });
      if (createErr || !created) throw createErr ?? new Error('Create failed');
      createdId = created.custom_map.id;

      await uploadToSignedUrl(created.upload_url, file, setUploadFraction);
      const { error: completeErr } = await completeCustomMapUpload(campaignId, createdId);
      if (completeErr) throw completeErr;

      createdId = null;
      setShowAdd(false);
      setNewName('');
      setFile(null);
      await refresh();
    } catch (err) {
      handleError(err, 'Failed to upload custom map');
      // Clean up the row we created but couldn't finish; backend's lazy prune
      // would catch it eventually but this gives immediate UI feedback.
      if (createdId) deleteCustomMap(campaignId, createdId).catch(() => {});
    } finally {
      setUploading(false);
      setUploadFraction(0);
    }
  };

  const renameCustomMap = async (id: string, name: string) => {
    try {
      const { data } = await patchCustomMap(campaignId, id, { name });
      if (data) setCustomMaps((cur) => cur.map((m) => (m.id === id ? data : m)));
    } catch (err) {
      handleError(err, 'Failed to rename custom map');
    }
  };

  const updateVizParams = async (id: string, vizParams: CustomMapVizParams) => {
    try {
      const { data } = await patchCustomMap(campaignId, id, { viz_params: vizParams });
      if (data) setCustomMaps((cur) => cur.map((m) => (m.id === id ? data : m)));
    } catch (err) {
      handleError(err, 'Failed to update rendering');
    }
  };

  const removeCustomMap = async (id: string) => {
    if (!window.confirm('Delete this custom map? This cannot be undone.')) return;
    try {
      await deleteCustomMap(campaignId, id);
      setCustomMaps((cur) => cur.filter((m) => m.id !== id));
    } catch (err) {
      handleError(err, 'Failed to delete custom map');
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Custom maps</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Upload classification rasters or other maps to overlay on this campaign&apos;s imagery.
            Uploads are reprojected to a Web Mercator COG in the background.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            to={`/campaigns/${campaignId}/visualize`}
            className="text-xs text-neutral-600 hover:text-neutral-900 underline underline-offset-4 decoration-neutral-300 transition-colors"
          >
            Open visualizer
          </Link>
          {!showAdd && (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
            >
              + Add custom map
            </button>
          )}
        </div>
      </div>

      {showAdd && (
        <div className="mb-4 p-3 border border-neutral-200 rounded-md bg-neutral-50">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[12rem]">
              <label className="block text-[11px] text-neutral-600 mb-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. 2024 crop classification"
                className={`${inputClass} w-full text-xs`}
                disabled={uploading}
              />
            </div>
            <div className="flex-1 min-w-[14rem]">
              <label className="block text-[11px] text-neutral-600 mb-1">GeoTIFF file</label>
              <label
                className={`flex items-center gap-2 h-9 px-3 border border-dashed border-neutral-300 rounded-md text-xs bg-white transition-colors ${
                  uploading
                    ? 'opacity-60 cursor-not-allowed'
                    : 'cursor-pointer hover:border-brand-500 hover:bg-brand-50/50'
                }`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-neutral-500 shrink-0"
                >
                  <path
                    d="M10 3v10M5 8l5-5 5 5M3 17h14"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className={file ? 'text-neutral-800 truncate' : 'text-neutral-500'}>
                  {file ? file.name : 'Click to choose a .tif/.tiff file'}
                </span>
                <input
                  type="file"
                  accept=".tif,.tiff,image/tiff"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="sr-only"
                  disabled={uploading}
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={submitNew} disabled={uploading}>
                {uploading ? `Uploading ${Math.round(uploadFraction * 100)}%` : 'Upload'}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setShowAdd(false);
                  setNewName('');
                  setFile(null);
                }}
                disabled={uploading}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-6 flex justify-center">
          <LoadingSpinner />
        </div>
      ) : customMaps.length === 0 ? (
        <p className="text-xs text-neutral-400 italic">No custom maps configured.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
          {customMaps.map((m) => {
            const isExpanded = expandedId === m.id;
            const canConfigure = m.status === 'ready';
            return (
              <li key={m.id} className="py-2">
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    defaultValue={m.name}
                    onChange={(e) => {
                      editingRef.current[m.id] = e.target.value;
                    }}
                    onBlur={(e) => {
                      const next = (editingRef.current[m.id] ?? e.target.value).trim();
                      if (next && next !== m.name) renameCustomMap(m.id, next);
                    }}
                    className={`${inputClass} flex-1 text-xs`}
                  />
                  <span
                    className={`px-2 py-0.5 text-[11px] rounded ${STATUS_CLASS[m.status]}`}
                    title={m.error_message ?? undefined}
                  >
                    {STATUS_LABEL[m.status]}
                  </span>
                  <button
                    type="button"
                    onClick={() => canConfigure && setExpandedId(isExpanded ? null : m.id)}
                    disabled={!canConfigure}
                    className="text-neutral-400 hover:text-neutral-700 transition-colors cursor-pointer p-1 shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Configure rendering"
                    title="Configure rendering"
                  >
                    {isExpanded ? (
                      <IconChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <IconChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCustomMap(m.id)}
                    className="text-neutral-400 hover:text-red-600 transition-colors cursor-pointer p-1 shrink-0"
                    aria-label="Delete custom map"
                    title="Delete custom map"
                  >
                    <IconTrash className="w-3.5 h-3.5" />
                  </button>
                </div>
                {isExpanded && canConfigure && (
                  <div className="mt-2">
                    <CustomMapVizConfig customMap={m} onChange={(p) => updateVizParams(m.id, p)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
