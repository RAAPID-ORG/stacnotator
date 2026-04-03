/**
 * Band presets, rescale defaults, and colormaps for known STAC collections.
 * Ported from geo-ai-agents' collectionPresets.ts.
 */

export interface BandPreset {
  label: string;
  assets: string[];
  colormap?: string;
  rescale?: string;
  expression?: string;
  colorFormula?: string;
  /** Extra query parameters passed through to the tiler (e.g. asset_bidx=image|1,2,3) */
  extraParams?: Record<string, string>;
}

export const COLLECTION_PRESETS: Record<string, BandPreset[]> = {
  'sentinel-2-l2a': [
    {
      label: 'True Color (RGB)',
      assets: ['B04', 'B03', 'B02'],
      colorFormula: 'Gamma RGB 3.2 Saturation 0.8 Sigmoidal RGB 25 0.35',
    },
    {
      label: 'False Color (Vegetation)',
      assets: ['B08', 'B04', 'B03'],
      colorFormula: 'Gamma RGB 3.7 Saturation 1.5 Sigmoidal RGB 15 0.35',
    },
    {
      label: 'Agriculture',
      assets: ['B11', 'B08', 'B02'],
      colorFormula: 'Gamma RGB 3.2 Saturation 0.8 Sigmoidal RGB 25 0.35',
    },
    {
      label: 'SWIR',
      assets: ['B12', 'B8A', 'B04'],
      colorFormula: 'Gamma RGB 3.2 Saturation 0.8 Sigmoidal RGB 25 0.35',
    },
    {
      label: 'Geology',
      assets: ['B12', 'B11', 'B02'],
      colorFormula: 'Gamma RGB 3.2 Saturation 0.8 Sigmoidal RGB 25 0.35',
    },
    { label: 'NDVI (B08)', assets: ['B08'], colormap: 'rdylgn', rescale: '-1,1' },
    { label: 'Visual (rendered)', assets: ['visual'] },
  ],
  'sentinel-2-l1c': [
    {
      label: 'True Color (RGB)',
      assets: ['B04', 'B03', 'B02'],
      colorFormula: 'Gamma RGB 3.2 Saturation 0.8 Sigmoidal RGB 25 0.35',
    },
    {
      label: 'False Color (Vegetation)',
      assets: ['B08', 'B04', 'B03'],
      colorFormula: 'Gamma RGB 3.7 Saturation 1.5 Sigmoidal RGB 15 0.35',
    },
    { label: 'Visual (rendered)', assets: ['visual'] },
  ],
  'landsat-c2-l2': [
    {
      label: 'True Color',
      assets: ['red', 'green', 'blue'],
      colorFormula: 'Gamma RGB 3.5 Saturation 1.0 Sigmoidal RGB 20 0.35',
    },
    {
      label: 'False Color',
      assets: ['nir08', 'red', 'green'],
      colorFormula: 'Gamma RGB 3.5 Saturation 1.3 Sigmoidal RGB 15 0.35',
    },
    {
      label: 'SWIR',
      assets: ['swir16', 'nir08', 'red'],
      colorFormula: 'Gamma RGB 3.5 Saturation 1.0 Sigmoidal RGB 20 0.35',
    },
    {
      label: 'Agriculture',
      assets: ['swir16', 'nir08', 'blue'],
      colorFormula: 'Gamma RGB 3.5 Saturation 1.0 Sigmoidal RGB 20 0.35',
    },
  ],
  'landsat-c2-l1': [
    {
      label: 'True Color',
      assets: ['red', 'green', 'blue'],
      colorFormula: 'Gamma RGB 3.5 Saturation 1.0 Sigmoidal RGB 20 0.35',
    },
    {
      label: 'False Color',
      assets: ['nir08', 'red', 'green'],
      colorFormula: 'Gamma RGB 3.5 Saturation 1.3 Sigmoidal RGB 15 0.35',
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
      colorFormula: 'Gamma RGB 3.5 Saturation 1.2 Sigmoidal RGB 15 0.35',
    },
    {
      label: 'False Color (Vegetation)',
      assets: ['B8A', 'B04', 'B03'],
      colorFormula: 'Gamma RGB 3.5 Saturation 1.2 Sigmoidal RGB 15 0.35',
    },
    {
      label: 'Agriculture',
      assets: ['B11', 'B8A', 'B02'],
      colorFormula: 'Gamma RGB 3.5 Saturation 1.2 Sigmoidal RGB 15 0.35',
    },
    { label: 'NDVI (B8A)', assets: ['B8A'], colormap: 'rdylgn', rescale: '0,1' },
  ],
  'hls2-l30': [
    {
      label: 'True Color (RGB)',
      assets: ['B04', 'B03', 'B02'],
      colorFormula: 'Gamma RGB 3.5 Saturation 1.2 Sigmoidal RGB 15 0.35',
    },
    {
      label: 'False Color (Vegetation)',
      assets: ['B05', 'B04', 'B03'],
      colorFormula: 'Gamma RGB 3.5 Saturation 1.2 Sigmoidal RGB 15 0.35',
    },
    { label: 'NDVI (B05)', assets: ['B05'], colormap: 'rdylgn', rescale: '0,1' },
  ],
  'sentinel-1-grd': [
    { label: 'VV Backscatter', assets: ['vv'], colormap: 'greys', rescale: '0,0.4' },
    { label: 'VH Backscatter', assets: ['vh'], colormap: 'greys', rescale: '0,0.1' },
  ],
  'modis-13Q1-061': [
    { label: 'NDVI', assets: ['250m_16_days_NDVI'], colormap: 'rdylgn', rescale: '-2000,10000' },
    { label: 'EVI', assets: ['250m_16_days_EVI'], colormap: 'rdylgn', rescale: '-2000,10000' },
  ],
};

export const KNOWN_RESCALE: Record<string, string> = {
  'cop-dem-glo-30': '0,4000',
  'cop-dem-glo-90': '0,4000',
  'sentinel-1-grd': '0,0.4',
  naip: '0,255',
};

export function guessRescale(collectionId: string): string | undefined {
  const id = collectionId.toLowerCase();
  if (id.includes('dem') || id.includes('elevation')) return '0,4000';
  if (id.includes('sentinel-1') || id.includes('sar')) return '0,0.4';
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
