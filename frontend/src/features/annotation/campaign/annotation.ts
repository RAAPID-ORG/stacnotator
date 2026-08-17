import type {
  AnnotationOut,
  AnnotationTaskOut,
  CampaignOutFull,
  CampaignSettingsOut,
  DateRangeValue,
  LabelBase,
  PolicyAudience,
} from '~/api/client';

export type FormField = NonNullable<CampaignSettingsOut['form_fields']>[number];
export type FormValues = NonNullable<AnnotationOut['form_values']>;
export type FormValue = FormValues[string];
export type TaskStatus = NonNullable<AnnotationTaskOut['task_status']>;

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export type GeometryType = 'point' | 'polygon' | 'line';

export interface ExtendedLabel extends LabelBase {
  geometry_type: GeometryType;
  color: string;
}

const LABEL_COLORS = [
  '#10b981',
  '#f59e0b',
  '#3b82f6',
  '#8b5cf6',
  '#ef4444',
  '#ec4899',
  '#06b6d4',
  '#a3883a',
  '#6366f1',
  '#14b8a6',
];

export function extendedLabels(
  campaign: Pick<CampaignOutFull, 'settings'> | null | undefined
): ExtendedLabel[] {
  return (campaign?.settings.labels ?? []).map((label, index) => ({
    ...label,
    geometry_type: (label.geometry_type as GeometryType) || 'polygon',
    color: LABEL_COLORS[index % LABEL_COLORS.length],
  }));
}

/** Labels an annotation may be reassigned to on edit: the drawn geometry
 *  cannot change type, so only labels of the same type qualify. */
export function labelsWithSameGeometry(labels: ExtendedLabel[], labelId: number | null) {
  const current = labels.find((l) => l.id === labelId);
  return current ? labels.filter((l) => l.geometry_type === current.geometry_type) : labels;
}

// ---------------------------------------------------------------------------
// Access policy
// ---------------------------------------------------------------------------

export interface PolicyContext {
  userId: string | null;
  isAdmin: boolean;
  isAuthoritative: boolean;
  isMember: boolean;
  isAssigned?: boolean;
}

export function isAudienceMember(
  audience: PolicyAudience | undefined,
  ctx: PolicyContext
): boolean {
  const kinds = audience?.kinds ?? [];
  if (kinds.includes('anyone')) return true;
  if (kinds.includes('members') && ctx.isMember) return true;
  if (kinds.includes('admins') && ctx.isAdmin) return true;
  if (kinds.includes('authoritative') && ctx.isAuthoritative) return true;
  if (kinds.includes('assignees') && ctx.isAssigned) return true;
  return ctx.userId != null && (audience?.user_ids ?? []).includes(ctx.userId);
}

// ---------------------------------------------------------------------------
// Form values
// ---------------------------------------------------------------------------

function isEmptyValue(value: FormValue | null): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function setFieldValue(
  values: FormValues,
  fieldId: number,
  value: FormValue | null
): FormValues {
  const next = { ...values };
  delete next[String(fieldId)];
  if (value !== null && !isEmptyValue(value)) next[String(fieldId)] = value;
  return next;
}

export function toggleMultiOption(values: FormValues, field: FormField, optionId: number) {
  const current = values[String(field.id)];
  const selected = Array.isArray(current) ? current : [];
  const next = selected.includes(optionId)
    ? selected.filter((id) => id !== optionId)
    : [...selected, optionId].sort((a, b) => a - b);
  return setFieldValue(values, field.id, next);
}

/** Category fields toggle the chosen option off; multicategory adds/removes. */
export function applyCategoryOption(values: FormValues, field: FormField, optionId: number) {
  if (field.type === 'multicategory') return toggleMultiOption(values, field, optionId);
  const current = values[String(field.id)];
  return setFieldValue(values, field.id, current === optionId ? null : optionId);
}

export function missingRequiredFields(fields: FormField[], values: FormValues): FormField[] {
  return fields.filter((f) => f.required && isEmptyValue(values[String(f.id)] ?? null));
}

export function formatMissingFieldsTitle(missing: FormField[]): string {
  return `Missing required: ${missing.map((f) => f.title).join(', ')}`;
}

export function isDateRangeValue(value: unknown): value is DateRangeValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as DateRangeValue).start === 'string' &&
    typeof (value as DateRangeValue).end === 'string'
  );
}

function valueEqual(a: FormValue, b: FormValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    // multicategory ids are kept sorted, so position compares.
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
    );
  }
  if (isDateRangeValue(a) || isDateRangeValue(b)) {
    return isDateRangeValue(a) && isDateRangeValue(b) && a.start === b.start && a.end === b.end;
  }
  return a === b;
}

export function formValuesEqual(a: FormValues, b: FormValues): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => key in b && valueEqual(a[key], b[key]));
}

/**
 * Wire payload for a PATCH-style update. The backend reads `null` as "keep the
 * stored answers", `{}` as "clear them" and a dict as "replace". `undefined`
 * means the caller is not touching answers at all (a geometry-only edit), and
 * an unchanged set is not worth a needless server-side required-field recheck.
 */
export function patchFormValues(prev: FormValues, next: FormValues | undefined): FormValues | null {
  if (next === undefined || formValuesEqual(prev, next)) return null;
  return next;
}

export interface FormValidation {
  ok: boolean;
  /** Titles of unanswered required fields, in field order. */
  missing: string[];
}

export function validateForm(fields: FormField[], values: Record<string, unknown>): FormValidation {
  const missing = missingRequiredFields(fields, values as FormValues);
  return { ok: missing.length === 0, missing: missing.map((f) => f.title) };
}

// ---------------------------------------------------------------------------
// Keyboard navigation across the form
// ---------------------------------------------------------------------------

/** The primary label selector. Digits still pick labels while it is active. */
export const LABEL_FIELD_INDEX = -1;

/** `null` and LABEL_FIELD_INDEX both route digits to labels, so entering the
 *  cycle forward skips to the first custom field. */
export function cycleFieldIndex(
  current: number | null,
  fieldCount: number,
  direction: 1 | -1
): number | null {
  if (fieldCount === 0) return null;
  if (direction === 1) {
    if (current === null || current === LABEL_FIELD_INDEX) return 0;
    return current === fieldCount - 1 ? LABEL_FIELD_INDEX : current + 1;
  }
  if (current === null) return fieldCount - 1;
  if (current === 0) return LABEL_FIELD_INDEX;
  if (current === LABEL_FIELD_INDEX) return fieldCount - 1;
  return current - 1;
}

export function isLabelGroupActive(activeIndex: number | null, fieldCount: number): boolean {
  return fieldCount > 0 && (activeIndex === null || activeIndex === LABEL_FIELD_INDEX);
}

function digitTargetsOption(
  field: FormField
): field is Extract<FormField, { type: 'category' | 'multicategory' }> {
  return field.type === 'category' || field.type === 'multicategory';
}

export interface FormKeyContext {
  fields: FormField[];
  activeIndex: number | null;
  values: FormValues;
  setValues: (next: FormValues) => void;
  setActiveIndex: (index: number | null) => void;
}

/** `handled` lets callers fall through to their own bindings for the same
 *  keys; `focusFieldId` names the input to focus so a digit starts a typed
 *  value rather than selecting an option. */
export interface FormKeyResult {
  handled: boolean;
  focusFieldId: number | null;
}

export function handleFormFieldKey(e: KeyboardEvent, ctx: FormKeyContext): FormKeyResult {
  const { fields, activeIndex } = ctx;
  const active = activeIndex !== null && activeIndex >= 0 ? fields[activeIndex] : undefined;

  if (active && /^[0-9]$/.test(e.key)) {
    e.preventDefault();
    if (!digitTargetsOption(active)) return { handled: true, focusFieldId: active.id };
    const option = active.options[parseInt(e.key, 10) - 1];
    if (option) ctx.setValues(applyCategoryOption(ctx.values, active, option.id));
    return { handled: true, focusFieldId: null };
  }

  if (active && e.key === 'Enter' && !digitTargetsOption(active)) {
    e.preventDefault();
    return { handled: true, focusFieldId: active.id };
  }

  if (e.key === 'Tab' && fields.length > 0) {
    e.preventDefault();
    ctx.setActiveIndex(cycleFieldIndex(activeIndex, fields.length, e.shiftKey ? -1 : 1));
    return { handled: true, focusFieldId: null };
  }

  if (e.key === 'Escape' && activeIndex !== null) {
    e.preventDefault();
    ctx.setActiveIndex(null);
    return { handled: true, focusFieldId: null };
  }

  return { handled: false, focusFieldId: null };
}

// ---------------------------------------------------------------------------
// Submit readiness
// ---------------------------------------------------------------------------

export interface SubmitReadiness {
  selectedLabelId: number | null;
  hasExistingLabel: boolean;
  mayLabel: boolean;
  isSubmitting: boolean;
}

/** Submitting nothing means "take my label off this task", which only exists
 *  when there is one to take off. */
export function isRemovingLabel(
  state: Pick<SubmitReadiness, 'selectedLabelId' | 'hasExistingLabel'>
): boolean {
  return state.hasExistingLabel && state.selectedLabelId === null;
}

/** Behind both the Submit button and the Enter key, so a keystroke can never
 *  record what the button refuses. Skipping is a separate action with the
 *  same permission check. */
export function maySubmitTask(state: SubmitReadiness): boolean {
  if (state.isSubmitting || !state.mayLabel) return false;
  return state.selectedLabelId !== null || isRemovingLabel(state);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function extentOf(geometry: GeoJSON.Geometry): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (value: unknown): void => {
    if (Array.isArray(value) && typeof value[0] === 'number') {
      const [x, y] = value as [number, number];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  };
  if (geometry.type === 'GeometryCollection') {
    geometry.geometries.forEach((g) => visit(g.type === 'GeometryCollection' ? [] : g.coordinates));
  } else {
    visit(geometry.coordinates);
  }
  return [minX, minY, maxX, maxY];
}

/** Bounding-box centre - deterministic and good enough for "recenter here". */
export function geometryCentroid(geometry: GeoJSON.Geometry): [number, number] {
  const [minX, minY, maxX, maxY] = extentOf(geometry);
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** Stable per-feature key so a feature spanning several vector tiles is only
 *  counted once when box-selecting. MVT ids are stable across tiles but only
 *  unique within a layer, hence the namespace; sources without ids fall back
 *  to a rounded extent. */
export function featureDedupeKey(
  layerId: unknown,
  id: string | number | undefined,
  geometry: GeoJSON.Geometry
): string {
  if (id !== undefined) return `${layerId}:id:${id}`;
  const extent = extentOf(geometry).map((n) => Math.round(n));
  return `${layerId}:geom:${geometry.type}:${extent.join(',')}`;
}

const pairs = (coords: number[][]) => coords.map(([x, y]) => `${x} ${y}`).join(', ');

/** Covers the shapes the draw tools produce, which is all geometry_wkt needs. */
export function geometryToWkt(geometry: GeoJSON.Geometry): string {
  switch (geometry.type) {
    case 'Point':
      return `POINT (${geometry.coordinates[0]} ${geometry.coordinates[1]})`;
    case 'LineString':
      return `LINESTRING (${pairs(geometry.coordinates)})`;
    case 'Polygon':
      return `POLYGON (${geometry.coordinates.map((ring) => `(${pairs(ring)})`).join(', ')})`;
    default:
      throw new Error(`geometryToWkt: unsupported geometry type ${geometry.type}`);
  }
}

const parsePair = (pair: string): [number, number] => {
  const [x, y] = pair.trim().split(/\s+/).map(Number);
  return [x, y];
};

/** Task and annotation geometries arrive from the backend as WKT. */
export function wktToGeometry(wkt: string): GeoJSON.Geometry {
  const trimmed = wkt.trim();

  const point = /^POINT\s*\(([^)]+)\)$/i.exec(trimmed);
  if (point) return { type: 'Point', coordinates: parsePair(point[1]) };

  const line = /^LINESTRING\s*\(([^)]+)\)$/i.exec(trimmed);
  if (line) return { type: 'LineString', coordinates: line[1].split(',').map(parsePair) };

  const polygon = /^POLYGON\s*\(\((.+)\)\)$/i.exec(trimmed);
  if (polygon) {
    const rings = polygon[1].split(/\)\s*,\s*\(/).map((ring) =>
      ring
        .trim()
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map(parsePair)
    );
    return { type: 'Polygon', coordinates: rings };
  }

  throw new Error(`wktToGeometry: unsupported WKT "${wkt}"`);
}
