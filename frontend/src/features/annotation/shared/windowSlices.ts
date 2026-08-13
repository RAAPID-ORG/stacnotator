import { useSyncExternalStore } from 'react';

const windowSliceOverrides = new Map<number, number>();
const userPickedSlices = new Map<number, number>();
const listeners = new Set<() => void>();
let revision = 0;

function notify(): void {
  revision++;
  for (const listener of listeners) listener();
}

export function getWindowSlice(collectionId: number): number | undefined {
  return windowSliceOverrides.get(collectionId);
}

export function getUserPickedSlice(collectionId: number): number | undefined {
  return userPickedSlices.get(collectionId);
}

export function rememberWindowSlice(
  collectionId: number,
  sliceIndex: number,
  byUser = false
): void {
  windowSliceOverrides.set(collectionId, sliceIndex);
  if (byUser) userPickedSlices.set(collectionId, sliceIndex);
  notify();
}

/** These values belong to one loaded campaign; collection ids may be reused. */
export function resetWindowSlices(): void {
  windowSliceOverrides.clear();
  userPickedSlices.clear();
  notify();
}

export function useWindowSlice(collectionId: number): number | undefined {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => getWindowSlice(collectionId)
  );
}

/** Re-renders consumers that need the complete visible-window selection set,
 * such as task preloading. The numeric snapshot is stable between changes. */
export function useWindowSlicesRevision(): number {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => revision
  );
}
