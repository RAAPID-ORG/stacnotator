import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignOutFull } from '~/api/client';
import type { FormField } from '~/features/annotation/core/apiTypes';
import { buildCatalog } from '~/features/annotation/core/catalog';
import { makeCampaign } from '~/features/annotation/core/catalog/testHelpers';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useWorkStore } from '~/features/annotation/stores';
import type { ComposeCtx } from '../registry';
import { getActiveTool, resetToolState, selectLabel, selectTool } from './toolState';

const alerts: string[] = [];
beforeEach(() => {
  alerts.length = 0;
  useLayoutStore.setState({ showAlert: (message) => alerts.push(message) });
});

const FIELDS: FormField[] = [
  { id: 1, title: 'Cover', type: 'category', required: true, options: [{ id: 10, name: 'yes' }] },
];

const CAMPAIGN: CampaignOutFull = makeCampaign({
  id: 42,
  settings: {
    bbox_west: -10,
    bbox_south: -20,
    bbox_east: 10,
    bbox_north: 20,
    labelling_policy: {
      explore: { kinds: ['anyone'] },
      assigned_tasks: { kinds: ['anyone'] },
      complete_assigned: { kinds: ['anyone'] },
      unassigned_tasks: { kinds: ['anyone'] },
    },
    labels: [
      { id: 1, name: 'tree', geometry_type: 'point' },
      { id: 2, name: 'field', geometry_type: 'polygon' },
    ],
    form_fields: FIELDS,
  },
});

const CTX: ComposeCtx = {
  campaign: CAMPAIGN,
  catalog: buildCatalog(CAMPAIGN),
  view: null,
  mode: 'explore',
  isMobile: false,
};

const realCloseDraft = useWorkStore.getState().closeDraft;

beforeEach(() => {
  resetToolState();
  useWorkStore.setState({ closeDraft: realCloseDraft });
  useWorkStore.getState().resetForm();
  useWorkStore.setState({ draft: { phase: 'idle' } });
});

describe('selectTool', () => {
  it('starts on pan', () => {
    expect(getActiveTool()).toBe('pan');
  });

  it('clears the selected label when going back to pan', async () => {
    useWorkStore.getState().setSelectedLabelId(2);
    await selectTool('pan', CTX);
    expect(useWorkStore.getState().selectedLabelId).toBeNull();
  });

  it('closes an open draft when leaving the annotate tool', async () => {
    const closeDraft = vi.fn().mockResolvedValue('discarded');
    useWorkStore.setState({ closeDraft });
    useWorkStore.setState({
      draft: { phase: 'draft', labelId: 1, geometry: { type: 'Point', coordinates: [0, 0] } },
    });

    await selectTool('edit', CTX);

    expect(closeDraft).toHaveBeenCalledWith(42, FIELDS);
    expect(getActiveTool()).toBe('edit');
  });

  it('leaves the draft alone while staying on annotate', async () => {
    const closeDraft = vi.fn().mockResolvedValue('discarded');
    useWorkStore.setState({ closeDraft });
    useWorkStore.setState({
      draft: { phase: 'draft', labelId: 1, geometry: { type: 'Point', coordinates: [0, 0] } },
    });

    await selectTool('annotate', CTX);

    expect(closeDraft).not.toHaveBeenCalled();
  });

  it('says so when that close could not save, instead of losing the draft quietly', async () => {
    useWorkStore.setState({ closeDraft: vi.fn().mockResolvedValue('save-failed') });
    useWorkStore.setState({
      draft: { phase: 'draft', labelId: 1, geometry: { type: 'Point', coordinates: [0, 0] } },
    });

    await selectTool('edit', CTX);

    expect(alerts).toContainEqual(expect.stringContaining('still in the panel'));
  });

  it('does not close anything when no draft is open', async () => {
    const closeDraft = vi.fn().mockResolvedValue('nothing');
    useWorkStore.setState({ closeDraft });

    await selectTool('timeseries', CTX);

    expect(closeDraft).not.toHaveBeenCalled();
  });
});

describe('selectLabel', () => {
  it('arms the annotate tool so the next map gesture draws', async () => {
    await selectTool('pan', CTX);
    selectLabel(2, CTX);
    expect(useWorkStore.getState().selectedLabelId).toBe(2);
    expect(getActiveTool()).toBe('annotate');
  });

  it('keeps the label-vector tool, where the label applies to clicked features', async () => {
    await selectTool('labelVector', CTX);
    selectLabel(1, CTX);
    expect(useWorkStore.getState().selectedLabelId).toBe(1);
    expect(getActiveTool()).toBe('labelVector');
  });

  it('selects by list position for the digit hotkeys', async () => {
    await selectTool('pan', CTX);
    selectLabel(CAMPAIGN.settings.labels[1].id, CTX);
    expect(useWorkStore.getState().selectedLabelId).toBe(2);
  });
});
