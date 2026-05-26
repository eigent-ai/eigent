// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

/**
 * HTTP API Layer Unit Tests
 *
 * Tests all exported functions from src/api/http.ts:
 * - getBaseURL: caching from ipcRenderer 'get-backend-port'
 * - fetchGet/fetchPost/fetchPut/fetchDelete: local backend fetch methods
 * - proxyFetchGet/proxyFetchPost/proxyFetchPut/proxyFetchDelete: proxy cloud fetch
 * - uploadFile: FormData upload via proxy
 * - checkBackendHealth: health check with AbortController
 * - waitForBackendReady: retry health check loop
 * - checkLocalServerStale: server version hash validation
 *
 * Uses vi.resetModules() to reset module-level state (baseUrl, serverStaleChecked)
 * between tests, then dynamically imports the module under test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared Mocks (declared before vi.mock calls)
// ---------------------------------------------------------------------------

const mockShowCreditsToast = vi.fn();
const mockShowStorageToast = vi.fn();
const mockShowTrafficToast = vi.fn();
const mockToast = { warning: vi.fn() };
const mockFetch = vi.fn();
const mockGetAuthStore = vi.fn(() => ({ token: 'test-token' }));

vi.mock('@/components/Toast/creditsToast', () => ({
  showCreditsToast: mockShowCreditsToast,
}));

vi.mock('@/components/Toast/storageToast', () => ({
  showStorageToast: mockShowStorageToast,
}));

vi.mock('@/components/Toast/trafficToast', () => ({
  showTrafficToast: mockShowTrafficToast,
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: mockGetAuthStore,
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

// Stub global fetch
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helper: fresh-import the http module (resets module-level state)
// ---------------------------------------------------------------------------

async function importHttp() {
  const mod = await import('@/api/http');
  return mod;
}

// ---------------------------------------------------------------------------
// Helper: build a mock Response
// ---------------------------------------------------------------------------

function mockResponse(
  opts: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    json?: any;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Response {
  const {
    ok = true,
    status = 200,
    statusText = 'OK',
    json,
    headers: headerObj = { 'content-type': 'application/json' },
    body = null,
  } = opts;
  const headers = new Headers(headerObj);
  const reader = {
    read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
  };
  const res = {
    ok,
    status,
    statusText,
    headers,
    body: body ?? null,
    json: json !== undefined ? vi.fn().mockResolvedValue(json) : undefined,
    getReader: vi.fn().mockReturnValue(reader),
  } as unknown as Response;
  return res;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('http.ts API layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.resetModules();

    // Reset import.meta.env to safe defaults
    import.meta.env.DEV = true as any;
    import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
    import.meta.env.VITE_BASE_URL = 'https://api.eigent.ai';
    import.meta.env.VITE_SERVER_CODE_HASH = '';
    import.meta.env.VITE_USE_LOCAL_PROXY = 'false';

    // Default ipcRenderer mock for getBaseURL
    (window as any).ipcRenderer = {
      invoke: vi.fn().mockResolvedValue(8888),
    };

    // Default auth store mock
    mockGetAuthStore.mockReturnValue({ token: 'test-token' });

    // Default fetch mock - will be overridden per test
    mockFetch.mockResolvedValue(
      mockResponse({ json: { code: 1, text: 'ok', data: {} } })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // getBaseURL
  // =========================================================================

  describe('getBaseURL', () => {
    it('fetches port from ipcRenderer on first call and caches it', async () => {
      const { getBaseURL } = await importHttp();

      const url = await getBaseURL();
      expect(url).toBe('http://localhost:8888');
      expect((window as any).ipcRenderer.invoke).toHaveBeenCalledWith(
        'get-backend-port'
      );
    });

    it('returns cached URL on subsequent calls without invoking ipcRenderer', async () => {
      const { getBaseURL } = await importHttp();

      await getBaseURL();
      const callCount = (window as any).ipcRenderer.invoke.mock.calls.length;

      await getBaseURL();
      expect((window as any).ipcRenderer.invoke.mock.calls.length).toBe(
        callCount
      );
    });

    it('uses different port from ipcRenderer', async () => {
      (window as any).ipcRenderer = {
        invoke: vi.fn().mockResolvedValue(9999),
      };
      const { getBaseURL } = await importHttp();

      const url = await getBaseURL();
      expect(url).toBe('http://localhost:9999');
    });
  });

  // =========================================================================
  // fetchGet
  // =========================================================================

  describe('fetchGet', () => {
    it('makes GET request with correct URL and headers', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { fetchGet } = await importHttp();

      await fetchGet('/api/test');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8888/api/test');
      expect(options.method).toBe('GET');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['Authorization']).toBe('Bearer test-token');
    });

    it('encodes query parameters for GET requests', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { fetchGet } = await importHttp();

      await fetchGet('/api/search', { q: 'hello world', page: 1 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('q=hello%20world');
      expect(url).toContain('page=1');
    });

    it('skips Authorization header when URL contains http://', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { fetchGet } = await importHttp();

      await fetchGet('http://external.com/api/data');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBeUndefined();
    });

    it('skips Authorization header when token is null', async () => {
      mockGetAuthStore.mockReturnValue({ token: null as any });
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { fetchGet } = await importHttp();

      await fetchGet('/api/test');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBeUndefined();
    });

    it('merges custom headers with defaults', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { fetchGet } = await importHttp();

      await fetchGet('/api/test', undefined, {
        'X-Custom': 'value',
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['X-Custom']).toBe('value');
    });
  });

  // =========================================================================
  // fetchPost
  // =========================================================================

  describe('fetchPost', () => {
    it('makes POST request with JSON body', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { fetchPost } = await importHttp();

      await fetchPost('/api/create', { name: 'test', value: 42 });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8888/api/create');
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify({ name: 'test', value: 42 }));
    });

    it('makes POST request without body when data is undefined', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { fetchPost } = await importHttp();

      await fetchPost('/api/trigger');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.body).toBeUndefined();
    });
  });

  // =========================================================================
  // fetchPut
  // =========================================================================

  describe('fetchPut', () => {
    it('makes PUT request with JSON body', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { fetchPut } = await importHttp();

      await fetchPut('/api/update', { id: 1, status: 'done' });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8888/api/update');
      expect(options.method).toBe('PUT');
      expect(options.body).toBe(JSON.stringify({ id: 1, status: 'done' }));
    });
  });

  // =========================================================================
  // fetchDelete
  // =========================================================================

  describe('fetchDelete', () => {
    it('makes DELETE request with JSON body', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { fetchDelete } = await importHttp();

      await fetchDelete('/api/remove', { id: 5 });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8888/api/remove');
      expect(options.method).toBe('DELETE');
      expect(options.body).toBe(JSON.stringify({ id: 5 }));
    });
  });

  // =========================================================================
  // handleResponse (tested indirectly via fetch methods)
  // =========================================================================

  describe('handleResponse', () => {
    it('returns data when code is 1', async () => {
      const responseData = { code: 1, text: 'success', data: { id: 1 } };
      mockFetch.mockResolvedValueOnce(mockResponse({ json: responseData }));
      const { fetchGet } = await importHttp();

      const result = await fetchGet('/api/test');
      expect(result).toEqual(responseData);
    });

    it('returns data when code is 300', async () => {
      const responseData = { code: 300, text: 'redirect' };
      mockFetch.mockResolvedValueOnce(mockResponse({ json: responseData }));
      const { fetchGet } = await importHttp();

      const result = await fetchGet('/api/test');
      expect(result).toEqual(responseData);
    });

    it('shows credits toast when code is 20 and returns data', async () => {
      const responseData = { code: 20, text: 'credits low' };
      mockFetch.mockResolvedValueOnce(mockResponse({ json: responseData }));
      const { fetchGet } = await importHttp();

      const result = await fetchGet('/api/test');
      expect(mockShowCreditsToast).toHaveBeenCalledTimes(1);
      expect(result).toEqual(responseData);
    });

    it('shows storage toast when code is 21 and returns data', async () => {
      const responseData = { code: 21, text: 'storage full' };
      mockFetch.mockResolvedValueOnce(mockResponse({ json: responseData }));
      const { fetchGet } = await importHttp();

      const result = await fetchGet('/api/test');
      expect(mockShowStorageToast).toHaveBeenCalledTimes(1);
      expect(result).toEqual(responseData);
    });

    it('throws Error with text when code is 13', async () => {
      const responseData = { code: 13, text: 'Unauthorized' };
      mockFetch.mockResolvedValueOnce(mockResponse({ json: responseData }));
      const { fetchGet } = await importHttp();

      await expect(fetchGet('/api/test')).rejects.toThrow('Unauthorized');
    });

    it('returns { code: 0, text: "" } for 204 status', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, status: 204, statusText: 'No Content' })
      );
      const { fetchGet } = await importHttp();

      const result = await fetchGet('/api/test');
      expect(result).toEqual({ code: 0, text: '' });
    });

    it('returns stream object for non-JSON content type with body', async () => {
      const reader = {
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
      };
      const bodyStream = { getReader: vi.fn().mockReturnValue(reader) };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: bodyStream,
        json: vi.fn(),
      } as unknown as Response);
      const { fetchGet } = await importHttp();

      const result = await fetchGet('/api/stream');
      expect(result.isStream).toBe(true);
      expect(result.body).toBe(bodyStream);
      expect(result.reader).toBe(reader);
    });

    it('throws error with detail message for non-ok response', async () => {
      const responseData = { detail: 'Not found', code: 404 };
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 404,
          json: responseData,
        })
      );
      const { fetchGet } = await importHttp();

      try {
        await fetchGet('/api/test');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toBe('Not found');
        expect(err.response).toBeDefined();
        expect(err.response.status).toBe(404);
        expect(err.response.data).toEqual(responseData);
      }
    });

    it('throws error with message field when detail is missing', async () => {
      const responseData = { message: 'Bad request', code: 400 };
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 400,
          json: responseData,
        })
      );
      const { fetchGet } = await importHttp();

      try {
        await fetchGet('/api/test');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toBe('Bad request');
      }
    });

    it('throws error with HTTP status fallback when detail and message missing', async () => {
      const responseData = { code: 500 };
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 500,
          json: responseData,
        })
      );
      const { fetchGet } = await importHttp();

      try {
        await fetchGet('/api/test');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toBe('HTTP error 500');
      }
    });

    it('returns null when response JSON is null', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: true,
          status: 200,
          json: null,
        })
      );
      const { fetchGet } = await importHttp();

      const result = await fetchGet('/api/test');
      expect(result).toBeNull();
    });

    it('shows traffic toast on fetch error for cloud requests', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));
      const { fetchGet } = await importHttp();

      await expect(fetchGet('/api/test', { api_url: 'cloud' })).rejects.toThrow(
        'Network failure'
      );

      expect(mockShowTrafficToast).toHaveBeenCalledTimes(1);
    });

    it('does not show traffic toast on fetch error for non-cloud requests', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));
      const { fetchGet } = await importHttp();

      await expect(fetchGet('/api/test')).rejects.toThrow('Network failure');
      expect(mockShowTrafficToast).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // proxyFetchGet
  // =========================================================================

  describe('proxyFetchGet', () => {
    it('uses proxy base URL in dev mode', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://proxy.test:3001';
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { proxyFetchGet } = await importHttp();

      await proxyFetchGet('/api/data');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://proxy.test:3001/api/data');
    });

    it('uses default localhost:3001 when VITE_PROXY_URL is empty in dev', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = '';
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { proxyFetchGet } = await importHttp();

      await proxyFetchGet('/api/data');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3001/api/data');
    });

    it('uses VITE_BASE_URL in production mode', async () => {
      import.meta.env.DEV = false as any;
      import.meta.env.VITE_BASE_URL = 'https://api.eigent.ai';
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { proxyFetchGet } = await importHttp();

      await proxyFetchGet('/api/data');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.eigent.ai/api/data');
    });

    it('throws when VITE_BASE_URL is not configured in production', async () => {
      import.meta.env.DEV = false as any;
      import.meta.env.VITE_BASE_URL = '';
      const { proxyFetchGet } = await importHttp();

      await expect(proxyFetchGet('/api/data')).rejects.toThrow(
        'VITE_BASE_URL not configured'
      );
    });

    it('adds X-Proxy-Target header in dev mode when VITE_BASE_URL is set', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      import.meta.env.VITE_BASE_URL = 'https://real-backend.com';
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { proxyFetchGet } = await importHttp();

      await proxyFetchGet('/api/data');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Proxy-Target']).toBe(
        'https://real-backend.com'
      );
    });

    it('does not add X-Proxy-Target header in production mode', async () => {
      import.meta.env.DEV = false as any;
      import.meta.env.VITE_BASE_URL = 'https://api.eigent.ai';
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { proxyFetchGet } = await importHttp();

      await proxyFetchGet('/api/data');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Proxy-Target']).toBeUndefined();
    });

    it('adds Authorization header for non-http URLs', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { proxyFetchGet } = await importHttp();

      await proxyFetchGet('/api/data');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer test-token');
    });

    it('skips Authorization for http:// URLs', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { proxyFetchGet } = await importHttp();

      await proxyFetchGet('http://external.com/api');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBeUndefined();
    });

    it('skips Authorization for https:// URLs', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { proxyFetchGet } = await importHttp();

      await proxyFetchGet('https://secure.com/api');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBeUndefined();
    });

    it('encodes query parameters for GET requests', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { proxyFetchGet } = await importHttp();

      await proxyFetchGet('/api/search', { key: 'a b', num: 3 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('key=a%20b');
      expect(url).toContain('num=3');
    });
  });

  // =========================================================================
  // proxyFetchPost
  // =========================================================================

  describe('proxyFetchPost', () => {
    it('makes POST request with JSON body via proxy', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { proxyFetchPost } = await importHttp();

      await proxyFetchPost('/api/create', { name: 'test' });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3001/api/create');
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify({ name: 'test' }));
    });
  });

  // =========================================================================
  // proxyFetchPut
  // =========================================================================

  describe('proxyFetchPut', () => {
    it('makes PUT request with JSON body via proxy', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { proxyFetchPut } = await importHttp();

      await proxyFetchPut('/api/update', { id: 1 });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3001/api/update');
      expect(options.method).toBe('PUT');
      expect(options.body).toBe(JSON.stringify({ id: 1 }));
    });
  });

  // =========================================================================
  // proxyFetchDelete
  // =========================================================================

  describe('proxyFetchDelete', () => {
    it('makes DELETE request with JSON body via proxy', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { proxyFetchDelete } = await importHttp();

      await proxyFetchDelete('/api/remove', { id: 3 });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3001/api/remove');
      expect(options.method).toBe('DELETE');
      expect(options.body).toBe(JSON.stringify({ id: 3 }));
    });
  });

  // =========================================================================
  // uploadFile
  // =========================================================================

  describe('uploadFile', () => {
    it('uploads file via proxy URL with FormData', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      const formData = new FormData();
      formData.append('file', new Blob(['content']), 'test.txt');
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { uploadFile } = await importHttp();

      await uploadFile('/api/upload', formData);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3001/api/upload');
      expect(options.method).toBe('POST');
      expect(options.body).toBe(formData);
    });

    it('removes Content-Type header so browser sets multipart boundary', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      const formData = new FormData();
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { uploadFile } = await importHttp();

      await uploadFile('/api/upload', formData, {
        'Content-Type': 'application/json',
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Content-Type']).toBeUndefined();
    });

    it('adds Authorization header when URL is relative', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      const formData = new FormData();
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { uploadFile } = await importHttp();

      await uploadFile('/api/upload', formData);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer test-token');
    });

    it('skips Authorization for http:// URL', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      const formData = new FormData();
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { uploadFile } = await importHttp();

      await uploadFile('http://cdn.example.com/upload', formData);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBeUndefined();
    });

    it('adds X-Proxy-Target header in dev mode', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      import.meta.env.VITE_BASE_URL = 'https://real-api.com';
      const formData = new FormData();
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { uploadFile } = await importHttp();

      await uploadFile('/api/upload', formData);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Proxy-Target']).toBe('https://real-api.com');
    });

    it('passes through custom headers (except Content-Type)', async () => {
      import.meta.env.DEV = true as any;
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      const formData = new FormData();
      mockFetch.mockResolvedValueOnce(
        mockResponse({ json: { code: 1, text: 'ok' } })
      );
      const { uploadFile } = await importHttp();

      await uploadFile('/api/upload', formData, {
        'X-Request-Id': 'abc-123',
        'Content-Type': 'text/plain',
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Request-Id']).toBe('abc-123');
      expect(options.headers['Content-Type']).toBeUndefined();
    });
  });

  // =========================================================================
  // checkBackendHealth
  // =========================================================================

  describe('checkBackendHealth', () => {
    it('returns true when health endpoint responds ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);
      const { checkBackendHealth } = await importHttp();

      const result = await checkBackendHealth();
      expect(result).toBe(true);
    });

    it('returns false when health endpoint responds not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);
      const { checkBackendHealth } = await importHttp();

      const result = await checkBackendHealth();
      expect(result).toBe(false);
    });

    it('returns false when fetch throws an error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      const { checkBackendHealth } = await importHttp();

      const result = await checkBackendHealth();
      expect(result).toBe(false);
    });

    it('fetches the /health endpoint on the base URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);
      const { checkBackendHealth } = await importHttp();

      await checkBackendHealth();

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8888/health');
      expect(options.method).toBe('GET');
      expect(options.signal).toBeDefined();
    });

    it('uses AbortController with signal for timeout', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);
      const { checkBackendHealth } = await importHttp();

      await checkBackendHealth();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // =========================================================================
  // waitForBackendReady
  // =========================================================================

  describe('waitForBackendReady', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    it('returns true immediately when backend is ready on first check', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);
      const { waitForBackendReady } = await importHttp();

      const result = await waitForBackendReady(10000, 500);
      expect(result).toBe(true);
    });

    it('retries and returns true when backend becomes ready', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Not ready'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response);
      const { waitForBackendReady } = await importHttp();

      const resultPromise = waitForBackendReady(10000, 100);
      await vi.advanceTimersByTimeAsync(200);
      const result = await resultPromise;

      expect(result).toBe(true);
    });

    it('returns false when backend never becomes ready within timeout', async () => {
      mockFetch.mockRejectedValue(new Error('Not ready'));
      const { waitForBackendReady } = await importHttp();

      const resultPromise = waitForBackendReady(500, 100);
      await vi.advanceTimersByTimeAsync(600);
      const result = await resultPromise;

      expect(result).toBe(false);
    });

    it('uses default maxWaitMs of 10000 and retryIntervalMs of 500', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);
      const { waitForBackendReady } = await importHttp();

      // Should succeed immediately with defaults
      const result = await waitForBackendReady();
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // checkLocalServerStale
  // =========================================================================

  describe('checkLocalServerStale', () => {
    it('skips check when EXPECTED_SERVER_HASH is empty', async () => {
      import.meta.env.VITE_SERVER_CODE_HASH = '';
      import.meta.env.VITE_USE_LOCAL_PROXY = 'true';
      const { checkLocalServerStale } = await importHttp();

      await checkLocalServerStale();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips check when VITE_USE_LOCAL_PROXY is not true', async () => {
      import.meta.env.VITE_SERVER_CODE_HASH = 'abc123';
      import.meta.env.VITE_USE_LOCAL_PROXY = 'false';
      const { checkLocalServerStale } = await importHttp();

      await checkLocalServerStale();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does nothing when server hash matches expected', async () => {
      import.meta.env.VITE_SERVER_CODE_HASH = 'abc123';
      import.meta.env.VITE_USE_LOCAL_PROXY = 'true';
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ server_hash: 'abc123' }),
      } as unknown as Response);
      const { checkLocalServerStale } = await importHttp();

      await checkLocalServerStale();
      expect(mockToast.warning).not.toHaveBeenCalled();
    });

    it('shows warning toast when server hash differs from expected', async () => {
      import.meta.env.VITE_SERVER_CODE_HASH = 'abc123';
      import.meta.env.VITE_USE_LOCAL_PROXY = 'true';
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ server_hash: 'def456' }),
      } as unknown as Response);
      const { checkLocalServerStale } = await importHttp();

      await checkLocalServerStale();
      expect(mockToast.warning).toHaveBeenCalledWith(
        'Server code has been updated',
        expect.objectContaining({
          description: expect.stringContaining('restart'),
          duration: Infinity,
          closeButton: true,
        })
      );
    });

    it('shows warning toast when /health returns 404', async () => {
      import.meta.env.VITE_SERVER_CODE_HASH = 'abc123';
      import.meta.env.VITE_USE_LOCAL_PROXY = 'true';
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      } as unknown as Response);
      const { checkLocalServerStale } = await importHttp();

      await checkLocalServerStale();
      expect(mockToast.warning).toHaveBeenCalledWith(
        'Server code has been updated',
        expect.any(Object)
      );
    });

    it('shows warning toast when server does not report server_hash', async () => {
      import.meta.env.VITE_SERVER_CODE_HASH = 'abc123';
      import.meta.env.VITE_USE_LOCAL_PROXY = 'true';
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ status: 'ok' }),
      } as unknown as Response);
      const { checkLocalServerStale } = await importHttp();

      await checkLocalServerStale();
      expect(mockToast.warning).toHaveBeenCalledWith(
        'Server code has been updated',
        expect.any(Object)
      );
    });

    it('does not show toast when server_hash is "unknown"', async () => {
      import.meta.env.VITE_SERVER_CODE_HASH = 'abc123';
      import.meta.env.VITE_USE_LOCAL_PROXY = 'true';
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ server_hash: 'unknown' }),
      } as unknown as Response);
      const { checkLocalServerStale } = await importHttp();

      await checkLocalServerStale();
      expect(mockToast.warning).not.toHaveBeenCalled();
    });

    it('silently handles fetch errors', async () => {
      import.meta.env.VITE_SERVER_CODE_HASH = 'abc123';
      import.meta.env.VITE_USE_LOCAL_PROXY = 'true';
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      const { checkLocalServerStale } = await importHttp();

      // Should not throw
      await expect(checkLocalServerStale()).resolves.toBeUndefined();
      expect(mockToast.warning).not.toHaveBeenCalled();
    });

    it('does not run check again after first execution', async () => {
      import.meta.env.VITE_SERVER_CODE_HASH = 'abc123';
      import.meta.env.VITE_USE_LOCAL_PROXY = 'true';
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ server_hash: 'abc123' }),
      } as unknown as Response);

      const { checkLocalServerStale } = await importHttp();

      await checkLocalServerStale();
      const callCount = mockFetch.mock.calls.length;

      await checkLocalServerStale();
      expect(mockFetch.mock.calls.length).toBe(callCount);
    });

    it('skips check for other HTTP errors (not 404)', async () => {
      import.meta.env.VITE_SERVER_CODE_HASH = 'abc123';
      import.meta.env.VITE_USE_LOCAL_PROXY = 'true';
      import.meta.env.VITE_PROXY_URL = 'http://localhost:3001';
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
      } as unknown as Response);
      const { checkLocalServerStale } = await importHttp();

      await checkLocalServerStale();
      expect(mockToast.warning).not.toHaveBeenCalled();
    });

    it('uses default proxy URL when VITE_PROXY_URL is not set', async () => {
      import.meta.env.VITE_SERVER_CODE_HASH = 'abc123';
      import.meta.env.VITE_USE_LOCAL_PROXY = 'true';
      import.meta.env.VITE_PROXY_URL = '';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ server_hash: 'abc123' }),
      } as unknown as Response);
      const { checkLocalServerStale } = await importHttp();

      await checkLocalServerStale();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3001/health');
    });
  });
});
