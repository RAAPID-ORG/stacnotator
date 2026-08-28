import { useState } from 'react';
import {
  previewPlanetScenes,
  type PlanetCredentials,
  type PlanetSceneGroupOut,
  type PlanetSceneWindowOut,
  type PlanetScenesGenerationConfigV1,
} from '~/api/client';
import { Modal } from '~/shared/ui/Modal';
import { Button, Input, Select } from '~/shared/ui/forms';
import { handleError } from '~/shared/utils/errorHandler';
import { formatSliceLabel, formatWindowLabel } from '~/shared/utils/utility';
import { PlanetKeyConnect } from './PlanetKeyConnect';
import { createId, emptySource } from './types';
import type { CollectionItem, ImagerySlice, ImagerySource } from './types';

interface PlanetSceneBrowserProps {
  projectId: number;
  /** The area the search is bounded by: west, south, east, north. */
  campaignBbox: number[] | null;
  onAdd: (source: ImagerySource) => Promise<void>;
  onClose: () => void;
}

/** Past this the wizard says so: free-form periods make a decade of daily slices as
 *  easy to ask for as a month of them, and the cost only shows up at save time. */
const MANY_SLICES = 300;

/** Planet scene tiles come from the visual asset, so there is one rendering. */
const VISUALIZATION = 'Visual';

type PeriodUnit = PlanetScenesGenerationConfigV1['slice_period_unit'];
interface Period {
  interval: number;
  unit: PeriodUnit;
}

const PERIOD_UNITS: { unit: PeriodUnit; label: string }[] = [
  { unit: 'days', label: 'days' },
  { unit: 'weeks', label: 'weeks' },
  { unit: 'months', label: 'months' },
  { unit: 'years', label: 'years' },
];

/** Roughly how long a period is, only ever compared against another period, so a
 *  month being 30 days here costs nothing. */
const APPROXIMATE_DAYS: Record<PeriodUnit, number> = {
  days: 1,
  weeks: 7,
  months: 30,
  years: 365,
};
const span = (period: Period) => period.interval * APPROXIMATE_DAYS[period.unit];

const PeriodField = ({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: Period;
  onChange: (period: Period) => void;
}) => (
  <div className="space-y-1">
    <label className="text-xs text-neutral-700 font-medium">{label}</label>
    <p className="text-[11px] text-neutral-500 leading-snug">{help}</p>
    <div className="flex items-center gap-2">
      <span className="text-xs text-neutral-500">every</span>
      <Input
        size="sm"
        type="number"
        min={1}
        value={value.interval}
        onChange={(e) => onChange({ ...value, interval: Math.max(1, Number(e.target.value) || 1) })}
        className="!w-20"
        aria-label={`${label} interval`}
      />
      <Select
        size="sm"
        value={value.unit}
        onChange={(e) => onChange({ ...value, unit: e.target.value as PeriodUnit })}
        aria-label={`${label} unit`}
        className="!w-32"
      >
        {PERIOD_UNITS.map((option) => (
          <option key={option.unit} value={option.unit}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  </div>
);

const today = () => new Date().toISOString().slice(0, 10);

const monthBack = () => {
  const from = new Date();
  from.setUTCMonth(from.getUTCMonth() - 1);
  return from.toISOString().slice(0, 10);
};

const polygonOf = (bbox: number[]) => {
  const [west, south, east, north] = bbox;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
};

const toSlice = (group: PlanetSceneGroupOut, unit: PeriodUnit): ImagerySlice => ({
  id: createId(),
  name: formatSliceLabel(group.start_date, group.end_date, unit, 0),
  startDate: group.start_date,
  endDate: group.end_date,
  // Filled in by registration, which mints one Planet layer per slice.
  vizUrls: [],
});

/** The windows a preview describes, as the collections a source is made of. */
export function sceneCollections(
  windows: PlanetSceneWindowOut[],
  generationSeriesId: string,
  windowUnit: PeriodUnit,
  sliceUnit: PeriodUnit
): CollectionItem[] {
  return windows.map((window) => {
    const cover = window.cover ? [toSlice(window.cover, windowUnit)] : [];
    return {
      id: createId(),
      name: formatWindowLabel(window.start_date, window.end_date, windowUnit),
      slices: [...cover, ...window.slices.map((slice) => toSlice(slice, sliceUnit))],
      coverSliceIndex: 0,
      hasDedicatedCover: cover.length > 0,
      generationSeriesId,
      data: { type: 'manual', vizUrls: [] },
    };
  });
}

/**
 * Build an imagery source from the PlanetScope archive.
 *
 * A basemap series hands over finished mosaics at Planet's cadence; here the cadence
 * is ours and Planet stacks each period's acquisitions into one layer on request.
 * Deliberately not called a mosaic: there is no harmonisation or seam removal, and
 * "mosaic" is Planet's word for the other product. Nothing is chosen scene by scene -
 * this settles what a window and a slice mean, and registration mints the layers.
 */
export const PlanetSceneBrowser = ({
  projectId,
  campaignBbox,
  onAdd,
  onClose,
}: PlanetSceneBrowserProps) => {
  const [credentials, setCredentials] = useState<PlanetCredentials | null>(null);
  const [startDate, setStartDate] = useState(monthBack());
  const [endDate, setEndDate] = useState(today());
  const [windowPeriod, setWindowPeriod] = useState<Period>({ interval: 1, unit: 'months' });
  const [slicePeriod, setSlicePeriod] = useState<Period>({ interval: 1, unit: 'days' });
  const [wholeWindowCover, setWholeWindowCover] = useState(true);
  const [maxCloudCover, setMaxCloudCover] = useState(80);
  const [windows, setWindows] = useState<PlanetSceneWindowOut[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const config: PlanetScenesGenerationConfigV1 | null = campaignBbox
    ? {
        kind: 'planet_scenes',
        version: 1,
        aoi: polygonOf(campaignBbox),
        item_types: ['PSScene'],
        start_date: startDate,
        end_date: endDate,
        collection_period_interval: windowPeriod.interval,
        collection_period_unit: windowPeriod.unit,
        slice_period_interval: slicePeriod.interval,
        slice_period_unit: slicePeriod.unit,
        whole_window_cover: wholeWindowCover,
        max_cloud_cover: maxCloudCover,
        quality_categories: ['standard'],
      }
    : null;

  // A slice longer than its window is clipped to the window, so every window would
  // hold one slice covering all of it. Said rather than silently corrected: the
  // numbers are the user's, and which of the two they meant to change is not ours
  // to guess.
  const sliceTooCoarse = span(slicePeriod) > span(windowPeriod);

  const search = () => {
    if (!credentials || !config) return;
    setSearching(true);
    setWindows(null);
    void previewPlanetScenes({ body: { credentials, config } })
      .then(({ data }) => setWindows(data ?? []))
      .catch((err) => handleError(err, 'Could not search Planet for scenes'))
      .finally(() => setSearching(false));
  };

  const add = async () => {
    if (!credentials || !config || !windows?.length) return;
    setSubmitting(true);
    try {
      const seriesKey = createId();
      const source = emptySource();
      source.name = 'PlanetScope daily imagery';
      source.visualizations = [{ name: VISUALIZATION }];
      source.collections = sceneCollections(
        windows,
        seriesKey,
        windowPeriod.unit,
        slicePeriod.unit
      );
      // The search that produced these windows, so the source can be rebuilt or
      // extended later without anyone having to remember what was asked for.
      source.generationSeries = [{ id: seriesKey, config }];
      // The source keeps whichever key browsed it, so registration can mint with it.
      source.organizationApiKeyId = credentials.organization_api_key_id ?? null;
      source.apiKey = credentials.api_key ?? undefined;
      await onAdd(source);
    } finally {
      setSubmitting(false);
    }
  };

  const sliceTotal = (windows ?? []).reduce(
    (n, window) => n + window.slices.length + (window.cover ? 1 : 0),
    0
  );

  return (
    <Modal
      title="Add Planet daily imagery"
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-neutral-500">
            {windows?.length
              ? `${windows.length} window${windows.length === 1 ? '' : 's'}, ${sliceTotal} slice${sliceTotal === 1 ? '' : 's'}`
              : ''}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void add()}
            disabled={submitting || !windows?.length}
          >
            {submitting ? 'Adding…' : 'Add source'}
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        <p className="text-[11px] text-neutral-500 leading-snug">
          Each period&apos;s acquisitions are stacked into one layer on request, clearest on top, so
          a slice can be as fine as a single day. Overlaps stay visible as seams - this is the raw
          archive, not a harmonised basemap. The tiles count against your scene-tile quota, which is
          separate from the basemap allowance.
        </p>

        <PlanetKeyConnect
          projectId={projectId}
          credentials={credentials}
          onChange={(next) => {
            setWindows(null);
            setCredentials(next);
          }}
        />

        {!campaignBbox && (
          <p className="text-[11px] text-amber-700 rounded-md bg-amber-50 border border-amber-200 p-2">
            This campaign has no area yet, and the scene search is bounded by it. Set the campaign
            area first.
          </p>
        )}

        {credentials && campaignBbox && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-neutral-700 font-medium">From</label>
                <Input
                  size="sm"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-neutral-700 font-medium">To</label>
                <Input
                  size="sm"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <PeriodField
              label="New window"
              help="One canvas window per period, named after the dates it covers."
              value={windowPeriod}
              onChange={setWindowPeriod}
            />

            <PeriodField
              label="New slice"
              help="What one step through the imagery moves by, inside a window."
              value={slicePeriod}
              onChange={setSlicePeriod}
            />

            {sliceTooCoarse && (
              <p className="text-[11px] text-amber-700 rounded-md bg-amber-50 border border-amber-200 p-2">
                A slice cannot be longer than its window, or every window holds a single slice
                covering all of it. Shorten the slice period or lengthen the window.
              </p>
            )}

            <div className="space-y-1">
              <label className="text-xs text-neutral-700 font-medium">
                What the window opens on
              </label>
              <p className="text-[11px] text-neutral-500 leading-snug">
                Annotators see this before stepping through the dates inside it. A composite stacks
                every acquisition in the window, so it has fewer gaps than any single date.
              </p>
              <Select
                size="sm"
                value={wholeWindowCover ? 'composite' : 'first'}
                onChange={(e) => setWholeWindowCover(e.target.value === 'composite')}
                aria-label="What the window opens on"
              >
                <option value="composite">A composite of the whole window</option>
                <option value="first">Its first date</option>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-neutral-700 font-medium">Maximum cloud cover</label>
              <p className="text-[11px] text-neutral-500 leading-snug">
                Cloudier acquisitions are left out, so a date with nothing clear enough gets no
                slice at all.
              </p>
              <div className="flex items-center gap-1.5">
                <Input
                  size="sm"
                  type="number"
                  min={0}
                  max={100}
                  value={maxCloudCover}
                  onChange={(e) =>
                    setMaxCloudCover(Math.min(100, Math.max(0, Number(e.target.value) || 0)))
                  }
                  className="!w-20"
                />
                <span className="text-xs text-neutral-500">%</span>
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={search}
              disabled={searching || sliceTooCoarse}
            >
              {searching ? 'Searching Planet…' : 'Search'}
            </Button>

            {windows?.length === 0 && (
              <p className="text-[11px] text-amber-700 rounded-md bg-amber-50 border border-amber-200 p-2">
                Planet has no scenes over this area for these dates and filters.
              </p>
            )}

            {sliceTotal > MANY_SLICES && (
              <p className="text-[11px] text-amber-700 rounded-md bg-amber-50 border border-amber-200 p-2">
                {sliceTotal} slices is a lot to build and a lot to step through. Each one is a layer
                minted when you save, and a date in the annotator&apos;s navigation.
              </p>
            )}

            {!!windows?.length && (
              <div className="space-y-1.5">
                <p className="text-xs text-neutral-700 font-medium">What will be created</p>
                <ul className="text-[11px] text-neutral-600 space-y-0.5 max-h-48 overflow-y-auto">
                  {windows.map((window) => (
                    <li key={window.start_date}>
                      <strong>
                        {formatWindowLabel(window.start_date, window.end_date, windowPeriod.unit)}
                      </strong>{' '}
                      - {window.slices.length} slice
                      {window.slices.length === 1 ? '' : 's'}
                      {window.cover && `, cover from ${window.cover.scene_count} scenes`}
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-neutral-500 leading-snug">
                  Layers are minted in the background after saving, so the source shows as
                  registering until every slice has one.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
