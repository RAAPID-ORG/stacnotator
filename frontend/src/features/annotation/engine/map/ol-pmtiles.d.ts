// ol-pmtiles ships untyped JS; this is the slice of it we use.
declare module 'ol-pmtiles' {
  import VectorTileSource from 'ol/source/VectorTile';

  export class PMTilesVectorSource extends VectorTileSource {
    /** `url` points at the .pmtiles archive itself, without the pmtiles:// scheme. */
    constructor(options: { url: string; attributions?: string | string[] });
  }
}
