import { afterEach, describe, expect, it } from 'vitest';
import type { CampaignOutFull } from '~/api/client';
import { buildCatalog } from '~/features/annotation/core/catalog';
import { makeCampaign, makeView } from '~/features/annotation/core/catalog/testHelpers';
import { useImageryStore } from '~/features/annotation/stores';
import { registerBindings } from '~/features/annotation/engine/hotkeys';
import type { ComposeCtx } from '../../composition';
import { hotkeyTip, mainMapBindings, stopSliceAutoNav } from './hotkeys';

const CAMPAIGN: CampaignOutFull = makeCampaign({
  imagery_views: [makeView({ id: 1, name: 'Default' })],
});

const CTX: ComposeCtx = {
  campaign: CAMPAIGN,
  catalog: buildCatalog(CAMPAIGN),
  view: CAMPAIGN.imagery_views[0],
  mode: 'explore',
  isMobile: false,
};

afterEach(() => stopSliceAutoNav());

describe('mainMapBindings', () => {
  it('registers as one global table without colliding keys', () => {
    // registerBindings throws on a duplicate key within a scope.
    let unregister = () => {};
    expect(() => {
      unregister = registerBindings('global', mainMapBindings(CTX));
    }).not.toThrow();
    unregister();
  });

  it('drives the imagery store from the keyboard', () => {
    const unregister = registerBindings('global', mainMapBindings(CTX));
    const before = useImageryStore.getState().crosshair;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    expect(useImageryStore.getState().crosshair).toBe(!before);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'X', shiftKey: true }));
    expect(useImageryStore.getState().crosshair).toBe(!before);

    unregister();
    useImageryStore.getState().setCrosshair(before);
  });

  // A hand-written tooltip can advertise a key the button is not bound to.
  // Deriving it from the binding makes that unrepresentable.
  it('derives button tooltips from the bindings themselves', () => {
    const bindings = mainMapBindings(CTX);
    expect(hotkeyTip(bindings, 'x')).toBe('Toggle crosshair (X)');
    expect(hotkeyTip(bindings, 'shift+x')).toBe('Toggle drawn objects (Shift+X)');
    expect(hotkeyTip(bindings, ' ')).toContain('(Space)');
  });
});
