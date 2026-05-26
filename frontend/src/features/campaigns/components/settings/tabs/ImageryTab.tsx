import type { ImagerySourceOut, ImageryViewOut, BasemapOut } from '~/api/client';
import { ImagerySetup } from '~/features/campaigns/components/imagery/ImagerySetup';
import { usePersistedController } from '~/features/campaigns/components/imagery/controller';

interface Props {
  imagery: ImagerySourceOut[];
  views: ImageryViewOut[];
  basemaps?: BasemapOut[];
  campaignId: number;
  campaignBbox?: number[] | null;
  /** Called after a successful save so the parent can refetch the campaign. */
  onChanged?: () => void;
}

const ImageryTab = ({ imagery, views, basemaps, campaignId, campaignBbox, onChanged }: Props) => {
  const controller = usePersistedController({
    campaignId,
    imagery,
    views,
    basemaps,
    campaignBbox: campaignBbox ?? null,
    refetch: onChanged,
  });

  const { isDirty, pending, save, discard } = controller;

  return (
    <div id="tab-imagery" role="tabpanel">
      <ImagerySetup controller={controller} campaignBbox={campaignBbox ?? null} />

      {isDirty && (
        <div className="sticky bottom-0 left-0 right-0 mt-6 -mx-4 px-4 py-3 bg-white border-t border-amber-300 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] flex items-center justify-between gap-4 z-20">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-neutral-700 font-medium">Unsaved imagery changes</span>
            <span className="text-neutral-500">— your edits are local until you save.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={discard}
              disabled={pending}
              className="px-3 py-1.5 text-sm rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => {
                save().catch(() => {
                  /* error already surfaced via handleError */
                });
              }}
              disabled={pending}
              className="px-4 py-1.5 text-sm rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageryTab;
