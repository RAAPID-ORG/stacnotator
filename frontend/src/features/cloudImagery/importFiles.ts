import type { FileSelection } from '~/api/client';

export interface StorageObject {
  path: string;
  etag: string;
}

export type TimeInput =
  | { kind: 'instant'; value: string }
  | { kind: 'interval'; start: string; end: string };

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
