import type { VisualizerViewOut } from '~/api/client';
import type { Camera } from '~/shared/map/Camera';
import type { GeocodingResult } from '~/shared/map/geocoding';
import { LocationSearch } from '~/shared/map/LocationSearch';
import { Minimap } from '~/shared/map/minimap/Minimap';
import type { Bbox } from '~/shared/map/types';
import { RenderLegend } from '~/shared/imagery/RenderLegend';
import { effectiveRenderConfig, isCustomized } from '~/shared/imagery/tileColors';
import { IconChevronDoubleRight, IconExternalLink, IconSliders } from '~/shared/ui/Icons';
import { Select } from '~/shared/ui/forms';
import { pillCls } from '~/shared/ui/pill';
import { selectSource, type ViewerState } from '../viewerState';

/**
 * Everything the map is showing, as a list you can reach into: which imagery,
 * rendered how, and what sits on top of it.
 */
export function ViewerSidebar({
  view,
  state,
  onChange,
  onCollapse,
  onGoTo,
  camera,
  overview,
  area,
}: {
  view: VisualizerViewOut;
  state: ViewerState;
  onChange: (next: ViewerState) => void;
  onCollapse: () => void;
  onGoTo: (result: GeocodingResult) => void;
  camera: Camera;
  overview: Camera;
  area: Bbox | null;
}) {
  const registering = view.registration_status === 'registering';

  return (
    <aside
      className="absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l border-neutral-200 bg-white desktop:relative desktop:inset-auto desktop:w-64"
      data-testid="visualizer-sidebar"
    >
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 pb-2 pt-3">
        <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
          <IconSliders className="h-3.5 w-3.5" />
          Layers
        </span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Hide layers"
          title="Hide layers"
          className="cursor-pointer rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
        >
          <IconChevronDoubleRight className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view.imagery.length > 0 && (
          <Section title="Imagery">
            <div className="space-y-0.5">
              {view.imagery.map((entry) => {
                const active = entry.id === state.sourceId;
                return (
                  <div key={entry.id}>
                    <button
                      type="button"
                      onClick={() => onChange(selectSource(view, state, active ? null : entry.id))}
                      data-testid="visualizer-source-option"
                      data-active={active}
                      title={active ? 'Hide this imagery' : 'Show this imagery'}
                      className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                        active
                          ? 'bg-brand-50 font-medium text-brand-800'
                          : 'text-neutral-700 hover:bg-neutral-50'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          active ? 'bg-brand-600' : 'bg-neutral-300'
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">
                        {entry.steps.length || (registering ? '…' : 0)}
                      </span>
                    </button>

                    {/* Right under the imagery it belongs to: a visualization is
                        a property of that source, not of the panel. A source can
                        publish a dozen, so it is a list rather than a row. */}
                    {active && entry.visualizations.length > 1 && (
                      <Select
                        size="sm"
                        aria-label="Rendering"
                        data-testid="visualizer-viz-select"
                        className="!mt-1 !h-7 !text-[11px]"
                        value={state.visualization ?? ''}
                        onChange={(e) => onChange({ ...state, visualization: e.target.value })}
                      >
                        {entry.visualizations.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                );
              })}
            </div>

            {registering && (
              <p className="mt-2 text-[11px] leading-snug text-amber-700">
                Imagery is still registering. Dates appear as they finish.
              </p>
            )}
          </Section>
        )}

        {view.overlays.length > 0 && (
          <Section title="Overlays">
            <div className="space-y-2">
              {view.overlays.map((overlay) => {
                const chosen = state.overlays[overlay.id] ?? { visible: false, opacity: 1 };
                const setChosen = (patch: Partial<typeof chosen>) =>
                  onChange({
                    ...state,
                    overlays: { ...state.overlays, [overlay.id]: { ...chosen, ...patch } },
                  });
                const override = state.renderOverrides[overlay.id];
                const config =
                  overlay.kind === 'raster'
                    ? effectiveRenderConfig(overlay.render_config, override)
                    : null;
                const pending = overlay.kind === 'raster' && overlay.status !== 'ready';

                return (
                  <div
                    key={overlay.id}
                    className="rounded border border-neutral-200 bg-neutral-50 px-2.5 py-2"
                    data-testid="visualizer-overlay"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={chosen.visible}
                        disabled={pending}
                        onChange={(e) => setChosen({ visible: e.target.checked })}
                        aria-label={`Show ${overlay.name}`}
                        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand-500"
                      />
                      {overlay.kind === 'vector' && (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10"
                          style={{ backgroundColor: overlay.color }}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm text-neutral-900">
                        {overlay.name}
                      </span>
                      {overlay.kind === 'raster' && overlay.mlops_url && (
                        <a
                          href={overlay.mlops_url}
                          target="_blank"
                          rel="noreferrer"
                          title="Open the model run behind this layer"
                          className="shrink-0 text-neutral-400 transition-colors hover:text-neutral-700"
                        >
                          <IconExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>

                    {pending && (
                      <p className="mt-1 pl-6 text-[11px] text-amber-700">
                        {overlay.status === 'failed'
                          ? 'This layer failed to register.'
                          : 'Still registering.'}
                      </p>
                    )}

                    {chosen.visible && !pending && (
                      <div className="mt-2 space-y-2 pl-6 text-xs text-neutral-600">
                        {config && (
                          <div>
                            <RenderLegend
                              config={config}
                              onChange={(patch) =>
                                onChange({
                                  ...state,
                                  renderOverrides: {
                                    ...state.renderOverrides,
                                    [overlay.id]: { ...override, ...patch },
                                  },
                                })
                              }
                              width="w-full"
                            />
                            {overlay.kind === 'raster' &&
                              isCustomized(overlay.render_config, override) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onChange({
                                      ...state,
                                      renderOverrides: {
                                        ...state.renderOverrides,
                                        [overlay.id]: {},
                                      },
                                    })
                                  }
                                  className="mt-1 cursor-pointer text-[10px] text-neutral-500 underline hover:text-neutral-800"
                                >
                                  Reset colours
                                </button>
                              )}
                          </div>
                        )}
                        <label className="flex items-center gap-2">
                          <span className="w-12 shrink-0 text-neutral-500">Opacity</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={Math.round(chosen.opacity * 100)}
                            onChange={(e) => setChosen({ opacity: Number(e.target.value) / 100 })}
                            className="w-full cursor-pointer accent-brand-500"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        )}
        {view.basemaps.length > 0 && (
          <Section title="Base map">
            <div className="flex flex-wrap gap-1.5">
              {view.basemaps.map((basemap) => (
                <button
                  key={basemap.id}
                  type="button"
                  onClick={() => onChange({ ...state, basemapId: basemap.id })}
                  data-testid="visualizer-basemap-option"
                  className={pillCls(basemap.id === state.basemapId, '!h-7 !px-2.5 !text-xs')}
                >
                  {basemap.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onChange({ ...state, basemapId: null })}
                className={pillCls(state.basemapId === null, '!h-7 !px-2.5 !text-xs')}
              >
                None
              </button>
            </div>
          </Section>
        )}
      </div>

      {/* Pinned under the list rather than flowing after it: where you are
          looking does not belong to the layers, and a reviewer wants it in the
          same corner however many layers there happen to be. */}
      <div className="shrink-0 border-t border-neutral-200 px-4 py-3">
        <Label>Location</Label>
        <div className="space-y-2">
          <LocationSearch onSelect={onGoTo} />
          <div className="h-32 overflow-hidden rounded border border-neutral-200">
            <Minimap camera={overview} main={camera} roi={area} />
          </div>
        </div>
      </div>
    </aside>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="border-t border-neutral-100 px-4 py-3 first:border-t-0">
    <Label>{title}</Label>
    {children}
  </section>
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
    {children}
  </p>
);
