/** The annotation export's request, filename and error message. */

export type ExportFormat = 'csv' | 'geojson';

export function exportRows(campaignId: number, mergeOnAgreement: boolean) {
  return {
    path: { campaign_id: campaignId },
    ...(mergeOnAgreement ? { query: { merge_on_agreement: true } } : {}),
    parseAs: 'blob' as const,
  };
}

/** The server's Content-Disposition filename when it sends one, else a
 *  slugified fallback. */
export function resolveExportFilename(
  campaignName: string,
  format: ExportFormat,
  contentDisposition: string | null
): string {
  const ext = format === 'geojson' ? 'geojson' : 'csv';
  const fallback = `${campaignName.replace(/\s+/g, '_')}_annotations.${ext}`;
  const match = contentDisposition?.match(/filename="?(.+)"?/i);
  return match ? match[1] : fallback;
}

export function parseExportErrorDetail(body: string): string | null {
  try {
    return (JSON.parse(body) as { detail?: string }).detail ?? null;
  } catch {
    return null;
  }
}
