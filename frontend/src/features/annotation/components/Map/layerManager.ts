import OLMap from "ol/Map";
import type { Layer } from "./Layer";
import BaseTileLayer from "ol/layer/BaseTile";
import type TileSource from "ol/source/Tile";
import { listen, unlistenByKey } from "ol/events";
import type { EventsKey } from "ol/events";
import PrefetchManager from "openlayers-prefetching";

/** Stats snapshot type inferred from PrefetchManager.onStats callback signature. */
export type PrefetchStatsSnapshot = Parameters<Parameters<PrefetchManager['onStats']>[0]>[0];

type OLTileLayer = BaseTileLayer<TileSource, any>;

/**
 * LayerManager - manages the OL layer registry and active layer switching.
 *
 * Responsibilities:
 *   - Register / remove Layer instances and add them to the OL map
 *   - Switch the active (visible) layer with a smooth crossfade
 *   - Notify when the active layer's tiles have finished rendering
 *   - Manage tile prefetching via openlayers-prefetching
 *
 * Layer ID convention for STAC layers: `stac-w{windowId}-s{sliceIndex}-v{templateId}`
 */
export class LayerManager {
    private layers: Layer[] = [];
    private map: OLMap;
    private activeLayerId = '';
    private prefetchManager: PrefetchManager | null = null;

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
     * Switch the visible layer. The new layer becomes visible immediately;
     * the previous layer is hidden once the new one's tiles have loaded
     * (smooth crossfade, no white flash).
     *
     * If the new layer's tiles were already prefetched the switch is
     * essentially instantaneous — no network requests, no flash.
     */
    setActiveLayer(layerId: string) {
        const newOL = this._findOLLayer(layerId);
        if (!newOL) return;

        const previousId = this.activeLayerId;
        const previousOL = previousId && previousId !== layerId
            ? this._findOLLayer(previousId) : undefined;

        // Cancel any pending hides from earlier switches
        this._cancelPendingHide(newOL);
        if (previousOL) this._cancelPendingHide(previousOL);

        // Show the new layer immediately (tiles may still be loading)
        newOL.setVisible(true);
        this.activeLayerId = layerId;

        if (!previousOL) return;

        // Check if the new layer's source already has all visible tiles cached.
        // If so, hide the old layer on the very next animation frame so the
        // transition is instant.
        const source = newOL.getSource();
        let pending = 0;
        const keys: EventsKey[] = [];
        let done = false;

        const finish = () => {
            if (done) return;
            done = true;
            keys.forEach(unlistenByKey);
            keys.length = 0;
            previousOL.set('_pendingHide', undefined);
            previousOL.setVisible(false);
        };

        const cancel = () => {
            done = true;
            keys.forEach(unlistenByKey);
            keys.length = 0;
            previousOL.set('_pendingHide', undefined);
            previousOL.setVisible(false);
        };
        previousOL.set('_pendingHide', cancel);

        if (source) {
            keys.push(
                listen(source, 'tileloadstart', () => { pending++; }),
                listen(source, 'tileloadend', () => { pending = Math.max(0, pending - 1); if (pending === 0) finish(); }),
                listen(source, 'tileloaderror', () => { pending = Math.max(0, pending - 1); if (pending === 0) finish(); }),
            );
            // If tiles are already in the source cache no events will fire.
            // Use rAF so the layer has one frame to render cached tiles, then
            // hide the old one.
            requestAnimationFrame(() => {
                if (pending === 0) finish();
            });
        } else {
            finish();
        }
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
        this.prefetchManager?.dispose();
        this.prefetchManager = null;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Prefetching
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Initialise the PrefetchManager.
     * Safe to call multiple times - disposes previous manager first.
     */
    initPrefetching(options?: {
        spatialBufferFactor?: number;
        maxConcurrent?: number;
        enableSpatial?: boolean;
    }) {
        this.prefetchManager?.dispose();

        this.prefetchManager = new PrefetchManager({
            map: this.map,
            spatialBufferFactor: options?.spatialBufferFactor ?? 0.5,
            maxConcurrentPrefetches: options?.maxConcurrent ?? 6,
            idleDelay: 150,
            tickInterval: 300,
            enabled: true,
            loadActiveDuringInteraction: true,
        });

        // If spatial prefetching is disabled (task mode), set priority to 0 so
        // the planner skips it entirely.
        if (options?.enableSpatial === false) {
            this.prefetchManager.setCategoryPriorities({
                spatial: 0,
                bgBuffer: 0,
            } as any);
        }
    }

    /** Get the underlying PrefetchManager (null if not initialized). */
    getPrefetchManager() {
        return this.prefetchManager;
    }

    /**
     * Configure background-layer prefetching.
     * Pass an array of layer IDs with priorities (lower = higher priority).
     * Only imagery layers that are already registered on this LayerManager
     * will be matched.
     */
    setBackgroundLayers(entries: Array<{ layerId: string; priority: number }>) {
        if (!this.prefetchManager) return;

        const olEntries: Array<{ layer: OLTileLayer; priority: number }> = [];
        for (const entry of entries) {
            const olLayer = this._findOLLayer(entry.layerId);
            if (olLayer) {
                olEntries.push({ layer: olLayer, priority: entry.priority });
            }
        }
        this.prefetchManager.syncBackgroundLayers(olEntries);
    }

    /**
     * Set the active layer for prefetching (spatial tiles around viewport).
     * This should generally match the visible active layer.
     */
    setPrefetchActiveLayer(layerId: string) {
        if (!this.prefetchManager) return;
        const olLayer = this._findOLLayer(layerId);
        if (olLayer) {
            this.prefetchManager.setActiveLayer(olLayer);
        }
    }

    /**
     * Set the primary layer to prefetch at next-navigation targets.
     */
    setPrefetchNextNavLayer(layerId: string) {
        if (!this.prefetchManager) return;
        const olLayer = this._findOLLayer(layerId);
        if (olLayer) {
            this.prefetchManager.setNextNavLayer(olLayer);
        }
    }

    /**
     * Set next-navigation targets (e.g. next task location).
     */
    setPrefetchNextTargets(targets: Array<{ center: [number, number]; zoom: number }>) {
        if (!this.prefetchManager) return;
        this.prefetchManager.setNextTargets(targets);
    }

    /** Clear next-nav targets. */
    clearPrefetchNextTargets() {
        this.prefetchManager?.clearNextTargets();
    }

    /** Subscribe to prefetch stats updates. Returns unsubscribe function. */
    onPrefetchStats(callback: (stats: PrefetchStatsSnapshot) => void): () => void {
        if (!this.prefetchManager) return () => {};
        this.prefetchManager.onStats(callback);
        // PrefetchManager doesn't provide an off() - disposal cleans up
        return () => {};
    }

    // Private helpers

    private _findOLLayer(layerId: string): BaseTileLayer<TileSource, any> | undefined {
        return this.map.getLayers().getArray()
            .find((l) => l.get("layerId") === layerId) as BaseTileLayer<TileSource, any> | undefined;
    }

    private _cancelPendingHide(olLayer: BaseTileLayer<TileSource, any>) {
        const cancel = olLayer.get('_pendingHide') as (() => void) | undefined;
        if (cancel) cancel();
    }
}
