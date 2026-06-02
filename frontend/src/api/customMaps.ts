/**
 * XHR upload with progress tracking - the only thing that can't be expressed
 * through the generated SDK client. Everything else (list, create, delete,
 * viz-params update) should be called from ~/api/client directly.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Upload a file directly to `uploadUrl` using XHR so callers can observe
 * progress. Handles two cases:
 *
 * - External URL (Azure SAS): PUT raw file bytes with the required blob-type
 *   header. No auth token - the SAS URL already grants write access.
 * - Local backend URL: POST multipart/form-data with a Bearer token so the
 *   backend can authenticate the request.
 */
export function uploadFile(
  uploadUrl: string,
  method: string,
  file: File,
  getToken: () => Promise<string>,
  onProgress?: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const isExternal = uploadUrl.startsWith('http');
    const fullUrl = isExternal ? uploadUrl : `${API_BASE}${uploadUrl}`;

    const xhr = new XMLHttpRequest();
    xhr.open(method, fullUrl);

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }

    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Upload network error'));

    if (isExternal) {
      xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
      xhr.send(file);
    } else {
      getToken().then((token) => {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        const body = new FormData();
        body.append('file', file);
        xhr.send(body);
      });
    }
  });
}
