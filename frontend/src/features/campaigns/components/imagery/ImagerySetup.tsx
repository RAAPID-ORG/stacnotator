import type { ImageryController } from './controller';
import { SourcesTab } from './SourcesTab';
import { ViewLayoutTab } from './ViewLayoutTab';
import { BasemapList } from './BasemapList';

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
  return (
    <div className="space-y-8">
      {(sections === 'sources-only' || sections === 'all') && (
        <SourcesTab controller={controller} campaignBbox={campaignBbox} />
      )}

      {(sections === 'view-layout-only' || sections === 'all') && (
        <ViewLayoutTab controller={controller} />
      )}

      {(sections === 'sources-only' || sections === 'all') && (
        <BasemapList controller={controller} />
      )}
    </div>
  );
};
