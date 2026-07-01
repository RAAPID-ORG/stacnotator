import { isItemSortOption, type ItemSortOption } from './types';
import { Select } from '~/shared/ui/forms';
import { Tooltip } from '~/shared/ui/Tooltip';
import { StacQueryEditor } from './StacQueryEditor';

interface CoverSearchParamsProps {
  hasCloudCover: boolean;
  maxCloudCover: number;
  onMaxCloudCoverChange: (v: number) => void;
  itemSort: ItemSortOption;
  onItemSortChange: (v: ItemSortOption) => void;
  searchQuery: Record<string, unknown> | null;
  onSearchQueryChange: (q: Record<string, unknown> | null) => void;
  autoQuery: Record<string, unknown> | null;
  queryLabel?: string;
}

export const CoverSearchParams = ({
  hasCloudCover,
  maxCloudCover,
  onMaxCloudCoverChange,
  itemSort,
  onItemSortChange,
  searchQuery,
  onSearchQueryChange,
  autoQuery,
  queryLabel = 'Cover slice search query',
}: CoverSearchParamsProps) => {
  return (
    <div className="space-y-2">
      <h5 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wider">
        Search parameters
      </h5>
      {hasCloudCover && (
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 font-medium">Max cloud cover (%)</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              value={maxCloudCover}
              onChange={(e) => onMaxCloudCoverChange(Number(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs text-neutral-600 w-8 text-right">{maxCloudCover}%</span>
          </div>
        </div>
      )}
      <div className="space-y-1">
        <label className="text-xs text-neutral-700 font-medium flex items-center gap-1">
          Item sort order
          <Tooltip text="Controls the order in which STAC items are returned for the cover slice." />
        </label>
        <Select
          size="sm"
          value={itemSort}
          onChange={(e) => {
            if (isItemSortOption(e.target.value)) onItemSortChange(e.target.value);
          }}
        >
          <option value="date_desc">Date (newest first)</option>
          <option value="date_asc">Date (oldest first)</option>
          {hasCloudCover && <option value="cloud_cover_asc">Cloud cover (lowest first)</option>}
        </Select>
      </div>
      {autoQuery && (
        <StacQueryEditor
          value={searchQuery}
          onChange={onSearchQueryChange}
          autoQuery={autoQuery}
          label={queryLabel}
        />
      )}
    </div>
  );
};
