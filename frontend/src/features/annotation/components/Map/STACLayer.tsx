import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import { Layer } from "./Layer";

/**
 * A Layer backed by a STAC-registered tile URL.
 * The URL is already fully resolved (searchId substituted) before this object
 * is constructed - registration happens outside in useStacLayers.
 */
export class STACLayer extends Layer {
    readonly tileUrl: string;
    readonly attribution?: string;

    constructor(params: {
        id: string;
        name: string;
        tileUrl: string;
        attribution?: string;
    }) {
        super(params.id, params.name, "imagery");
        this.tileUrl = params.tileUrl;
        this.attribution = params.attribution;
    }

    asOLLayer(): TileLayer<XYZ> {
        return new TileLayer({
            source: new XYZ({
                url: this.tileUrl,
                attributions: this.attribution,
                // Cross-origin needed for most STAC tile providers
                crossOrigin: "anonymous",
            }),
        });
    }
}
