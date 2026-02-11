import type { CampaignCreate } from '~/api/client';

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

  // Bounding box - all four values must be filled and logically valid
  const { bbox_west, bbox_south, bbox_east, bbox_north } = s;

  if (bbox_west == null || bbox_south == null || bbox_east == null || bbox_north == null) {
    errors.bbox = 'All four bounding box coordinates are required.';
  } else if (bbox_west >= bbox_east) {
    errors.bbox = 'West longitude must be less than East longitude.';
  } else if (bbox_south >= bbox_north) {
    errors.bbox = 'South latitude must be less than North latitude.';
  }

  // Labels - at least one non-empty label required
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

export function validateImageryStep(form: CampaignCreate): StepValidationResult {
  const errors: FieldErrors = {};
  const items = form.imagery_configs ?? [];

  if (items.length === 0) {
    errors.imagery = 'At least one imagery source is required.';
    return { errors, isValid: false };
  }

  items.forEach((img, i) => {
    const prefix = `imagery_${i}`;
    if (!img.name.trim()) {
      errors[`${prefix}_name`] = `Imagery ${i + 1}: Name is required.`;
    }
    if (!img.start_ym) {
      errors[`${prefix}_start`] = `Imagery ${i + 1}: Start date is required.`;
    }
    if (!img.end_ym) {
      errors[`${prefix}_end`] = `Imagery ${i + 1}: End date is required.`;
    }
    if (img.start_ym && img.end_ym && img.start_ym > img.end_ym) {
      errors[`${prefix}_dates`] = `Imagery ${i + 1}: Start date must be before end date.`;
    }
    if (!img.visualization_url_templates || img.visualization_url_templates.length === 0) {
      errors[`${prefix}_tiles`] = `Imagery ${i + 1}: At least one tile URL template is required.`;
    } else {
      img.visualization_url_templates.forEach((t, j) => {
        if (!t.visualization_url.trim()) {
          errors[`${prefix}_tile_${j}_url`] = `Imagery ${i + 1}, Tile ${j + 1}: URL is required.`;
        }
      });
    }
  });

  return { errors, isValid: Object.keys(errors).length === 0 };
}

export function validateTimeseriesStep(form: CampaignCreate): StepValidationResult {
  const errors: FieldErrors = {};
  const items = form.timeseries_configs ?? [];

  // Timeseries is optional - no items = valid
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

export function validateFullForm(form: CampaignCreate): FullValidationResult {
  const campaign = validateCampaignStep(form);
  const settings = validateSettingsStep(form);
  const imagery = validateImageryStep(form);
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
