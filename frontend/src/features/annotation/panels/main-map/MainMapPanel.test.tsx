import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCatalog } from '~/features/annotation/core/catalog';
import {
  makeCampaign,
  makeCustomMap,
  makeVectorLayer,
} from '~/features/annotation/core/catalog/testHelpers';
import { useImageryStore } from '~/features/annotation/stores';
import type { ComposeCtx } from '../../composition';
import { MainMapHeader } from './MainMapPanel';

describe('MainMapHeader reference layers', () => {
  beforeEach(() => {
    useImageryStore.setState({
      overlay: { id: null, visible: true },
      vector: { id: null, visible: true },
    });
  });

  it('offers configured overlays and vector layers while annotating tasks', () => {
    const campaign = makeCampaign({
      custom_maps: [makeCustomMap({ id: 3, name: 'Crop map' })],
      vector_layers: [makeVectorLayer({ id: 5, name: 'Building footprints' })],
    });
    const ctx: ComposeCtx = {
      campaign,
      catalog: buildCatalog(campaign),
      view: null,
      mode: 'tasks',
      isMobile: false,
    };

    render(<MainMapHeader ctx={ctx} />);

    expect(screen.getByTestId('custom-map-controls')).toBeTruthy();
    expect(screen.getByTitle('Select overlay map')).toBeTruthy();
    expect(screen.getByTestId('vector-layer-controls')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Select vector layer'));
    fireEvent.click(screen.getByText('Building footprints'));
    expect(useImageryStore.getState().vector).toEqual({ id: 5, visible: true });

    const toggle = screen.getByTestId('vector-layer-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(useImageryStore.getState().vector.visible).toBe(false);
  });
});
