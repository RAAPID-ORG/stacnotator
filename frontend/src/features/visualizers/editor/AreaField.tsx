import type { VisualizerArea, VisualizerOptionsOut } from '~/api/client';
import { BoundingBoxEditor } from '~/features/campaigns/components/BoundingBoxEditor';
import { LocationSearch } from '~/shared/map/LocationSearch';
import { Button, Select } from '~/shared/ui/forms';

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
  const campaignAreas = options.campaigns.filter((campaign) => campaign.area !== null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <LocationSearch
          variant="field"
          className="min-w-0 flex-1"
          onSelect={(result) => {
            const [west, south, east, north] = result.extent ?? [
              result.center[0] - 0.5,
              result.center[1] - 0.5,
              result.center[0] + 0.5,
              result.center[1] + 0.5,
            ];
            onChange({ west, south, east, north });
          }}
        />

        {campaignAreas.length > 0 && (
          <Select
            size="sm"
            aria-label="Take the area from a campaign"
            className="!w-44 shrink-0"
            value=""
            onChange={(e) => {
              const picked = campaignAreas.find((c) => String(c.campaign_id) === e.target.value);
              if (picked) onChange(picked.area);
            }}
          >
            <option value="">From a campaign…</option>
            {campaignAreas.map((campaign) => (
              <option key={campaign.campaign_id} value={campaign.campaign_id}>
                {campaign.campaign_name}
              </option>
            ))}
          </Select>
        )}

        {value && (
          <Button variant="secondary" size="sm" onClick={() => onChange(null)}>
            Clear
          </Button>
        )}
      </div>

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
          Without an area the map opens on the whole world, and imagery cannot be set up here.
        </p>
      )}
    </div>
  );
}
