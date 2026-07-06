import { useMapStore } from '../stores/map.store';
import type { CustomMapOut } from '~/api/client';
import { gradientFor, formatTick } from '../utils/customMapColormaps';

function LegendBody({ cm }: { cm: CustomMapOut }) {
  if (cm.render_config.mode === 'continuous') {
    const { rescale, colormap_name } = cm.render_config;
    if (!colormap_name || !rescale || !isFinite(rescale[0]) || !isFinite(rescale[1])) return null;

    const [min, max] = rescale;
    const mid = (min + max) / 2;

    return (
      <>
        <div className="h-2.5 w-28 rounded-sm" style={{ background: gradientFor(colormap_name) }} />
        <div className="mt-0.5 flex justify-between w-28">
          <span>{formatTick(min)}</span>
          <span>{formatTick(mid)}</span>
          <span>{formatTick(max)}</span>
        </div>
      </>
    );
  }

  return (
    <>
      {(cm.render_config.entries ?? []).map((e) => (
        <div key={e.value} className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: e.color }} />
          <span>{e.label ?? String(e.value)}</span>
        </div>
      ))}
    </>
  );
}

export function CustomMapLegend({ customMaps }: { customMaps: CustomMapOut[] }) {
  const activeCustomMapId = useMapStore((s) => s.activeCustomMapId);
  const showCustomMap = useMapStore((s) => s.showCustomMap);
  const customMapOpacity = useMapStore((s) => s.customMapOpacity);
  const setCustomMapOpacity = useMapStore((s) => s.setCustomMapOpacity);

  const cm = customMaps.find((m) => m.id === activeCustomMapId && m.status === 'ready');
  if (!cm || !showCustomMap) return null;

  return (
    <div
      className="absolute bottom-2 right-2 rounded bg-white/90 p-2 text-xs shadow"
      data-testid="custom-map-legend"
    >
      <div className="max-h-48 overflow-y-auto pr-1">
        <LegendBody cm={cm} />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={customMapOpacity}
        data-testid="custom-map-opacity"
        onChange={(e) => setCustomMapOpacity(Number(e.target.value))}
        title="Overlay opacity"
        className="mt-1.5 block w-28 accent-brand-500 cursor-pointer"
      />
    </div>
  );
}
