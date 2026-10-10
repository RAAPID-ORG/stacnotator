import { useState } from 'react';
import type { ImageryController } from './controller';
import { SourcesTab } from './SourcesTab';
import { BasemapList } from './BasemapList';
import { CustomMapsEditor } from '../CustomMapsEditor';
import { VectorLayersEditor } from '../VectorLayersEditor';
import { SourceEditor } from './SourceEditor';

interface ImagerySetupProps {
  controller: ImageryController;
}

export const ImagerySetup = ({ controller }: ImagerySetupProps) => {
  // Single source-editor instance shared by every entry point (Sources list and
  // the add-source wizard) so a source can be opened for editing from anywhere.
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const editingSource = editingSourceId
    ? (controller.state.sources.find((s) => s.id === editingSourceId) ?? null)
    : null;

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3">
          <h3 className="section-heading">Satellite Imagery</h3>
          <p className="section-description">
            Imagery is at the core of your campaign. Setup and configure imagery sources here. Each
            source source represents a remote sensing dataset (e.g. Sentinel-2, Landsat, NAIP) with
            collections covering specific time periods.
          </p>
        </div>
        <SourcesTab controller={controller} onEditSource={setEditingSourceId} />
      </section>

      <BasemapList controller={controller} />

      <section>
        <div className="mb-4">
          <h3 className="section-heading">Overlays</h3>
          <p className="section-description">
            Layers drawn on top of the imagery in the annotation view - raster maps (COG, e.g. model
            predictions) and vector layers (PMTiles).
          </p>
        </div>
        {controller.campaignId != null ? (
          <div className="space-y-6">
            <CustomMapsEditor
              ownerKind="campaign"
              ownerId={controller.campaignId}
              projectId={controller.projectId}
            />
            <VectorLayersEditor ownerKind="campaign" ownerId={controller.campaignId} />
          </div>
        ) : (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-4">
            <p className="text-xs text-neutral-600">
              Overlays are available after campaign creation. Add them from the campaign's imagery
              settings.
            </p>
            {[
              ['Raster layers (COG)', '+ Add raster layer'],
              ['Vector layers (PMTiles)', '+ Add vector layer'],
            ].map(([label, action]) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  {label}
                </h4>
                <button
                  type="button"
                  disabled
                  className="text-xs text-neutral-400 cursor-not-allowed"
                >
                  {action}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {editingSource && (
        <SourceEditor
          source={editingSource}
          controller={controller}
          onClose={() => setEditingSourceId(null)}
        />
      )}
    </div>
  );
};
