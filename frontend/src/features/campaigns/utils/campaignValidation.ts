import type { CampaignCreate } from '~/api/client';
import type { ImageryStepState } from '~/features/campaigns/components/creation/steps/imagery/types';

export type FieldErrors = Record<string, string>;

export interface StepValidationResult {
  errors: FieldErrors;
  isValid: boolean;
}

export function validateCampaignStep(form: CampaignCreate): StepValidationResult {
  const errors: FieldErrors = {};

  if (!form.name.trim()) {
    errors.name = 'Campaign name is required.';
  }

  if (!form.mode) {
    errors.mode = 'Please select a campaign mode.';
  }

  return { errors, isValid: Object.keys(errors).length === 0 };
}

export function validateSettingsStep(form: CampaignCreate): StepValidationResult {
  const errors: FieldErrors = {};
  const s = form.settings;

  if (s == null) {
    errors.settings = 'Settings are required.';
    return { errors, isValid: false };
  }

  const { bbox_west, bbox_south, bbox_east, bbox_north } = s;

  if (bbox_west == null || bbox_south == null || bbox_east == null || bbox_north == null) {
    errors.bbox = 'All four bounding box coordinates are required.';
  } else if (bbox_west >= bbox_east) {
    errors.bbox = 'West longitude must be less than East longitude.';
  } else if (bbox_south >= bbox_north) {
    errors.bbox = 'South latitude must be less than North latitude.';
  }

  if (!s.labels || s.labels.length === 0) {
    errors.labels = 'At least one label is required.';
  } else {
    const emptyLabels = s.labels.filter((l) => !l.name.trim());
    if (emptyLabels.length > 0) {
      errors.labels = `${emptyLabels.length} label${emptyLabels.length > 1 ? 's have' : ' has'} an empty name.`;
    }
  }

  return { errors, isValid: Object.keys(errors).length === 0 };
}

export function validateImageryStep(imageryState: ImageryStepState): StepValidationResult {
  const errors: FieldErrors = {};

  // Must have at least one source
  if (imageryState.sources.length === 0) {
    errors.sources = 'Add at least one imagery source.';
    return { errors, isValid: false };
  }

  // Validate each source
  imageryState.sources.forEach((source, si) => {
    const prefix = `source_${si}`;

    if (!source.name.trim()) {
      errors[`${prefix}_name`] = `Source ${si + 1}: Name is required.`;
    }

    if (source.visualizations.length === 0) {
      errors[`${prefix}_viz`] = `Source "${source.name || si + 1}": At least one visualization is required.`;
    } else {
      const emptyViz = source.visualizations.filter((v) => !v.name.trim());
      if (emptyViz.length > 0) {
        errors[`${prefix}_viz_names`] = `Source "${source.name || si + 1}": ${emptyViz.length} visualization(s) have no name.`;
      }
    }

    if (source.collections.length === 0) {
      errors[`${prefix}_collections`] = `Source "${source.name || si + 1}": At least one collection is required.`;
    } else {
      source.collections.forEach((col, ci) => {
        const cp = `${prefix}_col_${ci}`;

        if (col.slices.length === 0) {
          errors[`${cp}_slices`] = `Source "${source.name || si + 1}", Collection "${col.name || ci + 1}": Has no time slices.`;
        }

        if (col.data.type === 'stac') {
          if (!col.data.registrationUrl.trim()) {
            errors[`${cp}_regurl`] = `Source "${source.name || si + 1}", Collection "${col.name || ci + 1}": Registration URL is required.`;
          }
          if (!col.data.searchBody.trim()) {
            errors[`${cp}_search`] = `Source "${source.name || si + 1}", Collection "${col.name || ci + 1}": Search body is required.`;
          }
        }

        const emptyVizUrls = col.data.vizUrls.filter((v) => !v.url.trim());
        if (emptyVizUrls.length > 0) {
          errors[`${cp}_vizurls`] = `Source "${source.name || si + 1}", Collection "${col.name || ci + 1}": ${emptyVizUrls.length} visualization URL(s) are empty.`;
        }
      });
    }
  });

  // Validate views
  if (imageryState.views.length === 0) {
    errors.views = 'At least one view is required.';
  } else {
    const hasAssignedView = imageryState.views.some((v) => v.collectionRefs.length > 0);
    if (!hasAssignedView) {
      errors.views_empty = 'At least one view must have collections assigned. Drag a source into the canvas preview.';
    }
  }

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
      errors[`${prefix}_name`] = `Timeseries ${i + 1}: Name is required.`;
    }
    if (!ts.start_ym) {
      errors[`${prefix}_start`] = `Timeseries ${i + 1}: Start date is required.`;
    }
    if (!ts.end_ym) {
      errors[`${prefix}_end`] = `Timeseries ${i + 1}: End date is required.`;
    }
    if (ts.start_ym && ts.end_ym && ts.start_ym > ts.end_ym) {
      errors[`${prefix}_dates`] = `Timeseries ${i + 1}: Start date must be before end date.`;
    }
    if (!ts.data_source) {
      errors[`${prefix}_source`] = `Timeseries ${i + 1}: Data source is required.`;
    }
    if (!ts.provider) {
      errors[`${prefix}_provider`] = `Timeseries ${i + 1}: Provider is required.`;
    }
    if (!ts.ts_type) {
      errors[`${prefix}_type`] = `Timeseries ${i + 1}: Type is required.`;
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

export function validateFullForm(form: CampaignCreate, imageryState: ImageryStepState): FullValidationResult {
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
