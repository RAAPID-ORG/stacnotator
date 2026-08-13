import { useSyncExternalStore } from 'react';

const loadingMaps = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Track foreground map traffic by stable map id. Repeated OL events are
 * idempotent, and unmount callers clear their id so a vanished panel cannot
 * leave speculative loading paused forever. */
export function setForegroundMapLoading(mapId: string, loading: boolean): void {
  const had = loadingMaps.has(mapId);
  if (loading === had) return;
  if (loading) loadingMaps.add(mapId);
  else loadingMaps.delete(mapId);
  emit();
}

export function isForegroundLoading(): boolean {
  return loadingMaps.size > 0;
}

export function useForegroundLoading(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    isForegroundLoading,
    isForegroundLoading
  );
}

export function resetForegroundLoads(): void {
  if (loadingMaps.size === 0) return;
  loadingMaps.clear();
  emit();
}
