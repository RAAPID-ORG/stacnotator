import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '~/api/client';
import { makeAnnotation, makeCampaign, makeSettings } from '~/features/annotation/testing/fixtures';
import { seedCampaign } from '../../testing/seed';
import { useWorkStore } from '../../stores/work';
import { EditDetails } from './EditDetails';

const TREE = { id: 1, name: 'tree', color: '#00aa00', geometry_type: 'point' as const };
const ROCK = { id: 2, name: 'rock', color: '#888888', geometry_type: 'point' as const };
const SAVED: GeoJSON.Point = { type: 'Point', coordinates: [1, 2] };
const DRAGGED: GeoJSON.Point = { type: 'Point', coordinates: [3, 4] };
const HINT = /Confirm \(Enter\) or cancel \(Esc\) the reshape/;

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return { ...actual, updateAnnotation: vi.fn() };
});

const chip = (id: number) =>
  document.querySelector<HTMLButtonElement>(`button[data-label-id="${id}"]`)!;

describe('EditDetails while a reshape is pending', () => {
  beforeEach(() => {
    seedCampaign(
      makeCampaign({ id: 5, settings: makeSettings({ labels: [TREE, ROCK] } as never) }),
      { mode: 'explore', currentUserId: 'u1' }
    );
    useWorkStore.setState({
      tool: 'edit',
      edit: { annotation: makeAnnotation({ id: 7 }), geometry: SAVED, pending: null, busy: false },
      selection: [7],
    } as never);
  });
  afterEach(() => useWorkStore.getState().resetAll());

  it('offers the label chips until the shape is dragged', () => {
    render(<EditDetails />);
    expect(chip(ROCK.id).disabled).toBe(false);
    expect(screen.queryByText(HINT)).toBeNull();

    act(() => useWorkStore.getState().setPendingGeometry(DRAGGED));

    expect(chip(TREE.id).disabled).toBe(true);
    expect(chip(ROCK.id).disabled).toBe(true);
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('gives the chips back once the reshape is settled', () => {
    useWorkStore.getState().setPendingGeometry(DRAGGED);
    render(<EditDetails />);
    expect(chip(ROCK.id).disabled).toBe(true);

    act(() => useWorkStore.getState().setPendingGeometry(null));

    expect(chip(ROCK.id).disabled).toBe(false);
    expect(screen.queryByText(HINT)).toBeNull();
  });
});

describe('EditDetails label', () => {
  const open = (labels: (typeof TREE)[]) => {
    seedCampaign(makeCampaign({ id: 5, settings: makeSettings({ labels } as never) }), {
      mode: 'explore',
      currentUserId: 'u1',
    });
    useWorkStore.setState({
      tool: 'edit',
      edit: {
        annotation: makeAnnotation({ id: 7, label_id: TREE.id }),
        geometry: SAVED,
        pending: null,
        busy: false,
      },
      selection: [7],
    } as never);
  };
  afterEach(() => {
    useWorkStore.getState().resetAll();
    vi.mocked(api.updateAnnotation).mockReset();
  });

  it("shows the shape's label when its type has only one", () => {
    open([TREE]);
    render(<EditDetails />);
    expect(chip(TREE.id).textContent).toMatch(/tree/i);
    expect(screen.queryByTestId('edit-details-save')).toBeNull();
  });

  it('saves a picked label at once', async () => {
    open([TREE, ROCK]);
    vi.mocked(api.updateAnnotation).mockResolvedValue({
      data: makeAnnotation({ id: 7, label_id: ROCK.id }),
    } as never);
    render(<EditDetails />);

    fireEvent.click(chip(ROCK.id));

    await waitFor(() =>
      expect(api.updateAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({ body: { label_id: ROCK.id, form_values: {} } })
      )
    );
    await waitFor(() => expect(useWorkStore.getState().edit?.annotation.label_id).toBe(ROCK.id));
  });
});
