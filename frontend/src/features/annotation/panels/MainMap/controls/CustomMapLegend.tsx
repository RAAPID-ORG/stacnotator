import { useTranslation } from 'react-i18next';
import { readyCustomMaps, type ImageryCatalog } from '../../../campaign/imagery';
import { RenderLegend } from '~/shared/imagery/RenderLegend';
import { effectiveRenderConfig, isCustomized } from '~/shared/imagery/tileColors';
import { useImageryStore } from '../../../stores/imagery';
import { usePrefsStore } from '../../../stores/prefs';

export interface CustomMapLegendProps {
  catalog: ImageryCatalog;
}

export function CustomMapLegend({ catalog }: CustomMapLegendProps) {
  const { t } = useTranslation('panels');
  const overlay = useImageryStore((s) => s.overlay);
  // Per view, like the overlay selection: switching views (U) restores the
  // opacity that view was left at.
  const opacity = useImageryStore((s) => s.overlayOpacity);
  const setOverlayOpacity = useImageryStore((s) => s.setOverlayOpacity);
  const overrides = usePrefsStore((s) => s.customMapOverrides);
  const setOverride = usePrefsStore((s) => s.setCustomMapOverride);
  const resetOverride = usePrefsStore((s) => s.resetCustomMapOverride);

  const map = readyCustomMaps([...catalog.customMaps.values()]).find((m) => m.id === overlay.id);
  if (!map || !overlay.visible) return null;

  const override = overrides[map.id];
  const config = effectiveRenderConfig(map.render_config, override);
  const customized = isCustomized(map.render_config, override);

  return (
    <div
      className="absolute bottom-2 right-2 rounded bg-white/90 p-2 text-xs text-neutral-700 shadow"
      data-testid="custom-map-legend"
      data-customized={customized}
    >
      <div className="max-h-48 overflow-y-auto pr-1">
        <RenderLegend
          config={config}
          onChange={(patch) => setOverride(map.id, { ...override, ...patch })}
        />
      </div>

      {customized && (
        <button
          type="button"
          onClick={() => resetOverride(map.id)}
          data-testid="custom-map-legend-reset"
          title={t('overlay.resetColoursTitle')}
          className="mt-1.5 cursor-pointer text-[10px] text-neutral-500 underline hover:text-neutral-800"
        >
          {t('overlay.resetColours')}
        </button>
      )}

      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(opacity * 100)}
        data-testid="custom-map-opacity"
        onChange={(e) => setOverlayOpacity(Number(e.target.value) / 100)}
        title={t('overlay.opacity')}
        className="mt-1.5 block w-28 cursor-pointer accent-brand-500"
      />
    </div>
  );
}
