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

import { showCreditsToast } from '@/components/Toast/creditsToast';
import { showStorageToast } from '@/components/Toast/storageToast';
import { showTrafficToast } from '@/components/Toast/trafficToast';
import { getAuthStore } from '@/store/authStore';
import {
  getConnectionConfig,
  setConnectionConfig,
} from '@/store/connectionStore';
import {
  EventSourceMessage,
  fetchEventSource,
} from '@microsoft/fetch-event-source';

const defaultHeaders = {
  'Content-Type': 'application/json',
};

export function getDefaultBrainEndpoint(): string {
  const envEndpoint = import.meta.env.VITE_BRAIN_ENDPOINT;
  if (envEndpoint && typeof envEndpoint === 'string') {
    return envEndpoint.replace(/\/$/, '');
  }
  if (import.meta.env.DEV) {
    return 'http://localhost:5001';
  }
  return '';
}

function persistSessionIdFromResponse(response: Response): void {
  const sessionId = response.headers.get('x-session-id');
  if (!sessionId) {
    return;
  }
  const current = getConnectionConfig().sessionId;
  if (current !== sessionId) {
    setConnectionConfig({ sessionId });
  }
}

function shouldAttachAuthHeader(url: string): boolean {
  return !url.includes('http://') && !url.includes('https://');
}

function buildBrainHeaders(
  url: string,
  customHeaders: Record<string, string> = {},
  includeContentType = true
): Record<string, string> {
  const { token } = getAuthStore();
  const conn = getConnectionConfig();
  const headers: Record<string, string> = {
    ...(includeContentType ? defaultHeaders : {}),
    'X-Channel': conn.channel,
    ...customHeaders,
  };
  if (conn.sessionId) {
    headers['X-Session-ID'] = conn.sessionId;
  }
  if (token && shouldAttachAuthHeader(url)) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/** Reset cached baseUrl (e.g. when backend restarts). */
export function resetBaseURL(): void {
  setConnectionConfig({ brainEndpoint: '' });
}

export async function getBaseURL() {
  const cfg = getConnectionConfig();
  if (cfg.brainEndpoint) {
    return cfg.brainEndpoint.replace(/\/$/, '');
  }
  // Electron: get port from IPC
  const port = await (window as any).ipcRenderer?.invoke('get-backend-port');
  if (port && port > 0) {
    const resolved = `http://localhost:${port}`;
    setConnectionConfig({ brainEndpoint: resolved });
    return resolved;
  }
  // Pure Web: use VITE_BRAIN_ENDPOINT (dev default http://localhost:5001)
  const envEndpoint = getDefaultBrainEndpoint();
  if (envEndpoint && typeof envEndpoint === 'string') {
    const resolved = envEndpoint.replace(/\/$/, ''); // trim trailing slash
    setConnectionConfig({ brainEndpoint: resolved });
    return resolved;
  }
  return '';
}

async function fetchRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  data?: Record<string, any>,
  customHeaders: Record<string, string> = {}
): Promise<any> {
  const baseURL = await getBaseURL();
  const fullUrl = `${baseURL}${url}`;
  const headers = buildBrainHeaders(url, customHeaders);

  const options: RequestInit = {
    method,
    headers,
  };

  if (method === 'GET') {
    const query = data
      ? '?' +
        Object.entries(data)
          .map(
            ([key, val]) =>
              `${encodeURIComponent(key)}=${encodeURIComponent(val)}`
          )
          .join('&')
      : '';
    return handleResponse(fetch(fullUrl + query, options), data);
  }

  if (data) {
    options.body = JSON.stringify(data);
  }

  return handleResponse(fetch(fullUrl, options), data);
}

async function handleResponse(
  responsePromise: Promise<Response>,
  requestData?: Record<string, any>
): Promise<any> {
  try {
    const res = await responsePromise;
    persistSessionIdFromResponse(res);
    if (res.status === 204) {
      return { code: 0, text: '' };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const msg = detail?.trim() || `HTTP ${res.status}`;
        const err = new Error(msg);
        (err as any).status = res.status;
        (err as any).response = res;
        throw err;
      }
      if (res.body) {
        return {
          isStream: true,
          body: res.body,
          reader: res.body.getReader(),
        };
      }
      return null;
    }
    const resData = await res.json();
    if (!resData) {
      return null;
    }
    const { code, text } = resData;
    // showCreditsToast()
    if (code === 1 || code === 300) {
      return resData;
    }

    if (code === 20) {
      showCreditsToast();
      return resData;
    }

    if (code === 21) {
      showStorageToast();
      return resData;
    }

    if (code === 13) {
      // const { logout } = getAuthStore()
      // logout()
      // window.location.href = '#/login'
      throw new Error(text);
    }

    if (!res.ok) {
      const detail = resData?.detail;
      const msg =
        (Array.isArray(detail) ? detail[0] : detail) ||
        resData?.message ||
        `HTTP ${res.status}`;
      const err: any = new Error(typeof msg === 'string' ? msg : String(msg));
      err.status = res.status;
      err.response = { data: resData, status: res.status };
      throw err;
    }

    return resData;
  } catch (err: any) {
    // Only show traffic toast for cloud model requests
    const isCloudRequest = requestData?.api_url === 'cloud';
    if (isCloudRequest) {
      showTrafficToast();
    }

    console.error('[fetch error]:', err);

    if (err?.response?.status === 401) {
      // const { logout } = getAuthStore()
      // logout()
      // window.location.href = '#/login'
    }

    throw err;
  }
}

// Encapsulate common methods
export const fetchGet = (url: string, params?: any, headers?: any) =>
  fetchRequest('GET', url, params, headers);

export const fetchPost = (url: string, data?: any, headers?: any) =>
  fetchRequest('POST', url, data, headers);

export const fetchPut = (url: string, data?: any, headers?: any) =>
  fetchRequest('PUT', url, data, headers);

export const fetchDelete = (url: string, data?: any, headers?: any) =>
  fetchRequest('DELETE', url, data, headers);

/** POST FormData to Brain base URL (for file uploads). */
export async function fetchPostForm(
  url: string,
  formData: FormData,
  customHeaders: Record<string, string> = {}
): Promise<any> {
  const baseURL = await getBaseURL();
  const fullUrl = `${baseURL}${url}`;
  const headers = buildBrainHeaders(url, customHeaders, false);
  return handleResponse(
    fetch(fullUrl, { method: 'POST', headers, body: formData })
  );
}

export async function uploadFileToBrain(file: globalThis.File): Promise<{
  file_id: string;
  filename: string;
  size: number;
}> {
  const formData = new FormData();
  formData.append('file', file);
  return fetchPostForm('/files', formData);
}

export interface SSETransportOptions {
  url: string;
  method?: 'GET' | 'POST';
  body?: Record<string, any> | string;
  signal?: AbortSignal;
  extraHeaders?: Record<string, string>;
  openWhenHidden?: boolean;
  onmessage: (event: EventSourceMessage) => void | Promise<void>;
  onopen?: (response: Response) => void | Promise<void>;
  onerror?: (err: any) => number | null | undefined | void;
  onclose?: () => void;
}

export async function sseTransport(
  options: SSETransportOptions
): Promise<void> {
  const baseURL = await getBaseURL();
  const fullUrl =
    options.url.startsWith('http://') || options.url.startsWith('https://')
      ? options.url
      : `${baseURL}${options.url}`;

  const headers = buildBrainHeaders(options.url, options.extraHeaders);
  const body =
    typeof options.body === 'string'
      ? options.body
      : options.body
        ? JSON.stringify(options.body)
        : undefined;

  await fetchEventSource(fullUrl, {
    method: options.method || 'POST',
    openWhenHidden: options.openWhenHidden ?? true,
    signal: options.signal,
    headers,
    body,
    onmessage: options.onmessage,
    async onopen(response) {
      persistSessionIdFromResponse(response);
      if (options.onopen) {
        await options.onopen(response);
      }
    },
    onerror: options.onerror,
    onclose: options.onclose,
  });
}

// =============== porxy ===============

// get proxy base URL
async function getProxyBaseURL() {
  const isDev = import.meta.env.DEV;

  if (isDev) {
    // Use empty base so request goes to same origin; Vite proxy forwards /api to VITE_PROXY_URL
    // This avoids CORS when running dev:web (browser at 5173, server at 3001)
    return '';
  } else {
    const baseUrl = import.meta.env.VITE_BASE_URL;
    if (!baseUrl) {
      throw new Error('VITE_BASE_URL not configured');
    }
    return baseUrl;
  }
}

async function proxyFetchRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  data?: Record<string, any>,
  customHeaders: Record<string, string> = {}
): Promise<any> {
  const baseURL = await getProxyBaseURL();
  const fullUrl = `${baseURL}${url}`;
  const { token } = getAuthStore();

  const headers: Record<string, string> = {
    ...defaultHeaders,
    ...customHeaders,
  };

  if (!url.includes('http://') && !url.includes('https://') && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (import.meta.env.DEV) {
    const targetUrl = import.meta.env.VITE_BASE_URL;
    if (targetUrl) {
      headers['X-Proxy-Target'] = targetUrl;
    }
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (method === 'GET') {
    const query = data
      ? '?' +
        Object.entries(data)
          .map(
            ([key, val]) =>
              `${encodeURIComponent(key)}=${encodeURIComponent(val)}`
          )
          .join('&')
      : '';
    return handleResponse(fetch(fullUrl + query, options));
  }

  if (data) {
    options.body = JSON.stringify(data);
  }

  return handleResponse(fetch(fullUrl, options));
}

export const proxyFetchGet = (url: string, params?: any, headers?: any) =>
  proxyFetchRequest('GET', url, params, headers);

export const proxyFetchPost = (url: string, data?: any, headers?: any) =>
  proxyFetchRequest('POST', url, data, headers);

export const proxyFetchPut = (url: string, data?: any, headers?: any) =>
  proxyFetchRequest('PUT', url, data, headers);

export const proxyFetchDelete = (url: string, data?: any, headers?: any) =>
  proxyFetchRequest('DELETE', url, data, headers);

// File upload function with FormData
export async function uploadFile(
  url: string,
  formData: FormData,
  headers?: Record<string, string>
): Promise<any> {
  const baseURL = await getProxyBaseURL();
  const fullUrl = `${baseURL}${url}`;
  const { token } = getAuthStore();

  const requestHeaders: Record<string, string> = {
    ...headers,
  };

  // Remove Content-Type header to let browser set it with boundary for FormData
  if (requestHeaders['Content-Type']) {
    delete requestHeaders['Content-Type'];
  }

  if (!url.includes('http://') && !url.includes('https://') && token) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  if (import.meta.env.DEV) {
    const targetUrl = import.meta.env.VITE_BASE_URL;
    if (targetUrl) {
      requestHeaders['X-Proxy-Target'] = targetUrl;
    }
  }

  const options: RequestInit = {
    method: 'POST',
    headers: requestHeaders,
    body: formData,
  };

  return handleResponse(fetch(fullUrl, options));
}

// =============== Backend Health Check ===============

/**
 * Check if backend is ready by checking the health endpoint
 * @returns Promise<boolean> - true if backend is ready, false otherwise
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const baseURL = await getBaseURL();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);

    const res = await fetch(`${baseURL}/health`, {
      signal: controller.signal,
      method: 'GET',
    });

    clearTimeout(timeoutId);
    return res.ok;
  } catch (error) {
    console.log('[Backend Health Check] Not ready:', error);
    return false;
  }
}

// =============== Local Server Stale Detection ===============

/**
 * Git hash of the last commit that touched server/, injected by Vite at build
 * time. When the running server reports a different hash it means the server
 * process is stale and needs to be restarted / rebuilt.
 */
const EXPECTED_SERVER_HASH: string =
  import.meta.env.VITE_SERVER_CODE_HASH || '';

let serverStaleChecked = false;

/**
 * One-time check: when VITE_USE_LOCAL_PROXY is enabled, fetch the local
 * server's /health and compare its server_hash against the expected hash
 * baked into this build. Shows a persistent toast if they differ.
 */
export async function checkLocalServerStale(): Promise<void> {
  if (serverStaleChecked || !EXPECTED_SERVER_HASH) return;
  serverStaleChecked = true;

  const useLocalProxy = import.meta.env.VITE_USE_LOCAL_PROXY === 'true';
  if (!useLocalProxy) return;

  const serverUrl = import.meta.env.VITE_PROXY_URL || 'http://localhost:3001';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${serverUrl}/health`, {
      signal: controller.signal,
      method: 'GET',
    });

    clearTimeout(timeoutId);

    let staleReason = '';

    if (res.status === 404) {
      // /health endpoint doesn't exist — server predates v0.0.89
      staleReason = 'Server does not have /health endpoint (pre-v0.0.89)';
    } else if (res.ok) {
      const data = await res.json();
      const serverHash: string | undefined = data?.server_hash;

      if (!serverHash) {
        staleReason = 'Server does not report version info (pre-v0.0.89)';
      } else if (
        serverHash !== 'unknown' &&
        serverHash !== EXPECTED_SERVER_HASH
      ) {
        staleReason = `Server hash ${serverHash} != expected ${EXPECTED_SERVER_HASH}`;
      }
    } else {
      // Other HTTP errors — skip
      return;
    }

    if (staleReason) {
      const { toast } = await import('sonner');
      toast.warning('Server code has been updated', {
        description:
          'Server is outdated. Please restart it or rebuild: docker-compose up --build -d',
        duration: Infinity,
        closeButton: true,
      });
      console.warn(`[Server Check] ${staleReason}. Please restart the server.`);
    }
  } catch {
    // server not reachable — skip silently
  }
}

/**
 * Simple backend health check with retries
 * @param maxWaitMs - Maximum time to wait in milliseconds (default: 10000ms)
 * @param retryIntervalMs - Interval between retries in milliseconds (default: 500ms)
 * @returns Promise<boolean> - true if backend becomes ready, false if timeout
 */
export async function waitForBackendReady(
  maxWaitMs: number = 10000,
  retryIntervalMs: number = 500
): Promise<boolean> {
  const startTime = Date.now();
  console.log('[Backend Health Check] Waiting for backend to be ready...');

  while (Date.now() - startTime < maxWaitMs) {
    const isReady = await checkBackendHealth();

    if (isReady) {
      console.log(
        `[Backend Health Check] Backend is ready after ${Date.now() - startTime}ms`
      );

      // Fire-and-forget: check local server version when using local proxy
      checkLocalServerStale();

      return true;
    }

    console.log(
      `[Backend Health Check] Backend not ready, retrying... (${Date.now() - startTime}ms elapsed)`
    );
    await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
  }

  console.error(
    `[Backend Health Check] Backend failed to start within ${maxWaitMs}ms`
  );
  return false;
}
