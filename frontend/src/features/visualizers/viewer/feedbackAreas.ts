import type { VisualizerFeedbackOut } from '~/api/client';
import type { Bbox, FeatureLayerSpec } from '~/shared/map/types';
import type { BadgeTone } from '~/shared/ui/Badge';

const AREAS_LAYER_ID = 'feedback-areas';
const AREAS_Z = 20;

/** Green, red or neutral: the verdict is what a reviewer scans for, so it is
 *  what both the badge and the box on the map are coloured by. */
export const VERDICT: Record<string, { tone: BadgeTone; label: string; color: string }> = {
  good: { tone: 'green', label: 'Looks good', color: '#16a34a' },
  wrong: { tone: 'red', label: 'Looks wrong', color: '#dc2626' },
};

const NEUTRAL = '#525252';

const colorOf = (entry: VisualizerFeedbackOut) =>
  (entry.verdict ? VERDICT[entry.verdict]?.color : null) ?? NEUTRAL;

export const feedbackBounds = (entry: VisualizerFeedbackOut): Bbox => [
  entry.area.west,
  entry.area.south,
  entry.area.east,
  entry.area.north,
];

const ring = ([west, south, east, north]: Bbox): GeoJSON.Position[] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];

/** Every remark at once, over the imagery it is about. Drawn above the
 *  overlays: a reviewer is looking for the boxes, not through them. */
export function feedbackAreasLayer(
  items: VisualizerFeedbackOut[],
  selectedId: number | null
): FeatureLayerSpec {
  return {
    kind: 'features',
    id: AREAS_LAYER_ID,
    features: items.map((entry) => ({
      id: entry.id,
      geometry: { type: 'Polygon', coordinates: [ring(feedbackBounds(entry))] },
      properties: { color: colorOf(entry), selected: entry.id === selectedId },
    })),
    style: (f) => {
      const color = String(f.properties?.color ?? NEUTRAL);
      const selected = Boolean(f.properties?.selected);
      return {
        stroke: { color, width: selected ? 3 : 1.5 },
        fill: { color: `${color}${selected ? '40' : '14'}` },
      };
    },
    zIndex: AREAS_Z,
  };
}
