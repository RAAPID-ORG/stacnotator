import { describe, it, expect } from 'vitest';
import { exportRows, parseExportErrorDetail, resolveExportFilename } from './exportRows';

describe('exportRows', () => {
  it('builds a CSV request with no merge query when merge-on-agreement is off', () => {
    expect(exportRows(7, 'csv', false)).toEqual({
      path: { campaign_id: 7 },
      parseAs: 'blob',
    });
  });

  it('builds a GeoJSON request carrying merge_on_agreement when requested', () => {
    expect(exportRows(7, 'geojson', true)).toEqual({
      path: { campaign_id: 7 },
      query: { merge_on_agreement: true },
      parseAs: 'blob',
    });
  });
});

describe('resolveExportFilename', () => {
  it('uses the server-provided filename from Content-Disposition when present', () => {
    // /filename="?(.+)"?/i: the greedy (.+) swallows the closing quote before
    // backtracking to satisfy the optional trailing "?, so the captured group
    // keeps it - quote and all.
    const name = resolveExportFilename('My Campaign', 'csv', 'attachment; filename="report.csv"');
    expect(name).toBe('report.csv"');
  });

  it('has no trailing quote to strip for an unquoted filename', () => {
    const name = resolveExportFilename('My Campaign', 'csv', 'attachment; filename=report.csv');
    expect(name).toBe('report.csv');
  });

  it('falls back to a slugified campaign name when the header is absent', () => {
    expect(resolveExportFilename('My Campaign', 'csv', null)).toBe('My_Campaign_annotations.csv');
  });

  it('uses the geojson extension for the geojson format fallback', () => {
    expect(resolveExportFilename('My Campaign', 'geojson', null)).toBe(
      'My_Campaign_annotations.geojson'
    );
  });
});

describe('parseExportErrorDetail', () => {
  it('extracts the backend detail message from a JSON error body', () => {
    expect(parseExportErrorDetail('{"detail":"conflicting task numbers"}')).toBe(
      'conflicting task numbers'
    );
  });

  it('returns null when the body is not JSON', () => {
    expect(parseExportErrorDetail('not json')).toBeNull();
  });

  it('returns null when the JSON body has no detail field', () => {
    expect(parseExportErrorDetail('{}')).toBeNull();
  });
});
