import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/api/client/sdk.gen', async () => {
  const actual =
    await vi.importActual<typeof import('~/api/client/sdk.gen')>('~/api/client/sdk.gen');
  return {
    ...actual,
    getProjectOrganizationKeys: vi.fn(() =>
      Promise.resolve({ data: { items: [{ id: 11, name: 'Planet' }] } })
    ),
    getProject: vi.fn(() => Promise.resolve({ data: { visibility: 'private' } })),
  };
});

import { renderWithQuery } from '~/shared/testing/renderWithQuery';
import { BasemapList } from './BasemapList';
import type { ImageryController } from './controller';
import { basemapToBackend } from './draftSync';
import type { Basemap } from './types';

const KEYED: Basemap = { id: 'new-1', name: 'Planet', url: 'https://p/{z}/{x}/{y}?k={api_key}' };

/** A draft controller, as in the create wizard: no campaign exists yet. */
const renderDraft = () => {
  const saved: { basemaps: Basemap[] } = { basemaps: [KEYED] };
  const Host = () => {
    const [basemaps, setBasemaps] = useState<Basemap[]>([KEYED]);
    const controller = {
      projectId: 5,
      state: { sources: [], basemaps },
      setBasemaps: async (next: Basemap[]) => {
        saved.basemaps = next;
        setBasemaps(next);
      },
    } as unknown as ImageryController;
    return <BasemapList controller={controller} />;
  };
  renderWithQuery(<Host />);
  return saved;
};

describe('BasemapList provider key', () => {
  it('takes the key for an unsaved basemap and sends it with the imagery', async () => {
    const saved = renderDraft();

    await userEvent.type(screen.getByLabelText('Provider API key'), 'planet-secret');
    expect(basemapToBackend(saved.basemaps[0]).api_key).toBeNull();

    await userEvent.click(screen.getByRole('checkbox'));
    expect(basemapToBackend(saved.basemaps[0])).toMatchObject({
      api_key: 'planet-secret',
      organization_api_key_id: null,
    });
  });

  it("points the basemap at one of the organization's keys instead", async () => {
    const saved = renderDraft();

    const select = await screen.findByTestId('org-key-select');
    await userEvent.selectOptions(select, '11');

    await waitFor(() =>
      expect(basemapToBackend(saved.basemaps[0])).toMatchObject({
        api_key: null,
        organization_api_key_id: 11,
      })
    );
    expect(screen.queryByLabelText('Provider API key')).toBeNull();
  });
});
