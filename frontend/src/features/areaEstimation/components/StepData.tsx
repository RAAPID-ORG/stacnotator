import { useState } from 'react';
import { Button, Field, IconButton, Input, Select } from '~/shared/ui/forms';
import { Badge } from '~/shared/ui/Badge';
import { IconTrash } from '~/shared/ui/Icons';
import { Spinner } from '~/shared/ui/Spinner';
import { handleError } from '~/shared/utils/errorHandler';
import { censusPixels, inspectRaster, parseStudyAreas } from '../api';
import type { AreaEstimationPlan, MapValue, StudyArea } from '../core/plan';
import { studyAreaPixels } from '../core/plan';
import { ChoiceCard, Explain, Note, StepHeading, SubHeading } from './Explain';
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

  const runCensus = async () => {
    if (!plan.raster) return;
    setCounting(true);
    try {
      const census = await censusPixels(plan.raster, plan.bandIndex, plan.areas, plan.values);
      update({ census });
    } catch (err) {
      handleError(err, 'Could not count the map pixels');
    } finally {
      setCounting(false);
    }
  };

  const setValueLabel = (value: number, label: string) =>
    update({ values: plan.values.map((v) => (v.value === value ? { ...v, label } : v)) });

  const toggleNoData = (value: number) =>
    update({
      noDataValues: plan.noDataValues.includes(value)
        ? plan.noDataValues.filter((v) => v !== value)
        : [...plan.noDataValues, value],
      classes: plan.classes.map((c) => ({ ...c, values: c.values.filter((v) => v !== value) })),
    });

  const renameArea = (id: string, name: string) =>
    update({ areas: plan.areas.map((a) => (a.id === id ? { ...a, name } : a)) });

  const removeArea = (id: string) =>
    update({ areas: plan.areas.filter((a) => a.id !== id), census: null });

  const missingNames = plan.values.filter((v) => !v.label.trim()).length;

  return (
    <div className="space-y-8">
      <StepHeading title="The map and the areas you report on">
        Two inputs start everything. The map is not the answer; it is what makes the sample
        efficient. The areas say where the answer applies.
      </StepHeading>

      <Explain
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
        unbiased even when the map is imperfect.
      </Explain>

      <section className="space-y-3">
        <SubHeading title="1. Stratification map">
          A classified raster: one integer per pixel saying which class the map thinks it is.
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
              <label
                className={`flex items-center gap-3 h-9 px-1 pr-3 border border-neutral-300 rounded-md bg-white transition-colors ${
                  inspecting
                    ? 'opacity-50 cursor-not-allowed'
                    : 'cursor-pointer hover:border-neutral-400'
                }`}
              >
                <input
                  type="file"
                  accept=".tif,.tiff"
                  disabled={inspecting}
                  className="sr-only"
                  data-testid="uae-map-file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void loadRaster(file.name);
                  }}
                />
                <span className="inline-flex items-center h-7 px-3 rounded text-xs font-medium bg-neutral-100 text-neutral-700 shrink-0">
                  Choose file
                </span>
                <span className="text-xs text-neutral-500 truncate">
                  {inspecting ? 'Reading the map…' : 'No file selected'}
                </span>
              </label>
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
              <li>
                An <strong className="font-medium text-neutral-600">equal-area</strong> projection,
                so that every pixel stands for the same amount of ground.
              </li>
              <li>Covering all of the areas you want to report on.</li>
            </ul>
          </div>
        ) : (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900 truncate">{plan.raster.name}</p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {plan.raster.crs} · {plan.raster.resolutionMeters} m pixels ·{' '}
                  {(plan.raster.areaPerPixel / 10_000).toFixed(2)} ha per pixel
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => update({ raster: null, values: [], census: null, classes: [] })}
              >
                Replace
              </Button>
            </div>

            {!plan.raster.isEqualArea && (
              <Note tone="warning">
                This map is in a latitude/longitude projection, where a pixel near the north of the
                country covers less ground than one in the south. Pixel counts are then not
                proportional to area and the stratum weights would be wrong. Reproject the map to an
                equal-area projection before continuing.
              </Note>
            )}

            {plan.raster.bands.length > 1 && (
              <Field
                label="Band"
                hint="Which band of the file holds the classification."
                className="max-w-xs"
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
                      {b.description ? ` — ${b.description}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
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

          <label className="flex items-center gap-3 h-9 px-1 pr-3 border border-neutral-300 rounded-md bg-white cursor-pointer hover:border-neutral-400 transition-colors">
            <input
              type="file"
              accept=".geojson,.json,.zip"
              className="sr-only"
              data-testid="uae-areas-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void addAreas(file.name);
                e.target.value = '';
              }}
            />
            <span className="inline-flex items-center h-7 px-3 rounded text-xs font-medium bg-neutral-100 text-neutral-700 shrink-0">
              Add areas
            </span>
            <span className="text-xs text-neutral-500 truncate">
              GeoJSON, or a zipped shapefile
            </span>
          </label>

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

      {plan.raster && plan.areas.length > 0 && (
        <section className="space-y-3">
          <SubHeading title="3. Map values">
            Every distinct value in the band, how much of the study area it covers, and what to call
            it.
          </SubHeading>

          {plan.values.length === 0 ? (
            <Note tone="warning">
              This band carries no class list. Read the pixels to find the distinct values, then
              name each one.
            </Note>
          ) : missingNames > 0 ? (
            <Note tone="warning">
              {missingNames} value{missingNames === 1 ? '' : 's'} still need a name. The file did
              not carry class names, so they have to be typed in.
            </Note>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => void runCensus()}
              disabled={counting}
              leading={counting ? <Spinner size="xs" variant="white" /> : undefined}
              data-testid="uae-count-pixels"
            >
              {plan.census ? 'Recount pixels' : 'Count pixels in the areas'}
            </Button>
            {plan.census && (
              <span className="text-xs text-neutral-500">
                {formatPixels(studyAreaPixels(plan))} pixels in the study area
              </span>
            )}
          </div>

          {plan.values.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                  <th className="py-2 font-medium w-20">Value</th>
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium w-32 text-right">Pixels</th>
                  <th className="py-2 font-medium w-40 text-right">Unmapped</th>
                </tr>
              </thead>
              <tbody>
                {plan.values.map((value) => (
                  <ValueRow
                    key={value.value}
                    value={value}
                    pixels={pixelsForValue(plan, value.value)}
                    isNoData={plan.noDataValues.includes(value.value)}
                    onLabel={(label) => setValueLabel(value.value, label)}
                    onToggleNoData={() => toggleNoData(value.value)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
};

const pixelsForValue = (plan: AreaEstimationPlan, value: number): number | null => {
  if (!plan.census) return null;
  return plan.areas.reduce(
    (sum, area) => sum + (plan.census?.byArea[area.id]?.[String(value)] ?? 0),
    0
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
  isNoData,
  onLabel,
  onToggleNoData,
}: {
  value: MapValue;
  pixels: number | null;
  isNoData: boolean;
  onLabel: (label: string) => void;
  onToggleNoData: () => void;
}) => (
  <tr className="border-b border-neutral-100">
    <td className="py-2 font-mono text-xs text-neutral-600">{value.value}</td>
    <td className="py-2 pr-3">
      <Input
        size="sm"
        value={value.label}
        placeholder="Name this class"
        onChange={(e) => onLabel(e.target.value)}
        invalid={!value.label.trim()}
        aria-label={`Name for value ${value.value}`}
      />
    </td>
    <td className="py-2 text-right text-xs text-neutral-600 tabular-nums">
      {pixels === null ? '—' : formatPixels(pixels)}
    </td>
    <td className="py-2 text-right">
      <label className="inline-flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
        <input
          type="checkbox"
          checked={isNoData}
          onChange={onToggleNoData}
          className="cursor-pointer"
        />
        {isNoData ? <Badge tone="neutral">Not a class</Badge> : 'Mark as unmapped'}
      </label>
    </td>
  </tr>
);
