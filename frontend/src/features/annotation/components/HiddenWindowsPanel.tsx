import { useMemo, useState } from 'react';
import { useCampaignStore } from '../stores/campaign.store';

/** Edit-mode-only panel listing collections eligible for the active view
 *  (`show_as_window=true`) but absent from the user's current layout. Defaults
 *  to a small chip so it doesn't overlap canvas content; expands on click. */
export const HiddenWindowsPanel = () => {
  const campaign = useCampaignStore((s) => s.campaign);
  const selectedViewId = useCampaignStore((s) => s.selectedViewId);
  const isEditingLayout = useCampaignStore((s) => s.isEditingLayout);
  const currentLayout = useCampaignStore((s) => s.currentLayout);
  const addWindow = useCampaignStore((s) => s.addWindow);

  const [expanded, setExpanded] = useState(true);

  const view = campaign?.imagery_views.find((v) => v.id === selectedViewId) ?? null;

  const hidden = useMemo(() => {
    if (!campaign || !view) return [];
    const layoutKeys = new Set((currentLayout ?? []).map((it) => it.i));
    return view.collection_refs
      .filter((ref) => ref.show_as_window)
      .filter((ref) => !layoutKeys.has(String(ref.collection_id)))
      .map((ref) => {
        const source = campaign.imagery_sources.find((s) => s.id === ref.source_id);
        const collection = source?.collections.find((c) => c.id === ref.collection_id);
        return source && collection ? { source, collection } : null;
      })
      .filter(
        (
          x
        ): x is {
          source: NonNullable<typeof x>['source'];
          collection: NonNullable<typeof x>['collection'];
        } => x !== null
      );
  }, [campaign, view, currentLayout]);

  if (!isEditingLayout) return null;

  // Collapsed chip — always rendered so the count stays visible. Auto-collapse
  // when there's nothing hidden so the user isn't nagged by an empty panel.
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="absolute bottom-3 right-3 z-[1002] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-neutral-300 bg-white shadow-sm text-xs text-neutral-700 hover:bg-neutral-50"
        title="Show hidden windows"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </svg>
        <span className="font-medium">Hidden</span>
        <span className="text-neutral-500">({hidden.length})</span>
      </button>
    );
  }

  return (
    <div className="absolute bottom-3 right-3 z-[1002] w-72 max-h-64 flex flex-col rounded-lg border border-neutral-200 bg-white shadow-lg">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-neutral-100">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Hidden windows ({hidden.length})
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-neutral-400 hover:text-neutral-700 text-sm leading-none px-1"
          aria-label="Collapse hidden windows panel"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {hidden.length === 0 ? (
          <p className="text-xs text-neutral-500 px-1 py-1">
            All eligible collections are visible. Click the eye icon on a window header to hide it.
          </p>
        ) : (
          <ul className="space-y-1">
            {hidden.map(({ source, collection }) => (
              <li
                key={collection.id}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-neutral-50"
              >
                <span
                  className="text-xs text-neutral-700 truncate"
                  title={`${source.name} - ${collection.name}`}
                >
                  <span className="text-neutral-400">{source.name}</span>
                  <span className="mx-1 text-neutral-400">›</span>
                  {collection.name}
                </span>
                <button
                  type="button"
                  onClick={() => addWindow(collection.id)}
                  className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded border border-brand-300 text-brand-700 hover:bg-brand-50"
                  aria-label={`Add ${collection.name} back to layout`}
                >
                  + Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
