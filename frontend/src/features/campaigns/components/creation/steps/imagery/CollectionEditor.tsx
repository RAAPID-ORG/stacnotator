import { useState } from 'react';
import type {
  CollectionItem,
  ImagerySlice,
  VisualizationUrl,
  StacCollectionData,
  StacBrowserCollectionData,
} from './types';
import { emptySlice, sliceDateRange } from './types';
import { IconTrash, IconChevronDown, IconChevronUp, IconPlus, IconClock } from '~/shared/ui/Icons';
import { AutoSizeTextarea } from '~/shared/ui/AutoSizeTextarea';
import { Tooltip } from './Tooltip';
import { VizParamsInlineEditor } from './VizParamsInlineEditor';
import { StacQueryEditor } from './StacQueryEditor';

interface CollectionEditorProps {
  collection: CollectionItem;
  vizNames: string[];
  onChange: (updates: Partial<CollectionItem>) => void;
  onRemove: () => void;
  /** When true, hides the outer border and expand/collapse header (for use inside a modal) */
  inModal?: boolean;
}

function PlaceholderBadge({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono leading-none ${
        present
          ? 'bg-green-50 text-green-700 border border-green-200'
          : 'bg-red-50 text-red-600 border border-red-200'
      }`}
      title={present ? 'Found in search body' : 'Missing -required'}
    >
      {present ? '✓' : '✗'} {label}
    </span>
  );
}

export const CollectionEditor = ({
  collection,
  vizNames,
  onChange,
  onRemove,
  inModal,
}: CollectionEditorProps) => {
  const [expanded, setExpanded] = useState(true);

  const typeLabel =
    collection.data.type === 'stac'
      ? 'STAC'
      : collection.data.type === 'stac_browser'
        ? 'Catalog'
        : 'XYZ';

  const updateSlice = (sliceId: string, updates: Partial<ImagerySlice>) => {
    onChange({
      slices: collection.slices.map((s) => (s.id === sliceId ? { ...s, ...updates } : s)),
    });
  };

  const removeSlice = (sliceId: string) => {
    const newSlices = collection.slices.filter((s) => s.id !== sliceId);
    const removedIndex = collection.slices.findIndex((s) => s.id === sliceId);
    let newCoverIndex = collection.coverSliceIndex;
    if (removedIndex < newCoverIndex) {
      newCoverIndex = Math.max(0, newCoverIndex - 1);
    } else if (removedIndex === newCoverIndex) {
      newCoverIndex = 0;
    }
    onChange({
      slices: newSlices,
      coverSliceIndex: Math.min(newCoverIndex, Math.max(0, newSlices.length - 1)),
    });
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

  const updateVizUrl = (vizName: string, url: string) => {
    const existing = collection.data.vizUrls;
    const idx = existing.findIndex((v) => v.vizName === vizName);
    const updated: VisualizationUrl[] =
      idx >= 0
        ? existing.map((v, i) => (i === idx ? { ...v, url } : v))
        : [...existing, { vizName, url }];
    onChange({ data: { ...collection.data, vizUrls: updated } });
  };

  const getVizUrl = (vizName: string): string =>
    collection.data.vizUrls.find((v) => v.vizName === vizName)?.url ?? '';

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
              className="text-sm font-medium text-neutral-800 truncate bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-brand-500 outline-none focus:ring-0 min-w-0 flex-1"
            />
            <span className="text-[10px] px-1.5 py-0.5 bg-neutral-100 text-neutral-500 rounded shrink-0">
              {typeLabel}
            </span>
            {collection.slices.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 bg-brand-50 text-brand-700 rounded shrink-0 flex items-center gap-0.5">
                <IconClock className="w-2.5 h-2.5" />
                {collection.slices.length} slice{collection.slices.length !== 1 ? 's' : ''}
                {collection.slices[collection.coverSliceIndex] && (
                  <span className="text-brand-500 ml-0.5">
                    ({collection.slices[collection.coverSliceIndex].name || 'cover'})
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="text-red-400 hover:text-red-600 transition-colors cursor-pointer p-0.5"
            >
              <IconTrash className="w-3.5 h-3.5" />
            </button>
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
              <input
                type="text"
                value={collection.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder={
                  collection.slices.length > 0
                    ? `${sliceDateRange(collection.slices)} (auto-generated from dates)`
                    : 'Auto-generated from dates'
                }
                className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-sm"
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

            {collection.slices.map((slice, i) => {
              const isCover = i === collection.coverSliceIndex;
              return (
                <div
                  key={slice.id}
                  className={`p-2 rounded border ${isCover ? 'bg-brand-50/40 border-brand-200' : 'bg-neutral-50 border-neutral-100'}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        placeholder={`Slice ${i + 1}`}
                        value={slice.name}
                        onChange={(e) => updateSlice(slice.id, { name: e.target.value })}
                        className="border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs w-28"
                      />
                      {isCover ? (
                        <span className="text-[10px] px-1.5 py-0.5 bg-brand-100 text-brand-700 rounded shrink-0">
                          Cover
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onChange({ coverSliceIndex: i })}
                          className="text-[10px] px-1.5 py-0.5 text-neutral-400 hover:text-brand-700 hover:bg-brand-50 rounded transition-colors cursor-pointer shrink-0"
                          title="Set as cover slice"
                        >
                          Set as cover
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSlice(slice.id)}
                      className="text-red-400 hover:text-red-600 transition-colors cursor-pointer p-0.5"
                      title="Remove slice"
                    >
                      <IconTrash className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <label className="text-[11px] text-neutral-500">Start</label>
                      <input
                        type="date"
                        value={slice.startDate}
                        onChange={(e) => updateSlice(slice.id, { startDate: e.target.value })}
                        className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[11px] text-neutral-500">End</label>
                      <input
                        type="date"
                        value={slice.endDate}
                        onChange={(e) => updateSlice(slice.id, { endDate: e.target.value })}
                        className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
                      />
                    </div>
                  </div>
                  {/* Cover slice visualization overrides */}
                  {isCover &&
                    collection.data.type === 'stac_browser' &&
                    (collection.data as StacBrowserCollectionData).coverVisualizations &&
                    (collection.data as StacBrowserCollectionData).coverVisualizations!.length >
                      0 && (
                      <div className="mt-2 space-y-1.5 border-t border-brand-100 pt-1.5">
                        <label className="text-[11px] text-brand-700 font-medium">
                          Cover Visualization Overrides
                        </label>
                        {(collection.data as StacBrowserCollectionData).coverVisualizations!.map(
                          (cv, cvIdx) => (
                            <div
                              key={cvIdx}
                              className="p-1.5 rounded border border-brand-100 bg-white space-y-1"
                            >
                              <span className="text-xs font-medium text-brand-700">{cv.name}</span>
                              <VizParamsInlineEditor
                                vizParams={cv.vizParams}
                                onChange={(key, value) => {
                                  const sb = collection.data as StacBrowserCollectionData;
                                  const newCoverVizs = sb.coverVisualizations!.map((v, i) =>
                                    i === cvIdx
                                      ? { ...v, vizParams: { ...v.vizParams, [key]: value } }
                                      : v
                                  );
                                  onChange({
                                    data: { ...sb, coverVisualizations: newCoverVizs },
                                  });
                                }}
                                showCompositing={
                                  (collection.data as StacBrowserCollectionData).mode === 'mosaic'
                                }
                              />
                            </div>
                          )
                        )}
                      </div>
                    )}
                  {/* Per-slice visualization URLs for manual XYZ collections */}
                  {collection.data.type === 'manual' && vizNames.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-neutral-100 pt-1.5">
                      {vizNames.map((vizName) => {
                        const url = slice.vizUrls?.find((v) => v.vizName === vizName)?.url ?? '';
                        const missingParams = ['{z}', '{x}', '{y}'].filter((p) => !url.includes(p));
                        return (
                          <div key={vizName} className="space-y-0.5">
                            <label className="text-[11px] text-neutral-500">
                              {vizName || '(unnamed)'} URL
                            </label>
                            <input
                              type="text"
                              placeholder="https://.../tiles/{z}/{x}/{y}"
                              value={url}
                              onChange={(e) => updateSliceVizUrl(slice.id, vizName, e.target.value)}
                              className="w-full border border-neutral-200 rounded px-2 py-1 text-xs font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
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
                  )}
                </div>
              );
            })}
          </div>

          {/* STAC-specific fields */}
          {collection.data.type === 'stac' &&
            (() => {
              const stac = collection.data as StacCollectionData;

              /* Check which required placeholders are present in the search body */
              const hasStart = stac.searchBody.includes('{startDatetimePlaceholder}');
              const hasEnd = stac.searchBody.includes('{endDatetimePlaceholder}');
              const hasBbox = stac.searchBody.includes('{campaignBBoxPlaceholder}');

              /* Extract cloud_cover value from search body if present */
              const cloudMatch = stac.searchBody.match(/"eo:cloud_cover"\s*\}\s*,\s*(\d+)/);
              const cloudCoverValue = cloudMatch ? cloudMatch[1] : '';

              const updateCloudCover = (val: string) => {
                const num = parseInt(val, 10);
                if (isNaN(num) && val !== '') return;
                try {
                  const body = JSON.parse(stac.searchBody);
                  const args = body?.filter?.args;
                  if (Array.isArray(args)) {
                    const ccIdx = args.findIndex(
                      (a: { args?: { property?: string }[] }) =>
                        a?.args?.[0]?.property === 'eo:cloud_cover'
                    );
                    if (ccIdx >= 0 && val !== '') {
                      args[ccIdx].args[1] = num;
                    } else if (ccIdx >= 0 && val === '') {
                      args.splice(ccIdx, 1);
                    } else if (val !== '') {
                      args.push({ op: '<=', args: [{ property: 'eo:cloud_cover' }, num] });
                    }
                    onChange({ data: { ...stac, searchBody: JSON.stringify(body, null, 2) } });
                  }
                } catch {
                  /* non-JSON body, ignore */
                }
              };

              return (
                <div className="space-y-2 p-2 rounded bg-neutral-50 border border-neutral-100">
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-700 flex items-center gap-1">
                      Registration URL
                      <Tooltip text="STAC TiTiler mosaic registration endpoint for this collection." />
                    </label>
                    <input
                      type="url"
                      value={stac.registrationUrl}
                      onChange={(e) =>
                        onChange({
                          data: { ...stac, registrationUrl: e.target.value },
                        })
                      }
                      placeholder="https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register"
                      className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
                    />
                  </div>

                  {/* Cloud Cover */}
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-700 flex items-center gap-1">
                      Max Cloud Cover (%)
                      <Tooltip text="Maximum cloud cover percentage for filtering scenes. Leave empty to disable." />
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={cloudCoverValue}
                      onChange={(e) => updateCloudCover(e.target.value)}
                      placeholder="e.g. 90"
                      className="w-24 border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
                    />
                  </div>

                  {/* Search Body */}
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-700 flex items-center gap-1">
                      Search Body
                      <Tooltip text="JSON payload for mosaic registration. Required placeholders: {startDatetimePlaceholder}, {endDatetimePlaceholder}, {campaignBBoxPlaceholder}." />
                    </label>
                    <AutoSizeTextarea
                      value={stac.searchBody}
                      onChange={(val) =>
                        onChange({
                          data: { ...stac, searchBody: val },
                        })
                      }
                      className="w-full border border-neutral-200 rounded px-2 py-1.5 text-xs font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none resize-none"
                    />
                    {/* Required placeholder indicators */}
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <PlaceholderBadge label="{startDatetimePlaceholder}" present={hasStart} />
                      <PlaceholderBadge label="{endDatetimePlaceholder}" present={hasEnd} />
                      <PlaceholderBadge label="{campaignBBoxPlaceholder}" present={hasBbox} />
                    </div>
                  </div>
                </div>
              );
            })()}

          {/* STAC Browser parameters */}
          {collection.data.type === 'stac_browser' &&
            (() => {
              const sb = collection.data as StacBrowserCollectionData;
              const updateSb = (updates: Partial<StacBrowserCollectionData>) =>
                onChange({ data: { ...sb, ...updates } });
              const updateVizParam = (vizIdx: number, key: string, value: unknown) => {
                const newVizs = sb.visualizations.map((v, i) =>
                  i === vizIdx ? { ...v, vizParams: { ...v.vizParams, [key]: value } } : v
                );
                updateSb({ visualizations: newVizs });
              };

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
                      <input
                        type="url"
                        value={sb.catalogUrl}
                        onChange={(e) => updateSb({ catalogUrl: e.target.value })}
                        className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-neutral-700">STAC Collection ID</label>
                      <input
                        type="text"
                        value={sb.stacCollectionId}
                        onChange={(e) => updateSb({ stacCollectionId: e.target.value })}
                        className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
                      />
                    </div>
                  </div>

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
                        autoQuery={{
                          collections: [sb.stacCollectionId],
                          filter: {
                            op: 'and',
                            args: [
                              {
                                op: 'anyinteracts',
                                args: [
                                  { property: 'datetime' },
                                  { interval: ['{sliceStart}', '{sliceEnd}'] },
                                ],
                              },
                              ...((sb.maxCloudCover ?? 100) < 100
                                ? [
                                    {
                                      op: '<=',
                                      args: [{ property: 'eo:cloud_cover' }, sb.maxCloudCover],
                                    },
                                  ]
                                : []),
                            ],
                          },
                          filterLang: 'cql2-json',
                        }}
                      />
                    </div>
                  )}

                  {/* Visualization parameters - tabs synced with source vizNames */}
                  {vizNames.length > 0 && (
                    <div className="space-y-2 mt-2">
                      <label className="text-xs text-neutral-700 font-medium">
                        Visualization Parameters
                      </label>
                      {vizNames.map((name) => {
                        const vizIdx = sb.visualizations.findIndex((v) => v.name === name);
                        const viz = vizIdx !== -1 ? sb.visualizations[vizIdx] : null;
                        return (
                          <div
                            key={name}
                            className="p-2 rounded border border-neutral-200 bg-white space-y-1.5"
                          >
                            <span className="text-xs font-medium text-neutral-800">
                              {name || '(unnamed)'}
                            </span>
                            {viz ? (
                              <VizParamsInlineEditor
                                vizParams={viz.vizParams}
                                onChange={(key, value) => updateVizParam(vizIdx, key, value)}
                                showCompositing={sb.mode === 'mosaic'}
                              />
                            ) : (
                              <p className="text-[10px] text-neutral-400 italic">
                                No parameters configured. Re-add this collection from the catalog to
                                set up viz params.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

          {/* Visualization URLs - only for old STAC flow */}
          {collection.data.type === 'stac' && (
            <div className="space-y-2">
              <label className="text-xs text-neutral-700 font-medium flex items-center gap-1">
                Visualization URLs
                <Tooltip text="Tile URL templates. Must include {searchId}, {z}, {x}, {y} placeholders." />
              </label>
              {vizNames.map((vizName) => {
                const url = getVizUrl(vizName);
                const missingParams = ['{searchId}', '{z}', '{x}', '{y}'].filter(
                  (p) => !url.includes(p)
                );
                return (
                  <div key={vizName} className="space-y-0.5">
                    <label className="text-[11px] text-neutral-500">{vizName || '(unnamed)'}</label>
                    <input
                      type="text"
                      placeholder="https://.../mosaic/{searchId}/tiles/{z}/{x}/{y}?..."
                      value={url}
                      onChange={(e) => updateVizUrl(vizName, e.target.value)}
                      className="w-full border border-neutral-200 rounded px-2 py-1 text-xs font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
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
          )}
        </div>
      )}
    </div>
  );
};
