import React, { useState } from 'react';
import type { ImagerySourceOut } from '~/api/client';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

interface Props {
  imagery: ImagerySourceOut[];
  campaignId: number;
  setDeleteConfirm: (v: { imageryId?: number } | null) => void;
  onSourceUpdated: (
    sourceId: number,
    updates: { crosshair_hex6?: string; default_zoom?: number }
  ) => void;
}

async function patchSource(
  campaignId: number,
  sourceId: number,
  body: { crosshair_hex6?: string; default_zoom?: number },
  token?: string
) {
  const resp = await fetch(`${API_BASE}/api/${campaignId}/imagery/sources/${sourceId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error('Failed to update source');
  return resp.json();
}

export const ImageryTab: React.FC<Props> = ({
  imagery,
  campaignId,
  setDeleteConfirm,
  onSourceUpdated,
}) => {
  return (
    <div id="tab-imagery" role="tabpanel" className="space-y-3">
      <div className="bg-white rounded-lg border border-neutral-300 p-6">
        <h2 className="text-base font-semibold text-neutral-900 mb-4">
          Imagery Sources ({imagery.length})
        </h2>
        <p className="text-xs text-neutral-500 mb-4">
          Imagery sources are the satellite or map layers displayed during annotation. Each source
          defines a tile service with visualisation settings and one or more temporal collections.
        </p>
        <div className="space-y-4">
          {imagery.length === 0 ? (
            <p className="text-xs text-neutral-500">No imagery sources added yet.</p>
          ) : (
            imagery.map((src) => (
              <SourceCard
                key={src.id}
                source={src}
                campaignId={campaignId}
                onDelete={() => setDeleteConfirm({ imageryId: src.id })}
                onUpdated={onSourceUpdated}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

function SourceCard({
  source,
  campaignId,
  onDelete,
  onUpdated,
}: {
  source: ImagerySourceOut;
  campaignId: number;
  onDelete: () => void;
  onUpdated: (
    sourceId: number,
    updates: { crosshair_hex6?: string; default_zoom?: number }
  ) => void;
}) {
  const [zoom, setZoom] = useState(source.default_zoom);
  const [color, setColor] = useState(source.crosshair_hex6);
  const [saving, setSaving] = useState(false);

  const hasChanges = zoom !== source.default_zoom || color !== source.crosshair_hex6;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: { crosshair_hex6?: string; default_zoom?: number } = {};
      if (zoom !== source.default_zoom) updates.default_zoom = zoom;
      if (color !== source.crosshair_hex6) updates.crosshair_hex6 = color;

      const { authManager } = await import('~/features/auth/index');
      const token = await authManager.getIdToken();
      await patchSource(campaignId, source.id, updates, token);
      onUpdated(source.id, updates);
    } catch (e) {
      console.error('Failed to update source:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-neutral-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-neutral-900">{source.name}</h4>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-red-500 hover:text-red-700 transition-colors cursor-pointer"
        >
          Remove
        </button>
      </div>

      <div className="flex items-center gap-5 text-xs">
        <div className="flex items-center gap-1.5">
          <label className="text-neutral-500">Zoom:</label>
          <input
            type="number"
            min="1"
            max="22"
            value={zoom}
            onChange={(e) => setZoom(Math.max(1, Math.min(22, Number(e.target.value))))}
            className="w-12 border border-neutral-200 rounded px-1.5 py-0.5 text-xs text-center focus:border-brand-500 outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-neutral-500">Crosshair:</label>
          <div className="relative">
            <input
              type="color"
              value={`#${color}`}
              onChange={(e) => setColor(e.target.value.replace('#', ''))}
              className="absolute opacity-0 w-5 h-5 cursor-pointer"
              id={`color-${source.id}`}
            />
            <label
              htmlFor={`color-${source.id}`}
              className="w-5 h-5 rounded-full border-2 border-neutral-300 cursor-pointer block"
              style={{ backgroundColor: `#${color}` }}
            />
          </div>
          <span className="text-neutral-400 font-mono">#{color}</span>
        </div>
        {hasChanges && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="ml-auto px-2.5 py-1 text-xs font-medium bg-brand-500 text-white rounded hover:bg-brand-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

      {source.visualizations.length > 0 && (
        <div>
          <span className="text-[11px] font-medium text-neutral-500">Visualizations</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {source.visualizations.map((viz) => (
              <span
                key={viz.id}
                className="inline-block px-2 py-0.5 bg-neutral-100 text-neutral-600 text-[11px] rounded"
              >
                {viz.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {source.collections.length > 0 && (
        <div>
          <span className="text-[11px] font-medium text-neutral-500">
            Collections ({source.collections.length})
          </span>
          <div className="mt-1 space-y-1.5">
            {source.collections.map((col) => (
              <div
                key={col.id}
                className="text-[11px] text-neutral-600 bg-neutral-50 rounded px-2 py-1.5"
              >
                <span className="font-medium">{col.name}</span>
                <span className="ml-2 text-neutral-400">
                  {col.slices.length} slice{col.slices.length !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ImageryTab;
