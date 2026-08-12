import { afterEach, describe, expect, it } from 'vitest';
import type { CampaignOutFull } from '~/api/client';
import { buildCatalog } from '~/features/annotation/core/catalog';
import { makeCampaign, makeTimeSeries } from '~/features/annotation/core/catalog/testHelpers';
import { getHelp } from '~/features/annotation/engine/hotkeys';
import { activeFeatures, CONTROLS_PANEL_ID, featuresToPanels, registerAllHotkeys } from './index';
import type { ComposeCtx } from './registry';

function ctxFor(mode: ComposeCtx['mode'], overrides: Partial<ComposeCtx> = {}): ComposeCtx {
  const campaign: CampaignOutFull = makeCampaign();
  return {
    campaign,
    catalog: buildCatalog(campaign),
    view: null,
    mode,
    isMobile: false,
    ...overrides,
  };
}

const names = (ctx: ComposeCtx) => activeFeatures(ctx).map((f) => f.name);
const panelIds = (ctx: ComposeCtx) => featuresToPanels(activeFeatures(ctx), ctx).map((p) => p.id);

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('activeFeatures', () => {
  it('mounts the work mode that is live and never the other one', () => {
    expect(names(ctxFor('tasks'))).toContain('task-work');
    expect(names(ctxFor('tasks'))).not.toContain('explore-work');
    expect(names(ctxFor('tasks'))).not.toContain('drawing');

    expect(names(ctxFor('explore'))).toContain('explore-work');
    expect(names(ctxFor('explore'))).toContain('drawing');
    expect(names(ctxFor('explore'))).not.toContain('task-work');
  });

  it('keeps the mode-independent features in both modes', () => {
    for (const mode of ['tasks', 'explore'] as const) {
      expect(names(ctxFor(mode))).toEqual(
        expect.arrayContaining([
          'main-map',
          'imagery-windows',
          'minimap',
          'timeseries',
          'toolbar',
          'layout-edit',
        ])
      );
    }
  });

  it('drops the drawing feature on mobile, which has no edit affordances', () => {
    expect(names(ctxFor('explore', { isMobile: true }))).not.toContain('drawing');
    expect(names(ctxFor('explore', { isMobile: true }))).toContain('explore-work');
  });
});

describe('featuresToPanels', () => {
  it("puts each mode's controls panel into the grid's single controls slot", () => {
    expect(panelIds(ctxFor('tasks'))).toContain(CONTROLS_PANEL_ID);
    expect(panelIds(ctxFor('tasks'))).not.toContain('task-controls');
    expect(panelIds(ctxFor('explore'))).toContain(CONTROLS_PANEL_ID);
  });

  it('always composes the map and minimap panels', () => {
    expect(panelIds(ctxFor('tasks'))).toEqual(expect.arrayContaining(['main', 'minimap']));
  });

  it('tags every panel with the feature that produced it', () => {
    const ctx = ctxFor('explore');
    const panels = featuresToPanels(activeFeatures(ctx), ctx);
    expect(panels.find((p) => p.id === 'main')?.role).toBe('main-map');
    expect(panels.find((p) => p.id === CONTROLS_PANEL_ID)?.role).toBe('explore-work');
  });

  it('composes one timeseries panel per configured window group', () => {
    const campaign = makeCampaign({
      time_series: [
        makeTimeSeries({ id: 1, name: 'NDVI', window_name: 'Vegetation' }),
        makeTimeSeries({ id: 2, name: 'NDWI', window_name: 'Water' }),
      ],
    });
    const ctx: ComposeCtx = {
      campaign,
      catalog: buildCatalog(campaign),
      view: null,
      mode: 'explore',
      isMobile: false,
    };
    const timeseriesPanels = featuresToPanels(activeFeatures(ctx), ctx).filter(
      (p) => p.role === 'timeseries'
    );
    expect(timeseriesPanels).toHaveLength(2);
  });
});

describe('registerAllHotkeys', () => {
  it('registers no drawing scope in tasks mode', () => {
    const ctx = ctxFor('tasks');
    cleanup = registerAllHotkeys(activeFeatures(ctx), ctx);
    expect(getHelp().some((row) => row.scope === 'drawing')).toBe(false);
    expect(getHelp().some((row) => row.scope === 'mode' && row.key === 's')).toBe(true);
  });

  it('registers the drawing scope in explore mode, and not on mobile', () => {
    const ctx = ctxFor('explore');
    cleanup = registerAllHotkeys(activeFeatures(ctx), ctx);
    expect(getHelp().some((row) => row.scope === 'drawing')).toBe(true);
    cleanup();

    const mobile = ctxFor('explore', { isMobile: true });
    cleanup = registerAllHotkeys(activeFeatures(mobile), mobile);
    expect(getHelp().some((row) => row.scope === 'drawing')).toBe(false);
  });

  it('unregisters everything it registered', () => {
    const ctx = ctxFor('explore');
    const off = registerAllHotkeys(activeFeatures(ctx), ctx);
    expect(getHelp().length).toBeGreaterThan(0);
    off();
    expect(getHelp()).toEqual([]);
  });
});
