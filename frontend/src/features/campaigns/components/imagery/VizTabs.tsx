import type { NamedVizParams, VizParams } from './types';
import { emptyVizParams } from './types';
import type { StacAssetInfo } from '~/api/stacBrowser';
import { IconPlus, IconTrash } from '~/shared/ui/Icons';
import { Input } from '~/shared/ui/forms';
import { VizConfigPanel } from './VizConfigPanel';

interface VizTabsProps {
  visualizations: NamedVizParams[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  collectionId: string;
  availableAssets: Record<string, StacAssetInfo>;
  showCompositing: boolean;
  onParamsChange: (index: number, params: VizParams) => void;
  /** When provided, a "Visualization Name" input is shown and tab names are editable. */
  onNameChange?: (index: number, name: string) => void;
  /** When provided, a "+" tab adds a new visualization. */
  onAdd?: () => void;
  /** When provided (and more than one viz), per-tab trash buttons remove a visualization. */
  onRemove?: (index: number) => void;
}

export const VizTabs = ({
  visualizations,
  activeIndex,
  onActiveIndexChange,
  collectionId,
  availableAssets,
  showCompositing,
  onParamsChange,
  onNameChange,
  onAdd,
  onRemove,
}: VizTabsProps) => {
  if (visualizations.length === 0) return null;
  const active = Math.min(activeIndex, visualizations.length - 1);

  return (
    <div className="rounded-lg border border-neutral-200 overflow-hidden">
      <div className="flex items-center bg-neutral-50 border-b border-neutral-200 px-2 pt-2 gap-1">
        {visualizations.map((viz, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onActiveIndexChange(i)}
            className={`text-xs px-3 py-1.5 rounded-t-md transition-colors cursor-pointer flex items-center gap-1.5 ${
              i === active
                ? 'bg-white border border-neutral-200 border-b-white -mb-px text-brand-700 font-medium'
                : 'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            {viz.name || `Viz ${i + 1}`}
            {onRemove && visualizations.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(i);
                }}
                className="text-neutral-400 hover:text-red-500"
              >
                <IconTrash className="w-2.5 h-2.5" />
              </button>
            )}
          </button>
        ))}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="text-xs text-neutral-400 hover:text-brand-700 transition-colors cursor-pointer px-2 py-1.5 flex items-center gap-0.5"
            title="Add visualization"
          >
            <IconPlus className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="p-3 space-y-3 bg-white">
        {onNameChange && (
          <div className="space-y-1">
            <label className="text-xs text-neutral-700">Visualization Name</label>
            <Input
              type="text"
              size="sm"
              value={visualizations[active]?.name || ''}
              onChange={(e) => onNameChange(active, e.target.value)}
              placeholder="e.g. True Color"
            />
          </div>
        )}
        <VizConfigPanel
          collectionId={collectionId}
          availableAssets={availableAssets}
          vizParams={visualizations[active]?.vizParams || emptyVizParams()}
          onChange={(params) => onParamsChange(active, params)}
          showCompositing={showCompositing}
        />
      </div>
    </div>
  );
};
