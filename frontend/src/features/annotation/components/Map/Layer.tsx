import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";

export type LayerType = "imagery" | "basemap";

export abstract class Layer {
    readonly id: string;
    readonly name: string;
    readonly layerType: LayerType;

    protected constructor(id: string, name: string, layerType: LayerType) {
        this.id = id;
        this.name = name;
        this.layerType = layerType;
    }

    abstract asOLLayer(): TileLayer<XYZ>;
}

export class XYZLayer extends Layer {
    readonly urlTemplate: string;
    readonly attribution?: string;
    readonly minZoom?: number;
    readonly maxZoom?: number;

    constructor(params: {
        id: string;
        name: string;
        layerType: LayerType;
        urlTemplate: string;
        attribution?: string;
        minZoom?: number;
        maxZoom?: number;
    }) {
        super(params.id, params.name, params.layerType);
        this.urlTemplate = params.urlTemplate;
        this.attribution = params.attribution;
        this.minZoom = params.minZoom;
        this.maxZoom = params.maxZoom;
    }

    asOLLayer() {
        return new TileLayer({
            preload: 4,
            source: new XYZ({
                url: this.urlTemplate,
                attributions: this.attribution,
                minZoom: this.minZoom,
                maxZoom: this.maxZoom,
                crossOrigin: "anonymous",
                cacheSize: 512,
                transition: 0,  // disable fade-in so tiles snap in immediately
            }),
        });
    }   
}