import { useState } from 'react';
import type { ImageryController } from './controller';
import { SourcesTab } from './SourcesTab';
import { BasemapList } from './BasemapList';
import { CustomMapsEditor } from '~/features/customLayers/components/CustomMapsEditor';
import { VectorLayersEditor } from '~/features/customLayers/components/VectorLayersEditor';
import { SourceEditor } from './SourceEditor';

interface ImagerySetupProps {
  controller: ImageryController;
  campaignBbox?: number[] | null;
}

export const ImagerySetup = ({ controller, campaignBbox = null }: ImagerySetupProps) => {
  // Single source-editor instance shared by every entry point (Sources list and
  // the add-source wizard) so a source can be opened for editing from anywhere.
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const editingSource = editingSourceId
    ? (controller.state.sources.find((s) => s.id === editingSourceId) ?? null)
    : null;

  return (
    <div className="space-y-8">
      <SourcesTab
        controller={controller}
        campaignBbox={campaignBbox}
        onEditSource={setEditingSourceId}
      />

      <BasemapList controller={controller} />

      {controller.campaignId != null && (
        <>
          <CustomMapsEditor campaignId={controller.campaignId} projectId={controller.projectId} />
          <VectorLayersEditor campaignId={controller.campaignId} />
        </>
      )}

      {editingSource && (
        <SourceEditor
          source={editingSource}
          controller={controller}
          campaignBbox={campaignBbox}
          onClose={() => setEditingSourceId(null)}
        />
      )}
    </div>
  );
};
