/**
 * Specification: import times typed by the user become the exact UTC payload the
 * backend accepts (issue #158). One instant OR one complete interval per file;
 * YYYY-MM-DD dates only; intervals include the whole end day.
 *
 * Contract: `toImportFile(object, time)` from `./importFiles`
 *   object: { path: string; etag: string }
 *   time:   { kind: 'instant'; value: string } | { kind: 'interval'; start: string; end: string }
 *   -> { ok: true; file: ImportFile } | { ok: false; error: string }
 *   ImportFile = { path, etag, datetime } | { path, etag, start_datetime, end_datetime }
 */
import { describe, expect, it } from 'vitest';
import {
  assignAssets,
  buildSelection,
  parseTimeCsv,
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

  it('sets asset names without dates, then groups identical intervals automatically', () => {
    const result = assignAssets(rows(), rules);
    expect(result.errors).toEqual([]);
    const feb = [...result.rows.values()].filter((row) => row.object.path.includes('2025-02'));
    expect(feb.map((row) => row.assetKey)).toEqual(['reflectance', 'clear-count']);
    expect(feb[0].time).toEqual({ kind: 'instant', value: '' });
    for (const row of result.rows.values()) {
      const month = row.object.path.includes('2025-02') ? '02' : '01';
      row.time = {
        kind: 'interval',
        start: `2025-${month}-01`,
        end: `2025-${month}-${month === '02' ? '28' : '31'}`,
      };
    }
    const selection = buildSelection(result.rows.values());
    expect(selection.problems.size).toBe(0);
    expect(selection.itemCount).toBe(2);
    expect(selection.files[2].item_key).toBe(selection.files[3].item_key);
    expect(feb[0]).not.toHaveProperty('bandNames');
    expect(timeFromPath('2024-02-29_reflectance.tif', /(\d{4}-\d{2}-\d{2})/)).toEqual({
      kind: 'instant',
      value: '2024-02-29',
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
    const result = assignAssets(original, [rules[0]]);
    expect(result.errors).toEqual([]);
    expect([...result.rows.values()].filter((row) => row.assetKey === 'reflectance')).toHaveLength(
      2
    );
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
      const result = assignAssets(original, invalidRules);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.rows).toBe(original);
    }
  });

  it('groups selected files by date and rejects duplicate assets within a date', () => {
    const original = assignAssets(rows(), rules).rows;
    for (const row of original.values()) {
      row.selected = row.object.path.includes('2025-01');
      row.time = { kind: 'instant', value: '2025-01-01' };
    }
    const result = buildSelection(original.values());
    expect(result.problems.size).toBe(0);
    expect(result.files).toHaveLength(2);
    expect(result.itemCount).toBe(1);
    for (const row of original.values()) row.assetKey = 'data';
    expect(buildSelection(original.values()).problems.size).toBe(2);
  });
});

describe('toImportFile', () => {
  it.each([
    ['2024-02-29', '2024-02-29T00:00:00Z'],
    ['2025-12-31', '2025-12-31T00:00:00Z'],
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

  describe('parseTimeCsv', () => {
    it('preserves commas, escaped quotes, and newlines in quoted paths', () => {
      const { times, errors } = parseTimeCsv(
        [
          'path,date',
          '"flights/field,west.tif",2026-01-12',
          '"flights/field ""west"".tif",2026-01-13',
          '"flights/field',
          'west.tif",2026-01-14',
          'flights/next.tif,2026-01-15',
        ].join('\n')
      );

      expect(errors).toEqual([]);
      expect([...times]).toEqual([
        ['flights/field,west.tif', { kind: 'instant', value: '2026-01-12' }],
        ['flights/field "west".tif', { kind: 'instant', value: '2026-01-13' }],
        ['flights/field\nwest.tif', { kind: 'instant', value: '2026-01-14' }],
        ['flights/next.tif', { kind: 'instant', value: '2026-01-15' }],
      ]);
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
