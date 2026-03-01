import OLMap from "ol/Map";
import type { Layer } from "./Layer";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import PrefetchManager from "openlayers-prefetching";
import BaseTileLayer from "ol/layer/BaseTile";
import type TileSource from "ol/source/Tile";
import { fromLonLat } from "ol/proj";

/**
 * LayerManager owns both the OL layer registry and the PrefetchManager.
 *
 * Placement rationale: PrefetchManager needs direct access to OL TileLayer
 * instances and must be notified whenever the active layer changes or layers
 * are added/removed. LayerManager is the single place that controls all of
 * that, so co-locating the two avoids threading raw OL objects through React
 * props or the Zustand store.
 *
 * Priority scheme for imagery layers (lower number = loaded first):
 *   - Active (visible) imagery layer  → managed by PrefetchManager.setActiveLayer
 *   - First (index-0) imagery slice   → background priority 1
 *   - Remaining imagery slices        → background priority 2, 3, 4 …
 *   - Basemap layers                  → not registered with the prefetcher
 *     (they use OL's built-in TileQueue and are low-traffic)
 */
export class LayerManager {
    private layers: Layer[] = [];
    private map: OLMap;
    private activeLayerId: string;
    private prefetchManager: PrefetchManager;

    constructor(map: OLMap) {
        this.map = map;
        this.activeLayerId = '';

        this.prefetchManager = new PrefetchManager({
            map,
            maxConcurrentPrefetches: 32,
            spatialBufferFactor: 1.5,
            idleDelay: 80,
            tickInterval: 200,
            enabled: true,
        });
    }

    // -------------------------------------------------------------------------
    // Layer registration / removal
    // -------------------------------------------------------------------------

    registerLayer(layer: Layer) {
        const exists = this.layers.some((existing) => existing.id === layer.id);
        if (exists) return; // already registered — don't add a duplicate OL layer

        this.layers.push(layer);

        const olLayer = layer.asOLLayer();
        olLayer.setVisible(false);
        olLayer.set("layerId", layer.id);
        olLayer.set("name", `${layer.name} (${layer.layerType})`);
        olLayer.set("label", `${layer.name} (${layer.layerType})`);

        this.map.addLayer(olLayer);

        // Re-sync prefetch priorities whenever the imagery roster changes
        if (layer.layerType === "imagery") {
            this._syncPrefetchLayers();
        }
    }

    removeLayer(layerId: string) {
        const layer = this.layers.find((l) => l.id === layerId);
        this.layers = this.layers.filter((l) => l.id !== layerId);

        const mapLayers = this.map.getLayers().getArray();
        const olLayer = mapLayers.find((l) => l.get("layerId") === layerId) as BaseTileLayer<TileSource, any> | undefined;
        if (olLayer) {
            // Remove from prefetcher before removing from map
            if (layer?.layerType === "imagery") {
                this.prefetchManager.removeBackgroundLayer(olLayer);
            }
            this.map.removeLayer(olLayer);
        }

        if (this.activeLayerId === layerId) {
            this.activeLayerId = '';
        }

        if (layer?.layerType === "imagery") {
            this._syncPrefetchLayers();
        }
    }

    // -------------------------------------------------------------------------
    // Queries
    // -------------------------------------------------------------------------

    getLayers() {
        return [...this.layers];
    }

    getLayerById(layerId: string) {
        return this.layers.find((layer) => layer.id === layerId) ?? null;
    }

    getImageryLayers() {
        return this.layers.filter((layer) => layer.layerType === "imagery");
    }

    getBasemapLayers() {
        return this.layers.filter((layer) => layer.layerType === "basemap");
    }

    // -------------------------------------------------------------------------
    // Active layer switching
    // -------------------------------------------------------------------------

    setActiveLayer(layerId: string) {
        const olLayers = this.map.getLayers().getArray();

        const newActiveOLLayer = olLayers.find((l) => l.get("layerId") === layerId) as BaseTileLayer<TileSource, any> | undefined;
        if (!newActiveOLLayer) return;

        // Hide the current active layer first, then show the new one
        if (this.activeLayerId && this.activeLayerId !== layerId) {
            const previousLayer = olLayers.find((l) => l.get("layerId") === this.activeLayerId);
            if (previousLayer) previousLayer.setVisible(false);
        }

        newActiveOLLayer.setVisible(true);
        this.activeLayerId = layerId;

        // Tell the prefetcher which layer is now active (imagery only)
        const layer = this.layers.find((l) => l.id === layerId);
        if (layer?.layerType === "imagery") {
            this.prefetchManager.setActiveLayer(newActiveOLLayer);
            this._syncPrefetchLayers();
        }
    }

    getActiveLayer() {
        return this.layers.find((layer) => layer.id === this.activeLayerId);
    }

    /** Subscribe to live prefetch stats. Fires every ~200ms while active. */
    onPrefetchStats(callback: Parameters<PrefetchManager['onStats']>[0]) {
        this.prefetchManager.onStats(callback);
    }

    /**
     * Tell the prefetcher the next anticipated navigation target so it can
     * pre-warm tiles before the user arrives there (next task location).
     * Pass null to clear.
     */
    setNextNavTarget(latLon: [number, number] | null, zoom: number) {
        if (!latLon) {
            this.prefetchManager.setNextTarget(null as any, zoom);
            return;
        }
        const center = fromLonLat([latLon[1], latLon[0]]);
        this.prefetchManager.setNextTarget(center, zoom);
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    dispose() {
        this.prefetchManager.dispose();
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Rebuild the prefetcher's background layer list from scratch.
     *
     * Priority scheme:
     *   - The active imagery layer is registered via setActiveLayer (not here).
     *   - The first imagery layer (index 0 in registration order) gets priority 1
     *     so its tiles are always warm even when it isn't the active layer.
     *   - All other non-active imagery layers get priority 2, 3, 4 …
     */
    private _syncPrefetchLayers() {
        const olLayers = this.map.getLayers().getArray();

        // Clear existing background registrations
        const existing = this.prefetchManager.getBackgroundLayers?.() ?? [];
        existing.forEach((entry) =>
            this.prefetchManager.removeBackgroundLayer(entry.layer)
        );

        const imageryLayers = this.layers.filter((l) => l.layerType === "imagery");

        // Assign priorities: first slice = 1, rest increment from 2
        let nextPriority = 2;
        imageryLayers.forEach((layer, idx) => {
            if (layer.id === this.activeLayerId) return; // active layer handled separately

            const olLayer = olLayers.find((l) => l.get("layerId") === layer.id) as BaseTileLayer<TileSource, any> | undefined;
            if (!olLayer) return;

            // First registered imagery layer (index 0) gets highest background priority
            const priority = idx === 0 ? 1 : nextPriority++;
            this.prefetchManager.addBackgroundLayer(olLayer, priority);
        });
    }
}