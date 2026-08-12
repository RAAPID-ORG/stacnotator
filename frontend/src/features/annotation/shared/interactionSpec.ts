import { create } from 'zustand';
import type { InteractionSpec, LonLat, MapClickEvent } from '~/features/annotation/engine/map';

export interface InteractionSpecState {
  spec: InteractionSpec | undefined;
  onMapClick: ((e: MapClickEvent) => void) | undefined;
  /** Where the timeseries tool last probed, drawn as the probe marker. */
  probePoint: LonLat | null;
  /** The timeseries legend has hidden every series drawn for the probe point,
   *  so the on-map marker for it is meaningless and comes off too. Published
   *  by the timeseries feature,
   *  read by the map - hence shared, not either feature's own. */
  probeMarkerHidden: boolean;
}

const EMPTY_INTERACTIONS: InteractionSpecState = {
  spec: undefined,
  onMapClick: undefined,
  probePoint: null,
  probeMarkerHidden: false,
};

export const useInteractionSpec = create<InteractionSpecState>(() => ({ ...EMPTY_INTERACTIONS }));

export function setInteractions(
  spec: InteractionSpec | undefined,
  onMapClick: ((e: MapClickEvent) => void) | undefined
): void {
  useInteractionSpec.setState({ spec, onMapClick });
}

export function setProbePoint(point: LonLat | null): void {
  useInteractionSpec.setState({ probePoint: point });
}

export function setProbeMarkerHidden(probeMarkerHidden: boolean): void {
  useInteractionSpec.setState({ probeMarkerHidden });
}

/** Test/teardown seam, mirrors toolState's resetToolState: a probe point is a
 *  place in one campaign, and carrying it into the next one puts a marker on
 *  the new map where nobody clicked. */
export function resetInteractionSpec(): void {
  useInteractionSpec.setState({ ...EMPTY_INTERACTIONS });
}
