import type {
  SourceOptionOut,
  VisualizerImageryCreate,
  VisualizerOptionsOut,
  VisualizerOverlayCreate,
} from '~/api/client';

/** The generator inlines the backend's `LayerRestriction` union, so it is read
 *  back off the field rather than restated here. */
export type LayerRestriction = NonNullable<SourceOptionOut['restriction']>;

/**
 * What a visualizer would expose by being published.
 *
 * Most imagery is open data and publishing it costs nothing. A source served
 * through the backend key proxy is fetched with the organization's provider
 * credential, and an internal-storage layer with the tiler's managed identity -
 * so publishing either points anonymous traffic at a credential the
 * organization owns. That is the person's call to make, but it has to be a
 * decision rather than a side effect of a toggle.
 */

export interface RestrictedLayer {
  name: string;
  reason: LayerRestriction;
}

export const RESTRICTION_TEXT: Record<LayerRestriction, string> = {
  api_key: "served with your organization's provider key",
  internal_storage: 'read from internal storage',
};

export function restrictedSelection(
  options: VisualizerOptionsOut,
  selection: {
    imagery: VisualizerImageryCreate[];
    overlays: VisualizerOverlayCreate[];
  }
): RestrictedLayer[] {
  const sourceIds = new Set(selection.imagery.map((entry) => entry.source_id));
  const customMapIds = new Set(
    selection.overlays.map((entry) => entry.custom_map_id).filter((id) => id != null)
  );

  const restricted: RestrictedLayer[] = [];
  for (const campaign of options.campaigns) {
    for (const source of campaign.sources) {
      if (source.restriction && sourceIds.has(source.id)) {
        restricted.push({ name: source.name, reason: source.restriction });
      }
    }
    for (const overlay of campaign.raster_overlays) {
      if (overlay.restriction && customMapIds.has(overlay.id)) {
        restricted.push({ name: overlay.name, reason: overlay.restriction });
      }
    }
  }
  return restricted;
}

export interface PublishConfirm {
  title: string;
  description: string;
  confirmText: string;
  isDangerous: boolean;
}

/** Copy for the confirm a public visualizer needs before it can be saved, or
 *  null when nothing it draws is behind a credential. */
export function publishConfirm(restricted: RestrictedLayer[]): PublishConfirm | null {
  if (restricted.length === 0) return null;
  const names = restricted.map((layer) => layer.name).join(', ');
  const layers = restricted.length === 1 ? 'layer is' : 'layers are';
  return {
    title: 'Publish imagery that is not open data?',
    description:
      `Anyone with the link will be able to load ${names}. ` +
      `${restricted.length === 1 ? 'That' : 'Those'} ${layers} fetched with your organization's own ` +
      'credentials, so anonymous traffic spends that quota and reaches imagery your ' +
      'licence may not let you redistribute.',
    confirmText: 'Publish anyway',
    isDangerous: true,
  };
}
