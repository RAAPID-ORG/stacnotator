import { useMapStore } from '../stores/map.store';
import type { CustomMapOut } from '~/api/client';

export function CustomMapLegend({ customMaps }: { customMaps: CustomMapOut[] }) {
  const activeCustomMapId = useMapStore((s) => s.activeCustomMapId);
  const showCustomMap = useMapStore((s) => s.showCustomMap);

  const cm = customMaps.find((m) => m.id === activeCustomMapId);
  if (!cm || !showCustomMap || cm.render_config.mode !== 'categorical') return null;

  return (
    <div
      className="absolute bottom-2 right-2 rounded bg-white/90 p-2 text-xs shadow"
      data-testid="custom-map-legend"
    >
      {(cm.render_config.entries ?? []).map((e) => (
        <div key={e.value} className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: e.color }} />
          <span>{e.label ?? String(e.value)}</span>
        </div>
      ))}
    </div>
  );
}
