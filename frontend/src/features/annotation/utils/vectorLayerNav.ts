import { useMapStore } from '../stores/map.store';
import type { VectorLayerOut } from '~/api/client';

export function toggleVectorLayer(layers: VectorLayerOut[]): void {
  if (layers.length === 0) return;
  const s = useMapStore.getState();
  if (s.activeVectorLayerId != null && s.showVectorLayer) {
    s.setShowVectorLayer(false);
    return;
  }
  if (s.activeVectorLayerId == null || !layers.some((l) => l.id === s.activeVectorLayerId)) {
    s.setActiveVectorLayerId(layers[0].id);
  }
  s.setShowVectorLayer(true);
}

export function cycleVectorLayer(layers: VectorLayerOut[]): void {
  if (layers.length === 0) return;
  const s = useMapStore.getState();
  const idx = layers.findIndex((l) => l.id === s.activeVectorLayerId);
  const next = layers[(idx + 1) % layers.length];
  s.setActiveVectorLayerId(next.id);
  s.setShowVectorLayer(true);
}
