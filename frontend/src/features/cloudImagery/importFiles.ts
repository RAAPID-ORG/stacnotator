import type { DiscoveredObject, FileSelection } from '~/api/client';

export interface StorageObject {
  path: string;
  etag: string;
}

export type TimeInput =
  | { kind: 'instant'; value: string }
  | { kind: 'interval'; start: string; end: string };

export type SelectionRow = {
  object: DiscoveredObject;
  time: TimeInput;
  selected: boolean;
  assetKey?: string;
};

export type AssetRule = { name: string; pattern: string };

export type ImportFile = Pick<FileSelection, 'path' | 'etag'> &
  ({ datetime: string } | { start_datetime: string; end_datetime: string });

export type ImportFileResult = { ok: true; file: ImportFile } | { ok: false; error: string };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const isRealDate = (year: number, month: number, day: number) => {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
};

/** Date-only input becomes the first or last moment of that UTC day. */
export function toUtc(
  raw: string,
  end = false
): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: false, error: 'Enter a date (YYYY-MM-DD)' };
  const day = DATE_ONLY.exec(value);
  if (day) {
    if (!isRealDate(+day[1], +day[2], +day[3])) {
      return { ok: false, error: `${value} is not a calendar date` };
    }
    return { ok: true, value: `${value}T${end ? '23:59:59.999999' : '00:00:00'}Z` };
  }
  return { ok: false, error: `${value} is not a date (YYYY-MM-DD)` };
}

const sortable = (utc: string) => {
  const [whole, fraction = ''] = utc.replace(/Z$/, '').split('.');
  return `${whole}.${fraction.padEnd(6, '0')}`;
};

/** The import payload for one storage object, or why its typed time is not accepted. */
export function toImportFile(object: StorageObject, time: TimeInput): ImportFileResult {
  const { path, etag } = object;
  if (time.kind === 'instant') {
    const at = toUtc(time.value);
    return at.ok ? { ok: true, file: { path, etag, datetime: at.value } } : at;
  }
  if (!time.start.trim() || !time.end.trim()) {
    return { ok: false, error: 'An interval needs both a start and an end' };
  }
  const start = toUtc(time.start);
  if (!start.ok) return start;
  const end = toUtc(time.end, true);
  if (!end.ok) return end;
  if (sortable(start.value) > sortable(end.value)) {
    return { ok: false, error: 'The start is after the end' };
  }
  return {
    ok: true,
    file: { path, etag, start_datetime: start.value, end_datetime: end.value },
  };
}

export function timeFromPath(path: string, pattern: RegExp): TimeInput | null {
  const match = pattern.exec(path);
  if (!match) return null;
  const value = match[1] ?? match[0];
  return toUtc(value).ok ? { kind: 'instant', value } : null;
}

export function buildSelection(rows: Iterable<SelectionRow>) {
  const files: FileSelection[] = [];
  const problems = new Map<string, string>();
  const assets = new Map<string, string>();
  for (const row of rows) {
    if (!row.selected) continue;
    const path = row.object.path;
    const result = toImportFile(row.object, row.time);
    if (!result.ok) {
      problems.set(path, result.error);
      continue;
    }
    const asset = row.assetKey ?? 'data';
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(asset)) {
      problems.set(
        path,
        'Enter an asset name using letters, numbers, dots, hyphens or underscores.'
      );
      continue;
    }
    const item =
      'datetime' in result.file
        ? `date:${result.file.datetime}`
        : `interval:${result.file.start_datetime}/${result.file.end_datetime}`;
    const key = `${item}\n${asset}`;
    const previous = assets.get(key);
    if (previous) {
      const error = `Files with the same date or interval need distinct asset names: "${asset}" is repeated.`;
      problems.set(previous, error);
      problems.set(path, error);
    }
    assets.set(key, path);
    files.push({ ...result.file, item_key: item, asset_key: asset });
  }
  return { files, problems, itemCount: new Set(files.map((file) => file.item_key)).size };
}

export function assignAssets(
  rows: Map<string, SelectionRow>,
  rules: AssetRule[],
  matchingOnly = false
) {
  const errors: string[] = [];
  if (!rules.length || rules.some((rule) => !/^[A-Za-z0-9_.-]{1,128}$/.test(rule.name)))
    errors.push(
      'Give each rule an asset name using letters, numbers, dots, hyphens or underscores.'
    );
  if (new Set(rules.map((rule) => rule.name)).size !== rules.length)
    errors.push('Each asset rule needs a different name.');
  if (rules.some((rule) => !rule.pattern.trim())) errors.push('Give each asset rule a pattern.');
  if (errors.length) return { rows, errors };
  let compiled: RegExp[];
  try {
    compiled = rules.map((rule) => new RegExp(rule.pattern));
  } catch {
    return { rows, errors: ['An asset pattern is not a valid regular expression.'] };
  }
  const next = new Map(rows);
  let matched = 0;
  for (const [path, row] of rows) {
    if (!matchingOnly && !row.selected) continue;
    const matches = rules.filter((_, index) => compiled[index].test(path));
    if (!matches.length) {
      if (matchingOnly) next.set(path, { ...row, selected: false });
      continue;
    }
    if (matches.length > 1) {
      errors.push(`${path}: more than one asset rule matches.`);
      continue;
    }
    const rule = matches[0];
    matched++;
    next.set(path, { ...row, assetKey: rule.name, selected: true });
  }
  if (!matched && !errors.length)
    errors.push(
      matchingOnly
        ? 'No listed files match these patterns.'
        : 'No selected files match these patterns.'
    );
  return { rows: errors.length ? rows : next, errors };
}

/** Dates pasted as CSV rows: `path,date` or `path,start,end`. */
export function parseTimeCsv(text: string): { times: Map<string, TimeInput>; errors: string[] } {
  const times = new Map<string, TimeInput>();
  const errors: string[] = [];
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^path\s*,/i.test(line))
    .forEach((line, index) => {
      const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      if (cells.length === 2) times.set(cells[0], { kind: 'instant', value: cells[1] });
      else if (cells.length === 3)
        times.set(cells[0], { kind: 'interval', start: cells[1], end: cells[2] });
      else errors.push(`Line ${index + 1}: expected path,date or path,start,end`);
    });
  return { times, errors };
}
