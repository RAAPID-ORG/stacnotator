import { beforeEach, describe, expect, it } from 'vitest';
import type { CampaignOutFull } from '~/api/client';
import { buildCatalog } from '~/features/annotation/core/catalog';
import { makeCampaign } from '~/features/annotation/core/catalog/testHelpers';
import { useWorkStore } from '~/features/annotation/stores';
import type { ComposeCtx } from '../../composition';
import { exploreWorkHotkeys } from './hotkeys';

const campaignWithCategory = (): CampaignOutFull => {
  const campaign = makeCampaign();
  return {
    ...campaign,
    settings: {
      ...campaign.settings,
      form_fields: [
        {
          id: 100,
          title: 'Condition',
          required: true,
          type: 'category',
          options: [
            { id: 1001, name: 'Healthy' },
            { id: 1002, name: 'Stressed' },
          ],
        },
      ],
    },
  };
};

function ctxFor(campaign: CampaignOutFull): ComposeCtx {
  return {
    campaign,
    catalog: buildCatalog(campaign),
    view: null,
    mode: 'explore',
    isMobile: false,
  };
}

const formTable = (ctx: ComposeCtx) =>
  exploreWorkHotkeys(ctx).find((t) => t.scope === 'form')?.table ?? [];

describe('explore form-field keys', () => {
  beforeEach(() => {
    useWorkStore.getState().resetAll();
  });

  it('a digit answers the field the draft catalog highlights', () => {
    const table = formTable(ctxFor(campaignWithCategory()));
    const one = table.find((b) => b.key === '1')!;
    useWorkStore.getState().setActiveFieldIndex(0);

    expect(one.when!()).toBe(true);
    one.run(new KeyboardEvent('keydown', { key: '1' }));

    expect(useWorkStore.getState().formValues).toEqual({ '100': 1001 });
  });

  it('leaves the digits to label selection while no field is active', () => {
    const table = formTable(ctxFor(campaignWithCategory()));
    expect(table.find((b) => b.key === '1')!.when!()).toBe(false);
  });

  // The form scope outranks the mode scope, where Escape closes the draft and
  // Enter saves it.
  it('claims nothing but the digits', () => {
    const keys = formTable(ctxFor(campaignWithCategory())).map((b) => b.key);
    expect(keys).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('registers nothing at all outside explore mode', () => {
    const ctx = { ...ctxFor(campaignWithCategory()), mode: 'tasks' as const };
    expect(exploreWorkHotkeys(ctx)).toEqual([]);
  });
});
