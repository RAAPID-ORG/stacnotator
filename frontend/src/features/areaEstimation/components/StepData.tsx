import { useEffect, useRef, useState } from 'react';
import { Button, Field, IconButton, Input, Select } from '~/shared/ui/forms';
import { IconTrash } from '~/shared/ui/Icons';
import { Spinner } from '~/shared/ui/Spinner';
import { FileInput } from '~/shared/ui/FileInput';
import { handleError } from '~/shared/utils/errorHandler';
import { censusPixels, inspectRaster, parseStudyAreas } from '../api';
import type { AreaEstimationPlan, MapValue, StudyArea } from '../core/plan';
import { pixelsFor, studyAreaPixels } from '../core/plan';
import { EQUAL_AREA_PROJECTIONS } from '../core/guidance';
import { ChoiceCard, Note, StepHeading, SubHeading } from './Explain';
import { formatPixels } from './format';

interface Props {
  plan: AreaEstimationPlan;
  update: (patch: Partial<AreaEstimationPlan>) => void;
}

export const StepData = ({ plan, update }: Props) => {
  const [inspecting, setInspecting] = useState(false);
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
      handleError(err, 'Could not read the map');
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
      handleError(err, 'Could not read the area file');
    }
  };

  // Counting runs itself whenever the map, the band or the areas change. The
  // key is what the count depends on, so a rename or a class edit does not
  // trigger a pointless recount.
  const censusKey =
    plan.raster && plan.areas.length > 0 && plan.values.length > 0
      ? [
          plan.raster.name,
          plan.bandIndex,
          plan.areas.map((a) => a.id).join(','),
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
    censusPixels(raster, plan.bandIndex, plan.areas, plan.values)
      .then((census) => {
        if (!cancelled) update({ census });
      })
      .catch((err) => {
        countedKey.current = null;
        handleError(err, 'Could not count the map pixels');
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

  return (
    <div className="space-y-8">
      <StepHeading
        title="Map & Areas of Interest"
        technical={
          <>
            <p>
              Counting the pixels of a class and calling that its area is a biased estimator: a
              classifier that confuses two classes moves area between them, and no amount of extra
              pixels corrects it. The map is used only as a stratification variable, so its errors
              cost precision rather than accuracy.
            </p>
            <p className="mt-1.5">
              Pixel counts enter the design as stratum weights W<sub>i</sub>, and appear in the
              results only as a contrast to the sample-based estimate.
            </p>
          </>
        }
        source="Olofsson et al. (2014), Good practices for estimating area and assessing accuracy of land change, Sections 2.1.1 and 4.4."
      >
        The map you upload is used to divide the country into groups, so that the sample spends most
        of its points where they matter. The area figures you publish will come from what annotators
        see at the sample points, <strong>not</strong> from the map. That is what makes the result
        unbiased even when the initial map is imperfect.
      </StepHeading>

      <section className="space-y-3">
        <SubHeading title="1. Stratification map">
          A classified raster: one integer per pixel specifying the predicted class.
        </SubHeading>

        {!plan.raster ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <ChoiceCard
                selected={mapSource === 'file'}
                onSelect={() => setMapSource('file')}
                title="Upload a file"
                testId="uae-map-source-file"
              >
                A GeoTIFF from your own machine.
              </ChoiceCard>
              <ChoiceCard
                selected={mapSource === 'url'}
                onSelect={() => setMapSource('url')}
                title="Link a hosted map"
                testId="uae-map-source-url"
              >
                A cloud-optimized GeoTIFF already on the web.
              </ChoiceCard>
            </div>

            {mapSource === 'file' ? (
              <FileInput
                accept=".tif,.tiff"
                disabled={inspecting}
                data-testid="uae-map-file"
                busyText={inspecting ? 'Reading the map…' : undefined}
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
                  Read map
                </Button>
              </div>
            )}

            <ul className="mt-1.5 space-y-0.5 text-[11px] text-neutral-500 leading-snug list-disc list-inside">
              <li>
                One integer value per class.{' '}
                <strong className="font-medium text-neutral-600">Continuous</strong> probability
                rasters cannot be used as strata.
              </li>
              <li>Covering all of the areas you want to report on.</li>
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
                    {plan.raster.crs} · {plan.raster.resolutionMeters} m pixels ·{' '}
                    {(plan.raster.areaPerPixel / 10_000).toFixed(2)} ha per pixel
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => update({ raster: null, values: [], census: null, classes: [] })}
                >
                  Replace
                </Button>
              </li>
            </ul>

            <div className="flex flex-wrap items-start gap-6">
              {plan.raster.bands.length > 1 && (
                <Field
                  label="Band"
                  hint="Which band of the file holds the classification."
                  className="w-56"
                >
                  <Select
                    size="sm"
                    value={plan.bandIndex}
                    disabled={inspecting}
                    data-testid="uae-band"
                    onChange={(e) => void selectBand(Number(e.target.value))}
                  >
                    {plan.raster.bands.map((b) => (
                      <option key={b.index} value={b.index}>
                        Band {b.index}
                        {b.description ? ` - ${b.description}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <Field
                label="Areas computed in"
                hint={
                  plan.raster.isEqualArea
                    ? 'Taken from the map, which is already an equal-area projection.'
                    : 'The map is in latitude/longitude, where pixel size varies with latitude. Counts are reprojected into this equal-area projection before they become stratum weights.'
                }
                className="w-80"
              >
                <Select
                  size="sm"
                  value={plan.equalAreaCrs}
                  data-testid="uae-equal-area-crs"
                  onChange={(e) => update({ equalAreaCrs: e.target.value })}
                >
                  {EQUAL_AREA_PROJECTIONS.map((crs) => (
                    <option key={crs.code} value={crs.code}>
                      {crs.code} - {crs.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        )}

        {plan.raster && (
          <div className="space-y-3 pt-2">
            <SubHeading title="Class names">
              Every distinct value in the band, and what to call it. Which of them are nodata, and
              what to do with those, is settled on the next step.
            </SubHeading>

            {plan.values.length === 0 ? (
              <Note tone="warning">
                This band carries no class list, so the distinct values have to be read from the
                pixels and named by hand.
              </Note>
            ) : missingNames > 0 ? (
              <Note tone="warning">
                {missingNames} value{missingNames === 1 ? '' : 's'} still need a name. The file did
                not carry class names, so they have to be typed in.
              </Note>
            ) : null}

            {plan.values.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                    <th className="py-2 font-medium w-20">Value</th>
                    <th className="py-2 font-medium">Name</th>
                    <th className="py-2 font-medium w-32 text-right">Pixels</th>
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
          <SubHeading title="2. Areas of interest">
            One or more vector files. Every feature becomes an area you can report on; a feature
            made of several separate pieces is still one area.
          </SubHeading>

          <FileInput
            accept=".geojson,.json,.zip"
            action="Add areas"
            placeholder="GeoJSON, or a zipped shapefile"
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

          {plan.areas.length > 0 && (
            <p className="flex items-center gap-2 text-xs text-neutral-500">
              {counting ? (
                <>
                  <Spinner size="xs" />
                  Counting map pixels in these areas…
                </>
              ) : plan.census ? (
                <>{formatPixels(studyAreaPixels(plan))} pixels in the study area</>
              ) : null}
            </p>
          )}

          {plan.areas.length > 1 && (
            <div className="space-y-2 pt-1">
              <SubHeading title="How should these areas be reported?" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ChoiceCard
                  selected={plan.domainMode === 'combined'}
                  onSelect={() => update({ domainMode: 'combined' })}
                  title="One number for all areas together"
                  testId="uae-domain-combined"
                >
                  Cheapest. You get a national figure with the precision you ask for. Per-area
                  numbers can still be produced afterwards, but they will be much less precise.
                </ChoiceCard>
                <ChoiceCard
                  selected={plan.domainMode === 'per_area'}
                  onSelect={() => update({ domainMode: 'per_area' })}
                  title="A separate number for each area"
                  testId="uae-domain-per-area"
                >
                  Each area gets its own sample and reaches the precision you ask for on its own.
                  Expect the total number of points to multiply by the number of areas.
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
}) => (
  <li className="py-2.5 flex items-center gap-3">
    <Input
      size="sm"
      value={area.name}
      onChange={(e) => onRename(e.target.value)}
      className="max-w-sm"
      aria-label="Area name"
    />
    <span className="text-xs text-neutral-500">
      {area.featureCount} feature{area.featureCount === 1 ? '' : 's'}
    </span>
    <span className="flex-1" />
    <IconButton tone="danger" onClick={onRemove} aria-label={`Remove ${area.name}`}>
      <IconTrash className="w-4 h-4" />
    </IconButton>
  </li>
);

const ValueRow = ({
  value,
  pixels,
  onLabel,
}: {
  value: MapValue;
  pixels: number | null;
  onLabel: (label: string) => void;
}) => (
  <tr className="border-b border-neutral-100">
    <td className="py-2 font-mono text-xs text-neutral-600">{value.value}</td>
    <td className="py-2 pr-3">
      <Input
        size="sm"
        className="max-w-md"
        value={value.label}
        placeholder="Name this class"
        onChange={(e) => onLabel(e.target.value)}
        invalid={!value.label.trim()}
        aria-label={`Name for value ${value.value}`}
      />
    </td>
    <td className="py-2 text-right text-xs text-neutral-600 tabular-nums">
      {pixels === null ? '-' : formatPixels(pixels)}
    </td>
  </tr>
);
