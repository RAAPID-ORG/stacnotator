import { useEffect, useState } from 'react';
import type {
  CollectionItem,
  ImagerySlice,
  VisualizationUrl,
  StacBrowserCollectionData,
  NamedVizParams,
  VizParams,
} from './types';
import { emptySlice, emptyVizParams, sliceDateRange } from './types';
import { IconTrash, IconChevronDown, IconChevronUp, IconPlus, IconClock } from '~/shared/ui/Icons';
import { IconButton, Input, Select } from '~/shared/ui/forms';
import { Tooltip } from '~/shared/ui/Tooltip';
import { VizTabs } from './VizTabs';
import { CoverSearchParams } from './CoverSearchParams';
import { StacQueryEditor } from './StacQueryEditor';
import { getCollections, listTilers, type AssetInfo, type TilerOption } from '~/api/client';
import { useIsInternal } from '~/shared/stores/account.store';

interface CollectionEditorProps {
  collection: CollectionItem;
  vizNames: string[];
  onChange: (updates: Partial<CollectionItem>) => void;
  onRemove: () => void;
  /** When true, hides the outer border and expand/collapse header (for use inside a modal) */
  inModal?: boolean;
}

export const CollectionEditor = ({
  collection,
  vizNames,
  onChange,
  onRemove,
  inModal,
}: CollectionEditorProps) => {
  const isInternal = useIsInternal();
  const [expanded, setExpanded] = useState(true);
  const [availableAssets, setAvailableAssets] = useState<Record<string, AssetInfo>>({});
  const [hasCloudCover, setHasCloudCover] = useState(false);
  const [activeVizIndex, setActiveVizIndex] = useState(0);
  const [activeCoverVizIndex, setActiveCoverVizIndex] = useState(0);
  const [showCoverOptions, setShowCoverOptions] = useState(false);

  const sb = collection.data.type === 'stac_browser' ? collection.data : null;
  const updateSb = (updates: Partial<StacBrowserCollectionData>) => {
    if (!sb) return;
    onChange({ data: { ...sb, ...updates } });
  };

  const [tilers, setTilers] = useState<TilerOption[]>([]);
  useEffect(() => {
    listTilers()
      .then(({ data }) => setTilers(data?.tilers ?? []))
      .catch(() => {});
  }, []);
  const hostedTilers = tilers.filter((t) => t.kind === 'hosted');
  const defaultTilerName = hostedTilers.find((t) => t.is_default)?.name;
  const [showAdvanced, setShowAdvanced] = useState(false);

  const buildAutoQuery = (cloudCover: number | undefined): Record<string, unknown> => {
    const cc = cloudCover ?? 100;
    return {
      collections: sb ? [sb.stacCollectionId] : [],
      filter: {
        op: 'and',
        args: [
          {
            op: 'anyinteracts',
            args: [{ property: 'datetime' }, { interval: ['{sliceStart}', '{sliceEnd}'] }],
          },
          ...(cc < 100 ? [{ op: '<=', args: [{ property: 'eo:cloud_cover' }, cc] }] : []),
        ],
      },
      filterLang: 'cql2-json',
    };
  };

  const orderedVizs: NamedVizParams[] = sb
    ? vizNames.map(
        (name) =>
          sb.visualizations.find((v) => v.name === name) ?? { name, vizParams: emptyVizParams() }
      )
    : [];
  const writeVizParams = (index: number, params: VizParams) => {
    if (!sb) return;
    const name = vizNames[index];
    const existingIdx = sb.visualizations.findIndex((v) => v.name === name);
    const newVizs =
      existingIdx >= 0
        ? sb.visualizations.map((v, i) => (i === existingIdx ? { ...v, vizParams: params } : v))
        : [...sb.visualizations, { name, vizParams: params }];
    const updates: Partial<StacBrowserCollectionData> = { visualizations: newVizs };
    // Mirror into the dedicated cover viz while it's still unconfigured, so a
    // newly-added visualization's cover slice doesn't render with empty params.
    // A cover the user has filled in on its own is left untouched.
    if (collection.hasDedicatedCover) {
      const coverList = sb.coverVisualizations ?? [];
      const coverIdx = coverList.findIndex((v) => v.name === name);
      const cover = coverIdx >= 0 ? coverList[coverIdx] : undefined;
      const coverUnconfigured =
        !cover || (cover.vizParams.assets.length === 0 && !cover.vizParams.expression);
      if (coverUnconfigured) {
        const mirrored: NamedVizParams = {
          name,
          vizParams: { ...params, compositing: cover?.vizParams.compositing ?? 'first' },
        };
        updates.coverVisualizations =
          coverIdx >= 0
            ? coverList.map((v, i) => (i === coverIdx ? mirrored : v))
            : [...coverList, mirrored];
      }
    }
    updateSb(updates);
  };

  const coverVizs: NamedVizParams[] =
    sb && collection.hasDedicatedCover
      ? vizNames.map(
          (name) =>
            sb.coverVisualizations?.find((v) => v.name === name) ?? {
              name,
              vizParams: { ...emptyVizParams(), compositing: 'first' },
            }
        )
      : [];
  const writeCoverVizParams = (index: number, params: VizParams) => {
    if (!sb) return;
    const name = vizNames[index];
    const existing = sb.coverVisualizations ?? [];
    const existingIdx = existing.findIndex((v) => v.name === name);
    const newVizs =
      existingIdx >= 0
        ? existing.map((v, i) => (i === existingIdx ? { ...v, vizParams: params } : v))
        : [...existing, { name, vizParams: params }];
    updateSb({ coverVisualizations: newVizs });
  };

  const enableDedicatedCover = () => {
    if (!sb) return;
    onChange({
      hasDedicatedCover: true,
      data: {
        ...sb,
        coverVisualizations: vizNames.map((name) => {
          const base =
            sb.visualizations.find((v) => v.name === name)?.vizParams ?? emptyVizParams();
          return { name, vizParams: { ...base, compositing: 'first' } };
        }),
      },
    });
  };
  const disableDedicatedCover = () => {
    if (!sb) return;
    onChange({
      hasDedicatedCover: false,
      data: {
        ...sb,
        coverVisualizations: [],
        coverSearchQuery: undefined,
        coverMaxCloudCover: undefined,
        coverItemSort: undefined,
      },
    });
  };

  // Fetch STAC asset metadata for stac_browser collections so VizConfigPanel
  // renders the band picker / colormap dropdown (instead of text fallbacks).
  useEffect(() => {
    if (collection.data.type !== 'stac_browser') return;
    const sb = collection.data;
    if (!sb.catalogUrl || !sb.stacCollectionId) return;
    let cancelled = false;
    getCollections({ query: { catalog_url: sb.catalogUrl } })
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const match = data.find((c) => c.id === sb.stacCollectionId);
        if (match?.item_assets) setAvailableAssets(match.item_assets);
        setHasCloudCover(match?.has_cloud_cover ?? false);
      })
      .catch(() => {
        // Network/metadata failure is non-fatal - VizConfigPanel just shows
        // text inputs as it does without metadata.
      });
    return () => {
      cancelled = true;
    };
  }, [collection.data]);

  const typeLabel = collection.data.type === 'stac_browser' ? 'Catalog' : 'XYZ';

  const updateSlice = (sliceId: string, updates: Partial<ImagerySlice>) => {
    onChange({
      slices: collection.slices.map((s) => (s.id === sliceId ? { ...s, ...updates } : s)),
    });
  };

  const removeSlice = (sliceId: string) => {
    const newSlices = collection.slices.filter((s) => s.id !== sliceId);
    const removedIndex = collection.slices.findIndex((s) => s.id === sliceId);
    const removedDedicatedCover =
      collection.hasDedicatedCover && removedIndex === collection.coverSliceIndex;
    let newCoverIndex = collection.coverSliceIndex;
    if (removedIndex < newCoverIndex) {
      newCoverIndex = Math.max(0, newCoverIndex - 1);
    } else if (removedIndex === newCoverIndex) {
      newCoverIndex = 0;
    }
    const updates: Partial<CollectionItem> = {
      slices: newSlices,
      coverSliceIndex: Math.min(newCoverIndex, Math.max(0, newSlices.length - 1)),
    };
    if (removedDedicatedCover) {
      updates.hasDedicatedCover = false;
      if (collection.data.type === 'stac_browser') {
        const sb = collection.data as StacBrowserCollectionData;
        updates.data = { ...sb, coverVisualizations: [], coverSearchQuery: undefined };
      }
    }
    onChange(updates);
  };

  const addSlice = () => {
    const newSlice = emptySlice();
    if (collection.data.type === 'manual') {
      newSlice.vizUrls = vizNames.map((name) => ({ vizName: name, url: '' }));
    }
    onChange({
      slices: [...collection.slices, newSlice],
    });
  };

  const updateSliceVizUrl = (sliceId: string, vizName: string, url: string) => {
    onChange({
      slices: collection.slices.map((s) => {
        if (s.id !== sliceId) return s;
        const existing = s.vizUrls ?? [];
        const idx = existing.findIndex((v) => v.vizName === vizName);
        const updated: VisualizationUrl[] =
          idx >= 0
            ? existing.map((v, i) => (i === idx ? { ...v, url } : v))
            : [...existing, { vizName, url }];
        return { ...s, vizUrls: updated };
      }),
    });
  };

  const sliceManualXyzBlock = (slice: ImagerySlice) => {
    if (collection.data.type !== 'manual' || vizNames.length === 0) return null;
    return (
      <div className="mt-2 space-y-1 border-t border-neutral-100 pt-1.5">
        {vizNames.map((vizName) => {
          const url = slice.vizUrls?.find((v) => v.vizName === vizName)?.url ?? '';
          const missingParams = ['{z}', '{x}', '{y}'].filter((p) => !url.includes(p));
          return (
            <div key={vizName} className="space-y-0.5">
              <label className="text-[11px] text-neutral-500 flex items-center gap-1">
                {vizName || '(unnamed)'} URL
                <Tooltip text="If this provider requires an API key, put {api_key} in the URL where the value goes - e.g. https://tiles.example.com/{z}/{x}/{y}.png?api_key={api_key}. Users enter their key value once when they first open the campaign." />
              </label>
              <Input
                size="sm"
                type="text"
                placeholder="https://.../tiles/{z}/{x}/{y}"
                value={url}
                onChange={(e) => updateSliceVizUrl(slice.id, vizName, e.target.value)}
                className="font-mono"
              />
              {url && missingParams.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {missingParams.map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono leading-none bg-red-50 text-red-600 border border-red-200"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={inModal ? '' : 'rounded-md border border-neutral-200 bg-white'}>
      {/* Header - only shown when NOT in a modal */}
      {!inModal && (
        <div
          className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-neutral-50 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <input
              type="text"
              value={collection.name}
              onChange={(e) => onChange({ name: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              placeholder={
                collection.slices.length > 0
                  ? `${sliceDateRange(collection.slices)} (auto-generated from dates)`
                  : 'Auto-generated from dates'
              }
              className="text-sm font-medium text-neutral-800 truncate bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-brand-600 outline-none focus:ring-0 min-w-0 flex-1"
            />
            <span className="text-[10px] px-1.5 py-0.5 bg-neutral-100 text-neutral-500 rounded shrink-0">
              {typeLabel}
            </span>
            {collection.slices.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 bg-brand-50 text-brand-700 rounded shrink-0 flex items-center gap-0.5">
                <IconClock className="w-2.5 h-2.5" />
                {collection.slices.length} slice{collection.slices.length !== 1 ? 's' : ''}
                {collection.slices[collection.coverSliceIndex] && (
                  <span className="text-brand-700 ml-0.5">
                    ({collection.slices[collection.coverSliceIndex].name || 'cover'})
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <IconButton
              tone="danger"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              aria-label="Remove collection"
            >
              <IconTrash className="w-3.5 h-3.5" />
            </IconButton>
            {expanded ? (
              <IconChevronUp className="w-3.5 h-3.5 text-neutral-400" />
            ) : (
              <IconChevronDown className="w-3.5 h-3.5 text-neutral-400" />
            )}
          </div>
        </div>
      )}

      {(inModal || expanded) && (
        <div
          className={`space-y-3 ${inModal ? 'px-5 py-4' : 'px-3 pb-3 pt-1 border-t border-neutral-100'}`}
        >
          {/* Name field - in modal mode, show it here since no header */}
          {inModal && (
            <div className="space-y-1">
              <label className="text-xs text-neutral-700 font-medium">Name</label>
              <Input
                size="sm"
                type="text"
                value={collection.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder={
                  collection.slices.length > 0
                    ? `${sliceDateRange(collection.slices)} (auto-generated from dates)`
                    : 'Auto-generated from dates'
                }
              />
            </div>
          )}

          {/* Slices */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-neutral-700 font-medium flex items-center gap-1">
                Temporal Slices
                <Tooltip text="Each slice represents a time period with start and end dates. Data for each slice is loaded independently." />
              </label>
              <button
                type="button"
                onClick={addSlice}
                className="flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 transition-colors cursor-pointer"
              >
                <IconPlus className="w-3 h-3" />
                Add Slice
              </button>
            </div>

            {collection.slices.length === 0 && (
              <div className="rounded-md border border-dashed border-neutral-300 p-3 text-center">
                <p className="text-xs text-neutral-500">
                  No slices defined. Add slices manually or use the Temporal Series generator.
                </p>
              </div>
            )}

            {(() => {
              const customCoverArrayIndex = collection.hasDedicatedCover
                ? collection.coverSliceIndex
                : -1;
              const customCover =
                customCoverArrayIndex >= 0 ? collection.slices[customCoverArrayIndex] : null;
              const regularSlices = collection.slices
                .map((s, i) => ({ slice: s, originalIndex: i }))
                .filter(({ originalIndex }) => originalIndex !== customCoverArrayIndex);

              const renderSliceCard = (
                slice: ImagerySlice,
                originalIndex: number,
                variant: 'custom-cover' | 'regular'
              ) => {
                const isActiveCover = originalIndex === collection.coverSliceIndex;
                const isCustomCover = variant === 'custom-cover';
                return (
                  <div
                    key={slice.id}
                    className={`p-2 rounded border ${
                      isActiveCover
                        ? 'bg-brand-50/40 border-brand-300'
                        : 'bg-neutral-50 border-neutral-100'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Input
                          size="sm"
                          type="text"
                          placeholder={`Slice ${originalIndex + 1}`}
                          value={slice.name}
                          onChange={(e) => updateSlice(slice.id, { name: e.target.value })}
                          className="!w-28"
                        />
                        {isActiveCover ? (
                          <span className="text-[10px] px-1.5 py-0.5 bg-brand-100 text-brand-700 rounded shrink-0 font-medium">
                            Cover
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              onChange({
                                coverSliceIndex: originalIndex,
                                hasDedicatedCover: false,
                              })
                            }
                            className="text-[10px] px-1.5 py-0.5 text-brand-700 border border-brand-300 hover:bg-brand-50 hover:border-brand-500 rounded transition-colors cursor-pointer shrink-0 font-medium"
                            title="Set as cover slice"
                          >
                            Set as cover
                          </button>
                        )}
                        {isCustomCover && !isActiveCover && (
                          <span className="text-[10px] px-1.5 py-0.5 text-neutral-500 bg-neutral-100 rounded shrink-0">
                            Has overrides
                          </span>
                        )}
                      </div>
                      <IconButton
                        tone="danger"
                        onClick={() => removeSlice(slice.id)}
                        title="Remove slice"
                        aria-label="Remove slice"
                      >
                        <IconTrash className="w-3 h-3" />
                      </IconButton>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-0.5">
                        <label className="text-[11px] text-neutral-500">Start</label>
                        <Input
                          size="sm"
                          type="date"
                          value={slice.startDate}
                          onChange={(e) => updateSlice(slice.id, { startDate: e.target.value })}
                        />
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-[11px] text-neutral-500">End</label>
                        <Input
                          size="sm"
                          type="date"
                          value={slice.endDate}
                          onChange={(e) => updateSlice(slice.id, { endDate: e.target.value })}
                        />
                      </div>
                    </div>
                    {sb && sb.mode === 'mosaic' && isActiveCover && (
                      <div className="mt-2 border-t border-brand-100 pt-1.5">
                        <button
                          type="button"
                          onClick={() => setShowCoverOptions((v) => !v)}
                          className="flex items-center gap-1 text-[11px] text-brand-700 hover:text-brand-900 font-medium cursor-pointer"
                        >
                          {showCoverOptions ? (
                            <IconChevronUp className="w-3 h-3" />
                          ) : (
                            <IconChevronDown className="w-3 h-3" />
                          )}
                          Cover overrides (search &amp; visualization)
                        </button>
                        {showCoverOptions &&
                          (collection.hasDedicatedCover ? (
                            <div className="mt-1.5 space-y-3">
                              <CoverSearchParams
                                hasCloudCover={hasCloudCover}
                                maxCloudCover={sb.coverMaxCloudCover ?? sb.maxCloudCover ?? 90}
                                onMaxCloudCoverChange={(v) => updateSb({ coverMaxCloudCover: v })}
                                itemSort={sb.coverItemSort ?? sb.itemSort ?? 'date_desc'}
                                onItemSortChange={(v) => updateSb({ coverItemSort: v })}
                                searchQuery={sb.coverSearchQuery ?? null}
                                onSearchQueryChange={(q) =>
                                  updateSb({ coverSearchQuery: q ?? undefined })
                                }
                                autoQuery={buildAutoQuery(
                                  sb.coverMaxCloudCover ?? sb.maxCloudCover
                                )}
                              />
                              {coverVizs.length > 0 && (
                                <div className="space-y-2">
                                  <label className="text-xs text-neutral-700 font-medium">
                                    Cover visualizations
                                  </label>
                                  <VizTabs
                                    visualizations={coverVizs}
                                    activeIndex={activeCoverVizIndex}
                                    onActiveIndexChange={setActiveCoverVizIndex}
                                    collectionId={sb.stacCollectionId}
                                    availableAssets={availableAssets}
                                    showCompositing
                                    onParamsChange={writeCoverVizParams}
                                  />
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={disableDedicatedCover}
                                className="text-[11px] text-neutral-500 hover:text-red-600 cursor-pointer"
                              >
                                Reset to use the regular search &amp; visualization
                              </button>
                            </div>
                          ) : (
                            <div className="mt-1.5 space-y-1.5">
                              <p className="text-[11px] text-neutral-500 leading-snug">
                                The cover currently uses the same search and visualization as the
                                regular slices.
                              </p>
                              <button
                                type="button"
                                onClick={enableDedicatedCover}
                                className="text-[11px] px-2 py-1 text-brand-700 border border-brand-300 hover:bg-brand-50 hover:border-brand-500 rounded transition-colors cursor-pointer font-medium"
                              >
                                Customize cover separately
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                    {sliceManualXyzBlock(slice)}
                  </div>
                );
              };

              return (
                <>
                  {customCover && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-neutral-500 uppercase tracking-wider font-semibold">
                        Cover slice
                      </label>
                      {renderSliceCard(customCover, customCoverArrayIndex, 'custom-cover')}
                    </div>
                  )}
                  {regularSlices.length > 0 && (
                    <div className="space-y-1.5">
                      {customCover && (
                        <label className="text-[11px] text-neutral-500 uppercase tracking-wider font-semibold">
                          Regular slices
                        </label>
                      )}
                      <div className="space-y-2">
                        {regularSlices.map(({ slice, originalIndex }) =>
                          renderSliceCard(slice, originalIndex, 'regular')
                        )}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* STAC Browser parameters */}
          {collection.data.type === 'stac_browser' &&
            (() => {
              if (!sb) return null;

              return (
                <div className="space-y-2 p-2 rounded bg-neutral-50 border border-neutral-100">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">
                      STAC Configuration
                    </span>
                    {sb.isMpc && (
                      <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">
                        MPC
                      </span>
                    )}
                    <span className="text-[9px] bg-neutral-200 text-neutral-600 px-1.5 py-0.5 rounded-full font-medium">
                      {sb.mode === 'single-item' ? 'Single Item' : 'Mosaic'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-neutral-700">Catalog URL</label>
                      <Input
                        size="sm"
                        type="url"
                        value={sb.catalogUrl}
                        onChange={(e) => updateSb({ catalogUrl: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-neutral-700">STAC Collection ID</label>
                      <Input
                        size="sm"
                        type="text"
                        value={sb.stacCollectionId}
                        onChange={(e) => updateSb({ stacCollectionId: e.target.value })}
                      />
                    </div>
                  </div>

                  {isInternal && !sb.isMpc && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={sb.internalStorage ?? false}
                        onChange={(e) => updateSb({ internalStorage: e.target.checked })}
                        data-testid="collection-internal-storage"
                      />
                      <span className="text-xs text-neutral-700">
                        <span className="font-medium">Hosted in internal storage</span>
                        <span className="block text-[11px] text-neutral-500 leading-snug">
                          Check this if the assets live in our own Azure storage, so the tiler reads
                          them with its managed identity. Leave unchecked for public or AWS-hosted
                          imagery.
                        </span>
                      </span>
                    </label>
                  )}

                  {!sb.isMpc && hostedTilers.length > 1 && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setShowAdvanced((v) => !v)}
                        className="text-[11px] font-medium text-neutral-500 hover:text-neutral-700 flex items-center gap-1"
                      >
                        {showAdvanced ? <IconChevronUp /> : <IconChevronDown />}
                        Advanced
                      </button>
                      {showAdvanced && (
                        <div className="space-y-1 mt-2">
                          <label className="text-xs text-neutral-700 flex items-center gap-1">
                            Tile server
                            <Tooltip text="Which hosted tiler renders this collection's tiles. Only tilers you're allowed to use are listed; defaults to the standard tiler." />
                          </label>
                          <Select
                            size="sm"
                            value={sb.tiler ?? defaultTilerName ?? ''}
                            onChange={(e) => updateSb({ tiler: e.target.value || null })}
                          >
                            {hostedTilers.map((t) => (
                              <option key={t.name} value={t.name}>
                                {t.name}
                                {t.is_default ? ' (default)' : ''}
                              </option>
                            ))}
                          </Select>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cloud Cover */}
                  {sb.maxCloudCover !== undefined && (
                    <div className="space-y-1">
                      <label className="text-xs text-neutral-700 flex items-center gap-1">
                        Max Cloud Cover (%)
                        <Tooltip text="Maximum cloud cover percentage for filtering scenes." />
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={sb.maxCloudCover}
                          onChange={(e) => updateSb({ maxCloudCover: Number(e.target.value) })}
                          className="flex-1"
                        />
                        <span className="text-xs text-neutral-600 w-8 text-right">
                          {sb.maxCloudCover}%
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Custom Search Query */}
                  {sb.mode === 'mosaic' && (
                    <div className="mt-2">
                      <StacQueryEditor
                        value={sb.searchQuery ?? null}
                        onChange={(query) => updateSb({ searchQuery: query ?? undefined })}
                        autoQuery={buildAutoQuery(sb.maxCloudCover)}
                      />
                    </div>
                  )}

                  {/* Visualization parameters - tabs synced with source vizNames */}
                  {vizNames.length > 0 && (
                    <div className="space-y-2 mt-2">
                      <label className="text-xs text-neutral-700 font-medium">
                        Visualization Parameters
                      </label>
                      <VizTabs
                        visualizations={orderedVizs}
                        activeIndex={activeVizIndex}
                        onActiveIndexChange={setActiveVizIndex}
                        collectionId={sb.stacCollectionId}
                        availableAssets={availableAssets}
                        showCompositing={sb.mode === 'mosaic'}
                        onParamsChange={writeVizParams}
                      />
                    </div>
                  )}
                </div>
              );
            })()}
        </div>
      )}
    </div>
  );
};
