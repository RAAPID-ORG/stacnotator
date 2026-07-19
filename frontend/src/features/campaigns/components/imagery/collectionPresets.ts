/**
 * Band presets, rescale defaults, and colormaps for known STAC collections.
 * Ported from geo-ai-agents' collectionPresets.ts.
 */

export interface BandPreset {
  label: string;
  assets: string[];
  /** 1-based band indexes within a single multiband asset (e.g. [6,4,2]). When set, `assets`
   *  must be the single multiband asset and the tiler slices the output to these bands. */
  bidx?: number[];
  colormap?: string;
  rescale?: string;
  expression?: string;
  colorFormula?: string;
  /** Fill value to render transparent (e.g. 0 for Landsat C2 L2 / Sentinel-2 L2A). */
  nodata?: number;
  /** Extra query parameters passed through to the tiler (e.g. asset_bidx=image|1,2,3) */
  extraParams?: Record<string, string>;
}

export const COLLECTION_PRESETS: Record<string, BandPreset[]> = {
  // 8-band PlanetScope biweekly composites: one multiband "data" asset.
  // Bands: 1 coastal_blue, 2 blue, 3 green_i, 4 green, 5 yellow, 6 red, 7 rededge, 8 nir.
  planet_ethiopia_biweekly: [
    { label: 'True Color (RGB)', assets: ['data'], bidx: [6, 4, 2], rescale: '0,3000' },
    { label: 'Color Infrared (Vegetation)', assets: ['data'], bidx: [8, 6, 4], rescale: '0,3000' },
    { label: 'NIR', assets: ['data'], bidx: [8], rescale: '0,3000', colormap: 'viridis' },
  ],
  'sentinel-2-l2a': [
    { label: 'True Color (RGB)', assets: ['visual'] },
    {
      label: 'False Color (Vegetation)',
      assets: ['B08', 'B04', 'B03'],
      colorFormula: 'gamma RGB 3.7, saturation 1.5, sigmoidal RGB 15 0.35',
      nodata: 0,
    },
    {
      label: 'Agriculture',
      assets: ['B11', 'B08', 'B02'],
      colorFormula: 'gamma RGB 3.2, saturation 0.8, sigmoidal RGB 25 0.35',
      nodata: 0,
    },
    {
      label: 'SWIR',
      assets: ['B12', 'B8A', 'B04'],
      colorFormula: 'gamma RGB 3.2, saturation 0.8, sigmoidal RGB 25 0.35',
      nodata: 0,
    },
    {
      label: 'Geology',
      assets: ['B12', 'B11', 'B02'],
      colorFormula: 'gamma RGB 3.2, saturation 0.8, sigmoidal RGB 25 0.35',
      nodata: 0,
    },
    {
      // Expression-based: the referenced bands must be listed as assets so the
      // tiler loads them (with asset_as_band); the expression reduces them to a
      // single colorized band.
      label: 'NDVI',
      assets: ['B08', 'B04'],
      expression: '(B08-B04)/(B08+B04)',
      colormap: 'rdylgn',
      rescale: '-1,1',
      nodata: 0,
    },
  ],
  'sentinel-2-l1c': [
    {
      label: 'True Color (RGB)',
      assets: ['B04', 'B03', 'B02'],
      colorFormula: 'gamma RGB 3.2, saturation 0.8, sigmoidal RGB 25 0.35',
    },
    {
      label: 'False Color (Vegetation)',
      assets: ['B08', 'B04', 'B03'],
      colorFormula: 'gamma RGB 3.7, saturation 1.5, sigmoidal RGB 15 0.35',
    },
    { label: 'Visual (rendered)', assets: ['visual'] },
  ],
  'landsat-c2-l2': [
    {
      label: 'True Color',
      assets: ['red', 'green', 'blue'],
      colorFormula: 'gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55',
      nodata: 0,
    },
    {
      label: 'False Color',
      assets: ['nir08', 'red', 'green'],
      colorFormula: 'gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55',
      nodata: 0,
    },
    {
      label: 'SWIR',
      assets: ['swir16', 'nir08', 'red'],
      colorFormula: 'gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55',
      nodata: 0,
    },
    {
      label: 'Agriculture',
      assets: ['swir16', 'nir08', 'blue'],
      colorFormula: 'gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55',
      nodata: 0,
    },
    {
      label: 'NDVI',
      assets: ['nir08', 'red'],
      expression: '(nir08-red)/(nir08+red)',
      colormap: 'rdylgn',
      rescale: '-1,1',
      nodata: 0,
    },
  ],
  'landsat-c2-l1': [
    {
      label: 'True Color',
      assets: ['red', 'green', 'blue'],
      colorFormula: 'gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55',
      nodata: 0,
    },
    {
      label: 'False Color',
      assets: ['nir08', 'red', 'green'],
      colorFormula: 'gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55',
      nodata: 0,
    },
    {
      label: 'NDVI',
      assets: ['nir08', 'red'],
      expression: '(nir08-red)/(nir08+red)',
      colormap: 'rdylgn',
      rescale: '-1,1',
      nodata: 0,
    },
  ],
  'cop-dem-glo-30': [{ label: 'Elevation', assets: ['data'], colormap: 'terrain' }],
  'cop-dem-glo-90': [{ label: 'Elevation', assets: ['data'], colormap: 'terrain' }],
  naip: [
    {
      label: 'True Color (RGB)',
      assets: ['image'],
      extraParams: { asset_bidx: 'image|1,2,3' },
    },
  ],
  'hls2-s30': [
    {
      label: 'True Color (RGB)',
      assets: ['B04', 'B03', 'B02'],
      colorFormula: 'gamma RGB 3.5, saturation 1.2, sigmoidal RGB 15 0.35',
    },
    {
      label: 'False Color (Vegetation)',
      assets: ['B8A', 'B04', 'B03'],
      colorFormula: 'gamma RGB 3.5, saturation 1.2, sigmoidal RGB 15 0.35',
    },
    {
      label: 'Agriculture',
      assets: ['B11', 'B8A', 'B02'],
      colorFormula: 'gamma RGB 3.5, saturation 1.2, sigmoidal RGB 15 0.35',
    },
    {
      label: 'NDVI',
      assets: ['B8A', 'B04'],
      expression: '(B8A-B04)/(B8A+B04)',
      colormap: 'rdylgn',
      rescale: '-1,1',
    },
  ],
  'hls2-l30': [
    {
      label: 'True Color (RGB)',
      assets: ['B04', 'B03', 'B02'],
      colorFormula: 'gamma RGB 3.5, saturation 1.2, sigmoidal RGB 15 0.35',
    },
    {
      label: 'False Color (Vegetation)',
      assets: ['B05', 'B04', 'B03'],
      colorFormula: 'gamma RGB 3.5, saturation 1.2, sigmoidal RGB 15 0.35',
    },
    {
      label: 'NDVI',
      assets: ['B05', 'B04'],
      expression: '(B05-B04)/(B05+B04)',
      colormap: 'rdylgn',
      rescale: '-1,1',
    },
  ],
  'sentinel-1-grd': [
    // MPC stores VV/VH as uint16 amplitude DNs; single-band grayscale uses 0..250
    // (matches the MPC Explorer defaults for sentinel-1-grd).
    { label: 'VV Backscatter', assets: ['vv'], colormap: 'greys', rescale: '0,250' },
    { label: 'VH Backscatter', assets: ['vh'], colormap: 'greys', rescale: '0,250' },
  ],
  'modis-13Q1-061': [
    { label: 'NDVI', assets: ['250m_16_days_NDVI'], colormap: 'rdylgn', rescale: '-2000,10000' },
    { label: 'EVI', assets: ['250m_16_days_EVI'], colormap: 'rdylgn', rescale: '-2000,10000' },
  ],
};

export const KNOWN_RESCALE: Record<string, string> = {
  'cop-dem-glo-30': '0,4000',
  'cop-dem-glo-90': '0,4000',
  'sentinel-1-grd': '0,250',
  naip: '0,255',
};

export function guessRescale(collectionId: string): string | undefined {
  const id = collectionId.toLowerCase();
  if (id.includes('dem') || id.includes('elevation')) return '0,4000';
  if (id.includes('sentinel-1') || id.includes('sar')) return '0,250';
  return undefined;
}

export const COLORMAPS = [
  { value: 'viridis', label: 'Viridis' },
  { value: 'plasma', label: 'Plasma' },
  { value: 'inferno', label: 'Inferno' },
  { value: 'magma', label: 'Magma' },
  { value: 'terrain', label: 'Terrain' },
  { value: 'rdylgn', label: 'Red-Yellow-Green' },
  { value: 'spectral', label: 'Spectral' },
  { value: 'greys', label: 'Grayscale' },
  { value: 'blues', label: 'Blues' },
  { value: 'ylgnbu', label: 'Yellow-Green-Blue' },
  { value: 'coolwarm', label: 'Cool-Warm' },
];

const RGB_ASSET_KEYS = new Set(['visual', 'rendered_preview', 'true_color', 'image']);

export function isPreRenderedRGB(assetKey: string, roles?: string[]): boolean {
  if (RGB_ASSET_KEYS.has(assetKey.toLowerCase())) return true;
  if (roles?.includes('visual')) return true;
  return false;
}

export interface AssetInfo {
  title: string;
  type: string;
  roles: string[];
  /** eo:bands of this asset (order = band index). Present for single multiband assets
   *  (e.g. an 8-band COG exposed as one asset), enabling per-band selection via bidx. */
  bands?: { name: string; description?: string | null }[];
}

export function getRasterAssets(assets: Record<string, AssetInfo>): [string, AssetInfo][] {
  return Object.entries(assets).filter(([key, info]) => {
    const type = (info.type || '').toLowerCase();
    const roles = info.roles || [];
    return (
      type.includes('tiff') ||
      type.includes('geotiff') ||
      type.includes('cog') ||
      type.includes('jp2') ||
      roles.includes('data') ||
      roles.includes('visual') ||
      (!type &&
        !roles.length &&
        key !== 'tilejson' &&
        key !== 'rendered_preview' &&
        key !== 'thumbnail')
    );
  });
}
