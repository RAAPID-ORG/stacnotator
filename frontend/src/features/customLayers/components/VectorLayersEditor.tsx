import { useCallback, useEffect, useState } from 'react';
import { Input, Button, IconButton } from '~/shared/ui/forms';
import { IconTrash } from '~/shared/ui/Icons';
import { handleError } from '~/shared/utils/errorHandler';
import {
  listVectorLayers,
  createVectorLayer,
  deleteVectorLayer,
  type VectorLayerOut,
} from '~/api/client';

interface FormState {
  name: string;
  pmtiles_url: string;
  source_layer: string;
  color: string;
}

const defaultForm = (): FormState => ({
  name: '',
  pmtiles_url: '',
  source_layer: '',
  color: '#3b82f6',
});

interface VectorLayersEditorProps {
  campaignId: number;
}

export const VectorLayersEditor = ({ campaignId }: VectorLayersEditorProps) => {
  const [layers, setLayers] = useState<VectorLayerOut[]>([]);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const fetchLayers = useCallback(async () => {
    const { data, error } = await listVectorLayers({ path: { campaign_id: campaignId } });
    if (error) {
      handleError(error, 'Failed to load vector layers', { showUser: false });
      return;
    }
    if (data) setLayers(data);
  }, [campaignId]);

  useEffect(() => {
    fetchLayers();
  }, [fetchLayers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await createVectorLayer({
        path: { campaign_id: campaignId },
        body: {
          name: form.name,
          pmtiles_url: form.pmtiles_url,
          source_layer: form.source_layer.trim() || null,
          color: form.color,
        },
      });
      if (error) {
        handleError(error, 'Failed to add vector layer');
        return;
      }
      setForm(defaultForm());
      setShowForm(false);
      await fetchLayers();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (layerId: number) => {
    const { error } = await deleteVectorLayer({
      path: { campaign_id: campaignId, layer_id: layerId },
    });
    if (error) {
      handleError(error, 'Failed to delete vector layer');
      return;
    }
    setLayers((prev) => prev.filter((l) => l.id !== layerId));
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Vector layers</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            PMTiles vector overlays shown in the open-mode annotation view. Toggle them on/off,
            hover to highlight, and use the Label vector tool to label features by clicking.
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
          >
            + Add layer
          </button>
        )}
      </div>

      {layers.length === 0 && !showForm ? (
        <p className="text-xs text-neutral-400 italic">No vector layers configured.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
          {layers.map((l) => (
            <li
              key={l.id}
              data-testid="vector-layer-row"
              className="py-2.5 flex items-center gap-3"
            >
              <span
                className="w-3.5 h-3.5 rounded-sm flex-shrink-0 border border-black/10"
                style={{ backgroundColor: l.color }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-900 truncate">
                  {l.name}
                  {l.source_layer ? (
                    <span className="ml-1.5 text-xs font-normal text-neutral-400">
                      · {l.source_layer}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-neutral-500 truncate font-mono">{l.pmtiles_url}</p>
              </div>
              <IconButton
                tone="danger"
                onClick={() => handleDelete(l.id)}
                aria-label="Delete vector layer"
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
                placeholder="Field predictions"
                required
                data-testid="vector-layer-name"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Source layer <span className="text-neutral-400">(optional)</span>
              </label>
              <Input
                size="sm"
                type="text"
                value={form.source_layer}
                onChange={(e) => setForm((f) => ({ ...f, source_layer: e.target.value }))}
                placeholder="All layers"
                data-testid="vector-layer-source-layer"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">PMTiles URL</label>
            <Input
              size="sm"
              type="text"
              value={form.pmtiles_url}
              onChange={(e) => setForm((f) => ({ ...f, pmtiles_url: e.target.value }))}
              placeholder="https://example.com/predictions.pmtiles"
              required
              data-testid="vector-layer-url"
              className="font-mono text-[11px]"
            />
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-neutral-500 leading-snug list-disc list-inside">
              <li>
                Must be a{' '}
                <strong className="font-medium text-neutral-600">PMTiles vector archive</strong>{' '}
                (`.pmtiles`) — read directly by the browser, no tiler required.
              </li>
              <li>Reachable over HTTPS — a public URL, or one that includes a SAS token.</li>
              <li>
                Set a source layer to render just one layer inside the archive; leave blank for all.
              </li>
            </ul>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">Colour</label>
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
              className="h-8 w-12 rounded border border-neutral-300 cursor-pointer p-0.5 bg-white"
              title="Layer colour"
              data-testid="vector-layer-color"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" size="sm" disabled={submitting} data-testid="add-vector-layer">
              {submitting ? 'Adding…' : 'Add layer'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setShowForm(false);
                setForm(defaultForm());
              }}
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
