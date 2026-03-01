/**
 * Map store – owns everything map-related:
 *  - Which layer is currently active
 *  - The list of available layers (built-in XYZ + imagery-derived STAC)
 *  - Current map center & zoom
 *
 * The store is intentionally thin: it holds plain serialisable state.
 * The React component that renders the OL map is responsible for creating
 * and managing OL objects (Map, TileLayer, …) and reacting to store changes.
 */

import { create } from 'zustand';
import type { ImageryOut } from '~/api/client';
import {
  BUILTIN_XYZ_LAYERS,
  type LayerDef,
  type StacLayerDef,
} from './layers';
import { DEFAULT_MAP_ZOOM } from '~/shared/utils/constants';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface MapState {
  /** All layers available for selection (XYZ builtins + STAC layers from imagery) */
  availableLayers: LayerDef[];

  /** Id of the currently selected layer */
  activeLayerId: string;

  /** Map center as [lon, lat] in EPSG:4326 – updated by the OL map on every moveend */
  center: [number, number];

  /** OL zoom level – updated by the OL map on every moveend */
  zoom: number;

  /**
   * Explicit fly-to command issued by task navigation.
   * The OL map watches this and animates when it changes.
   * Kept separate from `center`/`zoom` so that user-pan updates
   * (setViewState) never re-trigger the animation.
   */
  flyToTarget: { center: [number, number]; zoom: number; seq: number } | null;
}

interface MapActions {
  /** Select a layer by id */
  setActiveLayer: (id: string) => void;

  /** Update center & zoom (called from OL map moveend – does NOT trigger animation) */
  setViewState: (center: [number, number], zoom: number) => void;

  /**
   * Animate the map to a new position (e.g. when navigating to a new task).
   * Increments `flyToTarget.seq` so subscribers can detect a new command even
   * when center/zoom values are identical to the previous target.
   */
  flyTo: (center: [number, number], zoom?: number) => void;

  /**
   * Register STAC layers from a campaign imagery list.
   * XYZ builtins are always present; STAC layers are appended once per imagery id.
   * Calling this again with the same imagery is a no-op (idempotent).
   */
  registerImageryLayers: (imagery: ImageryOut[]) => void;
}

export type MapStore = MapState & MapActions;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const DEFAULT_ACTIVE_LAYER = BUILTIN_XYZ_LAYERS[0].id;

export const useMapStore = create<MapStore>((set, get) => ({
  // ── initial state ────────────────────────────────────────────────────────
  availableLayers: [...BUILTIN_XYZ_LAYERS],
  activeLayerId: DEFAULT_ACTIVE_LAYER,
  center: [0, 0],
  zoom: DEFAULT_MAP_ZOOM,
  flyToTarget: null,

  // ── actions ──────────────────────────────────────────────────────────────
  setActiveLayer: (id) => {
    const { availableLayers } = get();
    const exists = availableLayers.some((l) => l.id === id);
    if (!exists) return;
    set({ activeLayerId: id });
  },

  setViewState: (center, zoom) => {
    set({ center, zoom });
  },

  flyTo: (center, zoom) => {
    set((state) => ({
      flyToTarget: {
        center,
        zoom: zoom ?? state.zoom,
        seq: (state.flyToTarget?.seq ?? 0) + 1,
      },
    }));
  },

  registerImageryLayers: (imagery) => {
    const { availableLayers } = get();
    const existingIds = new Set(availableLayers.map((l) => l.id));

    const newLayers: StacLayerDef[] = [];

    for (const img of imagery) {
      for (const tmpl of img.visualization_url_templates) {
        const layerId = `stac-${img.id}-${tmpl.id}`;
        if (existingIds.has(layerId)) continue;

        newLayers.push({
          id: layerId,
          name: `${img.name} – ${tmpl.name}`,
          kind: 'stac',
          registrationUrl: img.registration_url,
          searchBody: img.search_body,
          visualizationUrlTemplate: tmpl.visualization_url,
        });
      }
    }

    if (newLayers.length > 0) {
      set((state) => ({
        availableLayers: [...state.availableLayers, ...newLayers],
      }));
    }
  },
}));
