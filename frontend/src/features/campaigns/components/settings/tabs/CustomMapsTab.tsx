import { useCallback, useEffect, useState } from 'react';
import {
  listCustomMaps,
  deleteCustomMap,
  updateCustomMapVizParams,
  type CustomMapOut,
} from '~/api/client';
import { CustomMapUpload } from '~/features/annotation/components/Map/CustomMapUpload';
import { VizConfigPanel } from '~/features/campaigns/components/imagery/VizConfigPanel';
import type { VizParams } from '~/features/campaigns/components/imagery/types';
import type { AssetInfo } from '~/features/campaigns/components/imagery/collectionPresets';

interface Props {
  campaignId: number;
}

const STATUS_BADGE: Record<string, string> = {
  ready: 'bg-green-100 text-green-700',
  processing: 'bg-yellow-100 text-yellow-700',
  pending_processing: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<string, string> = {
  ready: 'Ready',
  processing: 'Processing…',
  pending_processing: 'Queued',
  failed: 'Failed',
};

function bandAssets(bandCount: number): Record<string, AssetInfo> {
  return Object.fromEntries(
    Array.from({ length: bandCount }, (_, i) => [
      String(i + 1),
      { title: `Band ${i + 1}`, type: 'image/tiff', roles: ['data'] },
    ])
  );
}

function vizParamsToForm(stored: Record<string, unknown> | null): VizParams {
  if (!stored) return { assets: ['1'], assetAsBand: true, rescale: '' };
  return {
    assets: (stored.assets as string[]) ?? ['1'],
    assetAsBand: (stored.assetAsBand as boolean) ?? true,
    rescale: (stored.rescale as string) ?? '',
    colormapName: stored.colormap_name as string | undefined,
    colorFormula: stored.color_formula as string | undefined,
    nodata: stored.nodata as number | undefined,
  };
}

function formToVizParams(p: VizParams): Record<string, unknown> {
  return {
    assets: p.assets,
    assetAsBand: p.assetAsBand,
    rescale: p.rescale,
    ...(p.colormapName && { colormap_name: p.colormapName }),
    ...(p.colorFormula && { color_formula: p.colorFormula }),
    ...(p.nodata !== undefined && { nodata: p.nodata }),
  };
}

export function CustomMapsTab({ campaignId }: Props) {
  const [maps, setMaps] = useState<CustomMapOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editViz, setEditViz] = useState<VizParams>({
    assets: ['1'],
    assetAsBand: true,
    rescale: '',
  });
  const [savingViz, setSavingViz] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pollTimer, setPollTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const fetchMaps = useCallback(async () => {
    const { data } = await listCustomMaps({ path: { campaign_id: campaignId } });
    if (data) setMaps(data);
    return data ?? [];
  }, [campaignId]);

  const schedulePolling = useCallback(
    (current: CustomMapOut[]) => {
      if (current.some((m) => m.status === 'pending_processing' || m.status === 'processing')) {
        const t = setTimeout(async () => {
          const next = await fetchMaps();
          schedulePolling(next);
        }, 5000);
        setPollTimer(t);
      }
    },
    [fetchMaps]
  );

  useEffect(() => {
    setLoading(true);
    fetchMaps()
      .then(schedulePolling)
      .finally(() => setLoading(false));
    return () => {
      if (pollTimer) clearTimeout(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const handleDelete = async (mapId: string) => {
    setDeletingId(mapId);
    await deleteCustomMap({ path: { campaign_id: campaignId, map_id: mapId } });
    const next = await fetchMaps();
    schedulePolling(next);
    setDeletingId(null);
  };

  const openEdit = (m: CustomMapOut) => {
    setEditViz(vizParamsToForm(m.viz_params));
    setEditingId(m.id);
  };

  const handleSaveViz = async () => {
    if (!editingId) return;
    setSavingViz(true);
    await updateCustomMapVizParams({
      path: { campaign_id: campaignId, map_id: editingId },
      body: { viz_params: formToVizParams(editViz) },
    });
    await fetchMaps();
    setSavingViz(false);
    setEditingId(null);
  };

  return (
    <div id="tab-custom-maps" role="tabpanel" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-neutral-800">Custom Maps</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Upload raster files to display as overlays on the annotation map.
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="text-xs px-3 py-1.5 bg-brand-500 text-white rounded-md hover:bg-brand-600 transition-colors"
        >
          + Upload map
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-neutral-400">Loading…</p>
      ) : maps.length === 0 ? (
        <p className="text-xs text-neutral-400">No custom maps yet.</p>
      ) : (
        <div className="space-y-2">
          {maps.map((m) => (
            <div key={m.id} className="border border-neutral-200 rounded-lg overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-800 truncate">{m.name}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${STATUS_BADGE[m.status] ?? 'bg-neutral-100 text-neutral-600'}`}
                    >
                      {STATUS_LABEL[m.status] ?? m.status}
                    </span>
                  </div>
                  {m.status === 'ready' && m.band_count && (
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {m.band_count} band{m.band_count !== 1 ? 's' : ''}
                    </p>
                  )}
                  {m.status === 'failed' && m.error && (
                    <p className="text-xs text-red-500 mt-0.5 truncate">{m.error}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {m.status === 'ready' && (
                    <button
                      onClick={() => (editingId === m.id ? setEditingId(null) : openEdit(m))}
                      className="text-xs px-2 py-1 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
                      title="Edit visualization"
                    >
                      {editingId === m.id ? 'Close' : 'Viz'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(m.id)}
                    disabled={deletingId === m.id}
                    className="text-xs px-2 py-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors disabled:opacity-40"
                  >
                    {deletingId === m.id ? '…' : 'Delete'}
                  </button>
                </div>
              </div>

              {editingId === m.id && m.band_count && (
                <div className="border-t border-neutral-100 px-4 py-3 bg-neutral-50 space-y-3">
                  <VizConfigPanel
                    collectionId="custom-map"
                    availableAssets={bandAssets(m.band_count)}
                    vizParams={editViz}
                    onChange={setEditViz}
                    showCompositing={false}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs px-3 py-1 text-neutral-500 hover:bg-neutral-200 rounded transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveViz}
                      disabled={savingViz}
                      className="text-xs px-3 py-1 bg-brand-500 text-white rounded hover:bg-brand-600 transition-colors disabled:opacity-50"
                    >
                      {savingViz ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showUpload && (
        <CustomMapUpload
          campaignId={campaignId}
          onClose={() => setShowUpload(false)}
          onUploaded={async () => {
            const next = await fetchMaps();
            schedulePolling(next);
          }}
        />
      )}
    </div>
  );
}

export default CustomMapsTab;
