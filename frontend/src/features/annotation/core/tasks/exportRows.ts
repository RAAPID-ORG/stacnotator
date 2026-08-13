export type ExportFormat = 'csv' | 'geojson';

export interface ExportRowsRequest {
  path: { campaign_id: number };
  query?: { merge_on_agreement: boolean };
  parseAs: 'blob';
}

export function exportRows(
  campaignId: number,
  _format: ExportFormat,
  mergeOnAgreement: boolean
): ExportRowsRequest {
  return {
    path: { campaign_id: campaignId },
    ...(mergeOnAgreement ? { query: { merge_on_agreement: true } } : {}),
    parseAs: 'blob',
  };
}

/** Filename to save the export under: the server's Content-Disposition
 *  filename when present, else a slugified `<campaign>_annotations.<ext>`. */
export function resolveExportFilename(
  campaignName: string,
  format: ExportFormat,
  contentDisposition: string | null
): string {
  const ext = format === 'geojson' ? 'geojson' : 'csv';
  const fallback = `${campaignName.replace(/\s+/g, '_')}_annotations.${ext}`;
  if (!contentDisposition) return fallback;
  const match = contentDisposition.match(/filename="?(.+)"?/i);
  return match ? match[1] : fallback;
}

/** Extract the backend's `detail` message from a failed export's JSON error
 *  body (e.g. conflicting task numbers when merge_on_agreement is rejected),
 *  or null when the body isn't JSON / has no detail. */
export function parseExportErrorDetail(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { detail?: string };
    return parsed.detail ?? null;
  } catch {
    return null;
  }
}
