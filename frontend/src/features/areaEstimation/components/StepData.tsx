import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button, Field, IconButton, Input, Select } from '~/shared/ui/forms';
import { IconTrash } from '~/shared/ui/Icons';
import { Spinner } from '~/shared/ui/Spinner';
import { FileInput } from '~/shared/ui/FileInput';
import { handleError } from '~/shared/utils/errorHandler';
import { censusPixels, inspectRaster, parseStudyAreas } from '../api';
import type { AreaEstimationPlan, MapValue, StudyArea } from '../core/plan';
import {
  looksNotEqualArea,
  pixelsFor,
  proposedEqualAreaCrs,
  reportingAreas,
  studyAreaPixels,
} from '../core/plan';
import { EQUAL_AREA_PROJECTIONS } from '../core/guidance';
import { ChoiceCard, expandLinkCls, Note, RICH_TEXT, StepHeading, SubHeading } from './Explain';
import { formatPixels } from './format';

interface Props {
  plan: AreaEstimationPlan;
  update: (patch: Partial<AreaEstimationPlan>) => void;
}

export const StepData = ({ plan, update }: Props) => {
  const { t } = useTranslation('areaEstimation');
  const [inspecting, setInspecting] = useState(false);
  const [crsOpen, setCrsOpen] = useState(false);
  const [counting, setCounting] = useState(false);
  const [mapUrl, setMapUrl] = useState('');
  const [mapSource, setMapSource] = useState<'file' | 'url'>('file');

  const loadRaster = async (name: string) => {
    setInspecting(true);
    try {
      const result = await inspectRaster(name);
      const band = result.raster.bands[0]?.index ?? 1;
      update({
        raster: result.raster,
        equalAreaCrs: result.equalAreaCrs,
        bandIndex: band,
        values: result.legendByBand[band] ?? [],
        noDataValues: result.noDataValuesByBand[band] ?? [],
        census: null,
        classes: [],
        targetClassId: null,
      });
    } catch (err) {
      handleError(err, t('data.readFailed'));
    } finally {
      setInspecting(false);
    }
  };

  const selectBand = async (bandIndex: number) => {
    if (!plan.raster) return;
    setInspecting(true);
    try {
      const result = await inspectRaster(plan.raster.name);
      update({
        bandIndex,
        values: result.legendByBand[bandIndex] ?? [],
        noDataValues: result.noDataValuesByBand[bandIndex] ?? [],
        census: null,
        classes: [],
        targetClassId: null,
      });
    } finally {
      setInspecting(false);
    }
  };

  const addAreas = async (name: string) => {
    try {
      const parsed = await parseStudyAreas(name);
      const existing = new Set(plan.areas.map((a) => a.id));
      const added = parsed
        .filter((a) => !existing.has(a.id))
        .map((a, i) => ({ ...a, id: `${a.id}-${plan.areas.length + i}` }));
      update({ areas: [...plan.areas, ...added], census: null });
    } catch (err) {
      handleError(err, t('data.areasFailed'));
    }
  };

  // Counting runs itself whenever the map, the band or the areas change. The
  // key is what the count depends on, so a rename or a class edit does not
  // trigger a pointless recount.
  const censusKey =
    plan.raster && plan.values.length > 0
      ? [
          plan.raster.name,
          plan.bandIndex,
          reportingAreas(plan)
            .map((a) => a.id)
            .join(','),
          plan.values.length,
        ].join('|')
      : null;
  const countedKey = useRef<string | null>(null);

  useEffect(() => {
    const raster = plan.raster;
    if (!raster || censusKey === null || countedKey.current === censusKey) return;
    countedKey.current = censusKey;
    let cancelled = false;
    setCounting(true);
    censusPixels(raster, plan.bandIndex, reportingAreas(plan), plan.values)
      .then((census) => {
        if (!cancelled) update({ census });
      })
      .catch((err) => {
        countedKey.current = null;
        handleError(err, t('data.countFailed'));
      })
      .finally(() => {
        if (!cancelled) setCounting(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [censusKey]);

  const setValueLabel = (value: number, label: string) =>
    update({ values: plan.values.map((v) => (v.value === value ? { ...v, label } : v)) });

  const renameArea = (id: string, name: string) =>
    update({ areas: plan.areas.map((a) => (a.id === id ? { ...a, name } : a)) });

  const removeArea = (id: string) =>
    update({ areas: plan.areas.filter((a) => a.id !== id), census: null });

  const missingNames = plan.values.filter((v) => !v.label.trim()).length;
  // Null for a map whose extent is unknown, which is a plan stored before the
  // extent was recorded: the offer disappears, the field still works.
  const proposedCrs = plan.raster ? proposedEqualAreaCrs(plan.raster) : null;

  return (
    <div className="space-y-8">
      <StepHeading
        title={t('data.title')}
        technical={
          <>
            <p>{t('data.technical1')}</p>
            <p className="mt-1.5">
              <Trans t={t} i18nKey="data.technical2" components={RICH_TEXT} />
            </p>
          </>
        }
        source={t('data.source')}
      >
        <Trans t={t} i18nKey="data.intro" components={RICH_TEXT} />
      </StepHeading>

      <section className="space-y-3">
        <SubHeading title={t('data.mapTitle')}>{t('data.mapIntro')}</SubHeading>

        {!plan.raster ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <ChoiceCard
                selected={mapSource === 'file'}
                onSelect={() => setMapSource('file')}
                title={t('data.uploadFile')}
                testId="uae-map-source-file"
              >
                {t('data.uploadFileHint')}
              </ChoiceCard>
              <ChoiceCard
                selected={mapSource === 'url'}
                onSelect={() => setMapSource('url')}
                title={t('data.linkMap')}
                testId="uae-map-source-url"
              >
                {t('data.linkMapHint')}
              </ChoiceCard>
            </div>

            {mapSource === 'file' ? (
              <FileInput
                accept=".tif,.tiff"
                disabled={inspecting}
                data-testid="uae-map-file"
                busyText={inspecting ? t('data.readingMap') : undefined}
                onSelect={(file) => void loadRaster(file.name)}
              />
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  size="sm"
                  value={mapUrl}
                  onChange={(e) => setMapUrl(e.target.value)}
                  placeholder="https://example.com/cropmap_2025.tif"
                  className="font-mono text-[11px]"
                  data-testid="uae-map-url"
                />
                <Button
                  size="sm"
                  disabled={!mapUrl.trim() || inspecting}
                  onClick={() => void loadRaster(mapUrl.trim().split('/').pop() ?? mapUrl)}
                  leading={inspecting ? <Spinner size="xs" variant="white" /> : undefined}
                >
                  {t('data.readMap')}
                </Button>
              </div>
            )}

            <ul className="mt-1.5 space-y-0.5 text-[11px] text-neutral-500 leading-snug list-disc list-inside">
              <li>
                <Trans
                  t={t}
                  i18nKey="data.requirementInteger"
                  components={{ strong: <strong className="font-medium text-neutral-600" /> }}
                />
              </li>
              <li>{t('data.requirementCoverage')}</li>
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
              <li className="py-2.5 flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-neutral-900 truncate">
                    {plan.raster.name}
                  </span>
                  <span className="block text-xs text-neutral-500">
                    {t('data.rasterDetails', {
                      crs: plan.raster.crs,
                      resolution: plan.raster.resolutionMeters,
                      hectares: (plan.raster.areaPerPixel / 10_000).toFixed(2),
                    })}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => update({ raster: null, values: [], census: null, classes: [] })}
                >
                  {t('data.replace')}
                </Button>
              </li>
            </ul>

            {plan.raster.bands.length > 1 && (
              <div className="flex flex-wrap items-start gap-6">
                <Field label={t('data.band')} hint={t('data.bandHint')} className="w-56">
                  <Select
                    size="sm"
                    value={plan.bandIndex}
                    disabled={inspecting}
                    data-testid="uae-band"
                    onChange={(e) => void selectBand(Number(e.target.value))}
                  >
                    {plan.raster.bands.map((b) => (
                      <option key={b.index} value={b.index}>
                        {b.description
                          ? t('data.bandOptionDescribed', {
                              index: b.index,
                              description: b.description,
                            })
                          : t('data.bandOption', { index: b.index })}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}

            <div className="space-y-3">
              <p className="text-xs leading-snug text-neutral-500">
                {plan.equalAreaCrs === proposedCrs ? (
                  t('data.crsProposed')
                ) : (
                  <Trans
                    t={t}
                    i18nKey="data.crsChosen"
                    values={{ crs: plan.equalAreaCrs }}
                    components={{
                      code: <code className="font-mono text-[11px] text-neutral-700" />,
                    }}
                  />
                )}{' '}
                <button
                  type="button"
                  onClick={() => setCrsOpen(!crsOpen)}
                  className={expandLinkCls}
                  data-testid="uae-crs-advanced"
                >
                  {crsOpen ? t('showLessDot') : t('data.changeCrs')}
                </button>
              </p>

              {crsOpen && (
                <>
                  <Field label={t('data.crsLabel')} hint={t('data.crsHint')}>
                    <Input
                      size="sm"
                      value={plan.equalAreaCrs}
                      onChange={(e) => update({ equalAreaCrs: e.target.value })}
                      className="font-mono text-[11px]"
                      spellCheck={false}
                      list="uae-equal-area-crs-options"
                      data-testid="uae-equal-area-crs"
                      aria-label={t('data.crsAria')}
                    />
                    <datalist id="uae-equal-area-crs-options">
                      {proposedCrs && <option value={proposedCrs} />}
                      {EQUAL_AREA_PROJECTIONS.map((crs) => (
                        <option key={crs.code} value={crs.code}>
                          {crs.name}
                        </option>
                      ))}
                    </datalist>
                  </Field>

                  {proposedCrs && plan.equalAreaCrs !== proposedCrs && (
                    <p className="text-xs leading-snug text-neutral-500">
                      <button
                        type="button"
                        onClick={() => update({ equalAreaCrs: proposedCrs })}
                        className="cursor-pointer text-brand-700 underline decoration-brand-300 underline-offset-4 hover:decoration-brand-600"
                        data-testid="uae-use-proposed-crs"
                      >
                        {t('data.useProposedCrs')}
                      </button>
                    </p>
                  )}
                </>
              )}

              {/* Stays out of the collapsed section: a projection that does not
                  preserve area is wrong, not merely unusual. */}
              {looksNotEqualArea(plan.equalAreaCrs) && (
                <Note tone="warning">{t('data.notEqualArea')}</Note>
              )}
            </div>
          </div>
        )}

        {plan.raster && (
          <div className="space-y-3 pt-2">
            <SubHeading title={t('data.namesTitle')}>{t('data.namesIntro')}</SubHeading>

            {plan.values.length === 0 ? (
              <Note tone="warning">{t('data.noLegend')}</Note>
            ) : missingNames > 0 ? (
              <Note tone="warning">{t('data.missingNames', { count: missingNames })}</Note>
            ) : null}

            {plan.values.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                    <th className="py-2 font-medium w-20">{t('table.value')}</th>
                    <th className="py-2 font-medium">{t('table.name')}</th>
                    <th className="py-2 font-medium w-32 text-right">{t('table.pixels')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.values.map((value) => (
                    <ValueRow
                      key={value.value}
                      value={value}
                      pixels={plan.census ? pixelsFor(plan, [value.value]) : null}
                      onLabel={(label) => setValueLabel(value.value, label)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {plan.raster && (
        <section className="space-y-3">
          <SubHeading title={t('data.areasTitle')}>{t('data.areasIntro')}</SubHeading>

          <FileInput
            accept=".geojson,.json,.zip"
            action={t('data.addAreas')}
            placeholder={t('data.areasPlaceholder')}
            data-testid="uae-areas-file"
            onSelect={(file) => void addAreas(file.name)}
          />

          {plan.areas.length > 0 && (
            <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
              {plan.areas.map((area) => (
                <AreaRow
                  key={area.id}
                  area={area}
                  onRename={(name) => renameArea(area.id, name)}
                  onRemove={() => removeArea(area.id)}
                />
              ))}
            </ul>
          )}

          <p className="flex items-center gap-2 text-xs text-neutral-500">
            {counting ? (
              <>
                <Spinner size="xs" />
                {t('data.counting')}
              </>
            ) : plan.census ? (
              t(plan.areas.length === 0 ? 'data.pixelsCountedWholeMap' : 'data.pixelsCounted', {
                pixels: formatPixels(studyAreaPixels(plan)),
              })
            ) : null}
          </p>

          {plan.areas.length > 1 && (
            <div className="space-y-2 pt-1">
              <SubHeading title={t('data.domainTitle')} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ChoiceCard
                  selected={plan.domainMode === 'combined'}
                  onSelect={() => update({ domainMode: 'combined' })}
                  title={t('data.combined')}
                  testId="uae-domain-combined"
                >
                  {t('data.combinedHint')}
                </ChoiceCard>
                <ChoiceCard
                  selected={plan.domainMode === 'per_area'}
                  onSelect={() => update({ domainMode: 'per_area' })}
                  title={t('data.perArea')}
                  testId="uae-domain-per-area"
                >
                  {t('data.perAreaHint')}
                </ChoiceCard>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

const AreaRow = ({
  area,
  onRename,
  onRemove,
}: {
  area: StudyArea;
  onRename: (name: string) => void;
  onRemove: () => void;
}) => {
  const { t } = useTranslation('areaEstimation');
  return (
    <li className="py-2.5 flex items-center gap-3">
      <Input
        size="sm"
        value={area.name}
        onChange={(e) => onRename(e.target.value)}
        className="max-w-sm"
        aria-label={t('data.areaName')}
      />
      <span className="text-xs text-neutral-500">
        {t('data.features', { count: area.featureCount })}
      </span>
      <span className="flex-1" />
      <IconButton
        tone="danger"
        onClick={onRemove}
        aria-label={t('data.removeArea', { name: area.name })}
      >
        <IconTrash className="w-4 h-4" />
      </IconButton>
    </li>
  );
};

const ValueRow = ({
  value,
  pixels,
  onLabel,
}: {
  value: MapValue;
  pixels: number | null;
  onLabel: (label: string) => void;
}) => {
  const { t } = useTranslation('areaEstimation');
  return (
    <tr className="border-b border-neutral-100">
      <td className="py-2 font-mono text-xs text-neutral-600">{value.value}</td>
      <td className="py-2 pr-3">
        <Input
          size="sm"
          className="max-w-md"
          value={value.label}
          placeholder={t('data.namePlaceholder')}
          onChange={(e) => onLabel(e.target.value)}
          invalid={!value.label.trim()}
          aria-label={t('data.nameAria', { value: value.value })}
        />
      </td>
      <td className="py-2 text-right text-xs text-neutral-600 tabular-nums">
        {pixels === null ? '-' : formatPixels(pixels)}
      </td>
    </tr>
  );
};
