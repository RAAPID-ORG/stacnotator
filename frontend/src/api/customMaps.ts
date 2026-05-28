import { client } from './client/client.gen';

export interface CustomMapVizParams {
  colormap_name?: string;
  rescale?: string;
  color_formula?: string;
  expression?: string;
  nodata?: number | string;
  [k: string]: unknown;
}

export interface CustomMap {
  id: string;
  campaign_id: number;
  name: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  display_order: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  band_count: number | null;
  min_value: number | null;
  max_value: number | null;
  viz_params: CustomMapVizParams | null;
  tile_url_template: string | null;
}

export interface CustomMapUpload {
  custom_map: CustomMap;
  upload_url: string;
  upload_path: string;
  expires_in: number;
}

const base = (campaignId: number) => `/api/campaigns/${campaignId}/custom-maps`;

export async function listCustomMaps(campaignId: number) {
  return client.get<CustomMap[]>({ url: `${base(campaignId)}/` });
}

export async function getCustomMap(campaignId: number, customMapId: string) {
  return client.get<CustomMap>({ url: `${base(campaignId)}/${customMapId}` });
}

export async function createCustomMap(
  campaignId: number,
  body: { name: string; original_filename: string }
) {
  return client.post<CustomMapUpload>({ url: `${base(campaignId)}/`, body });
}

export async function completeCustomMapUpload(campaignId: number, customMapId: string) {
  return client.post<CustomMap>({
    url: `${base(campaignId)}/${customMapId}/complete`,
  });
}

export async function patchCustomMap(
  campaignId: number,
  customMapId: string,
  body: {
    name?: string;
    display_order?: number;
    viz_params?: CustomMapVizParams | null;
  }
) {
  return client.patch<CustomMap>({ url: `${base(campaignId)}/${customMapId}`, body });
}

export async function deleteCustomMap(campaignId: number, customMapId: string) {
  return client.delete<void>({ url: `${base(campaignId)}/${customMapId}` });
}

function resolveUploadUrl(url: string): string {
  // Absolute (Azure SAS) passes through; relative local-blob URLs need the
  // backend origin since Vite doesn't proxy /api in dev.
  if (/^https?:\/\//.test(url)) return url;
  const base = import.meta.env.VITE_API_BASE_URL ?? '';
  return `${base}${url}`;
}

export function uploadToSignedUrl(
  signedUrl: string,
  file: File,
  onProgress?: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', resolveUploadUrl(signedUrl), true);
    // Required by Azure Blob SAS PUT to create a block blob.
    xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });
}
