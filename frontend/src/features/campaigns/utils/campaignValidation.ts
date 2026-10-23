import type { CampaignCreate } from '~/api/client';
import i18n from '~/shared/i18n';
import { isPlanetSceneConfig, type ImageryStepState } from '~/features/layers/imagery/types';
import { validateFormFields } from './formFields';

const t = i18n.getFixedT(null, 'campaigns');

export type FieldErrors = Record<string, string>;

export interface StepValidationResult {
  errors: FieldErrors;
  isValid: boolean;
}

function validateCampaignStep(form: CampaignCreate): StepValidationResult {
  const errors: FieldErrors = {};

  if (!form.name.trim()) {
    errors.name = t('validation.nameRequired');
  }

  return { errors, isValid: Object.keys(errors).length === 0 };
}

export function validateSettingsStep(form: CampaignCreate): StepValidationResult {
  const errors: FieldErrors = {};
  const s = form.settings;

  if (s == null) {
    errors.settings = t('validation.settingsRequired');
    return { errors, isValid: false };
  }

  const { bbox_west, bbox_south, bbox_east, bbox_north } = s;

  if (bbox_west == null || bbox_south == null || bbox_east == null || bbox_north == null) {
    errors.bbox = t('validation.bboxRequired');
  } else if (
    bbox_west < -180 ||
    bbox_west > 180 ||
    bbox_east < -180 ||
    bbox_east > 180 ||
    bbox_south < -90 ||
    bbox_south > 90 ||
    bbox_north < -90 ||
    bbox_north > 90
  ) {
    // A map panned past the antimeridian reports longitudes outside the range
    // the campaign area is stored in, and west < east alone does not catch it.
    errors.bbox = t('validation.bboxRange');
  } else if (bbox_west >= bbox_east) {
    errors.bbox = t('validation.bboxWestEast');
  } else if (bbox_south >= bbox_north) {
    errors.bbox = t('validation.bboxSouthNorth');
  }

  if (!s.labels || s.labels.length === 0) {
    errors.labels = t('validation.labelsRequired');
  } else {
    const emptyLabels = s.labels.filter((l) => !l.name.trim());
    if (emptyLabels.length > 0) {
      errors.labels = t('validation.emptyLabels', { count: emptyLabels.length });
    }
  }

  validateFormFields(s.form_fields ?? []).forEach((msg, i) => {
    errors[`form_field_${i}`] = msg;
  });

  return { errors, isValid: Object.keys(errors).length === 0 };
}

export function validateImageryStep(imageryState: ImageryStepState): StepValidationResult {
  const errors: FieldErrors = {};

  // Must have at least one source
  if (imageryState.sources.length === 0) {
    errors.sources = t('validation.sourcesRequired');
    return { errors, isValid: false };
  }

  // Validate each source
  imageryState.sources.forEach((source, si) => {
    const prefix = `source_${si}`;
    const sourceLabel = source.name || si + 1;

    if (!source.name.trim()) {
      errors[`${prefix}_name`] = t('validation.sourceNameRequired', {
        index: si + 1,
      });
    }

    if (source.visualizations.length === 0) {
      errors[`${prefix}_viz`] = t('validation.vizRequired', { source: sourceLabel });
    } else {
      const emptyViz = source.visualizations.filter((v) => !v.name.trim());
      if (emptyViz.length > 0) {
        errors[`${prefix}_viz_names`] = t('validation.vizUnnamed', {
          source: sourceLabel,
          count: emptyViz.length,
        });
      }
    }

    // Planet scene slices have no URLs until annotators search the archive, which
    // mints their layers per viewport.
    const sceneSeries = new Set(
      source.generationSeries
        .filter((series) => isPlanetSceneConfig(series.config))
        .map((series) => series.id)
    );

    if (source.collections.length === 0) {
      errors[`${prefix}_collections`] = t('validation.collectionsRequired', {
        source: sourceLabel,
      });
    } else {
      source.collections.forEach((col, ci) => {
        const cp = `${prefix}_col_${ci}`;

        if (col.slices.length === 0) {
          errors[`${cp}_slices`] = t('validation.noSlices', {
            source: sourceLabel,
            collection: col.name || ci + 1,
          });
        }

        if (col.data.type === 'manual' && !sceneSeries.has(col.generationSeriesId ?? '')) {
          const slicesWithMissing = col.slices.filter((sl) => {
            const urls = sl.vizUrls ?? [];
            return source.visualizations.some(
              (v) => !urls.find((u) => u.vizName === v.name)?.url?.trim()
            );
          });
          if (slicesWithMissing.length > 0) {
            errors[`${cp}_vizurls`] = t('validation.missingVizUrls', {
              source: sourceLabel,
              collection: col.name || ci + 1,
              count: slicesWithMissing.length,
            });
          }
        }
        // stac_browser: no viz URL validation needed (URLs generated from params)
      });
    }
  });

  return { errors, isValid: Object.keys(errors).length === 0 };
}

export function validateTimeseriesStep(form: CampaignCreate): StepValidationResult {
  const errors: FieldErrors = {};
  const items = form.timeseries_configs ?? [];

  // Timeseries is optional
  if (items.length === 0) {
    return { errors, isValid: true };
  }

  items.forEach((ts, i) => {
    const prefix = `ts_${i}`;
    if (!ts.name.trim()) {
      errors[`${prefix}_name`] = t('validation.timeseries.name', { index: i + 1 });
    }
    if (!ts.start_ym) {
      errors[`${prefix}_start`] = t('validation.timeseries.start', { index: i + 1 });
    }
    if (!ts.end_ym) {
      errors[`${prefix}_end`] = t('validation.timeseries.end', { index: i + 1 });
    }
    if (ts.start_ym && ts.end_ym && ts.start_ym > ts.end_ym) {
      errors[`${prefix}_dates`] = t('validation.timeseries.dates', { index: i + 1 });
    }
    if (!ts.data_source) {
      errors[`${prefix}_source`] = t('validation.timeseries.source', {
        index: i + 1,
      });
    }
    if (!ts.ts_type) {
      errors[`${prefix}_type`] = t('validation.timeseries.type', { index: i + 1 });
    }
  });

  return { errors, isValid: Object.keys(errors).length === 0 };
}

export interface FullValidationResult {
  campaign: StepValidationResult;
  settings: StepValidationResult;
  imagery: StepValidationResult;
  timeseries: StepValidationResult;
  isValid: boolean;
  stepsWithErrors: number[];
}

export function validateFullForm(
  form: CampaignCreate,
  imageryState: ImageryStepState
): FullValidationResult {
  const campaign = validateCampaignStep(form);
  const settings = validateSettingsStep(form);
  const imagery = validateImageryStep(imageryState);
  const timeseries = validateTimeseriesStep(form);

  const stepsWithErrors: number[] = [];
  if (!campaign.isValid) stepsWithErrors.push(1);
  if (!settings.isValid) stepsWithErrors.push(2);
  if (!imagery.isValid) stepsWithErrors.push(3);
  if (!timeseries.isValid) stepsWithErrors.push(4);

  return {
    campaign,
    settings,
    imagery,
    timeseries,
    isValid: stepsWithErrors.length === 0,
    stepsWithErrors,
  };
}
