import { useState } from 'react';
import type { VisualizerArea, VisualizerOptionsOut } from '~/api/client';
import { BoundingBoxEditor } from '~/features/campaigns/components/BoundingBoxEditor';
import { LocationSearch } from '~/shared/map/LocationSearch';
import { Button } from '~/shared/ui/forms';

/**
 * The area a visualizer is about.
 *
 * It is not decoration: the map opens framed on it, the viewer is told to zoom
 * back to it when it wanders off, and any imagery set up here is searched over
 * it. So this asks for one before imagery rather than after.
 */
export function AreaField({
  value,
  onChange,
  options,
}: {
  value: VisualizerArea | null;
  onChange: (area: VisualizerArea | null) => void;
  options: VisualizerOptionsOut;
}) {
  const [searchExpanded, setSearchExpanded] = useState(true);

  const campaignAreas = options.campaigns.filter((campaign) => campaign.area !== null);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <LocationSearch
          expanded={searchExpanded}
          onExpandedChange={(next) => setSearchExpanded(next || true)}
          onSelect={(result) => {
            const [west, south, east, north] = result.extent ?? [
              result.center[0] - 0.5,
              result.center[1] - 0.5,
              result.center[0] + 0.5,
              result.center[1] + 0.5,
            ];
            onChange({ west, south, east, north });
          }}
          className="max-w-64"
        />
        {value && (
          <Button variant="quiet" size="sm" onClick={() => onChange(null)}>
            Clear
          </Button>
        )}
      </div>

      {campaignAreas.length > 0 && !value && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
          <span>or take it from</span>
          {campaignAreas.map((campaign) => (
            <button
              key={campaign.campaign_id}
              type="button"
              onClick={() => onChange(campaign.area)}
              className="cursor-pointer rounded-full border border-neutral-200 px-2 py-0.5 text-neutral-700 transition-colors hover:border-brand-400 hover:text-brand-700"
            >
              {campaign.campaign_name}
            </button>
          ))}
        </div>
      )}

      {value ? (
        <BoundingBoxEditor
          heading={null}
          showCountrySearch={false}
          value={{
            bbox_west: value.west,
            bbox_south: value.south,
            bbox_east: value.east,
            bbox_north: value.north,
          }}
          onChange={(updates) =>
            onChange({
              west: updates.bbox_west ?? value.west,
              south: updates.bbox_south ?? value.south,
              east: updates.bbox_east ?? value.east,
              north: updates.bbox_north ?? value.north,
            })
          }
        />
      ) : (
        <p className="rounded-lg border border-dashed border-neutral-200 px-4 py-4 text-center text-xs text-neutral-500">
          Search for a place to set the area. Without one the map opens on the whole world, and
          imagery cannot be set up here.
        </p>
      )}
    </div>
  );
}
