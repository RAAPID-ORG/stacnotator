import { ImagerySetup } from '~/features/campaigns/components/imagery/ImagerySetup';
import type { ImageryController } from '~/features/campaigns/components/imagery/controller';

interface Props {
  /** Persisted imagery controller, owned by the page so the header action can
   *  reflect the dirty/save state. */
  controller: ImageryController;
  campaignBbox?: number[] | null;
}

const ImageryTab = ({ controller, campaignBbox }: Props) => {
  const { isDirty, pending, save, discard } = controller;

  return (
    <div id="tab-imagery" role="tabpanel">
      <ImagerySetup controller={controller} campaignBbox={campaignBbox ?? null} />

      {isDirty && (
        <div className="sticky bottom-0 left-0 right-0 mt-6 -mx-4 px-4 py-3 bg-white border-t border-amber-300 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] flex items-center justify-between gap-4 z-20">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-neutral-700 font-medium">Unsaved imagery changes</span>
            <span className="text-neutral-500">- your edits are local until you save.</span>
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
