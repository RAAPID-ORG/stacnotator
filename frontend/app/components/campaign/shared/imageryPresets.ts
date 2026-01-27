import type { ImageryCreate } from '~/api/client';

export type ImageryPreset = {
  id: string;
  label: string;
  template: Omit<ImageryCreate, 'start_ym' | 'end_ym'>;
};

export const IMAGERY_PRESETS: ImageryPreset[] = [
  {
    id: 'sentinel2',
    label: 'Sentinel-2 L2A',
    template: {
      name: 'Sentinel-2 L2A',
      crosshair_hex6: '00ff00',
      default_zoom: 12,
      window_interval: 1,
      window_unit: 'months',
      slicing_interval: 1,
      slicing_unit: 'weeks',
      registration_url: 'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register',
      search_body: JSON.stringify({
        bbox: '{campaignBBoxPlaceholder}',
        filter: {
          op: 'and',
          args: [
            {
              op: 'anyinteracts',
              args: [
                { property: 'datetime' },
                { interval: ['{startDatetimePlaceholder}', '{endDatetimePlaceholder}'] },
              ],
            },
            {
              op: '<=',
              args: [{ property: 'eo:cloud_cover' }, 20],
            },
            {
              op: '=',
              args: [{ property: 'collection' }, 'sentinel-2-l2a'],
            },
          ],
        },
        metadata: {
          type: 'mosaic',
          maxzoom: 24,
          minzoom: 0,
          pixel_selection: 'median',
        },
        filterLang: 'cql2-json',
        collections: ['sentinel-2-l2a'],
      }, null, 2),
      visualization_url_templates: [
        {
          name: 'True Color',
          visualization_url: 'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}?assets=B04&assets=B03&assets=B02&nodata=0&color_formula=Gamma+RGB+3.2+Saturation+0.8+Sigmoidal+RGB+25+0.35&collection=sentinel-2-l2a&pixel_selection=median',
        },
        {
          name: 'False Color',
          visualization_url: 'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}?assets=B08&assets=B04&assets=B03&nodata=0&color_formula=Gamma RGB 3.7 Saturation 1.5 Sigmoidal RGB 15 0.35&collection=sentinel-2-l2a&pixel_selection=median',
        },
        {
          name: 'NDVI',
          visualization_url: 'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}?assets=B08&assets=B04&nodata=0&expression=(B08-B04)/(B08%2BB04)&rescale=-1,1&colormap_name=rdylgn&collection=sentinel-2-l2a&pixel_selection=median',
        },
      ],
    },
  },
];

export const emptyImagery = (): ImageryCreate => ({
  name: '',
  start_ym: '',
  end_ym: '',
  crosshair_hex6: 'ff0000',
  default_zoom: 10,
  window_interval: undefined,
  window_unit: undefined,
  registration_url: '',
  search_body: '',
  visualization_url_templates: [],
});
