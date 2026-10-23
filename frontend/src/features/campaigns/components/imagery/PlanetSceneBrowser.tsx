import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  planPlanetScenes,
  type PlanetCredentials,
  type PlanetScenePeriodOut,
  type PlanetSceneWindowOut,
  type PlanetScenesGenerationConfigV1,
} from '~/api/client';
import { Modal } from '~/shared/ui/Modal';
import { Button, DateField, Input, Select } from '~/shared/ui/forms';
import i18n from '~/shared/i18n';
import { handleError } from '~/shared/utils/errorHandler';
import { formatSliceLabel, formatWindowLabel } from '~/shared/utils/utility';
import { PlanetKeyConnect } from './PlanetKeyConnect';
import { createId, emptySource } from './types';
import type { CollectionItem, ImagerySlice, ImagerySource } from './types';

interface PlanetSceneBrowserProps {
  projectId: number;
  onAdd: (source: ImagerySource) => Promise<void>;
  onClose: () => void;
}

/** Free-form periods make a decade of daily slices as easy to ask for as a month of
 *  them, and the cost only shows up when someone searches. */
const MANY_SLICES = 300;

/** Scene tiles come from the visual asset, so there is one rendering. */
const VISUALIZATION = 'Visual';

/** Long enough that a typed date or interval is not sent digit by digit. */
const TYPING_SETTLES_MS = 250;

type PeriodUnit = PlanetScenesGenerationConfigV1['slice_period_unit'];
interface Period {
  interval: number;
  unit: PeriodUnit;
}

const PERIOD_UNITS = [
  { unit: 'days', label: 'scenes.units.days' },
  { unit: 'weeks', label: 'scenes.units.weeks' },
  { unit: 'months', label: 'scenes.units.months' },
  { unit: 'years', label: 'scenes.units.years' },
] as const satisfies readonly { unit: PeriodUnit; label: string }[];

/** Only ever compared against another period, so a 30-day month costs nothing. */
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
}) => {
  const { t } = useTranslation('imagery');
  return (
    <div className="space-y-1">
      <label className="text-xs text-neutral-700 font-medium">{label}</label>
      <p className="text-[11px] text-neutral-500 leading-snug">{help}</p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-500">{t('scenes.every')}</span>
        <Input
          size="sm"
          type="number"
          min={1}
          value={value.interval}
          onChange={(e) =>
            onChange({ ...value, interval: Math.max(1, Number(e.target.value) || 1) })
          }
          className="!w-20"
          aria-label={t('scenes.intervalAria', { label })}
        />
        <Select
          size="sm"
          value={value.unit}
          onChange={(e) => onChange({ ...value, unit: e.target.value as PeriodUnit })}
          aria-label={t('scenes.unitAria', { label })}
          className="!w-32"
        >
          {PERIOD_UNITS.map((option) => (
            <option key={option.unit} value={option.unit}>
              {t(option.label)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
};

const today = () => new Date().toISOString().slice(0, 10);

const monthBack = () => {
  const from = new Date();
  from.setUTCMonth(from.getUTCMonth() - 1);
  return from.toISOString().slice(0, 10);
};

const toSlice = (group: PlanetScenePeriodOut, unit: PeriodUnit): ImagerySlice => ({
  id: createId(),
  name: formatSliceLabel(group.start_date, group.end_date, unit, 0),
  startDate: group.start_date,
  endDate: group.end_date,
  // Filled in by registration, which mints one Planet layer per slice.
  vizUrls: [],
});

/** The windows a plan describes, as the collections a source is made of. */
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
 * A basemap series hands over finished mosaics at Planet's cadence; here the cadence is
 * ours and Planet stacks each period's acquisitions into one layer. Deliberately not
 * called a mosaic: there is no harmonisation or seam removal, and "mosaic" is Planet's
 * word for the other product. This settles what a window and a slice mean; the layers
 * are minted later, from wherever an annotator asks for them.
 */
export const PlanetSceneBrowser = ({ projectId, onAdd, onClose }: PlanetSceneBrowserProps) => {
  const { t } = useTranslation('imagery');
  const [credentials, setCredentials] = useState<PlanetCredentials | null>(null);
  const [startDate, setStartDate] = useState(monthBack());
  const [endDate, setEndDate] = useState(today());
  const [windowPeriod, setWindowPeriod] = useState<Period>({ interval: 1, unit: 'months' });
  // Three days rather than one: PlanetScope revisits about daily, but a single date
  // over one place is often cloudy or missed entirely, and a three-day slice usually
  // has something to show without blurring what "this date" means.
  const [slicePeriod, setSlicePeriod] = useState<Period>({ interval: 3, unit: 'days' });
  const [wholeWindowCover, setWholeWindowCover] = useState(true);
  const [maxCloudCover, setMaxCloudCover] = useState(80);
  const [windows, setWindows] = useState<PlanetSceneWindowOut[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const config: PlanetScenesGenerationConfigV1 = useMemo(
    () => ({
      kind: 'planet_scenes',
      version: 1,
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
    }),
    [startDate, endDate, windowPeriod, slicePeriod, wholeWindowCover, maxCloudCover]
  );

  // Said rather than silently corrected: which of the two numbers they meant to
  // change is not ours to guess.
  const sliceTooCoarse = span(slicePeriod) > span(windowPeriod);
  // A date input is empty until the whole date is typed, and a half-typed range is a
  // request the backend can only reject.
  const datesReversed = Boolean(startDate && endDate && endDate < startDate);
  const datesIncomplete = !startDate || !endDate || datesReversed;

  // The dates follow the settings as they are typed. It is arithmetic, not a search -
  // nothing is asked of Planet - but it lives on the server so there is one
  // implementation of it: the slices stored here are matched to search results by the
  // ranges they cover, and two implementations that disagree would match nothing.
  useEffect(() => {
    if (datesIncomplete || sliceTooCoarse) {
      setWindows(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      void planPlanetScenes({ body: { project_id: projectId, config } })
        .then(({ data }) => {
          if (current) setWindows(data ?? []);
        })
        .catch((err) => {
          if (current) handleError(err, i18n.t('imagery:scenes.planFailed'));
        });
    }, TYPING_SETTLES_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [config, projectId, datesIncomplete, sliceTooCoarse]);

  const add = async () => {
    if (!credentials || !windows?.length) return;
    setSubmitting(true);
    try {
      const seriesKey = createId();
      const source = emptySource();
      source.name = t('scenes.defaultName');
      source.visualizations = [{ name: VISUALIZATION }];
      source.collections = sceneCollections(
        windows,
        seriesKey,
        windowPeriod.unit,
        slicePeriod.unit
      );
      // The search that produced these windows, so the source can be rebuilt later.
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
      title={t('scenes.title')}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-neutral-500">
            {windows?.length
              ? t('planet.summary', {
                  windows: t('planet.windows', { count: windows.length }),
                  slices: t('planet.slices', { count: sliceTotal }),
                })
              : ''}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void add()}
            disabled={submitting || !windows?.length || !credentials}
          >
            {submitting ? t('wizard.adding') : t('wizard.addSource')}
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        <p className="text-[11px] text-neutral-500 leading-snug">{t('scenes.intro')}</p>
        <p className="text-[11px] text-neutral-500 leading-snug">{t('scenes.datesOnly')}</p>

        <PlanetKeyConnect projectId={projectId} onChange={setCredentials} />

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-neutral-700 font-medium">{t('planet.from')}</label>
              <DateField
                size="sm"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700 font-medium">{t('planet.to')}</label>
              <DateField size="sm" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <PeriodField
            label={t('scenes.newWindow')}
            help={t('scenes.newWindowHelp')}
            value={windowPeriod}
            onChange={setWindowPeriod}
          />

          <PeriodField
            label={t('scenes.newSlice')}
            help={t('scenes.newSliceHelp')}
            value={slicePeriod}
            onChange={setSlicePeriod}
          />

          {datesReversed && (
            <p className="text-[11px] text-amber-700 rounded-md bg-amber-50 border border-amber-200 p-2">
              {t('scenes.datesReversed')}
            </p>
          )}

          {sliceTooCoarse && (
            <p className="text-[11px] text-amber-700 rounded-md bg-amber-50 border border-amber-200 p-2">
              {t('scenes.sliceTooCoarse')}
            </p>
          )}

          <div className="space-y-1">
            <label className="text-xs text-neutral-700 font-medium">{t('scenes.opensOn')}</label>
            <p className="text-[11px] text-neutral-500 leading-snug">{t('scenes.opensOnHelp')}</p>
            <Select
              size="sm"
              value={wholeWindowCover ? 'composite' : 'first'}
              onChange={(e) => setWholeWindowCover(e.target.value === 'composite')}
              aria-label={t('scenes.opensOn')}
            >
              <option value="composite">{t('scenes.opensOnComposite')}</option>
              <option value="first">{t('scenes.opensOnFirst')}</option>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-neutral-700 font-medium">
              {t('scenes.maxCloudCover')}
            </label>
            <p className="text-[11px] text-neutral-500 leading-snug">
              {t('scenes.maxCloudCoverHelp')}
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

          {sliceTotal > MANY_SLICES && (
            <p className="text-[11px] text-amber-700 rounded-md bg-amber-50 border border-amber-200 p-2">
              {t('scenes.manySlices', { count: sliceTotal })}
            </p>
          )}

          {!!windows?.length && (
            <div className="space-y-1.5">
              <p className="text-xs text-neutral-700 font-medium">{t('scenes.preview')}</p>
              <ul className="text-[11px] text-neutral-600 space-y-0.5 max-h-48 overflow-y-auto">
                {windows.map((window) => (
                  <li key={window.start_date}>
                    <Trans
                      t={t}
                      i18nKey={window.cover ? 'scenes.windowItemCover' : 'scenes.windowItem'}
                      values={{
                        label: formatWindowLabel(
                          window.start_date,
                          window.end_date,
                          windowPeriod.unit
                        ),
                        count: window.slices.length,
                      }}
                      components={{ strong: <strong /> }}
                    />
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-neutral-500 leading-snug">
                {t('scenes.nothingBuilt')}
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
