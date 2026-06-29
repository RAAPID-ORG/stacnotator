import { useState } from 'react';
import type { ImageryController } from './controller';
import { SourcesTab } from './SourcesTab';
import { ViewLayoutTab } from './ViewLayoutTab';
import { BasemapList } from './BasemapList';
import { CustomMapsEditor } from './CustomMapsEditor';
import { SourceEditor } from './SourceEditor';

export type ImagerySetupSections = 'sources-only' | 'view-layout-only' | 'all';

interface ImagerySetupProps {
  controller: ImageryController;
  campaignBbox?: number[] | null;
  /** Which sections to render. Defaults to 'all' (stacked) for settings/edit. */
  sections?: ImagerySetupSections;
}

export const ImagerySetup = ({
  controller,
  campaignBbox = null,
  sections = 'all',
}: ImagerySetupProps) => {
  // Single source-editor instance shared by every entry point (Sources list,
  // the View Layout preview, and the add-source wizard) so a source can be
  // opened for editing from anywhere.
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const editingSource = editingSourceId
    ? (controller.state.sources.find((s) => s.id === editingSourceId) ?? null)
    : null;

  return (
    <div className="space-y-8">
      {(sections === 'sources-only' || sections === 'all') && (
        <SourcesTab
          controller={controller}
          campaignBbox={campaignBbox}
          onEditSource={setEditingSourceId}
        />
      )}

      {(sections === 'view-layout-only' || sections === 'all') && (
        <ViewLayoutTab
          controller={controller}
          campaignBbox={campaignBbox}
          onEditSource={setEditingSourceId}
        />
      )}

      {(sections === 'sources-only' || sections === 'all') && (
        <BasemapList controller={controller} />
      )}

      {(sections === 'sources-only' || sections === 'all') && controller.campaignId != null && (
        <CustomMapsEditor campaignId={controller.campaignId} />
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
