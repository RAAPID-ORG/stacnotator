import { useState } from 'react';
import type { ImagerySourceCreate, ImagerySourceOut, VisualizerArea } from '~/api/client';
import {
  mapSourceOutToFe,
  useDraftController,
} from '~/features/campaigns/components/imagery/controller';
import { sourceToBackend } from '~/features/campaigns/components/imagery/draftSync';
import { SourceEditor } from '~/features/campaigns/components/imagery/SourceEditor';
import { SourcesTab } from '~/features/campaigns/components/imagery/SourcesTab';
import type { ImageryStepState } from '~/features/campaigns/components/imagery/types';

/**
 * Imagery set up for this visualizer alone.
 *
 * The same wizard a campaign's imagery is set up with, on a draft controller
 * this modal owns: the sources are persisted by the visualizer's own save, not
 * by any campaign endpoint. What differs is only what happens to the result -
 * the viewer flattens every collection into one list of dates.
 */
export function OwnImagery({
  state,
  onChange,
  area,
  projectId,
}: {
  state: ImageryStepState;
  onChange: (next: ImageryStepState) => void;
  area: VisualizerArea | null;
  projectId: number;
}) {
  const bbox = area ? [area.west, area.south, area.east, area.north] : null;
  const controller = useDraftController({
    projectId,
    state,
    setState: onChange,
    campaignBbox: bbox,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? (state.sources.find((s) => s.id === editingId) ?? null) : null;

  if (!area) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-200 px-4 py-4 text-center text-xs text-neutral-500">
        Choose the area above first. Imagery is searched and registered over it.
      </p>
    );
  }

  return (
    <>
      <SourcesTab
        controller={controller}
        campaignBbox={bbox}
        onEditSource={setEditingId}
        description={null}
      />
      {editing && (
        <SourceEditor
          source={editing}
          controller={controller}
          campaignBbox={bbox}
          onClose={() => setEditingId(null)}
        />
      )}
    </>
  );
}

export const emptyImageryState = (): ImageryStepState => ({ sources: [], basemaps: [] });

/** The stored sources, back in the shape the editor works in. */
export const imageryStateFrom = (sources: ImagerySourceOut[]): ImageryStepState => ({
  sources: sources.map(mapSourceOutToFe),
  basemaps: [],
});

/** The payload the visualizer's save endpoint takes for its own imagery. */
export const ownImageryPayload = (state: ImageryStepState): ImagerySourceCreate[] =>
  state.sources.map(sourceToBackend);
