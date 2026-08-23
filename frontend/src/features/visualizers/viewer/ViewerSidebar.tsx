import type { VisualizerViewOut } from '~/api/client';
import { RenderLegend } from '~/shared/imagery/RenderLegend';
import { effectiveRenderConfig, isCustomized } from '~/shared/imagery/tileColors';
import { IconChevronDoubleRight, IconExternalLink, IconSliders } from '~/shared/ui/Icons';
import { activeSource, BASEMAP_CHOICES, selectSource, type ViewerState } from '../viewerState';

/**
 * Everything the map is showing, as a list you can reach into: which imagery,
 * rendered how, and what sits on top of it.
 */
export function ViewerSidebar({
  view,
  state,
  onChange,
  onCollapse,
}: {
  view: VisualizerViewOut;
  state: ViewerState;
  onChange: (next: ViewerState) => void;
  onCollapse: () => void;
}) {
  const source = activeSource(view, state);

  return (
    <aside
      className="absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l border-white/10 bg-neutral-900/95 text-white backdrop-blur sm:relative sm:w-80"
      data-testid="visualizer-sidebar"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/60">
          <IconSliders className="h-3.5 w-3.5" />
          Layers
        </span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Hide layers"
          title="Hide layers"
          className="cursor-pointer rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <IconChevronDoubleRight className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view.imagery.length > 0 && (
          <Section title="Imagery">
            <div className="space-y-1">
              {view.imagery.map((entry) => (
                <button
                  key={entry.source_id}
                  type="button"
                  onClick={() => onChange(selectSource(view, state, entry.source_id))}
                  data-testid="visualizer-source-option"
                  data-active={entry.source_id === state.sourceId}
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    entry.source_id === state.sourceId
                      ? 'bg-brand-600/25 text-white ring-1 ring-inset ring-brand-500/50'
                      : 'text-white/70 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="truncate">{entry.name}</span>
                  <span className="shrink-0 text-[11px] text-white/40 tabular-nums">
                    {entry.steps.length}
                  </span>
                </button>
              ))}
            </div>

            {source && source.visualizations.length > 1 && (
              <div className="mt-3">
                <Label>Rendering</Label>
                <div className="flex flex-wrap gap-1.5">
                  {source.visualizations.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => onChange({ ...state, visualization: name })}
                      data-testid="visualizer-viz-option"
                      className={`cursor-pointer rounded-full px-2.5 py-1 text-xs transition-colors ${
                        name === state.visualization
                          ? 'bg-white text-neutral-900'
                          : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
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
                    className="rounded-lg bg-white/5 px-2.5 py-2"
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
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: overlay.color }}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">{overlay.name}</span>
                      {overlay.kind === 'raster' && overlay.mlops_url && (
                        <a
                          href={overlay.mlops_url}
                          target="_blank"
                          rel="noreferrer"
                          title="Open the model run behind this layer"
                          className="shrink-0 text-white/40 transition-colors hover:text-white"
                        >
                          <IconExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>

                    {pending && (
                      <p className="mt-1 pl-6 text-[11px] text-amber-300/80">
                        {overlay.status === 'failed'
                          ? 'This layer failed to register.'
                          : 'Still registering.'}
                      </p>
                    )}

                    {chosen.visible && !pending && (
                      <div className="mt-2 space-y-2 pl-6 text-xs text-white/70">
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
                                  className="mt-1 cursor-pointer text-[10px] text-white/40 underline hover:text-white"
                                >
                                  Reset colours
                                </button>
                              )}
                          </div>
                        )}
                        <label className="flex items-center gap-2">
                          <span className="w-12 shrink-0 text-white/40">Opacity</span>
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

        <Section title="Base map">
          <div className="flex gap-1.5">
            {BASEMAP_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => onChange({ ...state, basemap: choice })}
                className={`flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-xs capitalize transition-colors ${
                  choice === state.basemap
                    ? 'bg-white text-neutral-900'
                    : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                }`}
              >
                {choice}
              </button>
            ))}
          </div>
        </Section>
      </div>
    </aside>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="border-b border-white/5 px-4 py-3 last:border-b-0">
    <Label>{title}</Label>
    {children}
  </section>
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-white/40">{children}</p>
);
