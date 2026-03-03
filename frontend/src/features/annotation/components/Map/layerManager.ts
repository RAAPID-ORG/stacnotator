import OLMap from "ol/Map";
import type { Layer } from "./Layer";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import PrefetchManager from "openlayers-prefetching";
import BaseTileLayer from "ol/layer/BaseTile";
import type TileSource from "ol/source/Tile";
import { fromLonLat } from "ol/proj";
import { listen, unlistenByKey } from "ol/events";
import type { EventsKey } from "ol/events";

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
 *   - Slice-0 of every window          → background priority 1  (warms all windows)
 *   - Remaining slices of the active window → priority 2
 *   - Remaining slices of other windows     → priority 3, 4, 5 …
 *   - Non-selected viz templates        → NOT registered with the prefetcher
 *   - Basemap layers                   → not registered with the prefetcher
 *
 * Layer ID convention for STAC layers: `stac-w{windowId}-s{sliceIndex}-v{templateId}`
 * This allows the manager to parse windowId, sliceIndex and templateId from a layer ID.
 */
export class LayerManager {
    private layers: Layer[] = [];
    private map: OLMap;
    private activeLayerId: string;
    private prefetchManager: PrefetchManager;

    /** The viz template ID that is currently shown (set by MainMap) */
    private activeVizTemplateId: number | null = null;
    /** The active window ID (parsed from activeLayerId) */
    private activeWindowId: number | null = null;

    /** Suppress _syncPrefetchLayers during bulk registration */
    private _batchMode = false;
    /** Pending debounced _syncPrefetchLayers timer */
    private _syncTimer: ReturnType<typeof setTimeout> | null = null;
    /** When true, background prefetch syncs are suppressed (e.g. during timeline drag) */
    private _prefetchPaused = false;
    /** When true, the active layer is excluded from spatial prefetching (e.g. task mode) */
    private _spatialPrefetchDisabled = false;

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
    // Layer ID helpers
    // -------------------------------------------------------------------------

    /**
     * Parse the windowId and sliceIndex from a STAC layer ID.
     * Format: `stac-w{windowId}-s{sliceIndex}-v{templateId}`
     * Returns null for basemap or non-standard layer IDs.
     */
    private _parseStacLayerId(layerId: string): { windowId: number; sliceIndex: number; templateId: number } | null {
        const match = layerId.match(/^stac-w(\d+)-s(\d+)-v(\d+)$/);
        if (!match) return null;
        return {
            windowId: Number(match[1]),
            sliceIndex: Number(match[2]),
            templateId: Number(match[3]),
        };
    }

    // -------------------------------------------------------------------------
    // Layer registration / removal
    // -------------------------------------------------------------------------

    registerLayer(layer: Layer) {
        const exists = this.layers.some((existing) => existing.id === layer.id);
        if (exists) return; // already registered - don't add a duplicate OL layer

        this.layers.push(layer);

        const olLayer = layer.asOLLayer();
        olLayer.setVisible(false);
        olLayer.set("layerId", layer.id);
        olLayer.set("name", `${layer.name} (${layer.layerType})`);
        olLayer.set("label", `${layer.name} (${layer.layerType})`);

        this.map.addLayer(olLayer);

        // Re-sync prefetch priorities whenever the imagery roster changes
        if (layer.layerType === "imagery" && !this._batchMode) {
            this._scheduleSyncPrefetchLayers();
        }
    }

    /**
     * Register multiple layers in one batch - only calls _syncPrefetchLayers once
     * at the end instead of once per layer. Use this when registering many layers
     * at once (e.g. all STAC slices at startup) to avoid O(n²) work.
     */
    registerLayers(layers: Layer[]) {
        this._batchMode = true;
        let hadImagery = false;
        for (const layer of layers) {
            const exists = this.layers.some((existing) => existing.id === layer.id);
            if (exists) continue;

            this.layers.push(layer);
            const olLayer = layer.asOLLayer();
            olLayer.setVisible(false);
            olLayer.set("layerId", layer.id);
            olLayer.set("name", `${layer.name} (${layer.layerType})`);
            olLayer.set("label", `${layer.name} (${layer.layerType})`);
            this.map.addLayer(olLayer);

            if (layer.layerType === "imagery") hadImagery = true;
        }
        this._batchMode = false;
        if (hadImagery) {
            this._scheduleSyncPrefetchLayers();
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
            this._scheduleSyncPrefetchLayers();
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

        const previousLayerId = this.activeLayerId;
        const previousOLLayer = previousLayerId && previousLayerId !== layerId
            ? olLayers.find((l) => l.get("layerId") === previousLayerId) as BaseTileLayer<TileSource, any> | undefined
            : undefined;

        // Cancel any pending hide on the layer we're about to show (rapid switch guard).
        const pendingHide = newActiveOLLayer.get('_pendingHide') as (() => void) | undefined;
        if (pendingHide) pendingHide();

        // Also cancel any pending hide still running on the previous layer -
        // during rapid switches (e.g. timeline drag) we don't want ghost layers
        // from earlier positions to linger behind the newly active one.
        if (previousOLLayer) {
            const prevPendingHide = previousOLLayer.get('_pendingHide') as (() => void) | undefined;
            if (prevPendingHide) prevPendingHide();
        }

        // Show the new layer - old layer stays visible as backdrop.
        newActiveOLLayer.setVisible(true);

        if (previousOLLayer) {
            this.map.renderSync();

            const source = newActiveOLLayer.getSource();

            let pendingTiles = 0;
            const listenerKeys: EventsKey[] = [];

            const tryHide = () => {
                if (pendingTiles > 0) return;
                listenerKeys.forEach(unlistenByKey);
                listenerKeys.length = 0;
                previousOLLayer.set('_pendingHide', undefined);
                previousOLLayer.setVisible(false);
            };

            const cancel = () => {
                listenerKeys.forEach(unlistenByKey);
                listenerKeys.length = 0;
                previousOLLayer.set('_pendingHide', undefined);
                // Hide immediately on cancel so no ghost lingers
                previousOLLayer.setVisible(false);
            };
            previousOLLayer.set('_pendingHide', cancel);

            if (source) {
                listenerKeys.push(
                    listen(source, 'tileloadstart', () => { pendingTiles++; }),
                    listen(source, 'tileloadend',   () => { pendingTiles = Math.max(0, pendingTiles - 1); tryHide(); }),
                    listen(source, 'tileloaderror', () => { pendingTiles = Math.max(0, pendingTiles - 1); tryHide(); }),
                );

                // Give OL one tick to dispatch any tileloadstart events for the
                // tiles it queued during renderSync, then check if there's anything
                // to wait for at all. If the source was fully warm, pendingTiles
                // will still be 0 and we hide immediately.
                setTimeout(tryHide, 0);
            } else {
                tryHide();
            }
        }

        this.activeLayerId = layerId;

        // Track which window is active (for prefetch priority)
        const parsed = this._parseStacLayerId(layerId);
        this.activeWindowId = parsed?.windowId ?? null;

        // Tell the prefetcher which layer is now active (imagery only)
        const layer = this.layers.find((l) => l.id === layerId);
        if (layer?.layerType === "imagery") {
            this.prefetchManager.setActiveLayer(newActiveOLLayer);
            // If spatial prefetch is disabled (e.g. task mode), keep the new active
            // layer excluded so the prefetcher never issues spatial tiles for it.
            if (this._spatialPrefetchDisabled) {
                this.prefetchManager.excludeLayer(newActiveOLLayer);
            }
            this._scheduleSyncPrefetchLayers();
        }
    }

    /**
     * Atomically set the active layer AND the active viz template, then sync
     * the prefetcher once.  Use this instead of calling setActiveLayer +
     * setActiveVizTemplateId separately, which can race with the debounce timer
     * and leave activeVizTemplateId null when the sync fires.
     */
    setActiveLayerAndViz(layerId: string, vizTemplateId: number) {
        // Update viz template first so _syncPrefetchLayers sees the correct value
        this.activeVizTemplateId = vizTemplateId;
        // Now call the normal setActiveLayer which will schedule the sync
        this.setActiveLayer(layerId);
    }

    getActiveLayer() {
        return this.layers.find((layer) => layer.id === this.activeLayerId);
    }

    /**
     * Tell the LayerManager which visualization template is currently selected.
     * Layers belonging to other viz templates are excluded from background prefetching
     * (they're registered as OL layers so switching is instant, but we don't waste
     * bandwidth pre-loading them).
     */
    setActiveVizTemplateId(templateId: number) {
        if (this.activeVizTemplateId === templateId) return;
        this.activeVizTemplateId = templateId;
        this._scheduleSyncPrefetchLayers();
    }

    /**
     * Enable or disable spatial prefetching for the active layer.
     *
     * In task mode the map snaps to a fixed point per task, so loading tiles
     * around the viewport is wasteful - the area never changes between navigations.
     * Background (window warming) and next-nav prefetch are unaffected.
     *
     * When disabled, the active layer is added to the prefetcher's exclude list
     * so it never issues spatial tiles.  When re-enabled it is re-included.
     * Subsequent `setActiveLayer` calls also respect this flag, so the exclusion
     * persists across layer switches.
     */
    setSpatialPrefetchEnabled(enabled: boolean) {
        if (this._spatialPrefetchDisabled === !enabled) return;
        this._spatialPrefetchDisabled = !enabled;

        const activeOLLayer = this.map.getLayers().getArray()
            .find((l) => l.get('layerId') === this.activeLayerId) as BaseTileLayer<TileSource, any> | undefined;

        if (!activeOLLayer) return;

        if (!enabled) {
            this.prefetchManager.excludeLayer(activeOLLayer);
        } else {
            this.prefetchManager.includeLayer(activeOLLayer);
        }
    }

    /**
     * Pause ONLY the spatial (active-layer) prefetch - background and next-nav
     * tiles continue loading.  Call this during timeline drag so the prefetch
     * engine keeps warming other windows while the user scrubs.
     *
     * Internally we exclude the active OL layer from the prefetcher instead of
     * calling setEnabled(false), which would stop everything.
     */
    pausePrefetch() {
        this._prefetchPaused = true;
        // Cancel any pending background-sync that was already queued
        if (this._syncTimer !== null) {
            clearTimeout(this._syncTimer);
            this._syncTimer = null;
        }
        // Exclude the active layer so the prefetcher stops issuing spatial tiles
        // for it, but background/next-nav work continues unaffected.
        const activeOLLayer = this.map.getLayers().getArray()
            .find((l) => l.get('layerId') === this.activeLayerId) as BaseTileLayer<TileSource, any> | undefined;
        if (activeOLLayer) {
            this.prefetchManager.excludeLayer(activeOLLayer);
        }
    }

    /**
     * Resume after a pausePrefetch() call.
     * Re-includes the active layer and triggers one background-sync.
     */
    resumePrefetch() {
        this._prefetchPaused = false;
        // Re-include the active layer so spatial prefetch resumes
        const activeOLLayer = this.map.getLayers().getArray()
            .find((l) => l.get('layerId') === this.activeLayerId) as BaseTileLayer<TileSource, any> | undefined;
        if (activeOLLayer) {
            this.prefetchManager.includeLayer(activeOLLayer);
        }
        this._syncPrefetchLayers();
    }

    /** Subscribe to live prefetch stats. Fires every ~200ms while active. */
    onPrefetchStats(callback: Parameters<PrefetchManager['onStats']>[0]) {
        this.prefetchManager.onStats(callback);
    }

    /**
     * Register a one-shot callback that fires once ALL background prefetching has
     * finished (queued + loading === 0).  Uses PrefetchManager.onIdle() which
     * auto-unsubscribes after firing.  A safety timeout (default 60 s) prevents
     * the callback from never firing if tiles error out indefinitely.
     */
    onPrefetchIdle(callback: () => void, maxWaitMs = 60_000) {
        this.prefetchManager.onIdle(callback, maxWaitMs);
    }

    /**
     * Register a one-shot callback that fires once:
     *   1. The active imagery layer's viewport tiles are fully loaded, AND
     *   2. All background prefetch work has drained to idle.
     *
     * This is what gates the initial loading overlay - the user won't see the
     * map until both conditions are met, so switching windows is instant.
     *
     * Stage 1 - active layer rendered (10 s safety):
     *   Counts in-flight tileloadstart/end/error events on the active source,
     *   combined with map `rendercomplete`.  Fires when both agree the viewport
     *   is done.
     *
     * Stage 2 - prefetch queue idle (60 s safety):
     *   Waits for PrefetchManager to report queued + loading === 0.
     *
     * @param callback          Fires after BOTH stages complete (post-prefetch idle).
     */
    onceActiveLayerRendered(callback: () => void) {
        let fired = false;
        let pendingTiles = 0;
        let safetyTimer: ReturnType<typeof setTimeout> | null = null;
        const keys: EventsKey[] = [];

        const cleanup = () => {
            keys.forEach(unlistenByKey);
            keys.length = 0;
            if (safetyTimer !== null) { clearTimeout(safetyTimer); safetyTimer = null; }
        };

        // Stage 2: wait for full prefetch idle, then fire the real callback
        const advanceToStage2 = () => {
            this.prefetchManager.onIdle(callback, 60_000);
        };

        const fire = () => {
            if (fired) return;
            fired = true;
            cleanup();
            advanceToStage2();
        };

        const tryFire = () => {
            if (pendingTiles === 0) fire();
        };

        // Stage 1: count in-flight tiles on the active source
        const olLayer = this.map.getLayers().getArray()
            .find((l) => l.get('layerId') === this.activeLayerId) as BaseTileLayer<TileSource, any> | undefined;
        const source = olLayer?.getSource?.() ?? null;

        if (source) {
            keys.push(
                listen(source, 'tileloadstart', () => { pendingTiles++; }),
                listen(source, 'tileloadend',   () => { pendingTiles = Math.max(0, pendingTiles - 1); tryFire(); }),
                listen(source, 'tileloaderror', () => { pendingTiles = Math.max(0, pendingTiles - 1); tryFire(); }),
            );
        }

        // OL fires rendercomplete when all visible tile layers are idle -
        // use it as a secondary signal in case the source was already warm.
        this.map.once('rendercomplete', tryFire);

        // Safety: if the active layer never fires any tile events (e.g. fully cached),
        // advance to stage 2 after 10 s regardless.
        safetyTimer = setTimeout(fire, 10_000);
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
        if (this._syncTimer !== null) {
            clearTimeout(this._syncTimer);
            this._syncTimer = null;
        }
        this.prefetchManager.dispose();
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Schedule a _syncPrefetchLayers call on the next microtask tick.
     * Multiple calls within the same synchronous block collapse into one rebuild.
     */
    private _scheduleSyncPrefetchLayers() {
        if (this._prefetchPaused) return; // suppressed during timeline drag
        if (this._syncTimer !== null) return; // already scheduled
        this._syncTimer = setTimeout(() => {
            this._syncTimer = null;
            this._syncPrefetchLayers();
        }, 0);
    }


    /**
     * Rebuild the prefetcher's background layer list from scratch.
     *
     * Priority order (lower number = loaded first):
     *   1. Slice-0 of every OTHER window with the active viz template.
     *      This warms all windows so switching windows is instant.
     *   2. The adjacent slice (nearest by index) of the ACTIVE window.
     *      Only added when the active layer is NOT already slice-0 of that window,
     *      and only if bandwidth allows (registered after all window slice-0s).
     *
     * Layers that are already the active layer are always skipped.
     */
    private _syncPrefetchLayers() {
        if (this.activeWindowId === null || this.activeVizTemplateId === null) return;

        const olLayers = this.map.getLayers().getArray();

        // Clear existing background registrations
        const existing = this.prefetchManager.getBackgroundLayers();
        existing.forEach((entry) =>
            this.prefetchManager.removeBackgroundLayer(entry.layer)
        );

        const activeParsed = this._parseStacLayerId(this.activeLayerId);
        const activeSliceIndex = activeParsed?.sliceIndex ?? 0;

        let priority = 1;

        // ── Phase 1: slice-0 of every window (active viz template) ────────────
        // Get all unique window IDs that have at least one registered layer
        const allWindowIds = [...new Set(
            this.layers
                .filter((l) => l.layerType === 'imagery')
                .map((l) => this._parseStacLayerId(l.id)?.windowId)
                .filter((id): id is number => id !== undefined)
        )];

        for (const windowId of allWindowIds) {
            const layerId = `stac-w${windowId}-s0-v${this.activeVizTemplateId}`;
            if (layerId === this.activeLayerId) continue; // already the active layer

            const olLayer = olLayers.find((l) => l.get("layerId") === layerId) as BaseTileLayer<TileSource, any> | undefined;
            if (olLayer) {
                this.prefetchManager.addBackgroundLayer(olLayer, priority++);
            }
        }

        // ── Phase 2: adjacent slice of the active window ───────────────────────
        // Only useful when active slice is not slice-0 (slice-0 is already covered above).
        // Find the nearest slice index to the active one (excluding slice-0 and active).
        if (activeSliceIndex !== 0) {
            const suffix = `-v${this.activeVizTemplateId}`;
            const prefix = `stac-w${this.activeWindowId}-`;

            const otherSlices = this.layers
                .filter((l) =>
                    l.layerType === 'imagery' &&
                    l.id.startsWith(prefix) &&
                    l.id.endsWith(suffix) &&
                    l.id !== this.activeLayerId
                )
                .map((l) => this._parseStacLayerId(l.id)?.sliceIndex)
                .filter((idx): idx is number => idx !== undefined && idx !== 0)
                .sort((a, b) => Math.abs(a - activeSliceIndex) - Math.abs(b - activeSliceIndex));

            const nearestSlice = otherSlices[0];
            if (nearestSlice !== undefined) {
                const layerId = `stac-w${this.activeWindowId}-s${nearestSlice}-v${this.activeVizTemplateId}`;
                const olLayer = olLayers.find((l) => l.get("layerId") === layerId) as BaseTileLayer<TileSource, any> | undefined;
                if (olLayer) {
                    this.prefetchManager.addBackgroundLayer(olLayer, priority);
                }
            }
        }
    }
}
