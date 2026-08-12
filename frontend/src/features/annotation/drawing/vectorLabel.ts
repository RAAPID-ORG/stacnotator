import {
  batchCreateAnnotations,
  createAnnotationOpenmode,
  type AnnotationCreate,
} from '~/api/client';
import type { FormField, FormValues } from '~/features/annotation/core/apiTypes';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import {
  featureDedupeKey,
  geometryToWkt,
  validateForm,
} from '~/features/annotation/core/annotation';
import type { BoxHit } from '~/features/annotation/engine/map';

export type LabelOutcome =
  | { kind: 'saved'; count: number }
  | { kind: 'blocked'; missing: string[] }
  | { kind: 'error'; message: string }
  | { kind: 'noop' };

export interface LabelFeatureParams {
  campaignId: number;
  geometry: GeoJSON.Geometry;
  labelId: number;
  fields: FormField[];
  formValues: FormValues;
}

export interface LabelBoxParams {
  campaignId: number;
  hits: BoxHit[];
  labelId: number;
  fields: FormField[];
  formValues: FormValues;
}

export function annotationBody(
  geometry: GeoJSON.Geometry,
  labelId: number,
  formValues: FormValues
): AnnotationCreate {
  return {
    label_id: labelId,
    comment: null,
    geometry_wkt: geometryToWkt(geometry),
    confidence: null,
    // An empty answer set is "no answers given", not "all answers cleared".
    form_values: Object.keys(formValues).length ? formValues : null,
  };
}

/**
 * One feature per box hit, minus the copies of a feature that spans several
 * tiles: MVT ids repeat across the tiles a shape crosses, and they are only
 * unique within their own layer.
 */
function dedupeHits(hits: BoxHit[]): GeoJSON.Geometry[] {
  const seen = new Set<string>();
  const geometries: GeoJSON.Geometry[] = [];
  for (const { layerId, feature } of hits) {
    const key = featureDedupeKey(layerId, feature.id, feature.geometry);
    if (seen.has(key)) continue;
    seen.add(key);
    geometries.push(feature.geometry);
  }
  return geometries;
}

export async function labelFeature({
  campaignId,
  geometry,
  labelId,
  fields,
  formValues,
}: LabelFeatureParams): Promise<LabelOutcome> {
  const { ok, missing } = validateForm(fields, formValues);
  if (!ok) return { kind: 'blocked', missing };

  try {
    await createAnnotationOpenmode({
      path: { campaign_id: campaignId },
      body: annotationBody(geometry, labelId, formValues),
    });
    return { kind: 'saved', count: 1 };
  } catch (error) {
    return { kind: 'error', message: extractErrorMessage(error) };
  }
}

export async function labelFeaturesInBox({
  campaignId,
  hits,
  labelId,
  fields,
  formValues,
}: LabelBoxParams): Promise<LabelOutcome> {
  const geometries = dedupeHits(hits);
  if (geometries.length === 0) return { kind: 'noop' };

  const { ok, missing } = validateForm(fields, formValues);
  if (!ok) return { kind: 'blocked', missing };

  try {
    // One request and one transaction for the whole set: labelling hundreds
    // of vector features must not be hundreds of round trips.
    const result = await batchCreateAnnotations({
      path: { campaign_id: campaignId },
      body: {
        annotations: geometries.map((geometry) => annotationBody(geometry, labelId, formValues)),
      },
    });
    return { kind: 'saved', count: result.data?.created_count ?? geometries.length };
  } catch (error) {
    return { kind: 'error', message: extractErrorMessage(error) };
  }
}
