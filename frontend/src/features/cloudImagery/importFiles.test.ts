/**
 * Specification: import times typed by the user become the exact UTC payload the
 * backend accepts (issue #158). One instant OR one complete interval per file;
 * timezone-aware or date-only input only; date-only means whole UTC days.
 *
 * Contract: `toImportFile(object, time)` from `./importFiles`
 *   object: { path: string; etag: string }
 *   time:   { kind: 'instant'; value: string } | { kind: 'interval'; start: string; end: string }
 *   -> { ok: true; file: ImportFile } | { ok: false; error: string }
 *   ImportFile = { path, etag, datetime } | { path, etag, start_datetime, end_datetime }
 */
import { describe, expect, it } from 'vitest';
import {
  groupByDate,
  groupSelected,
  timeFromPath,
  toImportFile,
  type SelectionRow,
} from './importFiles';

const obj = { path: 'flights/a.tif', etag: '"0x1"' };

describe('asset grouping', () => {
  const rows = () =>
    new Map<string, SelectionRow>(
      ['01', '02'].flatMap((month) =>
        ['reflectance', 'clear-count'].map((asset) => {
          const path = `imagery/guaviare-s2-2025-${month}/guaviare-s2-2025-${month}_${asset}.tif`;
          return [
            path,
            {
              object: { path, etag: '"1"', size: 1000 },
              selected: true,
              time: { kind: 'instant', value: '' },
            },
          ] as [string, SelectionRow];
        })
      )
    );
  const rules = [
    { name: 'reflectance', pattern: '_reflectance\\.tif$' },
    { name: 'clear-count', pattern: '_clear-count\\.tif$' },
  ];

  it('groups monthly files by date with named assets and explicit month bounds', () => {
    const result = groupByDate(rows(), rules, '(\\d{4}-\\d{2})');
    expect(result.errors).toEqual([]);
    expect(new Set([...result.rows.values()].map((row) => row.itemKey)).size).toBe(2);
    const feb = [...result.rows.values()].filter((row) => row.object.path.includes('2025-02'));
    expect(feb.map((row) => row.assetKey)).toEqual(['reflectance', 'clear-count']);
    expect(feb[0].time).toEqual({ kind: 'interval', start: '2025-02-01', end: '2025-02-28' });
    expect(feb[0]).not.toHaveProperty('bandNames');
    expect(timeFromPath('2024-02_reflectance.tif', /(\d{4}-\d{2})/)).toEqual({
      kind: 'interval',
      start: '2024-02-01',
      end: '2024-02-29',
    });
  });

  it('leaves unmatched files unchanged, even without a date, and allows partial rule coverage', () => {
    const original = rows();
    const path = 'imagery/undated.tif';
    const unmatched: SelectionRow = {
      object: { path, etag: '"1"', size: 1000 },
      selected: true,
      time: { kind: 'instant', value: '' },
    };
    original.set(path, unmatched);
    const result = groupByDate(original, [rules[0]], '(\\d{4}-\\d{2})');
    expect(result.errors).toEqual([]);
    expect([...result.rows.values()].filter((row) => row.itemKey)).toHaveLength(2);
    for (const [key, row] of original) {
      if (!key.includes('reflectance')) expect(result.rows.get(key)).toBe(row);
    }
  });

  it('does not change rows for invalid, overlapping, or duplicate asset rules', () => {
    const original = rows();
    for (const invalidRules of [
      [{ ...rules[0], pattern: '(' }],
      [rules[0], { ...rules[1], pattern: '\\.tif$' }],
      rules.map((rule) => ({ ...rule, name: 'same' })),
    ]) {
      const result = groupByDate(original, invalidRules, '(\\d{4}-\\d{2})');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.rows).toBe(original);
    }
  });

  it('manually groups selected files without absorbing unselected files', () => {
    const original = rows();
    for (const row of original.values()) row.selected = row.object.path.includes('2025-01');
    const result = groupSelected(original, 'manual-1');
    expect(result.errors).toEqual([]);
    expect([...result.rows.values()].filter((row) => row.itemKey === 'manual-1')).toHaveLength(2);
    expect([...result.rows.values()].filter((row) => !row.itemKey)).toHaveLength(2);
  });
});

describe('toImportFile', () => {
  it.each([
    ['2026-01-12T12:20:00+02:00', '2026-01-12T10:20:00Z'],
    ['2026-01-12T10:20:00.250Z', '2026-01-12T10:20:00.250Z'],
    ['2026-01-12', '2026-01-12T00:00:00Z'],
  ])('normalizes instant %s to UTC', (value, datetime) => {
    expect(toImportFile(obj, { kind: 'instant', value })).toEqual({
      ok: true,
      file: { ...obj, datetime },
    });
  });

  it('expands a date-only interval to inclusive UTC day bounds', () => {
    expect(
      toImportFile(obj, {
        kind: 'interval',
        start: '2026-01-01',
        end: '2026-01-31',
      })
    ).toEqual({
      ok: true,
      file: {
        ...obj,
        start_datetime: '2026-01-01T00:00:00Z',
        end_datetime: '2026-01-31T23:59:59.999999Z',
      },
    });
  });

  it.each([
    ['naive timestamp', { kind: 'instant' as const, value: '2026-01-12T10:20:00' }],
    ['not a date', { kind: 'instant' as const, value: 'January' }],
    ['empty instant', { kind: 'instant' as const, value: '' }],
    ['missing end', { kind: 'interval' as const, start: '2026-01-01', end: '' }],
    ['start after end', { kind: 'interval' as const, start: '2026-02-01', end: '2026-01-01' }],
  ])('rejects %s with a message', (_name, time) => {
    const result = toImportFile(obj, time);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
