import { useMapStore } from '../stores/map.store';
import type { CustomMapOut } from '~/api/client';

export function readyCustomMaps(maps: CustomMapOut[]): CustomMapOut[] {
  return maps.filter((m) => m.status === 'ready' && !!m.tile_url);
}

export function toggleCustomMap(maps: CustomMapOut[]): void {
  const ready = readyCustomMaps(maps);
  if (ready.length === 0) return;
  const s = useMapStore.getState();
  if (s.activeCustomMapId != null && s.showCustomMap) {
    s.setShowCustomMap(false);
    return;
  }
  if (s.activeCustomMapId == null || !ready.some((m) => m.id === s.activeCustomMapId)) {
    s.setActiveCustomMapId(ready[0].id);
  }
  s.setShowCustomMap(true);
}

export function cycleCustomMap(maps: CustomMapOut[]): void {
  const ready = readyCustomMaps(maps);
  if (ready.length === 0) return;
  const s = useMapStore.getState();
  const idx = ready.findIndex((m) => m.id === s.activeCustomMapId);
  const next = ready[(idx + 1) % ready.length];
  s.setActiveCustomMapId(next.id);
  s.setShowCustomMap(true);
}
