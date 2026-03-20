import { useState } from 'react';
import type { CollectionItem, ImagerySlice, VisualizationUrl, StacCollectionData } from './types';
import { emptySlice, sliceDateRange, createId } from './types';
import { IconTrash, IconChevronDown, IconChevronUp, IconPlus, IconClock } from '~/shared/ui/Icons';
import { AutoSizeTextarea } from '~/shared/ui/AutoSizeTextarea';
import { Tooltip } from './Tooltip';

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

  const typeLabel = collection.data.type === 'stac' ? 'STAC' : 'XYZ';

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
    onChange({
      slices: [...collection.slices, emptySlice()],
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
                      (a: any) => a?.args?.[0]?.property === 'eo:cloud_cover'
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

          {/* Visualization URLs */}
          <div className="space-y-2">
            <label className="text-xs text-neutral-700 font-medium flex items-center gap-1">
              Visualization URLs
              <Tooltip
                text={
                  collection.data.type === 'stac'
                    ? 'Tile URL templates. Must include {searchId}, {z}, {x}, {y} placeholders.'
                    : 'XYZ tile URLs. Use {z}, {x}, {y} placeholders.'
                }
              />
            </label>
            {vizNames.map((vizName) => {
              const url = getVizUrl(vizName);
              const isStac = collection.data.type === 'stac';
              const missingParams = isStac
                ? ['{searchId}', '{z}', '{x}', '{y}'].filter((p) => !url.includes(p))
                : ['{z}', '{x}', '{y}'].filter((p) => !url.includes(p));
              return (
                <div key={vizName} className="space-y-0.5">
                  <label className="text-[11px] text-neutral-500">{vizName || '(unnamed)'}</label>
                  <input
                    type="text"
                    placeholder={
                      isStac
                        ? 'https://.../mosaic/{searchId}/tiles/{z}/{x}/{y}?...'
                        : 'https://.../tiles/{z}/{x}/{y}'
                    }
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
                          ✗ {p}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
