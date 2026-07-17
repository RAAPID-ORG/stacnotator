import { useState, useEffect, type ReactNode } from 'react';
import { Modal } from '~/shared/ui/Modal';
import { IconPlus } from '~/shared/ui/Icons';
import { Tooltip } from '~/shared/ui/Tooltip';
import { InfoPopover } from '~/shared/ui/InfoPopover';
import { MonthPicker } from '~/shared/ui/MonthPicker';
import { listCatalogs, getCollections, search } from '~/api/client';
import type { StacCatalogOut, StacCollectionOut, StacItemOut, AssetInfo } from '~/api/client';
import type {
  CollectionItem,
  ImagerySlice,
  VizParams,
  NamedVizParams,
  ItemSortOption,
} from './types';
import { createId, emptyVizParams, isItemSortOption } from './types';
import { VizTabs } from './VizTabs';
import { CoverSearchParams } from './CoverSearchParams';
import { COLLECTION_PRESETS, KNOWN_RESCALE, guessRescale } from './collectionPresets';
import type { BandPreset } from './collectionPresets';
import { StacQueryEditor } from './StacQueryEditor';
import { Button, Input, Select } from '~/shared/ui/forms';
import { formatSliceLabel, formatWindowLabel } from '~/shared/utils/utility';
import { extractErrorMessage, handleError } from '~/shared/utils/errorHandler';

type Step = 'catalog' | 'collection' | 'configure';

type TemporalPattern =
  | 'monthly-weekly'
  | 'monthly-monthly'
  | 'weekly-weekly'
  | 'yearly-monthly'
  | 'yearly-yearly'
  | 'custom';

interface TemporalPatternOption {
  id: Exclude<TemporalPattern, 'custom'>;
  label: string;
  windowInterval: number;
  windowUnit: 'weeks' | 'months' | 'years';
  sliceInterval: number;
  sliceUnit: 'days' | 'weeks' | 'months' | 'years';
}

const TEMPORAL_PATTERNS: TemporalPatternOption[] = [
  {
    id: 'monthly-weekly',
    label: 'Month by month, with weekly images to choose from',
    windowInterval: 1,
    windowUnit: 'months',
    sliceInterval: 1,
    sliceUnit: 'weeks',
  },
  {
    id: 'monthly-monthly',
    label: 'Month by month, one image per month',
    windowInterval: 1,
    windowUnit: 'months',
    sliceInterval: 1,
    sliceUnit: 'months',
  },
  {
    id: 'weekly-weekly',
    label: 'Week by week, one image per week',
    windowInterval: 1,
    windowUnit: 'weeks',
    sliceInterval: 1,
    sliceUnit: 'weeks',
  },
  {
    id: 'yearly-monthly',
    label: 'Year by year, with monthly images to choose from',
    windowInterval: 1,
    windowUnit: 'years',
    sliceInterval: 1,
    sliceUnit: 'months',
  },
  {
    id: 'yearly-yearly',
    label: 'Year by year, one image per year',
    windowInterval: 1,
    windowUnit: 'years',
    sliceInterval: 1,
    sliceUnit: 'years',
  },
];

export interface CatalogBrowserPreset {
  /** STAC collection ID within MPC (e.g. 'sentinel-2-l2a') */
  stacCollectionId: string;
  /** Human label */
  label: string;
  /** Temporal pattern to preselect; falls back to the form defaults (monthly/weekly) */
  temporalPattern?: Exclude<TemporalPattern, 'custom'>;
  /** Cover to preselect; falls back to a generated cover for cloud-bearing collections */
  coverMode?: 'nth' | 'custom';
}

/** Presets that map directly to MPC STAC collections */
export const MPC_PRESETS: CatalogBrowserPreset[] = [
  { stacCollectionId: 'sentinel-2-l2a', label: 'Sentinel-2 L2A' },
  { stacCollectionId: 'landsat-c2-l2', label: 'Landsat C2 L2' },
  { stacCollectionId: 'hls2-s30', label: 'HLS Sentinel-2 (S30)' },
  { stacCollectionId: 'hls2-l30', label: 'HLS Landsat (L30)' },
  // NAIP flies each state roughly every 2-3 years and carries no cloud metadata, so
  // sub-yearly windows produce empty slices and a composited cover buys nothing.
  { stacCollectionId: 'naip', label: 'NAIP', temporalPattern: 'yearly-yearly', coverMode: 'nth' },
  { stacCollectionId: 'sentinel-1-grd', label: 'Sentinel-1 GRD' },
  { stacCollectionId: 'cop-dem-glo-30', label: 'Copernicus DEM 30m' },
];

const MPC_API_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1';

interface CatalogBrowserProps {
  onAdd: (collections: CollectionItem[]) => void;
  onClose: () => void;
  campaignBbox?: number[] | null;
  /** Initial mode: 'mosaic' for temporal series, 'single-item' for single item */
  initialMode?: 'single-item' | 'mosaic';
  /** When true, generates a single collection (no collection period UI) but still with slices */
  singleCollection?: boolean;
  /** When set, auto-navigates to this MPC collection, skipping catalog/collection selection */
  preset?: CatalogBrowserPreset | null;
  /** Editing an existing collection defaults the advanced disclosure to expanded
   *  (post-creation edits are intentional power-user actions). */
  initialAdvanced?: boolean;
}

const AdvancedToggle = ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
  <div className="flex justify-end">
    <button
      type="button"
      onClick={onToggle}
      className="text-[11px] text-neutral-500 hover:text-brand-700 transition-colors cursor-pointer underline-offset-2 hover:underline"
    >
      {expanded ? 'Hide advanced options' : 'Show advanced options'}
    </button>
  </div>
);

const CatalogSection = ({
  title,
  badge,
  tone,
  note,
  children,
}: {
  title: string;
  badge: string;
  tone: 'green' | 'amber';
  note: string;
  children: ReactNode;
}) => {
  const badgeClass =
    tone === 'green'
      ? 'text-green-700 bg-green-50 border-green-200'
      : 'text-amber-700 bg-amber-50 border-amber-200';
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wider">
          {title}
        </p>
        <span className={`text-[10px] border rounded-full px-1.5 py-0.5 ${badgeClass}`}>
          {badge}
        </span>
      </div>
      <p className="text-[11px] text-neutral-500 leading-snug">{note}</p>
      {children}
    </section>
  );
};

export const CatalogBrowser = ({
  onAdd,
  onClose,
  campaignBbox,
  initialMode = 'mosaic',
  singleCollection = false,
  preset = null,
  initialAdvanced = false,
}: CatalogBrowserProps) => {
  const [step, setStep] = useState<Step>('catalog');
  const [catalogs, setCatalogs] = useState<StacCatalogOut[]>([]);
  const [collections, setCollections] = useState<StacCollectionOut[]>([]);
  const [items, setItems] = useState<StacItemOut[]>([]);
  // Paging cursor for static catalogs; null means no more items to load.
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedCatalog, setSelectedCatalog] = useState<StacCatalogOut | null>(null);
  const [selectedCollection, setSelectedCollection] = useState<StacCollectionOut | null>(null);

  const [query, setQuery] = useState('');
  const [customCatalogUrl, setCustomCatalogUrl] = useState('');
  const [mode, setMode] = useState<'single-item' | 'mosaic'>(initialMode);

  // Date range - default to 2024-01 through 2024-12
  const [startDate, setStartDateRaw] = useState('2024-01');
  const [endDate, setEndDateRaw] = useState('2024-12');

  /** Set start date, bumping end date forward if it would be before start */
  const setStartDate = (val: string) => {
    setStartDateRaw(val);
    if (val && endDate && val > endDate) {
      // Bump end to same month as start
      setEndDateRaw(val);
    }
  };
  /** Set end date, pulling start date back if it would be after end */
  const setEndDate = (val: string) => {
    setEndDateRaw(val);
    if (val && startDate && val < startDate) {
      setStartDateRaw(val);
    }
  };
  const [maxCloudCover, setMaxCloudCover] = useState<number>(90);
  const [itemSort, setItemSort] = useState<ItemSortOption>('date_desc');

  // Temporal slicing (mosaic mode)
  const [collectionPeriodInterval, setCollectionPeriodInterval] = useState(1);
  const [collectionPeriodUnit, setCollectionPeriodUnit] = useState<'weeks' | 'months' | 'years'>(
    'months'
  );
  const [slicePeriodInterval, setSlicePeriodInterval] = useState(1);
  const [slicePeriodUnit, setSlicePeriodUnit] = useState<'days' | 'weeks' | 'months' | 'years'>(
    'weeks'
  );
  const [coverSliceNth, setCoverSliceNth] = useState(1);
  const [coverMode, setCoverMode] = useState<'nth' | 'custom'>('nth');
  /** Per-viz params for the custom cover slice (e.g. different compositing) */
  const [coverVisualizations, setCoverVisualizations] = useState<NamedVizParams[]>([]);
  /** Cover slice search parameters */
  const [coverMaxCloudCover, setCoverMaxCloudCover] = useState<number>(90);
  const [coverItemSort, setCoverItemSort] = useState<ItemSortOption>('cloud_cover_asc');
  /** Active viz tab index for cover slice */
  const [activeCoverVizIndex, setActiveCoverVizIndex] = useState(0);
  /** Custom CQL2-JSON search query (null = auto-generated) */
  const [searchQuery, setSearchQuery] = useState<Record<string, unknown> | null>(null);
  /** Custom search query for cover slice (null = same as regular) */
  const [coverSearchQuery, setCoverSearchQuery] = useState<Record<string, unknown> | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(initialAdvanced);

  const matchingPattern: TemporalPattern = (() => {
    const found = TEMPORAL_PATTERNS.find(
      (p) =>
        p.windowInterval === collectionPeriodInterval &&
        p.windowUnit === collectionPeriodUnit &&
        p.sliceInterval === slicePeriodInterval &&
        p.sliceUnit === slicePeriodUnit
    );
    return found?.id ?? 'custom';
  })();

  const applyTemporalPattern = (id: TemporalPattern) => {
    if (id === 'custom') {
      setShowAdvanced(true);
      return;
    }
    const p = TEMPORAL_PATTERNS.find((x) => x.id === id);
    if (!p) return;
    setCollectionPeriodInterval(p.windowInterval);
    setCollectionPeriodUnit(p.windowUnit);
    setSlicePeriodInterval(p.sliceInterval);
    setSlicePeriodUnit(p.sliceUnit);
  };

  const SORTBY_MAP: Record<ItemSortOption, Array<{ field: string; direction: string }>> = {
    date_desc: [{ field: 'datetime', direction: 'desc' }],
    date_asc: [{ field: 'datetime', direction: 'asc' }],
    cloud_cover_asc: [
      { field: 'eo:cloud_cover', direction: 'asc' },
      { field: 'datetime', direction: 'desc' },
    ],
  };

  /** Build a search query from given parameters. */
  const buildQuery = (cloudCover: number, sort: ItemSortOption): Record<string, unknown> | null => {
    if (!selectedCollection) return null;
    const hasCloudCover = selectedCollection.has_cloud_cover ?? false;
    const cloudCoverFilter =
      hasCloudCover && cloudCover < 100
        ? [
            {
              op: 'or',
              args: [
                { op: 'isNull', args: [{ property: 'eo:cloud_cover' }] },
                { op: '<=', args: [{ property: 'eo:cloud_cover' }, cloudCover] },
              ],
            },
          ]
        : [];

    return {
      collections: [selectedCollection.id],
      filter: {
        op: 'and',
        args: [
          {
            op: 'anyinteracts',
            args: [{ property: 'datetime' }, { interval: ['{sliceStart}', '{sliceEnd}'] }],
          },
          ...cloudCoverFilter,
        ],
      },
      filterLang: 'cql2-json',
      sortby: SORTBY_MAP[sort],
    };
  };

  /** Build the canonical search query from UI state. Single source of truth for queries. */
  const buildAutoQuery = () => buildQuery(maxCloudCover, itemSort);
  /** Build the cover slice search query from cover-specific params. */
  const buildCoverAutoQuery = () => buildQuery(coverMaxCloudCover, coverItemSort);

  /** Effective query: user's custom override, or the auto-generated one */
  const effectiveQuery = searchQuery ?? buildAutoQuery();
  const effectiveCoverQuery = coverSearchQuery ?? buildCoverAutoQuery();

  // Multiple named visualizations
  const [visualizations, setVisualizations] = useState<NamedVizParams[]>([
    { name: 'True Color', vizParams: emptyVizParams() },
  ]);
  const [activeVizIndex, setActiveVizIndex] = useState(0);
  const [availableAssets, setAvailableAssets] = useState<Record<string, AssetInfo>>({});

  // Load catalogs on mount (skip if preset provided)
  useEffect(() => {
    if (preset) {
      // Auto-navigate: set MPC as catalog, fetch collection details, jump to configure
      const mpcCatalog: StacCatalogOut = {
        id: 'mpc',
        title: 'Microsoft Planetary Computer',
        url: MPC_API_URL,
        summary: '',
        is_mpc: true,
        auth_required: false,
      };
      setSelectedCatalog(mpcCatalog);
      setLoading(true);
      // Fetch full collection list to get item_assets metadata
      getCollections({ query: { catalog_url: MPC_API_URL } })
        .then(({ data, error }) => {
          if (error) throw new Error('Failed to fetch collections');
          const cols = data!;
          const match = cols.find((c) => c.id === preset.stacCollectionId);
          const col = match || {
            id: preset.stacCollectionId,
            title: preset.label,
            description: '',
            keywords: [],
          };
          setSelectedCollection(col);
          if (col.item_assets && Object.keys(col.item_assets).length > 0) {
            setAvailableAssets(col.item_assets);
          }
          // Pre-fill visualizations from known presets
          const initialVizs = buildInitialVisualizations(col.id);
          setVisualizations(initialVizs);
          setActiveVizIndex(0);
          // Default to cloud cover sort when available
          if (col.has_cloud_cover) {
            setItemSort('cloud_cover_asc');
            setCoverItemSort('cloud_cover_asc');
          }
          if (preset.temporalPattern) {
            applyTemporalPattern(preset.temporalPattern);
          }
          const coverMode = preset.coverMode ?? (col.has_cloud_cover ? 'custom' : 'nth');
          setCoverMode(coverMode);
          if (coverMode === 'custom') {
            setCoverVisualizations(buildInitialVisualizations(col.id, 'first'));
            setActiveCoverVizIndex(0);
          }
          setStep('configure');
        })
        .catch((e: unknown) => {
          const msg = handleError(e, `Failed to load ${preset.label} catalog`, { showUser: false });
          setError(`Could not load ${preset.label}: ${msg}`);
          setSelectedCollection({
            id: preset.stacCollectionId,
            title: preset.label,
            description: '',
            keywords: [],
          });
          setStep('configure');
        })
        .finally(() => setLoading(false));
      return;
    }
    setLoading(true);
    listCatalogs()
      .then(({ data, error }) => {
        if (error) throw new Error('Failed to fetch catalogs');
        setCatalogs(data!);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectCatalog = (cat: StacCatalogOut) => {
    if (cat.auth_required) return;
    setSelectedCatalog(cat);
    setStep('collection');
    setQuery('');
    setCollections([]);
    setLoading(true);
    setError('');
    getCollections({ query: { catalog_url: cat.url } })
      .then(({ data, error }) => {
        if (error) {
          const detail =
            (error as { detail?: unknown })?.detail ??
            (typeof error === 'string' ? error : JSON.stringify(error));
          throw new Error(`Failed to fetch collections: ${detail}`);
        }
        setCollections(data!);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const loadCustomCatalog = () => {
    if (!customCatalogUrl.trim()) return;
    const cat: StacCatalogOut = {
      id: 'custom',
      title: customCatalogUrl,
      url: customCatalogUrl.trim(),
      summary: 'Custom STAC catalog',
      is_mpc: false,
      auth_required: false,
    };
    selectCatalog(cat);
  };

  /** Build pre-configured visualizations from known collection presets.
   *  Returns True Color + False Color (if available), with bands/rescale/colorFormula pre-filled.
   *  Falls back to a single empty "True Color" viz if no presets exist. */
  const buildInitialVisualizations = (
    collectionId: string,
    compositingOverride?: string
  ): NamedVizParams[] => {
    const presets = COLLECTION_PRESETS[collectionId];
    if (!presets || presets.length === 0) {
      return [
        {
          name: 'True Color',
          vizParams: {
            ...emptyVizParams(),
            ...(compositingOverride ? { compositing: compositingOverride } : {}),
          },
        },
      ];
    }

    const knownRescale = KNOWN_RESCALE[collectionId] || guessRescale(collectionId);
    const trueColor = presets.find((p) => p.label.toLowerCase().includes('true color'));
    const falseColor = presets.find((p) => p.label.toLowerCase().includes('false color'));

    const buildViz = (preset: BandPreset): NamedVizParams => {
      const vp: VizParams = {
        ...emptyVizParams(),
        assets: preset.assets,
        assetAsBand: preset.assets.length === 3 || !!preset.expression,
        ...(preset.colorFormula ? { colorFormula: preset.colorFormula } : {}),
        ...(preset.colormap ? { colormapName: preset.colormap } : {}),
        ...(preset.expression ? { expression: preset.expression } : {}),
        ...(preset.extraParams ? { extraParams: { ...preset.extraParams } } : {}),
        ...(compositingOverride ? { compositing: compositingOverride } : {}),
      };
      // Set rescale: use preset-specific, or skip if color formula handles it
      if (preset.rescale) {
        vp.rescale = preset.rescale;
      } else if (!preset.colorFormula && knownRescale) {
        vp.rescale = knownRescale;
      }
      return { name: preset.label, vizParams: vp };
    };

    const vizs: NamedVizParams[] = [];
    if (trueColor) vizs.push(buildViz(trueColor));
    if (falseColor) vizs.push(buildViz(falseColor));
    // Fallback: if neither found, use first preset
    if (vizs.length === 0) vizs.push(buildViz(presets[0]));
    return vizs;
  };

  const selectCollection = (col: StacCollectionOut) => {
    setSelectedCollection(col);
    setStep('configure');
    setQuery('');
    setError('');
    // Pre-fill visualizations from known presets (True Color + False Color if available)
    const initialVizs = buildInitialVisualizations(col.id);
    setVisualizations(initialVizs);
    setActiveVizIndex(0);
    // Default to cloud cover sort when available
    const defaultSort = col.has_cloud_cover ? 'cloud_cover_asc' : 'date_desc';
    setItemSort(defaultSort);
    setCoverMaxCloudCover(90);
    setCoverItemSort(defaultSort);
    // For imagery collections (those with cloud cover), enable custom cover by default
    if (col.has_cloud_cover) {
      setCoverMode('custom');
      setCoverVisualizations(buildInitialVisualizations(col.id, 'first'));
      setActiveCoverVizIndex(0);
    } else {
      setCoverMode('nth');
      setCoverVisualizations([]);
    }
    // Use item_assets from collection metadata for viz config (no item search needed)
    setAvailableAssets(
      col.item_assets && Object.keys(col.item_assets).length > 0 ? col.item_assets : {}
    );
    // Only narrow the default range if the collection's extent is smaller
    if (col.temporal_extent?.start) {
      const colStart = col.temporal_extent.start.slice(0, 7);
      if (colStart > startDate) setStartDate(colStart);
    }
    if (col.temporal_extent?.end) {
      const colEnd = col.temporal_extent.end.slice(0, 7);
      if (colEnd < endDate) setEndDate(colEnd);
    }
  };

  const goBack = () => {
    if (step === 'configure') {
      setStep('collection');
      setItems([]);
      setError('');
    } else if (step === 'collection') {
      setStep('catalog');
      setError('');
    }
  };

  // One page of items. offset=0 starts a fresh search (replaces the list); a
  // positive offset is a "load more" that appends and advances the cursor. Static
  // catalogs page through their item links; STAC APIs return everything at once
  // (next_offset stays null), so "load more" simply never shows.
  const doSearch = async (offset = 0) => {
    if (!selectedCatalog || !selectedCollection) return;
    if (offset > 0) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const bbox = campaignBbox || undefined;
      const dtRange =
        startDate && endDate ? `${startDate}-01T00:00:00Z/${endDate}-28T23:59:59Z` : undefined;
      const { data, error } = await search({
        body: {
          catalog_url: selectedCatalog.url,
          collection_id: selectedCollection.id,
          bbox: bbox ?? null,
          datetime_range: dtRange ?? null,
          limit: 30,
          offset,
        },
      });
      if (error) throw new Error('Search failed');
      setItems((prev) => (offset > 0 ? [...prev, ...data!.items] : data!.items));
      setNextOffset(data!.next_offset ?? null);
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'Search failed'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // One initial search when landing on a collection in single-item mode, so the list isn't empty.
  useEffect(() => {
    if (step !== 'configure' || !selectedCatalog || !selectedCollection) return;
    if (mode !== 'single-item') return;
    if (!startDate || !endDate) return;
    doSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mode, selectedCatalog?.url, selectedCollection?.id]);

  const addVisualization = () => {
    const newViz = { name: `Viz ${visualizations.length + 1}`, vizParams: emptyVizParams() };
    setVisualizations((prev) => [...prev, newViz]);
    setActiveVizIndex(visualizations.length);
    // Sync cover visualizations
    if (coverMode === 'custom') {
      setCoverVisualizations((prev) => [
        ...prev,
        { ...newViz, vizParams: { ...newViz.vizParams, compositing: 'first' } },
      ]);
    }
  };

  const removeVisualization = (index: number) => {
    if (visualizations.length <= 1) return;
    setVisualizations((prev) => prev.filter((_, i) => i !== index));
    setActiveVizIndex((prev) => Math.min(prev, visualizations.length - 2));
    if (coverMode === 'custom') {
      setCoverVisualizations((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const updateVizName = (index: number, name: string) => {
    setVisualizations((prev) => prev.map((v, i) => (i === index ? { ...v, name } : v)));
    if (coverMode === 'custom') {
      setCoverVisualizations((prev) => prev.map((v, i) => (i === index ? { ...v, name } : v)));
    }
  };

  /** Sync cover visualizations structure with regular visualizations.
   *  Keeps existing cover viz params for matching indices, initializes new ones
   *  from the regular viz with compositing: 'first'. */
  const syncCoverVisualizationsFromRegular = () => {
    setCoverVisualizations((prev) => {
      return visualizations.map((viz, i) => {
        if (prev[i]) {
          // Keep existing cover params, just sync the name
          return { ...prev[i], name: viz.name };
        }
        // New viz: copy from regular with first-valid compositing
        return {
          name: viz.name,
          vizParams: { ...viz.vizParams, compositing: 'first' },
        };
      });
    });
  };

  const updateVizParams = (params: VizParams) => {
    setVisualizations((prev) =>
      prev.map((v, i) => (i === activeVizIndex ? { ...v, vizParams: params } : v))
    );
    // Keep the matching cover viz in sync while it hasn't been configured on its
    // own. A freshly-added viz (e.g. one the user just set to an NDVI preset)
    // starts with an empty cover entry; without this the cover slice would
    // render with no params (broken). A cover the user has already filled in via
    // Advanced is left untouched.
    if (coverMode === 'custom') {
      setCoverVisualizations((prev) =>
        prev.map((cv, i) => {
          if (i !== activeVizIndex) return cv;
          const coverUnconfigured = cv.vizParams.assets.length === 0 && !cv.vizParams.expression;
          if (!coverUnconfigured) return cv;
          return {
            ...cv,
            vizParams: { ...params, compositing: cv.vizParams.compositing ?? 'first' },
          };
        })
      );
    }
  };

  // Generate collections (mosaic mode with temporal slicing)

  /** Create a UTC date from YYYY-MM-DD string to avoid timezone issues */
  const utcDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
  const toDateStr = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

  const generateMosaicCollections = (): CollectionItem[] => {
    if (!selectedCatalog || !selectedCollection || !startDate || !endDate) return [];

    const [startY, startM] = startDate.split('-').map(Number);
    const [endY, endM] = endDate.split('-').map(Number);
    const start = utcDate(startY, startM - 1, 1);
    const endRaw = utcDate(endY, endM - 1, 1);
    endRaw.setUTCMonth(endRaw.getUTCMonth() + 1);
    const end = endRaw;
    const result: CollectionItem[] = [];

    // For singleCollection mode, use the entire range as one collection period
    const effectiveColInterval = singleCollection ? 999 : collectionPeriodInterval;
    const effectiveColUnit = singleCollection ? ('years' as const) : collectionPeriodUnit;

    let colCurrent = new Date(start);
    while (colCurrent < end) {
      const colStart = new Date(colCurrent);
      let colEnd: Date;

      if (effectiveColUnit === 'weeks') {
        colEnd = new Date(colCurrent);
        colEnd.setUTCDate(colEnd.getUTCDate() + effectiveColInterval * 7);
      } else if (effectiveColUnit === 'years') {
        colEnd = new Date(colCurrent);
        colEnd.setUTCFullYear(colEnd.getUTCFullYear() + effectiveColInterval);
      } else {
        colEnd = new Date(colCurrent);
        colEnd.setUTCMonth(colEnd.getUTCMonth() + effectiveColInterval);
      }
      if (colEnd > end) colEnd = new Date(end);
      const colEndDate = new Date(colEnd);
      colEndDate.setUTCDate(colEndDate.getUTCDate() - 1);

      const slices: ImagerySlice[] = [];
      let sliceCurrent = new Date(colStart);
      while (sliceCurrent < colEnd) {
        const sliceStart = new Date(sliceCurrent);
        let sliceEnd: Date;

        if (slicePeriodUnit === 'days') {
          sliceEnd = new Date(sliceCurrent);
          sliceEnd.setUTCDate(sliceEnd.getUTCDate() + slicePeriodInterval);
        } else if (slicePeriodUnit === 'weeks') {
          sliceEnd = new Date(sliceCurrent);
          sliceEnd.setUTCDate(sliceEnd.getUTCDate() + slicePeriodInterval * 7);
        } else if (slicePeriodUnit === 'years') {
          sliceEnd = new Date(sliceCurrent);
          sliceEnd.setUTCFullYear(sliceEnd.getUTCFullYear() + slicePeriodInterval);
        } else {
          sliceEnd = new Date(sliceCurrent);
          sliceEnd.setUTCMonth(sliceEnd.getUTCMonth() + slicePeriodInterval);
        }
        if (sliceEnd > colEnd) sliceEnd = new Date(colEnd);
        const sliceEndDate = new Date(sliceEnd);
        sliceEndDate.setUTCDate(sliceEndDate.getUTCDate() - 1);

        slices.push({
          id: createId(),
          name: formatSliceLabel(
            toDateStr(sliceStart),
            toDateStr(sliceEndDate),
            slicePeriodUnit,
            slices.length
          ),
          startDate: toDateStr(sliceStart),
          endDate: toDateStr(sliceEndDate),
        });
        sliceCurrent = sliceEnd;
      }

      let finalSlices = slices;
      let finalCoverIndex: number;

      if (coverMode === 'custom') {
        const coverSlice: ImagerySlice = {
          id: createId(),
          name: formatSliceLabel(toDateStr(colStart), toDateStr(colEndDate), slicePeriodUnit, 0),
          startDate: toDateStr(colStart),
          endDate: toDateStr(colEndDate),
        };
        finalSlices = [coverSlice, ...slices];
        finalCoverIndex = 0;
      } else {
        finalCoverIndex = Math.max(0, Math.min(coverSliceNth - 1, slices.length - 1));
      }

      result.push({
        id: createId(),
        name: formatWindowLabel(toDateStr(colStart), toDateStr(colEndDate), collectionPeriodUnit),
        slices: finalSlices,
        coverSliceIndex: finalCoverIndex,
        hasDedicatedCover: coverMode === 'custom',
        windowInterval: collectionPeriodInterval,
        windowUnit: collectionPeriodUnit,
        slicingInterval: slicePeriodInterval,
        slicingUnit: slicePeriodUnit,
        data: {
          type: 'stac_browser' as const,
          catalogUrl: selectedCatalog.url,
          stacCollectionId: selectedCollection.id,
          isMpc: selectedCatalog.is_mpc,
          // Only hosted tiler catalogs pin a tiler; MPC is auto-routed by catalog URL.
          tiler: selectedCatalog.is_mpc ? null : (selectedCatalog.tiler_name ?? null),
          mode: 'mosaic',
          maxCloudCover,
          itemSort,
          visualizations,
          coverVisualizations: coverMode === 'custom' ? coverVisualizations : undefined,
          coverMaxCloudCover: coverMode === 'custom' ? coverMaxCloudCover : undefined,
          coverItemSort: coverMode === 'custom' ? coverItemSort : undefined,
          searchQuery: effectiveQuery ?? undefined,
          coverSearchQuery: coverMode === 'custom' ? (effectiveCoverQuery ?? undefined) : undefined,
          vizUrls: visualizations.map((v) => ({ vizName: v.name, url: '' })),
        },
      });

      colCurrent = colEnd;
    }
    return result;
  };

  const selectItem = (item: StacItemOut) => {
    if (!selectedCatalog || !selectedCollection) return;
    const col: CollectionItem = {
      id: createId(),
      name: `${selectedCollection.title} - ${item.id}`,
      slices: [
        {
          id: createId(),
          name: item.datetime?.slice(0, 10) || item.id,
          startDate: item.datetime?.slice(0, 10) || '',
          endDate: item.datetime?.slice(0, 10) || '',
        },
      ],
      coverSliceIndex: 0,
      hasDedicatedCover: false,
      data: {
        type: 'stac_browser' as const,
        catalogUrl: selectedCatalog.url,
        stacCollectionId: selectedCollection.id,
        isMpc: selectedCatalog.is_mpc,
        tiler: selectedCatalog.is_mpc ? null : (selectedCatalog.tiler_name ?? null),
        mode: 'single-item',
        itemHref: item.self_href || undefined,
        maxCloudCover,
        visualizations,
        vizUrls: visualizations.map((v) => ({ vizName: v.name, url: '' })),
      },
    };
    onAdd([col]);
  };

  const handleGenerate = () => {
    if (mode === 'mosaic') {
      const cols = generateMosaicCollections();
      if (cols.length > 0) onAdd(cols);
    }
  };

  // Fuzzy filter + rank (title/id weighted heavily)
  const fuzzy = <T,>(
    items: T[],
    q: string,
    primaryFields: (item: T) => unknown[],
    secondaryFields?: (item: T) => unknown[]
  ): T[] => {
    const raw = q.trim().toLowerCase();
    if (!raw) return items;
    const tokens = raw.split(/\s+/);
    // Also try collapsed (no separators) for queries like "sentinel2" matching "sentinel-2"
    const collapsed = raw.replace(/[^a-z0-9]/g, '');

    const scored: { item: T; score: number }[] = [];

    for (const item of items) {
      const primary = primaryFields(item)
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .map((s) => s.toLowerCase());
      const secondary = (secondaryFields?.(item) ?? [])
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .map((s) => s.toLowerCase());

      let totalScore = 0;
      let allMatch = true;

      for (const tok of tokens) {
        let best = 0;
        // Primary fields (title, id) - high weight
        for (const text of primary) {
          if (text === tok) {
            best = Math.max(best, 100);
            continue;
          }
          if (text.startsWith(tok)) {
            best = Math.max(best, 80);
            continue;
          }
          const words = text.split(/[\s\-_/]+/);
          if (words.some((w) => w.startsWith(tok))) {
            best = Math.max(best, 50);
            continue;
          }
          if (text.includes(tok)) {
            best = Math.max(best, 20);
            continue;
          }
        }
        // Secondary fields (description, keywords) - low weight
        if (best === 0) {
          for (const text of secondary) {
            if (text.includes(tok)) {
              best = Math.max(best, 5);
              continue;
            }
          }
        }
        if (best > 0) {
          totalScore += best;
        } else {
          allMatch = false;
          break;
        }
      }

      // Fallback: collapsed match ("sentinel2" → "sentinel-2-l2a")
      if (!allMatch && collapsed.length >= 2) {
        const allCollapsed = [...primary, ...secondary].join('').replace(/[^a-z0-9]/g, '');
        if (allCollapsed.includes(collapsed)) {
          allMatch = true;
          totalScore = 3;
        }
      }

      if (allMatch) scored.push({ item, score: totalScore });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.item);
  };

  const providedCatalogs = catalogs.filter((c) => c.provided);
  const stacIndexCatalogs = catalogs.filter((c) => !c.provided);

  const renderCatalogCard = (cat: StacCatalogOut) => (
    <div key={cat.id} className="flex items-start gap-1.5">
      <button
        type="button"
        onClick={() => selectCatalog(cat)}
        disabled={cat.auth_required}
        className={`flex-1 text-left px-3 py-2.5 rounded-lg border transition-colors ${
          cat.auth_required
            ? 'border-neutral-100 bg-neutral-50 text-neutral-400 cursor-not-allowed'
            : 'border-neutral-200 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer'
        }`}
      >
        <span className="text-sm font-medium flex items-center gap-1.5">
          {cat.title}
          {cat.is_mpc && (
            <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">
              MPC
            </span>
          )}
          {cat.auth_required && (
            <span className="text-[9px] bg-neutral-200 text-neutral-500 px-1.5 py-0.5 rounded-full">
              Auth required
            </span>
          )}
        </span>
        <p className="text-xs text-neutral-500 mt-0.5 line-clamp-1">{cat.summary}</p>
      </button>
      <div className="mt-2.5">
        <InfoPopover>
          <div className="space-y-1.5">
            {cat.summary ? (
              <p>{cat.summary}</p>
            ) : (
              <p className="text-neutral-400 italic">No description available.</p>
            )}
            <a
              href={cat.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:underline block truncate"
            >
              {cat.url}
            </a>
          </div>
        </InfoPopover>
      </div>
    </div>
  );
  const filteredCollections = fuzzy(
    collections,
    query,
    (c) => [c.title, c.id],
    (c) => [c.description, ...(c.keywords ?? [])]
  );

  const preview = (() => {
    if (mode !== 'mosaic' || !startDate || !endDate) return null;
    const cols = generateMosaicCollections();
    return {
      collections: cols.length,
      slicesPerCollection: cols[0]?.slices.length ?? 0,
    };
  })();

  const hasVizConfig = visualizations.some((v) => v.vizParams.assets.length > 0);

  const isValid =
    mode === 'mosaic' ? startDate && endDate && startDate <= endDate && hasVizConfig : hasVizConfig;

  const stepTitle =
    step === 'catalog'
      ? 'Select STAC Catalog'
      : step === 'collection'
        ? selectedCatalog?.title || 'Collections'
        : selectedCollection?.title || 'Configure';

  const footer =
    step === 'configure' && mode === 'mosaic' ? (
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-neutral-600 hover:text-neutral-800 transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <Button variant="primary" onClick={handleGenerate} disabled={!isValid}>
          {singleCollection
            ? 'Add Collection'
            : `Generate ${preview ? `${preview.collections} Collection${preview.collections !== 1 ? 's' : ''}` : 'Collections'}`}
        </Button>
      </div>
    ) : undefined;

  return (
    <Modal title={stepTitle} onClose={onClose} maxWidth="max-w-xl" scrollable footer={footer}>
      <div className="p-4 space-y-3">
        {/* Full-screen loading for preset initialization */}
        {loading && preset && (
          <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
            <div className="w-6 h-6 border-2 border-neutral-300 border-t-brand-500 rounded-full animate-spin mb-3" />
            <span className="text-sm">Loading {preset.label}...</span>
          </div>
        )}

        {/* Normal UI (hidden during preset loading) */}
        {!(loading && preset) && (
          <>
            {/* Step indicator */}
            <div className="flex items-center gap-1 text-[11px] text-neutral-400">
              <button
                type="button"
                onClick={() => setStep('catalog')}
                className={`cursor-pointer hover:text-neutral-600 ${step === 'catalog' ? 'text-brand-600 font-medium' : ''}`}
              >
                Catalog
              </button>
              <span>/</span>
              <span className={step === 'collection' ? 'text-brand-600 font-medium' : ''}>
                Collection
              </span>
              <span>/</span>
              <span className={step === 'configure' ? 'text-brand-600 font-medium' : ''}>
                Configure
              </span>
              {step !== 'catalog' && (
                <button
                  type="button"
                  onClick={goBack}
                  className="ml-auto text-neutral-500 hover:text-neutral-700 cursor-pointer text-xs"
                >
                  ← Back
                </button>
              )}
            </div>

            {/* Collection search (the catalog step has its own search in the StacIndex section) */}
            {step === 'collection' && (
              <Input
                type="text"
                size="sm"
                placeholder="Search collections..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            )}

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-1.5">
                {error}
              </div>
            )}

            {loading && <div className="text-xs text-neutral-400 py-4 text-center">Loading...</div>}

            {/* Catalog list: three categories, each with a visible support note */}
            {step === 'catalog' && !loading && (
              <div className="space-y-4">
                <CatalogSection
                  title="Provided catalogs"
                  badge="Recommended"
                  tone="green"
                  note="Microsoft Planetary Computer and catalogs hosted on our own tilers. Fully supported with fast tile loading."
                >
                  <div className="space-y-1">{providedCatalogs.map(renderCatalogCard)}</div>
                  {!providedCatalogs.length && (
                    <p className="text-xs text-neutral-400 py-1">None available.</p>
                  )}
                </CatalogSection>

                <CatalogSection
                  title="Any STAC catalog URL"
                  badge="Experimental"
                  tone="amber"
                  note="Point at any STAC API. Served by our default tiler; may need manual adjustments."
                >
                  <div className="flex gap-2">
                    <Input
                      type="url"
                      size="sm"
                      className="!flex-1"
                      value={customCatalogUrl}
                      onChange={(e) => setCustomCatalogUrl(e.target.value)}
                      placeholder="https://earth-search.aws.element84.com/v1"
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={loadCustomCatalog}
                      disabled={!customCatalogUrl.trim()}
                    >
                      Load
                    </Button>
                  </div>
                </CatalogSection>

                <CatalogSection
                  title="Public catalogs (StacIndex)"
                  badge="Experimental"
                  tone="amber"
                  note="Public STAC APIs indexed by StacIndex. Served by our default tiler."
                >
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {stacIndexCatalogs.map(renderCatalogCard)}
                    {!stacIndexCatalogs.length && (
                      <p className="text-xs text-neutral-400 text-center py-4">No catalogs found</p>
                    )}
                  </div>
                </CatalogSection>
              </div>
            )}

            {/* Collection list */}
            {step === 'collection' && !loading && (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {filteredCollections.map((col) => (
                  <div key={col.id} className="flex items-start gap-1.5">
                    <button
                      type="button"
                      onClick={() => selectCollection(col)}
                      className="flex-1 text-left px-3 py-2.5 rounded-lg border border-neutral-200 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer transition-colors"
                    >
                      <span className="text-sm font-medium">{col.title}</span>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {col.id}
                        {col.temporal_extent?.start && (
                          <>
                            {' · '}
                            {col.temporal_extent.start.slice(0, 10)} to{' '}
                            {col.temporal_extent.end?.slice(0, 10) || 'present'}
                          </>
                        )}
                      </p>
                    </button>
                    <div className="mt-2.5">
                      <InfoPopover>
                        <div className="space-y-2">
                          <p className="font-medium text-xs text-neutral-800">{col.title}</p>
                          {col.description ? (
                            <p className="line-clamp-4">{col.description}</p>
                          ) : (
                            <p className="text-neutral-400 italic">No description available.</p>
                          )}
                          <table className="w-full text-[10px]">
                            <tbody>
                              <tr className="border-t border-neutral-100">
                                <td className="py-1 pr-2 text-neutral-500 font-medium whitespace-nowrap">
                                  ID
                                </td>
                                <td className="py-1 font-mono">{col.id}</td>
                              </tr>
                              {col.temporal_extent?.start && (
                                <tr className="border-t border-neutral-100">
                                  <td className="py-1 pr-2 text-neutral-500 font-medium whitespace-nowrap">
                                    Temporal
                                  </td>
                                  <td className="py-1">
                                    {col.temporal_extent.start.slice(0, 10)} to{' '}
                                    {col.temporal_extent.end?.slice(0, 10) || 'present'}
                                  </td>
                                </tr>
                              )}
                              {(col.keywords?.length ?? 0) > 0 && (
                                <tr className="border-t border-neutral-100">
                                  <td className="py-1 pr-2 text-neutral-500 font-medium whitespace-nowrap align-top">
                                    Keywords
                                  </td>
                                  <td className="py-1">
                                    {(col.keywords ?? []).slice(0, 8).join(', ')}
                                    {(col.keywords?.length ?? 0) > 8 ? '...' : ''}
                                  </td>
                                </tr>
                              )}
                              {col.item_assets && Object.keys(col.item_assets).length > 0 && (
                                <tr className="border-t border-neutral-100">
                                  <td className="py-1 pr-2 text-neutral-500 font-medium whitespace-nowrap align-top">
                                    Assets
                                  </td>
                                  <td className="py-1">
                                    {Object.keys(col.item_assets).slice(0, 10).join(', ')}
                                    {Object.keys(col.item_assets).length > 10 ? '...' : ''}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </InfoPopover>
                    </div>
                  </div>
                ))}
                {!filteredCollections.length && (
                  <p className="text-xs text-neutral-400 text-center py-4">No collections found</p>
                )}
              </div>
            )}

            {/* Configure step */}
            {step === 'configure' && !loading && (
              <div className="space-y-4">
                {selectedCatalog && !selectedCatalog.is_mpc && (
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                    <strong>Non-MPC catalog.</strong> Tile serving goes through our self-hosted
                    tiler which has noticeable latency compared to Planetary Computer. Only MPC is
                    currently optimized for fast tile loading.
                  </div>
                )}
                {selectedCatalog?.is_mpc && (
                  <div className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2.5 py-1.5">
                    <strong>Microsoft Planetary Computer</strong> - tiles are served directly from
                    MPC for fast loading when using first-valid compositing. Non-first-valid
                    compositing or masking will route through our self-hosted tiler (~10x slower
                    data loading).
                  </div>
                )}
                <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 overflow-hidden">
                  <div className="px-3 py-2.5 border-b border-neutral-200 bg-white">
                    <h4 className="text-xs font-semibold text-neutral-800 flex items-center gap-1">
                      Search Parameters
                      <Tooltip text="Controls which STAC items are considered. Choose whether you want a single scene or a date-windowed mosaic, then narrow the match by date range, cloud cover, sort order, or a custom CQL query." />
                    </h4>
                    <p className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">
                      Filter the STAC catalog by date, cloud cover, and an optional CQL query. Each
                      slice in the Temporal Structure below searches within these filters.
                    </p>
                  </div>
                  <div className="p-3 space-y-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setMode('mosaic')}
                        className={`flex-1 text-xs px-3 py-2 rounded-md border transition-colors cursor-pointer ${
                          mode === 'mosaic'
                            ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium'
                            : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                        }`}
                      >
                        Collection Mosaic
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode('single-item')}
                        className={`flex-1 text-xs px-3 py-2 rounded-md border transition-colors cursor-pointer ${
                          mode === 'single-item'
                            ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium'
                            : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                        }`}
                      >
                        Single Item
                      </button>
                    </div>

                    {/* Date range */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-neutral-700 flex items-center gap-1">
                          Start Month
                          <Tooltip text="First month of the temporal range." />
                        </label>
                        <MonthPicker value={startDate} onChange={setStartDate} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-neutral-700 flex items-center gap-1">
                          End Month (inclusive)
                          <Tooltip text="Last month of the temporal range (inclusive)." />
                        </label>
                        <MonthPicker value={endDate} onChange={setEndDate} />
                      </div>
                    </div>

                    {/* Cloud cover */}
                    {selectedCollection && selectedCollection.has_cloud_cover && (
                      <div className="space-y-1">
                        <label className="text-xs text-neutral-700 font-medium">
                          Max cloud cover (%)
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={maxCloudCover}
                            onChange={(e) => setMaxCloudCover(Number(e.target.value))}
                            className="flex-1"
                          />
                          <span className="text-xs text-neutral-600 w-8 text-right">
                            {maxCloudCover}%
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Item sort order (advanced) */}
                    {showAdvanced && mode === 'mosaic' && (
                      <div className="space-y-1">
                        <label className="text-xs text-neutral-700 font-medium flex items-center gap-1">
                          Item Sort Order
                          <Tooltip text="Controls the order in which STAC items are returned. For first-valid compositing, the first matching item wins - sorting by cloud cover puts the clearest images first." />
                        </label>
                        <Select
                          size="sm"
                          value={itemSort}
                          onChange={(e) => {
                            if (isItemSortOption(e.target.value)) setItemSort(e.target.value);
                          }}
                        >
                          <option value="date_desc">Date (newest first)</option>
                          <option value="date_asc">Date (oldest first)</option>
                          {selectedCollection?.has_cloud_cover && (
                            <option value="cloud_cover_asc">Cloud cover (lowest first)</option>
                          )}
                        </Select>
                      </div>
                    )}

                    {showAdvanced &&
                      mode === 'mosaic' &&
                      selectedCollection &&
                      buildAutoQuery() && (
                        <StacQueryEditor
                          value={searchQuery}
                          onChange={setSearchQuery}
                          autoQuery={buildAutoQuery()!}
                        />
                      )}
                    <AdvancedToggle
                      expanded={showAdvanced}
                      onToggle={() => setShowAdvanced((v) => !v)}
                    />
                  </div>
                </div>

                {mode === 'mosaic' && Object.keys(availableAssets).length > 0 && (
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 overflow-hidden">
                    <div className="px-3 py-2.5 border-b border-neutral-200 bg-white">
                      <h4 className="text-xs font-semibold text-neutral-800 flex items-center gap-1">
                        Temporal Structure
                        <Tooltip text="Controls how the date range is divided into collections and slices. Collections are top-level time windows (e.g. months). Each collection is split into slices (e.g. weeks) that annotators can browse to find the best imagery." />
                      </h4>
                      <p className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">
                        {singleCollection
                          ? 'The full date range becomes one collection, divided into slices that annotators can switch between.'
                          : 'The date range is split into collections (e.g. one per month). Each collection is further divided into slices (e.g. weeks) for annotators to browse.'}
                      </p>
                    </div>
                    <div className="p-3 space-y-3">
                      {!showAdvanced && !singleCollection && (
                        <div className="space-y-1">
                          <label className="text-xs text-neutral-700 flex items-center gap-1">
                            Pattern
                            <Tooltip text="How the date range is divided into collections and slices. Pick a preset or switch to Advanced for custom intervals." />
                          </label>
                          <Select
                            size="sm"
                            value={matchingPattern}
                            onChange={(e) =>
                              applyTemporalPattern(e.target.value as TemporalPattern)
                            }
                          >
                            {TEMPORAL_PATTERNS.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                              </option>
                            ))}
                            <option value="custom">Custom…</option>
                          </Select>
                        </div>
                      )}

                      {/* Collection period - only for temporal series (multiple collections) */}
                      {showAdvanced && !singleCollection && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs text-neutral-700 flex items-center gap-1">
                              Collection Period
                              <Tooltip text="How often to create a new collection. E.g. 1 month = each month becomes its own collection." />
                            </label>
                            <Input
                              type="number"
                              size="sm"
                              min="1"
                              value={collectionPeriodInterval}
                              onChange={(e) =>
                                setCollectionPeriodInterval(Math.max(1, Number(e.target.value)))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-neutral-700">Collection Unit</label>
                            <Select
                              size="sm"
                              value={collectionPeriodUnit}
                              onChange={(e) =>
                                setCollectionPeriodUnit(
                                  e.target.value as 'weeks' | 'months' | 'years'
                                )
                              }
                            >
                              <option value="weeks">Weeks</option>
                              <option value="months">Months</option>
                              <option value="years">Years</option>
                            </Select>
                          </div>
                        </div>
                      )}

                      {showAdvanced && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs text-neutral-700 flex items-center gap-1">
                              Slice Period
                              <Tooltip text="How to divide each collection into slices. Annotators switch between slices to find cloud-free imagery." />
                            </label>
                            <Input
                              type="number"
                              size="sm"
                              min="1"
                              value={slicePeriodInterval}
                              onChange={(e) =>
                                setSlicePeriodInterval(Math.max(1, Number(e.target.value)))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-neutral-700">Slice Unit</label>
                            <Select
                              size="sm"
                              value={slicePeriodUnit}
                              onChange={(e) =>
                                setSlicePeriodUnit(
                                  e.target.value as 'days' | 'weeks' | 'months' | 'years'
                                )
                              }
                            >
                              <option value="days">Days</option>
                              <option value="weeks">Weeks</option>
                              <option value="months">Months</option>
                              <option value="years">Years</option>
                            </Select>
                          </div>
                        </div>
                      )}
                      <AdvancedToggle
                        expanded={showAdvanced}
                        onToggle={() => setShowAdvanced((v) => !v)}
                      />
                    </div>
                  </div>
                )}

                {/* Explicit search trigger: filters only take effect on click, so
                    editing the date range doesn't fire a search on every change. */}
                {mode === 'single-item' && (
                  <button
                    type="button"
                    onClick={() => doSearch(0)}
                    disabled={loading || !startDate || !endDate}
                    className="w-full py-2 rounded-md bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  >
                    {loading ? 'Searching…' : 'Search items'}
                  </button>
                )}

                {/* Item results (single-item mode only) */}
                {mode === 'single-item' && items.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-neutral-700 font-medium">
                      Select an item
                      <span className="ml-1 font-normal text-neutral-400">({items.length})</span>
                    </label>
                    <div className="space-y-1 max-h-60 overflow-y-auto">
                      {items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => selectItem(item)}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded border border-neutral-200 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer transition-colors text-left"
                        >
                          {item.thumbnail && (
                            <img
                              src={item.thumbnail}
                              alt=""
                              className="w-12 h-12 rounded object-cover shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <span className="text-xs font-medium block truncate">{item.id}</span>
                            <span className="text-[11px] text-neutral-400">
                              {item.datetime?.slice(0, 10) || 'No date'}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                    {nextOffset !== null && (
                      <button
                        type="button"
                        onClick={() => doSearch(nextOffset)}
                        disabled={loadingMore}
                        className="w-full py-1.5 rounded-md border border-neutral-300 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 cursor-pointer transition-colors"
                      >
                        {loadingMore ? 'Loading…' : 'Load more'}
                      </button>
                    )}
                  </div>
                )}
                {mode === 'single-item' && items.length === 0 && loading && (
                  <div className="text-xs text-neutral-400 text-center py-2">
                    Searching for items...
                  </div>
                )}
                {mode === 'mosaic' &&
                  selectedCollection &&
                  Object.keys(availableAssets).length === 0 &&
                  !loading && (
                    <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2.5 text-xs text-red-800">
                      <p className="font-semibold">Asset metadata unavailable.</p>
                      <p className="mt-1 leading-relaxed">
                        This collection&apos;s STAC metadata didn&apos;t include per-band{' '}
                        <code className="font-mono text-[11px]">item_assets</code>, so
                        visualizations can&apos;t be configured from it. Pick a different
                        collection, or use the custom STAC registration URL path instead.
                      </p>
                    </div>
                  )}
                {mode === 'single-item' &&
                  Object.keys(availableAssets).length === 0 &&
                  !loading && (
                    <div className="text-xs text-neutral-400 text-center py-2">
                      No asset metadata found for this collection. Try selecting a different one.
                    </div>
                  )}

                {Object.keys(availableAssets).length > 0 && selectedCollection && (
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 overflow-hidden">
                    <div className="px-3 py-2.5 border-b border-neutral-200 bg-white">
                      <h4 className="text-xs font-semibold text-neutral-800 flex items-center gap-1">
                        Visualizations
                        <Tooltip text="Named rendering configurations for the imagery. Each defines which assets/bands to use and how to display them. Annotators can switch between them in the viewer." />
                      </h4>
                      <p className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">
                        Pre-configured renderings for this dataset (e.g. True Color, False Color).
                        Add new ones with{' '}
                        <span className="inline-flex items-center">
                          <IconPlus className="w-2.5 h-2.5" />
                        </span>
                        , or expand advanced options to edit compositing.
                      </p>
                    </div>
                    <div className="p-3 space-y-3 bg-white">
                      <VizTabs
                        visualizations={visualizations}
                        activeIndex={activeVizIndex}
                        onActiveIndexChange={setActiveVizIndex}
                        collectionId={selectedCollection.id}
                        availableAssets={availableAssets}
                        showCompositing={mode === 'mosaic' && showAdvanced}
                        onParamsChange={(_, params) => updateVizParams(params)}
                        onNameChange={updateVizName}
                        onAdd={addVisualization}
                        onRemove={removeVisualization}
                      />
                      <AdvancedToggle
                        expanded={showAdvanced}
                        onToggle={() => setShowAdvanced((v) => !v)}
                      />
                    </div>
                  </div>
                )}

                {/* Cover Slice - basic UI always visible in mosaic mode, advanced settings gated */}
                {mode === 'mosaic' && Object.keys(availableAssets).length > 0 && (
                  <CoverSliceSection
                    coverMode={coverMode}
                    setCoverMode={(m) => {
                      setCoverMode(m);
                      if (m === 'custom' && coverVisualizations.length === 0) {
                        syncCoverVisualizationsFromRegular();
                      }
                    }}
                    coverSliceNth={coverSliceNth}
                    setCoverSliceNth={setCoverSliceNth}
                    examples={(() => {
                      const cols = generateMosaicCollections();
                      return cols.slice(0, 2).map((c) => ({
                        name: c.name,
                        slices: c.slices.map((s, i) => ({
                          name: s.name,
                          startDate: s.startDate,
                          endDate: s.endDate,
                          isPreviewCover: i === c.coverSliceIndex,
                        })),
                      }));
                    })()}
                    showAdvanced={showAdvanced}
                    onToggleAdvanced={() => setShowAdvanced((v) => !v)}
                    advanced={
                      coverMode === 'custom' && showAdvanced ? (
                        <CoverSliceAdvancedPanel
                          selectedCollection={selectedCollection!}
                          availableAssets={availableAssets}
                          coverVisualizations={coverVisualizations}
                          setCoverVisualizations={setCoverVisualizations}
                          activeCoverVizIndex={activeCoverVizIndex}
                          setActiveCoverVizIndex={setActiveCoverVizIndex}
                          coverMaxCloudCover={coverMaxCloudCover}
                          setCoverMaxCloudCover={setCoverMaxCloudCover}
                          coverItemSort={coverItemSort}
                          setCoverItemSort={setCoverItemSort}
                          coverSearchQuery={coverSearchQuery}
                          setCoverSearchQuery={setCoverSearchQuery}
                          buildCoverAutoQuery={buildCoverAutoQuery}
                        />
                      ) : null
                    }
                  />
                )}

                {/* Preview */}
                {mode === 'mosaic' && preview && preview.collections > 0 && (
                  <div className="rounded-md bg-brand-50 border border-brand-200 px-3 py-2 text-xs text-brand-800">
                    This will generate <strong>{preview.collections}</strong> collection
                    {preview.collections !== 1 ? 's' : ''}, each with{' '}
                    <strong>{preview.slicesPerCollection}</strong> slice
                    {preview.slicesPerCollection !== 1 ? 's' : ''} and {visualizations.length}{' '}
                    visualization{visualizations.length !== 1 ? 's' : ''}.
                  </div>
                )}

                {/* Compositing note */}
                {(() => {
                  const hasAdvancedCompositing = visualizations.some(
                    (v) => v.vizParams.compositing && v.vizParams.compositing !== 'first'
                  );
                  const hasMasking = visualizations.some((v) => v.vizParams.maskLayer);
                  if (!hasAdvancedCompositing && !hasMasking) return null;
                  const features = [
                    hasAdvancedCompositing && 'non-first-valid compositing (median, mean, etc.)',
                    hasMasking && 'pixel masking',
                  ]
                    .filter(Boolean)
                    .join(' and ');
                  return (
                    <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
                      <strong>Self-hosted tiler required:</strong> {features} will route tiles
                      through our backend instead of MPC. Expect ~10x slower data loading compared
                      to first-valid compositing via MPC.
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

interface CoverExampleSlice {
  name: string;
  startDate: string;
  endDate: string;
  isPreviewCover: boolean;
}
interface CoverExample {
  name: string;
  slices: CoverExampleSlice[];
}

interface CoverSliceSectionProps {
  coverMode: 'nth' | 'custom';
  setCoverMode: (m: 'nth' | 'custom') => void;
  coverSliceNth: number;
  setCoverSliceNth: (n: number) => void;
  examples: CoverExample[];
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  advanced: React.ReactNode;
}

const CoverSliceSection = ({
  coverMode,
  setCoverMode,
  coverSliceNth,
  setCoverSliceNth,
  examples,
  showAdvanced,
  onToggleAdvanced,
  advanced,
}: CoverSliceSectionProps) => {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-neutral-200 bg-white">
        <h4 className="text-xs font-semibold text-neutral-800 flex items-center gap-1">
          Cover slice
          <Tooltip text="The cover slice is the image annotators see first when they open this collection. Pick which existing slice acts as the cover, or generate a separate mosaic spanning the full window." />
        </h4>
        <p className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">
          When annotators open a task, they see one image first for each collection. Decide which
          one: pick a specific slice, or generate a fresh mosaic that spans the whole window.
        </p>
      </div>
      <div className="p-3 space-y-3">
        {examples.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">
              Preview - your first{' '}
              {examples.length === 1 ? 'collection' : `${examples.length} collections`}
            </div>
            <div className="space-y-2">
              {examples.map((col, ci) => (
                <div key={ci} className="rounded-md border border-neutral-200 bg-white p-2">
                  <div className="text-[11px] font-medium text-neutral-700">{col.name}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {col.slices.map((sl, si) => (
                      <span
                        key={si}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                          sl.isPreviewCover
                            ? 'bg-brand-50 text-brand-700 border-brand-300'
                            : 'bg-neutral-50 text-neutral-500 border-neutral-200'
                        }`}
                        title={`${sl.startDate} → ${sl.endDate}`}
                      >
                        {sl.isPreviewCover && (
                          <svg
                            className="w-2.5 h-2.5"
                            viewBox="0 0 12 12"
                            fill="currentColor"
                            aria-hidden
                          >
                            <path d="M6 1l1.6 3.2L11 4.7l-2.5 2.4.6 3.4L6 8.9 2.9 10.5l.6-3.4L1 4.7l3.4-.5L6 1z" />
                          </svg>
                        )}
                        {sl.startDate.slice(5)}→{sl.endDate.slice(5)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-neutral-500 leading-snug">
              The highlighted slice is the cover - what annotators see first.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="radio"
              name="coverMode"
              checked={coverMode === 'nth'}
              onChange={() => setCoverMode('nth')}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Pick an existing slice as the cover</span>
              <span className="block text-[11px] text-neutral-500 mt-0.5">
                Typically the first slice - fast and no extra work for the backend.
              </span>
            </span>
          </label>
          {coverMode === 'nth' && (
            <div className="ml-5 flex items-center gap-2">
              <label className="text-[11px] text-neutral-700">Slice index (1-based)</label>
              <Input
                type="number"
                size="sm"
                className="!w-16"
                min="1"
                value={coverSliceNth}
                onChange={(e) => setCoverSliceNth(Math.max(1, Number(e.target.value)))}
              />
            </div>
          )}

          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="radio"
              name="coverMode"
              checked={coverMode === 'custom'}
              onChange={() => setCoverMode('custom')}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Generate a fresh cover spanning the full window</span>
              <span className="block text-[11px] text-neutral-500 mt-0.5">
                Best when individual slices have gaps or clouds: The cover composites the whole
                window i.e by taking all items with the lowest cloud cover from the full range.
                Configurable in advanced options.
              </span>
            </span>
          </label>
        </div>

        {advanced}

        <AdvancedToggle expanded={showAdvanced} onToggle={onToggleAdvanced} />
      </div>
    </div>
  );
};

interface CoverSliceAdvancedPanelProps {
  selectedCollection: StacCollectionOut;
  availableAssets: Record<string, AssetInfo>;
  coverVisualizations: NamedVizParams[];
  setCoverVisualizations: React.Dispatch<React.SetStateAction<NamedVizParams[]>>;
  activeCoverVizIndex: number;
  setActiveCoverVizIndex: (i: number) => void;
  coverMaxCloudCover: number;
  setCoverMaxCloudCover: (v: number) => void;
  coverItemSort: ItemSortOption;
  setCoverItemSort: (v: ItemSortOption) => void;
  coverSearchQuery: Record<string, unknown> | null;
  setCoverSearchQuery: (v: Record<string, unknown> | null) => void;
  buildCoverAutoQuery: () => Record<string, unknown> | null;
}

const CoverSliceAdvancedPanel = ({
  selectedCollection,
  availableAssets,
  coverVisualizations,
  setCoverVisualizations,
  activeCoverVizIndex,
  setActiveCoverVizIndex,
  coverMaxCloudCover,
  setCoverMaxCloudCover,
  coverItemSort,
  setCoverItemSort,
  coverSearchQuery,
  setCoverSearchQuery,
  buildCoverAutoQuery,
}: CoverSliceAdvancedPanelProps) => {
  return (
    <div className="space-y-3 p-3 rounded-lg bg-white border border-neutral-200">
      <p className="text-[11px] text-neutral-500">
        Configure the separate cover-slice search and rendering. By default it inherits from the
        main visualization params.
      </p>
      <CoverSearchParams
        hasCloudCover={selectedCollection.has_cloud_cover ?? false}
        maxCloudCover={coverMaxCloudCover}
        onMaxCloudCoverChange={setCoverMaxCloudCover}
        itemSort={coverItemSort}
        onItemSortChange={setCoverItemSort}
        searchQuery={coverSearchQuery}
        onSearchQueryChange={setCoverSearchQuery}
        autoQuery={buildCoverAutoQuery()}
      />

      {Object.keys(availableAssets).length > 0 && (
        <div className="space-y-2">
          <h5 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wider">
            Cover visualizations
          </h5>
          <VizTabs
            visualizations={coverVisualizations}
            activeIndex={activeCoverVizIndex}
            onActiveIndexChange={setActiveCoverVizIndex}
            collectionId={selectedCollection.id}
            availableAssets={availableAssets}
            showCompositing
            onParamsChange={(i, params) =>
              setCoverVisualizations((prev) =>
                prev.map((v, idx) => (idx === i ? { ...v, vizParams: params } : v))
              )
            }
          />
        </div>
      )}
    </div>
  );
};
