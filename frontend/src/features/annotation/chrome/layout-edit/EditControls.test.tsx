import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCampaign, makeView } from '~/features/annotation/core/catalog/testHelpers';
import { useWorkspaceStore } from '~/features/annotation/stores';

vi.mock('~/shared/utils/useIsMobile', async (importActual) => {
  const actual = await importActual<typeof import('~/shared/utils/useIsMobile')>();
  return { ...actual, useIsMobile: vi.fn() };
});

import { useIsMobile } from '~/shared/utils/useIsMobile';
import { EditControls } from './EditControls';

const CAMPAIGN = makeCampaign({ imagery_views: [makeView({ id: 1, name: 'V1' })] });

beforeEach(() => {
  useWorkspaceStore.setState({ editing: false });
});

describe('EditControls', () => {
  it('hides the Edit Layout trigger on mobile - the grid there is a static stack, not editable', () => {
    vi.mocked(useIsMobile).mockReturnValue(true);

    render(<EditControls campaign={CAMPAIGN} view={null} isCampaignAdmin={false} />);

    expect(screen.queryByTestId('edit-layout-trigger')).toBeNull();
  });

  it('shows the Edit Layout trigger on desktop', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);

    render(<EditControls campaign={CAMPAIGN} view={null} isCampaignAdmin={false} />);

    expect(screen.getByTestId('edit-layout-trigger')).toBeTruthy();
  });
});
