import type { ImagerySourceOut, ImageryViewOut, BasemapOut } from '~/api/client';
import { ImagerySetup } from '~/features/campaigns/components/imagery/ImagerySetup';
import { usePersistedController } from '~/features/campaigns/components/imagery/controller';

interface Props {
  imagery: ImagerySourceOut[];
  views: ImageryViewOut[];
  basemaps?: BasemapOut[];
  campaignId: number;
  campaignBbox?: number[] | null;
  /** Called after any successful mutation so the parent can refetch the campaign. */
  onChanged?: () => void;
  // Legacy props (still passed by CampaignSettingsPage). Unused by the new
  // controller-based implementation — kept here so the old call site still
  // compiles while the refactor lands.
  setDeleteConfirm?: (v: { imageryId?: number } | null) => void;
  onSourceUpdated?: (
    sourceId: number,
    updates: { name?: string; crosshair_hex6?: string; default_zoom?: number }
  ) => void;
  onCollectionVizUpdated?: () => void;
}

const ImageryTab = ({
  imagery,
  views,
  basemaps,
  campaignId,
  campaignBbox,
  onChanged,
  onCollectionVizUpdated,
}: Props) => {
  const controller = usePersistedController({
    campaignId,
    imagery,
    views,
    basemaps,
    campaignBbox: campaignBbox ?? null,
    refetch: onChanged ?? onCollectionVizUpdated,
  });
  return (
    <div id="tab-imagery" role="tabpanel">
      <ImagerySetup controller={controller} campaignBbox={campaignBbox ?? null} />
    </div>
  );
};

export default ImageryTab;
