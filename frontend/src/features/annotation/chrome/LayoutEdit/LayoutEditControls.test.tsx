import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCampaign, makeView } from '~/features/annotation/testing/fixtures';
import { useLayoutStore } from '../../stores/layout';

const createNewCanvasLayoutMock = vi.hoisted(() => vi.fn());

vi.mock('~/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/api/client')>()),
  createNewCanvasLayout: createNewCanvasLayoutMock,
}));

vi.mock('~/shared/utils/useIsMobile', async (importActual) => {
  const actual = await importActual<typeof import('~/shared/utils/useIsMobile')>();
  return { ...actual, useIsMobile: vi.fn() };
});

import { useIsMobile } from '~/shared/utils/useIsMobile';
import { LayoutEditControls } from './LayoutEditControls';

const CAMPAIGN = makeCampaign({ imagery_views: [makeView({ id: 1, name: 'V1' })] });

beforeEach(() => {
  useLayoutStore.setState({ editing: false });
  createNewCanvasLayoutMock.mockReset();
});

describe('LayoutEditControls', () => {
  it('hides the Edit Layout trigger on mobile - the grid there is a static stack, not editable', () => {
    vi.mocked(useIsMobile).mockReturnValue(true);

    render(<LayoutEditControls campaign={CAMPAIGN} view={null} isCampaignAdmin={false} />);

    expect(screen.queryByTestId('edit-layout-trigger')).toBeNull();
  });

  it('shows the Edit Layout trigger on desktop', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);

    render(<LayoutEditControls campaign={CAMPAIGN} view={null} isCampaignAdmin={false} />);

    expect(screen.getByTestId('edit-layout-trigger')).toBeTruthy();
  });

  it('persists first-view setup as the shared default', async () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    createNewCanvasLayoutMock.mockResolvedValue({ data: {}, status: 201 });
    const onDefaultSaved = vi.fn();
    useLayoutStore.setState({ editing: true });

    render(
      <LayoutEditControls
        campaign={CAMPAIGN}
        view={CAMPAIGN.imagery_views[0]}
        isCampaignAdmin
        mustSaveDefault
        onDefaultSaved={onDefaultSaved}
      />
    );

    fireEvent.click(screen.getByTestId('save-required-default'));
    fireEvent.click(screen.getByText('Save for Everyone'));

    await waitFor(() => expect(createNewCanvasLayoutMock).toHaveBeenCalledTimes(1));
    expect(createNewCanvasLayoutMock.mock.calls[0][0].body.should_be_default).toBe(true);
    expect(onDefaultSaved).toHaveBeenCalledTimes(1);
  });
});
