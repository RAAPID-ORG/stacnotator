import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { tileLoadImagery } from '../../utils/tileLoading';

export type LayerType = 'imagery' | 'basemap';

/** Bing-style quadkey: interleave x/y bits per zoom level into a base-4 string. */
function tileXYZToQuadkey(x: number, y: number, z: number): string {
  let q = '';
  for (let i = z; i > 0; i--) {
    const mask = 1 << (i - 1);
    q += String((x & mask ? 1 : 0) + (y & mask ? 2 : 0));
  }
  return q;
}

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
  readonly preload?: number;
  readonly crossOrigin: 'anonymous' | 'use-credentials';

  constructor(params: {
    id: string;
    name: string;
    layerType: LayerType;
    urlTemplate: string;
    attribution?: string;
    minZoom?: number;
    maxZoom?: number;
    /** OL preload depth. Defaults to 0 for imagery, 4 for basemaps. Use Infinity for eager neighbour/zoom prefetching. */
    preload?: number;
    /** Credentialed for our tilers (cookie auth); anonymous for MPC/public. Default anonymous. */
    crossOrigin?: 'anonymous' | 'use-credentials';
  }) {
    super(params.id, params.name, params.layerType);
    this.urlTemplate = params.urlTemplate;
    this.attribution = params.attribution;
    this.minZoom = params.minZoom;
    this.maxZoom = params.maxZoom;
    this.preload = params.preload;
    this.crossOrigin = params.crossOrigin ?? 'anonymous';
  }

  asOLLayer() {
    const template = this.urlTemplate;
    const baseOpts = {
      attributions: this.attribution,
      minZoom: this.minZoom,
      maxZoom: this.maxZoom,
      crossOrigin: this.crossOrigin,
      cacheSize: 512,
      transition: 150,
      ...(this.layerType === 'imagery'
        ? {
            tileLoadFunction: tileLoadImagery as unknown as (tile: unknown, src: string) => void,
          }
        : {}),
    };
    const source = template.includes('{q}')
      ? new XYZ({
          ...baseOpts,
          tileUrlFunction: ([z, x, y]) => template.replace('{q}', tileXYZToQuadkey(x, y, z)),
        })
      : new XYZ({ ...baseOpts, url: template });
    return new TileLayer({
      preload: this.preload ?? (this.layerType === 'imagery' ? 0 : 4),
      source,
    });
  }
}
