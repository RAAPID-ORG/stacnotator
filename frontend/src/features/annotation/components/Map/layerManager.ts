import OLMap from "ol/Map";
import type { Layer } from "./Layer";
import TileLayer from "ol/layer/Tile";


export class LayerManager {
    private layers: Layer[] = [];
    private map: OLMap;
    private activeLayerId: string | null = null;

    constructor(map: OLMap) {
        this.map = map;
    }

    registerLayer(layer: Layer) {
        const exists = this.layers.some((existing) => existing.id === layer.id);
        if (!exists) {
            this.layers.push(layer);
        }

        const olLayer = layer.asOLLayer();
        olLayer.setVisible(false);
        olLayer.set("layerId", layer.id);
        olLayer.set("name", `${layer.name} (${layer.layerType})`);
        olLayer.set("label", `${layer.name} (${layer.layerType})`);
        olLayer.set("preload", Infinity);

        this.map.addLayer(olLayer);
    }

    removeLayer(layerId: string) {
        this.layers = this.layers.filter((layer) => layer.id !== layerId);
        const mapLayers = this.map.getLayers().getArray();
        const olLayer = mapLayers.find((layer) => layer.get("layerId") === layerId);
        if (olLayer) {
            this.map.removeLayer(olLayer);
        }
        if (this.activeLayerId === layerId) {
            this.activeLayerId = null;
        }
    }

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

    setActiveLayer(layerId: string) {
        const newActiveLayer = this.map
            .getLayers()
            .getArray()
            .find((layer) => layer.get("layerId") === layerId);

        if (!newActiveLayer) return;

        newActiveLayer.setVisible(true);
        this.map.renderSync();

        if (this.activeLayerId) {
            const previousLayer = this.map
                .getLayers()
                .getArray()
                .find((layer) => layer.get("layerId") === this.activeLayerId)
            if (previousLayer) {
                previousLayer.setVisible(false);
            }
        }

        this.activeLayerId = layerId;

    }
}