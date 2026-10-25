import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { makeCampaign, makeSettings } from '~/features/annotation/testing/fixtures';
import { seedCampaign } from '../../testing/seed';
import { useWorkStore } from '../../stores/work';
import { ExploreControls } from './ExploreControls';

const LABEL = { id: 1, name: 'tree', color: '#00aa00', geometry_type: 'point' as const };
const QUESTION = { id: 100, type: 'text' as const, label: 'Notes', required: false };

function saving(formFields: unknown[]): void {
  seedCampaign(
    makeCampaign({
      id: 5,
      settings: makeSettings({ labels: [LABEL], form_fields: formFields } as never),
    })
  );
  useWorkStore.setState({
    tool: 'annotate',
    draft: {
      phase: 'committing',
      labelId: 1,
      geometry: { type: 'Point', coordinates: [0, 0] },
      savedId: null,
      sliceId: null,
    },
  } as never);
}

describe('ExploreControls while a shape saves', () => {
  afterEach(() => useWorkStore.getState().resetAll());

  it('shows no questions panel when the campaign asks none', () => {
    saving([]);
    render(<ExploreControls />);
    expect(screen.queryByTestId('draft-catalog')).toBeNull();
  });

  it('keeps the questions panel up while saving answers', () => {
    saving([QUESTION]);
    render(<ExploreControls />);
    expect(screen.getByTestId('draft-catalog')).toBeTruthy();
  });
});
