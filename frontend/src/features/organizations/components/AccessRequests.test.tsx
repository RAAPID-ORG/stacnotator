import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return {
    ...actual,
    listOrganizationAccessRequests: vi.fn(),
    approveOrganizationAccessRequest: vi.fn(),
    rejectOrganizationAccessRequest: vi.fn(),
  };
});

import {
  approveOrganizationAccessRequest,
  listOrganizationAccessRequests,
  rejectOrganizationAccessRequest,
  type AccessRequestOut,
} from '~/api/client';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { apiSuccess } from '~/shared/testing/apiSuccess';
import { AccessRequests } from './AccessRequests';

const REQUEST: AccessRequestOut = {
  user: { id: 'u-1', email: 'ada@example.org', display_name: 'Ada' },
  note: 'Working on the maize campaign',
  requested_at: '2026-08-01T10:00:00Z',
};

const listed = (items: AccessRequestOut[]) => apiSuccess({ items });

beforeEach(() => {
  vi.mocked(listOrganizationAccessRequests).mockReset();
  vi.mocked(approveOrganizationAccessRequest).mockReset().mockResolvedValue(apiSuccess(undefined));
  vi.mocked(rejectOrganizationAccessRequest).mockReset().mockResolvedValue(apiSuccess(undefined));
});

describe('AccessRequests', () => {
  it('shows the requester email and their note', async () => {
    vi.mocked(listOrganizationAccessRequests).mockResolvedValue(listed([REQUEST]));
    render(<AccessRequests organizationId={7} />);

    expect(await screen.findByText('ada@example.org')).toBeTruthy();
    expect(screen.getByText('Working on the maize campaign')).toBeTruthy();
  });

  it('stays out of the way when nobody is waiting', async () => {
    vi.mocked(listOrganizationAccessRequests).mockResolvedValue(listed([]));
    const { container } = render(<AccessRequests organizationId={7} />);

    await waitFor(() => expect(listOrganizationAccessRequests).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('approves the request and re-reads what is left', async () => {
    vi.mocked(listOrganizationAccessRequests)
      .mockResolvedValueOnce(listed([REQUEST]))
      .mockResolvedValue(listed([]));
    render(<AccessRequests organizationId={7} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(approveOrganizationAccessRequest).toHaveBeenCalledWith({
      path: { organization_id: 7, user_id: 'u-1' },
    });
    await waitFor(() => expect(screen.queryByText('ada@example.org')).toBeNull());
  });

  it('confirms before rejecting, and does nothing when the admin backs out', async () => {
    vi.mocked(listOrganizationAccessRequests).mockResolvedValue(listed([REQUEST]));
    useLayoutStore.setState({ showConfirmDialog: () => Promise.resolve(false) });
    render(<AccessRequests organizationId={7} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(rejectOrganizationAccessRequest).not.toHaveBeenCalled();
  });
});
