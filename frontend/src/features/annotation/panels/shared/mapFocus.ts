import { useSyncExternalStore } from 'react';
import type { GeoFeature, LonLat } from '~/features/annotation/engine/map';

export interface MapFocus {
  /** Where recenter puts the map, and where the crosshair is drawn. */
  center: LonLat;
  /** Task footprint / sample extent, in EPSG:4326. */
  extent?: GeoFeature | null;
  /** The active imagery source's crosshair colour, '#rrggbb'. */
  crosshairColor?: string | null;
  /** The next few centres the focus is expected to move to (tasks mode: the
   *  upcoming tasks). Nothing draws these - they exist so panels that fetch
   *  per-point data, i.e. the timeseries charts, can warm their cache without
   *  reaching into the task list, which is another feature's state. */
  upcoming?: LonLat[];
}

let focus: MapFocus | null = null;
const listeners = new Set<() => void>();

function samePoints(a: LonLat[] | undefined, b: LonLat[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
}

function sameFocus(a: MapFocus | null, b: MapFocus | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.center[0] === b.center[0] &&
    a.center[1] === b.center[1] &&
    a.extent === b.extent &&
    a.crosshairColor === b.crosshairColor &&
    samePoints(a.upcoming, b.upcoming)
  );
}

/** Callers rebuild the focus object every render; comparing by value keeps
 *  that from re-rendering every map and restarting preloading. */
export function setMapFocus(next: MapFocus | null): void {
  if (sameFocus(next, focus)) return;
  focus = next;
  for (const listener of listeners) listener();
}

export function getMapFocus(): MapFocus | null {
  return focus;
}

export function useMapFocus(): MapFocus | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getMapFocus,
    getMapFocus
  );
}
