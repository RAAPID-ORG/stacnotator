import { describe, it, expect, vi } from 'vitest';
import { uploadFile } from './customMaps';

/**
 * Tests for uploadFile - the only logic in customMaps.ts that can't be
 * expressed through the generated SDK (XHR is needed for progress tracking).
 */
describe('uploadFile', () => {
  function makeXhrMock() {
    const openSpy = vi.fn();
    const setHeaderSpy = vi.fn();
    const sendSpy = vi.fn();
    let instance: {
      open: typeof openSpy;
      setRequestHeader: typeof setHeaderSpy;
      send: typeof sendSpy;
      upload: { onprogress: ((e: ProgressEvent) => void) | null };
      onload: (() => void) | null;
      onerror: (() => void) | null;
      status: number;
    };

    class MockXHR {
      open = openSpy;
      setRequestHeader = setHeaderSpy;
      send = sendSpy;
      upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      status = 200;
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        instance = this;
      }
    }

    vi.stubGlobal('XMLHttpRequest', MockXHR);

    return {
      openSpy,
      setHeaderSpy,
      sendSpy,
      trigger: (event: 'load' | 'error') => {
        if (event === 'load' && instance.onload) instance.onload();
        if (event === 'error' && instance.onerror) instance.onerror();
      },
      setStatus: (s: number) => {
        instance.status = s;
      },
      triggerProgress: (loaded: number, total: number) => {
        instance.upload.onprogress?.({ loaded, total, lengthComputable: true } as ProgressEvent);
      },
    };
  }

  it('uses PUT and sets x-ms-blob-type for Azure SAS URLs', async () => {
    const xhr = makeXhrMock();
    const file = new File(['data'], 'raster.tif');
    const p = uploadFile('https://account.blob.core.windows.net/c/k?sas', 'PUT', file, vi.fn());
    setTimeout(() => xhr.trigger('load'), 0);
    await p;

    expect(xhr.openSpy).toHaveBeenCalledWith(
      'PUT',
      'https://account.blob.core.windows.net/c/k?sas'
    );
    expect(xhr.setHeaderSpy).toHaveBeenCalledWith('x-ms-blob-type', 'BlockBlob');
    expect(xhr.sendSpy).toHaveBeenCalledWith(file);
    vi.unstubAllGlobals();
  });

  it('uses POST multipart with Bearer token for local backend URLs', async () => {
    const xhr = makeXhrMock();
    const file = new File(['data'], 'raster.tif');
    const getToken = vi.fn().mockResolvedValue('my-token');
    const p = uploadFile('/api/1/custom-maps/upload-local?key=k', 'POST', file, getToken);
    await new Promise((r) => setTimeout(r, 10)); // let getToken resolve
    xhr.trigger('load');
    await p;

    expect(xhr.openSpy).toHaveBeenCalledWith(
      'POST',
      expect.stringContaining('/api/1/custom-maps/upload-local')
    );
    expect(xhr.setHeaderSpy).toHaveBeenCalledWith('Authorization', 'Bearer my-token');
    // body should be FormData (not the raw file)
    const sentBody = xhr.sendSpy.mock.calls[0][0];
    expect(sentBody).toBeInstanceOf(FormData);
    vi.unstubAllGlobals();
  });

  it('does NOT send an Authorization header for Azure SAS URLs', async () => {
    const xhr = makeXhrMock();
    const file = new File(['x'], 'x.tif');
    const p = uploadFile('https://azure.example.com/c/k?sas=abc', 'PUT', file, vi.fn());
    setTimeout(() => xhr.trigger('load'), 0);
    await p;

    const authCalls = xhr.setHeaderSpy.mock.calls.filter((args) => args[0] === 'Authorization');
    expect(authCalls).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('reports progress percentage when onProgress is provided', async () => {
    const xhr = makeXhrMock();
    const file = new File(['data'], 'x.tif');
    const onProgress = vi.fn();
    // Start upload first so XHR is created and upload.onprogress is wired up
    const p = uploadFile('https://sas.example.com/k', 'PUT', file, vi.fn(), onProgress);

    xhr.triggerProgress(50, 100);
    xhr.triggerProgress(100, 100);
    setTimeout(() => xhr.trigger('load'), 0);
    await p;

    expect(onProgress).toHaveBeenCalledWith(50);
    expect(onProgress).toHaveBeenCalledWith(100);
    vi.unstubAllGlobals();
  });

  it('rejects when the server returns a non-2xx status', async () => {
    const xhr = makeXhrMock();
    const file = new File(['x'], 'x.tif');
    // Start the upload first so the XHR instance is created, then set status
    const p = uploadFile('https://sas.example.com/k', 'PUT', file, vi.fn());
    xhr.setStatus(403);
    setTimeout(() => xhr.trigger('load'), 0);

    await expect(p).rejects.toThrow('Upload failed: 403');
    vi.unstubAllGlobals();
  });

  it('rejects on network error', async () => {
    const xhr = makeXhrMock();
    const file = new File(['x'], 'x.tif');
    const p = uploadFile('https://sas.example.com/k', 'PUT', file, vi.fn());
    setTimeout(() => xhr.trigger('error'), 0);

    await expect(p).rejects.toThrow('Upload network error');
    vi.unstubAllGlobals();
  });
});
