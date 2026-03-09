import OLMap from "ol/Map";
import type { Layer } from "./Layer";
import BaseTileLayer from "ol/layer/BaseTile";
import type TileSource from "ol/source/Tile";
import { listen, unlistenByKey } from "ol/events";
import type { EventsKey } from "ol/events";

/**
 * LayerManager - manages the OL layer registry and active layer switching.
 *
 * Responsibilities:
 *   - Register / remove Layer instances and add them to the OL map
 *   - Switch the active (visible) layer
 *   - Notify when the active layer's tiles have finished rendering
 *
 * Layer ID convention for STAC layers: `stac-w{windowId}-s{sliceIndex}-v{templateId}`
 */
export class LayerManager {
    private layers: Layer[] = [];
    private map: OLMap;
    private activeLayerId = '';

    constructor(map: OLMap) {
        this.map = map;
    }

    // Layer registration / removal

    registerLayer(layer: Layer) {
        if (this.layers.some((l) => l.id === layer.id)) return;

        this.layers.push(layer);
        const olLayer = layer.asOLLayer();
        olLayer.setVisible(false);
        olLayer.set("layerId", layer.id);
        olLayer.set("name", `${layer.name} (${layer.layerType})`);
        olLayer.set("label", `${layer.name} (${layer.layerType})`);
        this.map.addLayer(olLayer);
    }

    /** Register multiple layers in one batch. */
    registerLayers(layers: Layer[]) {
        for (const layer of layers) {
            this.registerLayer(layer);
        }
    }

    removeLayer(layerId: string) {
        this.layers = this.layers.filter((l) => l.id !== layerId);

        const olLayer = this._findOLLayer(layerId);
        if (olLayer) this.map.removeLayer(olLayer);

        if (this.activeLayerId === layerId) this.activeLayerId = '';
    }

    // Queries

    getLayers() {
        return [...this.layers];
    }

    getLayerById(layerId: string) {
        return this.layers.find((l) => l.id === layerId) ?? null;
    }

    getActiveLayer() {
        return this.layers.find((l) => l.id === this.activeLayerId);
    }

    // Active layer switching

    /**
     * Switch the visible layer.
     */
    setActiveLayer(layerId: string) {
        const newOL = this._findOLLayer(layerId);
        if (!newOL) return;

        // Hide the previous layer
        const previousOL = this.activeLayerId && this.activeLayerId !== layerId
            ? this._findOLLayer(this.activeLayerId) : undefined;
        if (previousOL) previousOL.setVisible(false);

        // Show the new layer
        newOL.setVisible(true);
        this.activeLayerId = layerId;
    }

    /**
     * Register a one-shot callback that fires once the active layer's
     * viewport tiles have finished loading.
     */
    onceActiveLayerRendered(callback: () => void) {
        let fired = false;
        let pending = 0;
        let safetyTimer: ReturnType<typeof setTimeout> | null = null;
        const keys: EventsKey[] = [];

        const cleanup = () => {
            keys.forEach(unlistenByKey);
            keys.length = 0;
            if (safetyTimer !== null) { clearTimeout(safetyTimer); safetyTimer = null; }
        };

        const fire = () => {
            if (fired) return;
            fired = true;
            cleanup();
            callback();
        };

        const tryFire = () => {
            if (pending === 0) fire();
        };

        const olLayer = this._findOLLayer(this.activeLayerId);
        const source = olLayer?.getSource?.() ?? null;

        if (source) {
            keys.push(
                listen(source, 'tileloadstart', () => { pending++; }),
                listen(source, 'tileloadend', () => { pending = Math.max(0, pending - 1); tryFire(); }),
                listen(source, 'tileloaderror', () => { pending = Math.max(0, pending - 1); tryFire(); }),
            );
        }

        this.map.once('rendercomplete', tryFire);

        // Safety: fire after 10s even if tiles never finish
        safetyTimer = setTimeout(fire, 10_000);
    }

    // Lifecycle

    dispose() {
        // No-op - kept for API compatibility
    }

    // Private helpers

    private _findOLLayer(layerId: string): BaseTileLayer<TileSource, any> | undefined {
        return this.map.getLayers().getArray()
            .find((l) => l.get("layerId") === layerId) as BaseTileLayer<TileSource, any> | undefined;
    }

}
