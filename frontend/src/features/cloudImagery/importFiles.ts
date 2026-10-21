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
  itemKey?: string;
  assetKey?: string;
  bandNames?: string;
};

export type AssetRule = { name: string; pattern: string };

export type ImportFile = Pick<FileSelection, 'path' | 'etag'> &
  ({ datetime: string } | { start_datetime: string; end_datetime: string });

export type ImportFileResult = { ok: true; file: ImportFile } | { ok: false; error: string };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/i;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

const isRealDate = (year: number, month: number, day: number) => {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
};

const formatUtc = (ms: number, fraction: string) => {
  const d = new Date(ms);
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${fraction}Z`
  );
};

/** One typed moment as a UTC timestamp. A bare date is the start (or, with `end`, the last
 *  microsecond) of that UTC day; a timestamp must carry its timezone. */
export function toUtc(
  raw: string,
  end = false
): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: false, error: 'Enter a date or timestamp' };
  const day = DATE_ONLY.exec(value);
  if (day) {
    if (!isRealDate(+day[1], +day[2], +day[3])) {
      return { ok: false, error: `${value} is not a calendar date` };
    }
    return { ok: true, value: `${value}T${end ? '23:59:59.999999' : '00:00:00'}Z` };
  }
  const ts = TIMESTAMP.exec(value);
  if (!ts) {
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(value)) {
      return { ok: false, error: `${value} needs a timezone, for example a trailing Z` };
    }
    return { ok: false, error: `${value} is not a date (YYYY-MM-DD) or ISO timestamp` };
  }
  const [, y, mo, d, h, mi, s = '00', fraction = '', zone] = ts;
  if (!isRealDate(+y, +mo, +d) || +h > 23 || +mi > 59 || +s > 59) {
    return { ok: false, error: `${value} is not a real date and time` };
  }
  let offsetMinutes = 0;
  if (zone.toUpperCase() !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const [oh, om] = zone.slice(1).split(':').map(Number);
    if (oh > 23 || om > 59) return { ok: false, error: `${value} has an invalid timezone` };
    offsetMinutes = sign * (oh * 60 + om);
  }
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - offsetMinutes * 60_000;
  return { ok: true, value: formatUtc(ms, fraction) };
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

const compactDate = (text: string) => {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(text);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** A date read out of a file path with a user's regular expression: its first capture group
 *  (or whole match) as YYYY-MM-DD or YYYYMMDD. */
export function dateFromPath(path: string, pattern: RegExp): string | null {
  const match = pattern.exec(path);
  if (!match) return null;
  return compactDate(match[1] ?? match[0]);
}

export function timeFromPath(path: string, pattern: RegExp): TimeInput | null {
  const match = pattern.exec(path);
  if (!match) return null;
  const value = match[1] ?? match[0];
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month && +month[2] >= 1 && +month[2] <= 12) {
    const lastDay = new Date(Date.UTC(+month[1], +month[2], 0)).getUTCDate();
    return { kind: 'interval', start: `${value}-01`, end: `${value}-${pad(lastDay, 2)}` };
  }
  const day = compactDate(value);
  return day && toUtc(day).ok ? { kind: 'instant', value: day } : null;
}

const assetName = (path: string) =>
  (path.split('/').pop() ?? path)
    .replace(/\.tiff?$/i, '')
    .split('_')
    .pop()!
    .replace(/[^A-Za-z0-9_.-]/g, '_');

const timeKey = (row: SelectionRow, time: TimeInput) => {
  const converted = toImportFile(row.object, time);
  if (!converted.ok) return null;
  return 'datetime' in converted.file
    ? converted.file.datetime
    : `${converted.file.start_datetime}/${converted.file.end_datetime}`;
};

const hasTime = (time: TimeInput) =>
  time.kind === 'instant' ? !!time.value.trim() : !!(time.start.trim() || time.end.trim());

export function groupSelected(rows: Map<string, SelectionRow>, itemKey: string) {
  const selected = [...rows.values()].filter((row) => row.selected);
  const errors: string[] = [];
  if (selected.length < 2) errors.push('Select at least two files to group.');
  const dates = new Set(selected.map((row) => timeKey(row, row.time)).filter(Boolean));
  if (selected.some((row) => hasTime(row.time) && !timeKey(row, row.time)))
    errors.push("Fix the selected files' dates before grouping.");
  if (dates.size > 1) errors.push('Selected files have different dates. Set a shared date first.');
  const names = selected.map((row) => row.assetKey || assetName(row.object.path));
  if (new Set(names).size !== names.length)
    errors.push('Asset names must be different within an item. Edit the asset names first.');
  if (errors.length) return { rows, errors };
  const time = selected.find((row) => timeKey(row, row.time))?.time ?? selected[0].time;
  const next = new Map(rows);
  selected.forEach((row, index) =>
    next.set(row.object.path, { ...row, itemKey, assetKey: names[index], time })
  );
  return { rows: next, errors };
}

export function groupByDate(rows: Map<string, SelectionRow>, rules: AssetRule[], pattern: string) {
  const errors: string[] = [];
  if (!rules.length || rules.some((rule) => !/^[A-Za-z0-9_.-]{1,128}$/.test(rule.name)))
    errors.push(
      'Give each rule an asset name using letters, numbers, dots, hyphens or underscores.'
    );
  if (new Set(rules.map((rule) => rule.name)).size !== rules.length)
    errors.push('Each asset rule needs a different name.');
  if (rules.some((rule) => !rule.pattern.trim())) errors.push('Give each asset rule a pattern.');
  if (errors.length) return { rows, errors };
  let datePattern: RegExp;
  let compiled: RegExp[];
  try {
    datePattern = new RegExp(pattern);
    compiled = rules.map((rule) => new RegExp(rule.pattern));
  } catch {
    return { rows, errors: ['A grouping pattern is not a valid regular expression.'] };
  }
  const next = new Map(rows);
  const changedItems = new Set<string>();
  for (const [path, row] of rows) {
    if (!row.selected) continue;
    const matches = rules.filter((_, index) => compiled[index].test(path));
    if (!matches.length) continue;
    if (matches.length > 1) {
      errors.push(`${path}: more than one asset rule matches.`);
      continue;
    }
    const time = hasTime(row.time) ? row.time : timeFromPath(path, datePattern);
    const date = time && timeKey(row, time);
    if (!date || !time) {
      errors.push(`${path}: enter a date or adjust the date extraction pattern.`);
      continue;
    }
    const rule = matches[0];
    const itemKey = `date:${date}`;
    changedItems.add(itemKey);
    next.set(path, { ...row, time, itemKey, assetKey: rule.name });
  }
  const seen = new Set<string>();
  for (const row of next.values()) {
    if (!row.selected || !row.itemKey || !changedItems.has(row.itemKey)) continue;
    const key = `${row.itemKey}\n${row.assetKey}`;
    if (seen.has(key))
      errors.push(`More than one file has asset name "${row.assetKey}" for the same date.`);
    seen.add(key);
  }
  if (!changedItems.size && !errors.length) errors.push('No selected files match these patterns.');
  return { rows: errors.length ? rows : next, errors };
}

/** Times pasted as CSV rows: `path,datetime` or `path,start,end`. */
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
      else errors.push(`Line ${index + 1}: expected path,datetime or path,start,end`);
    });
  return { times, errors };
}
