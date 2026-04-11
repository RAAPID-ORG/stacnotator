import { useState, useRef, useEffect } from 'react';
import type { StacConfig, ImagerySlice, CollectionItem, VisualizationUrl } from './types';
import { emptyStacConfig, createId, STAC_PRESETS } from './types';
import { formatSliceLabel, formatWindowLabel } from '~/shared/utils/utility';
import { IconCode, IconChevronDown, IconChevronUp } from '~/shared/ui/Icons';
import { AutoSizeTextarea } from '~/shared/ui/AutoSizeTextarea';
import { Modal } from '~/shared/ui/Modal';
import { Tooltip } from './Tooltip';
import { MonthPicker } from './MonthPicker';

interface StacGeneratorProps {
  vizNames: string[];
  onGenerate: (collections: CollectionItem[]) => void;
  onClose: () => void;
  /** When set, auto-applies this STAC preset on mount */
  initialPresetId?: string | null;
}

export const StacGenerator = ({
  vizNames,
  onGenerate,
  onClose,
  initialPresetId,
}: StacGeneratorProps) => {
  const [config, setConfig] = useState<StacConfig>(() => emptyStacConfig(vizNames));
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [showJson, setShowJson] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showCoverAdvanced, setShowCoverAdvanced] = useState(false);
  const initialPresetApplied = useRef(false);

  const update = <K extends keyof StacConfig>(key: K, value: StacConfig[K]) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      // When cloud cover changes, update the eo:cloud_cover value in searchBody if present
      if (key === 'cloudCover' && next.searchBody) {
        try {
          const body = JSON.parse(next.searchBody);
          const updated = updateCloudCoverInBody(body, value as number);
          if (updated) next.searchBody = JSON.stringify(body, null, 2);
        } catch {
          // searchBody is not valid JSON, skip
        }
      }
      return next;
    });
  };

  /** Recursively find and update eo:cloud_cover filter value in a CQL2 JSON body */
  const updateCloudCoverInBody = (obj: unknown, cloudCover: number): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    if (Array.isArray(obj)) {
      return obj.some((item) => updateCloudCoverInBody(item, cloudCover));
    }
    const rec = obj as Record<string, unknown>;
    // Match { op: '<=', args: [{ property: 'eo:cloud_cover' }, <number>] }
    if (
      (rec.op === '<=' || rec.op === '<') &&
      Array.isArray(rec.args) &&
      rec.args.length === 2 &&
      rec.args[0] &&
      typeof rec.args[0] === 'object' &&
      (rec.args[0] as Record<string, unknown>).property === 'eo:cloud_cover'
    ) {
      rec.args[1] = cloudCover;
      return true;
    }
    // Recurse into object values
    return Object.values(rec).some((v) => updateCloudCoverInBody(v, cloudCover));
  };

  const applyPreset = (presetId: string) => {
    const preset = STAC_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const merged = { ...config, ...preset.config };
    // Extract cloud cover from the search body if present
    if (merged.searchBody) {
      try {
        const body = JSON.parse(merged.searchBody);
        const extracted = extractCloudCover(body);
        if (extracted !== null) merged.cloudCover = extracted;
      } catch {
        // skip
      }
    }
    setConfig(merged);
    setSelectedPreset(presetId);
  };

  // Auto-apply initial preset on first mount
  useEffect(() => {
    if (initialPresetId && !initialPresetApplied.current) {
      initialPresetApplied.current = true;
      applyPreset(initialPresetId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Extract eo:cloud_cover value from a CQL2 JSON body */
  const extractCloudCover = (obj: unknown): number | null => {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const result = extractCloudCover(item);
        if (result !== null) return result;
      }
      return null;
    }
    const rec = obj as Record<string, unknown>;
    if (
      (rec.op === '<=' || rec.op === '<') &&
      Array.isArray(rec.args) &&
      rec.args.length === 2 &&
      rec.args[0] &&
      typeof rec.args[0] === 'object' &&
      (rec.args[0] as Record<string, unknown>).property === 'eo:cloud_cover' &&
      typeof rec.args[1] === 'number'
    ) {
      return rec.args[1];
    }
    for (const v of Object.values(rec)) {
      const result = extractCloudCover(v);
      if (result !== null) return result;
    }
    return null;
  };

  const updateVizUrl = (index: number, field: keyof VisualizationUrl, value: string) => {
    const updated = [...config.vizUrls];
    updated[index] = { ...updated[index], [field]: value };
    update('vizUrls', updated);
  };

  const generateCollections = (): CollectionItem[] => {
    if (!config.startDate || !config.endDate) return [];

    const start = new Date(config.startDate + '-01');
    // End month is inclusive: move one month past the selected end month
    const endRaw = new Date(config.endDate + '-01');
    endRaw.setMonth(endRaw.getMonth() + 1);
    const end = endRaw;
    const collections: CollectionItem[] = [];

    let colCurrent = new Date(start);
    while (colCurrent < end) {
      const colStart = new Date(colCurrent);
      let colEnd: Date;

      if (config.collectionPeriodUnit === 'weeks') {
        colEnd = new Date(colCurrent);
        colEnd.setDate(colEnd.getDate() + config.collectionPeriodInterval * 7);
      } else if (config.collectionPeriodUnit === 'years') {
        colEnd = new Date(colCurrent);
        colEnd.setFullYear(colEnd.getFullYear() + config.collectionPeriodInterval);
      } else {
        colEnd = new Date(colCurrent);
        colEnd.setMonth(colEnd.getMonth() + config.collectionPeriodInterval);
      }

      if (colEnd > end) {
        colEnd = new Date(end);
      }

      const colEndDate = new Date(colEnd);
      colEndDate.setDate(colEndDate.getDate() - 1);

      // Generate slices within this collection
      const slices: ImagerySlice[] = [];

      // Custom cover slice (spans full collection period)
      if (config.coverSliceMode === 'custom' && config.generateCoverSlice) {
        slices.push({
          id: createId(),
          name: config.coverSliceName || 'Cover',
          startDate: colStart.toISOString().slice(0, 10),
          endDate: colEndDate.toISOString().slice(0, 10),
        });
      }

      // Inner slices
      let sliceCurrent = new Date(colStart);
      while (sliceCurrent < colEnd) {
        const sliceStart = new Date(sliceCurrent);
        let sliceEnd: Date;

        if (config.slicePeriodUnit === 'days') {
          sliceEnd = new Date(sliceCurrent);
          sliceEnd.setDate(sliceEnd.getDate() + config.slicePeriodInterval);
        } else if (config.slicePeriodUnit === 'weeks') {
          sliceEnd = new Date(sliceCurrent);
          sliceEnd.setDate(sliceEnd.getDate() + config.slicePeriodInterval * 7);
        } else if (config.slicePeriodUnit === 'years') {
          sliceEnd = new Date(sliceCurrent);
          sliceEnd.setFullYear(sliceEnd.getFullYear() + config.slicePeriodInterval);
        } else {
          sliceEnd = new Date(sliceCurrent);
          sliceEnd.setMonth(sliceEnd.getMonth() + config.slicePeriodInterval);
        }

        if (sliceEnd > colEnd) sliceEnd = new Date(colEnd);

        const sliceEndDate = new Date(sliceEnd);
        sliceEndDate.setDate(sliceEndDate.getDate() - 1);

        slices.push({
          id: createId(),
          name: formatSliceLabel(
            sliceStart.toISOString().slice(0, 10),
            sliceEndDate.toISOString().slice(0, 10),
            config.slicePeriodUnit,
            slices.length
          ),
          startDate: sliceStart.toISOString().slice(0, 10),
          endDate: sliceEndDate.toISOString().slice(0, 10),
        });

        sliceCurrent = sliceEnd;
      }

      // Determine cover slice data (may differ from regular slices)
      const coverRegUrl = config.coverRegistrationUrl || config.registrationUrl;
      const coverBody = config.coverSearchBody || config.searchBody;
      const isCustomCover = config.coverSliceMode === 'custom' && config.generateCoverSlice;

      // Determine coverSliceIndex
      const coverSliceIndex = isCustomCover
        ? 0 // custom cover is always the first slice
        : Math.min(config.coverSliceNth - 1, slices.length - 1); // nth (0-based, clamped)

      collections.push({
        id: createId(),
        name: formatWindowLabel(
          colStart.toISOString().slice(0, 10),
          colEndDate.toISOString().slice(0, 10),
          config.collectionPeriodUnit
        ),
        slices,
        coverSliceIndex: Math.max(0, coverSliceIndex),
        windowInterval: config.collectionPeriodInterval,
        windowUnit: config.collectionPeriodUnit,
        slicingInterval: config.slicePeriodInterval,
        slicingUnit: config.slicePeriodUnit,
        data: {
          type: 'stac' as const,
          registrationUrl: isCustomCover ? coverRegUrl : config.registrationUrl,
          searchBody: isCustomCover ? coverBody : config.searchBody,
          vizUrls: config.vizUrls.map((v) => ({ ...v })),
        },
      });

      colCurrent = colEnd;
    }

    return collections;
  };

  const preview = (() => {
    if (!config.startDate || !config.endDate) return { collections: 0, slicesPerCollection: 0 };
    const cols = generateCollections();
    return {
      collections: cols.length,
      slicesPerCollection: cols[0]?.slices.length ?? 0,
    };
  })();

  const handleGenerate = () => {
    const collections = generateCollections();
    if (collections.length > 0) {
      onGenerate(collections);
    }
  };

  const isValid =
    config.startDate &&
    config.endDate &&
    config.startDate <= config.endDate &&
    (config.registrationUrl || (config.generateCoverSlice && config.coverRegistrationUrl)) &&
    config.vizUrls.length > 0 &&
    config.vizUrls.every((v) => v.url);

  const footer = (
    <div className="flex justify-between">
      <button
        type="button"
        onClick={onClose}
        className="text-sm text-neutral-600 hover:text-neutral-800 transition-colors cursor-pointer"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={!isValid}
        className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors cursor-pointer disabled:bg-neutral-300 disabled:text-neutral-500 disabled:cursor-not-allowed"
      >
        Generate {preview.collections > 0 ? `${preview.collections} Collections` : 'Collections'}
      </button>
    </div>
  );

  return (
    <Modal
      title="Generate Temporal Series"
      onClose={onClose}
      maxWidth="max-w-xl"
      scrollable
      footer={footer}
    >
      <div className="p-5 space-y-4">
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 font-medium">Preset</label>
          <select
            value={selectedPreset}
            onChange={(e) => applyPreset(e.target.value)}
            className="w-full border border-neutral-300 rounded-md px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
          >
            <option value="">Select a preset...</option>
            {STAC_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-neutral-700 flex items-center gap-1">
              Start Month
              <Tooltip text="First month of the temporal range for slice generation." />
            </label>
            <MonthPicker value={config.startDate} onChange={(v) => update('startDate', v)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-700 flex items-center gap-1">
              End Month (inclusive)
              <Tooltip text="Last month of the temporal range (inclusive). This month will be included as its own collection." />
            </label>
            <MonthPicker value={config.endDate} onChange={(v) => update('endDate', v)} />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-neutral-700 flex items-center gap-1">
            Max Cloud Cover (%)
            <Tooltip text="Maximum allowed cloud cover percentage. Applied as an eo:cloud_cover filter in the search body." />
          </label>
          <input
            type="number"
            min="0"
            max="100"
            value={config.cloudCover}
            onChange={(e) =>
              update('cloudCover', Math.max(0, Math.min(100, Number(e.target.value))))
            }
            className="w-32 border-brand-600 border-b focus:border-b-2 outline-none focus:ring-0 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-neutral-700 flex items-center gap-1">
              Collection Period
              <Tooltip text="How often to create a new collection. E.g. 1 month means each month is a collection." />
            </label>
            <input
              type="number"
              min="1"
              value={config.collectionPeriodInterval}
              onChange={(e) =>
                update('collectionPeriodInterval', Math.max(1, Number(e.target.value)))
              }
              className="w-full border-brand-600 border-b focus:border-b-2 outline-none focus:ring-0 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-700">Collection Unit</label>
            <select
              value={config.collectionPeriodUnit}
              onChange={(e) =>
                update('collectionPeriodUnit', e.target.value as 'weeks' | 'months' | 'years')
              }
              className="w-full border-brand-600 border-b focus:border-b-2 outline-none focus:ring-0 text-sm"
            >
              <option value="weeks">Weeks</option>
              <option value="months">Months</option>
              <option value="years">Years</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-neutral-700 flex items-center gap-1">
              Slice Period
              <Tooltip text="How to divide each collection into slices. E.g. 1 week creates weekly slices within each collection." />
            </label>
            <input
              type="number"
              min="1"
              value={config.slicePeriodInterval}
              onChange={(e) => update('slicePeriodInterval', Math.max(1, Number(e.target.value)))}
              className="w-full border-brand-600 border-b focus:border-b-2 outline-none focus:ring-0 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-700">Slice Unit</label>
            <select
              value={config.slicePeriodUnit}
              onChange={(e) =>
                update('slicePeriodUnit', e.target.value as 'days' | 'weeks' | 'months' | 'years')
              }
              className="w-full border-brand-600 border-b focus:border-b-2 outline-none focus:ring-0 text-sm"
            >
              <option value="days">Days</option>
              <option value="weeks">Weeks</option>
              <option value="months">Months</option>
              <option value="years">Years</option>
            </select>
          </div>
        </div>

        {/* Cover slice */}
        <div className="rounded-md border border-neutral-200 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-700 font-medium flex items-center gap-1">
              Cover Slice
              <Tooltip text="Each collection needs a cover slice - the representative image shown by default. You can either pick one of the regular slices or add a custom cover layer (e.g. a median mosaic)." />
            </span>
          </div>

          {/* Mode selector */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                update('coverSliceMode', 'nth');
                update('generateCoverSlice', false);
              }}
              className={`flex-1 text-xs px-3 py-1.5 rounded-md border transition-colors cursor-pointer ${
                config.coverSliceMode === 'nth'
                  ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium'
                  : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
              }`}
            >
              Use n-th slice
            </button>
            <button
              type="button"
              onClick={() => {
                update('coverSliceMode', 'custom');
                update('generateCoverSlice', true);
              }}
              className={`flex-1 text-xs px-3 py-1.5 rounded-md border transition-colors cursor-pointer ${
                config.coverSliceMode === 'custom'
                  ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium'
                  : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
              }`}
            >
              Custom cover layer
            </button>
          </div>

          {config.coverSliceMode === 'nth' ? (
            <div className="space-y-1">
              <label className="text-[11px] text-neutral-500 flex items-center gap-1">
                Slice number (1-based)
                <Tooltip text="Which regular slice to use as the cover. E.g. 1 = the first slice of each collection." />
              </label>
              <input
                type="number"
                min="1"
                value={config.coverSliceNth}
                onChange={(e) => update('coverSliceNth', Math.max(1, Number(e.target.value)))}
                className="w-20 border-brand-600 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] text-neutral-500">Cover slice name</label>
                <input
                  type="text"
                  value={config.coverSliceName}
                  onChange={(e) => update('coverSliceName', e.target.value)}
                  placeholder="e.g. Median Mosaic"
                  className="w-full border-brand-600 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
                />
              </div>

              {/* Collapsible cover STAC details */}
              <div className="rounded border border-neutral-100">
                <button
                  type="button"
                  onClick={() => setShowCoverAdvanced(!showCoverAdvanced)}
                  className="w-full flex items-center justify-between px-2 py-1.5 cursor-pointer hover:bg-neutral-50 transition-colors"
                >
                  <span className="text-[11px] text-neutral-500 font-medium">
                    Cover STAC Details
                  </span>
                  {showCoverAdvanced ? (
                    <IconChevronUp className="w-3 h-3 text-neutral-400" />
                  ) : (
                    <IconChevronDown className="w-3 h-3 text-neutral-400" />
                  )}
                </button>
                {showCoverAdvanced && (
                  <div className="px-2 pb-2 space-y-2 border-t border-neutral-100">
                    <div className="space-y-1 pt-2">
                      <label className="text-[11px] text-neutral-500 flex items-center gap-1">
                        Cover Registration URL
                        <Tooltip text="Separate STAC registration endpoint for the cover slice. Leave empty to use the main registration URL." />
                      </label>
                      <input
                        type="url"
                        placeholder={config.registrationUrl || 'Same as main registration URL'}
                        value={config.coverRegistrationUrl}
                        onChange={(e) => update('coverRegistrationUrl', e.target.value)}
                        className="w-full border-brand-600 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-neutral-500 flex items-center gap-1">
                        Cover Search Body
                        <Tooltip text="Separate JSON search body for the cover slice. Leave empty to use the main search body." />
                      </label>
                      <AutoSizeTextarea
                        placeholder={
                          config.searchBody
                            ? 'Same as main search body'
                            : '{"collections": [...], ...}'
                        }
                        value={config.coverSearchBody}
                        onChange={(val) => update('coverSearchBody', val)}
                        minRows={2}
                        className="w-full border border-neutral-200 rounded px-2 py-1.5 text-xs font-mono focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Collapsible STAC Details */}
        <div className="rounded-md border border-neutral-200">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-neutral-50 transition-colors"
          >
            <span className="text-xs text-neutral-700 font-medium">STAC Details</span>
            {showAdvanced ? (
              <IconChevronUp className="w-3.5 h-3.5 text-neutral-400" />
            ) : (
              <IconChevronDown className="w-3.5 h-3.5 text-neutral-400" />
            )}
          </button>

          {showAdvanced && (
            <div className="px-3 pb-3 space-y-4 border-t border-neutral-100">
              <div className="space-y-1 pt-3">
                <label className="text-xs text-neutral-700 flex items-center gap-1">
                  Registration URL
                  <Tooltip text="STAC TiTiler mosaic registration endpoint. Used to create a searchId for tile access." />
                </label>
                <input
                  type="url"
                  placeholder="https://example.com/mosaic/register"
                  value={config.registrationUrl}
                  onChange={(e) => update('registrationUrl', e.target.value)}
                  className="w-full border-brand-600 border-b focus:border-b-2 outline-none focus:ring-0 text-sm"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-neutral-700 flex items-center gap-1">
                    Search Body
                    <Tooltip text="JSON payload sent to the registration endpoint. Use {startDatetimePlaceholder} and {endDatetimePlaceholder} for temporal windowing, {campaignBBoxPlaceholder} for spatial filtering." />
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowJson(!showJson)}
                    className={`flex items-center gap-1 text-xs transition-colors cursor-pointer ${
                      showJson ? 'text-brand-700' : 'text-neutral-500 hover:text-neutral-700'
                    }`}
                  >
                    <IconCode className="w-3 h-3" />
                    JSON
                  </button>
                </div>
                <p className="text-[11px] text-neutral-500">
                  Use{' '}
                  <code className="bg-neutral-100 px-1 rounded">
                    {'{startDatetimePlaceholder}'}
                  </code>
                  ,{' '}
                  <code className="bg-neutral-100 px-1 rounded">{'{endDatetimePlaceholder}'}</code>,
                  and{' '}
                  <code className="bg-neutral-100 px-1 rounded">{'{campaignBBoxPlaceholder}'}</code>{' '}
                  as dynamic placeholders.
                </p>
                <AutoSizeTextarea
                  placeholder='{"collections": ["sentinel-2-l2a"], ...}'
                  value={config.searchBody}
                  onChange={(val) => update('searchBody', val)}
                  minRows={3}
                  className="w-full border border-neutral-200 rounded px-2 py-1.5 text-xs font-mono focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-neutral-700 font-medium flex items-center gap-1">
                  Visualization URL Templates
                  <Tooltip text="Tile URL templates for each visualization. Use {searchId}, {z}, {x}, {y} placeholders." />
                </label>

                {config.vizUrls.map((viz, i) => (
                  <div
                    key={i}
                    className="space-y-1.5 p-2 rounded bg-neutral-50 border border-neutral-100"
                  >
                    <span className="text-xs font-medium text-neutral-700">
                      {viz.vizName || '(unnamed)'}
                    </span>
                    <input
                      type="text"
                      placeholder="https://.../mosaic/{searchId}/tiles/{z}/{x}/{y}?..."
                      value={viz.url}
                      onChange={(e) => updateVizUrl(i, 'url', e.target.value)}
                      className="w-full border border-neutral-200 rounded px-2 py-1 text-xs font-mono focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {preview.collections > 0 && (
          <div className="rounded-md bg-brand-50 border border-brand-200 px-3 py-2 text-xs text-brand-800">
            This will generate <strong>{preview.collections}</strong> collection
            {preview.collections !== 1 ? 's' : ''}, each with{' '}
            <strong>{preview.slicesPerCollection}</strong> slice
            {preview.slicesPerCollection !== 1 ? 's' : ''}{' '}
            {config.coverSliceMode === 'custom' &&
              config.generateCoverSlice &&
              '(incl. custom cover) '}
            {config.coverSliceMode === 'nth' && `(cover = slice #${config.coverSliceNth}) `}
            and {config.vizUrls.length} visualization{config.vizUrls.length !== 1 ? 's' : ''}.
          </div>
        )}
      </div>
    </Modal>
  );
};
