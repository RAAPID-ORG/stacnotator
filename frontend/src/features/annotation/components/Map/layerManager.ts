import OLMap from 'ol/Map';
import type { Layer } from './Layer';
import BaseTileLayer from 'ol/layer/BaseTile';
import type TileSource from 'ol/source/Tile';
import { listen, unlistenByKey } from 'ol/events';
import type { EventsKey } from 'ol/events';

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

  // Busy/idle tracking for the active layer's tile source
  private busyListenerKeys: EventsKey[] = [];
  private activeTilePending = 0;
  private _busy = false;
  private busyChangeListeners: Array<(busy: boolean) => void> = [];
  /** Debounce timer - waits a short period after pending hits 0 before
   *  declaring idle, because OL often fires tileloadend immediately
   *  followed by another tileloadstart during pan/zoom. */
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly IDLE_DEBOUNCE_MS = 150;

  constructor(map: OLMap) {
    this.map = map;
  }

  // Layer registration / removal

  registerLayer(layer: Layer) {
    if (this.layers.some((l) => l.id === layer.id)) return;

    this.layers.push(layer);
    const olLayer = layer.asOLLayer();
    olLayer.setVisible(false);
    olLayer.set('layerId', layer.id);
    olLayer.set('name', `${layer.name} (${layer.layerType})`);
    olLayer.set('label', `${layer.name} (${layer.layerType})`);
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
    const previousOL =
      this.activeLayerId && this.activeLayerId !== layerId
        ? this._findOLLayer(this.activeLayerId)
        : undefined;
    if (previousOL) previousOL.setVisible(false);

    // Show the new layer
    newOL.setVisible(true);
    this.activeLayerId = layerId;

    // Re-attach busy listeners to the new active layer
    this._attachBusyListeners();
  }

  // Busy/idle tracking API

  /**
   * Whether the active layer is currently loading tiles.
   */
  get busy() {
    return this._busy;
  }

  /**
   * Subscribe to busy/idle transitions. Returns an unsubscribe function.
   */
  onBusyChange(listener: (busy: boolean) => void): () => void {
    this.busyChangeListeners.push(listener);
    return () => {
      this.busyChangeListeners = this.busyChangeListeners.filter((l) => l !== listener);
    };
  }

  /** Returns the underlying OL Map. */
  getMap(): OLMap {
    return this.map;
  }

  /** Returns the current active layer ID. */
  getActiveLayerId(): string {
    return this.activeLayerId;
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
      if (safetyTimer !== null) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
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
        listen(source, 'tileloadstart', () => {
          pending++;
        }),
        listen(source, 'tileloadend', () => {
          pending = Math.max(0, pending - 1);
          tryFire();
        }),
        listen(source, 'tileloaderror', () => {
          pending = Math.max(0, pending - 1);
          tryFire();
        })
      );
    }

    this.map.once('rendercomplete', tryFire);

    // Safety: fire after 10s even if tiles never finish
    safetyTimer = setTimeout(fire, 10_000);
  }

  // Lifecycle

  dispose() {
    this._detachBusyListeners();
    this.busyChangeListeners = [];
  }

  // Private helpers

  private _setBusy(busy: boolean) {
    if (busy === this._busy) return;
    this._busy = busy;
    for (const fn of this.busyChangeListeners) fn(busy);
  }

  /** Detach existing tile-load listeners from the previous active layer. */
  private _detachBusyListeners() {
    this.busyListenerKeys.forEach(unlistenByKey);
    this.busyListenerKeys = [];
    this.activeTilePending = 0;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this._setBusy(false);
  }

  /** Attach tile-load listeners to the current active layer's source. */
  private _attachBusyListeners() {
    this._detachBusyListeners();

    const olLayer = this._findOLLayer(this.activeLayerId);
    const source = olLayer?.getSource?.() ?? null;
    if (!source) return;

    const checkIdle = () => {
      if (this.activeTilePending <= 0) {
        // Debounce: wait a short period before declaring idle
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
          if (this.activeTilePending <= 0) {
            this._setBusy(false);
          }
        }, LayerManager.IDLE_DEBOUNCE_MS);
      }
    };

    this.busyListenerKeys.push(
      listen(source, 'tileloadstart', () => {
        this.activeTilePending++;
        if (this.idleTimer) {
          clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
        this._setBusy(true);
      }),
      listen(source, 'tileloadend', () => {
        this.activeTilePending = Math.max(0, this.activeTilePending - 1);
        checkIdle();
      }),
      listen(source, 'tileloaderror', () => {
        this.activeTilePending = Math.max(0, this.activeTilePending - 1);
        checkIdle();
      })
    );
  }

  private _findOLLayer(layerId: string): BaseTileLayer<TileSource, any> | undefined {
    return this.map
      .getLayers()
      .getArray()
      .find((l) => l.get('layerId') === layerId) as BaseTileLayer<TileSource, any> | undefined;
  }
}
