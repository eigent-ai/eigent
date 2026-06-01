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

import { getAuthStore } from '@/store/authStore';
import {
  EventSourceMessage,
  fetchEventSource,
} from '@microsoft/fetch-event-source';

const jsonHeaders = {
  'Content-Type': 'application/json',
};

function trimSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//.test(url);
}

export function getDefaultBrainEndpoint(): string {
  const endpoint = import.meta.env.VITE_BRAIN_ENDPOINT;
  if (typeof endpoint === 'string' && endpoint.trim()) {
    return trimSlash(endpoint);
  }
  return import.meta.env.DEV ? 'http://localhost:5001' : '';
}

export function resetBaseURL(): void {
  // no cached base URL in the standalone web UI
}

export async function getBaseURL(): Promise<string> {
  return getDefaultBrainEndpoint();
}

async function getProxyBaseURL(): Promise<string> {
  if (import.meta.env.DEV) {
    return '';
  }
  const useLocalProxy = import.meta.env.VITE_USE_LOCAL_PROXY === 'true';
  const proxyUrl = import.meta.env.VITE_PROXY_URL;
  const baseUrl =
    !useLocalProxy && proxyUrl
      ? proxyUrl
      : import.meta.env.VITE_BASE_URL || proxyUrl || '';
  return baseUrl ? trimSlash(String(baseUrl)) : '';
}

function appendQuery(url: string, params?: Record<string, unknown>): string {
  if (!params) return url;
  const next = new URL(url, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      next.searchParams.set(key, String(value));
    }
  });
  return next.pathname + next.search + next.hash;
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return { code: 0, text: '' };
  }
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object'
        ? ((payload as { detail?: string; message?: string }).detail ??
          (payload as { message?: string }).message ??
          `HTTP ${response.status}`)
        : String(payload || `HTTP ${response.status}`);
    const error = new Error(message);
    (error as Error & { status?: number; response?: Response }).status =
      response.status;
    (error as Error & { status?: number; response?: Response }).response =
      response;
    throw error;
  }
  return payload;
}

function authHeaders(
  url: string,
  customHeaders: Record<string, string> = {},
  includeContentType = true
): Record<string, string> {
  const { token, user_id } = getAuthStore();
  const headers: Record<string, string> = {
    ...(includeContentType ? jsonHeaders : {}),
    ...customHeaders,
  };
  if (!isAbsoluteUrl(url) && token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (user_id != null) {
    headers['X-User-ID'] = String(user_id);
  }
  return headers;
}

async function request(
  base: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  data?: Record<string, unknown>,
  headers?: Record<string, string>
) {
  const fullUrl = isAbsoluteUrl(url)
    ? url
    : `${base}${method === 'GET' ? appendQuery(url, data) : url}`;
  const response = await fetch(fullUrl, {
    method,
    headers: authHeaders(url, headers),
    body:
      method === 'GET' || data === undefined ? undefined : JSON.stringify(data),
  });
  return parseResponse(response);
}

async function brainRequest(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  data?: Record<string, unknown>,
  headers?: Record<string, string>
) {
  return request(await getBaseURL(), method, url, data, headers);
}

async function proxyRequest(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  data?: Record<string, unknown>,
  headers?: Record<string, string>
) {
  return request(await getProxyBaseURL(), method, url, data, headers);
}

export const fetchGet = (url: string, params?: any, headers?: any) =>
  brainRequest('GET', url, params, headers);
export const fetchPost = (url: string, data?: any, headers?: any) =>
  brainRequest('POST', url, data, headers);
export const fetchPut = (url: string, data?: any, headers?: any) =>
  brainRequest('PUT', url, data, headers);
export const fetchPatch = (url: string, data?: any, headers?: any) =>
  brainRequest('PATCH', url, data, headers);
export const fetchDelete = (url: string, data?: any, headers?: any) =>
  brainRequest('DELETE', url, data, headers);

export const proxyFetchGet = (url: string, params?: any, headers?: any) =>
  proxyRequest('GET', url, params, headers);
export const proxyFetchPost = (url: string, data?: any, headers?: any) =>
  proxyRequest('POST', url, data, headers);
export const proxyFetchPut = (url: string, data?: any, headers?: any) =>
  proxyRequest('PUT', url, data, headers);
export const proxyFetchPatch = (url: string, data?: any, headers?: any) =>
  proxyRequest('PATCH', url, data, headers);
export const proxyFetchDelete = (url: string, data?: any, headers?: any) =>
  proxyRequest('DELETE', url, data, headers);

export async function fetchPostForm(
  url: string,
  formData: FormData,
  customHeaders: Record<string, string> = {}
) {
  const response = await fetch(`${await getBaseURL()}${url}`, {
    method: 'POST',
    headers: authHeaders(url, customHeaders, false),
    body: formData,
  });
  return parseResponse(response);
}

export async function uploadFileToBrain(file: globalThis.File): Promise<{
  file_id: string;
  filename: string;
  size: number;
}> {
  const formData = new FormData();
  formData.append('file', file);
  return fetchPostForm('/files', formData) as Promise<{
    file_id: string;
    filename: string;
    size: number;
  }>;
}

export async function uploadFile(url: string, formData: FormData) {
  return fetchPostForm(url, formData);
}

export interface SSETransportOptions {
  url: string;
  method?: 'GET' | 'POST';
  body?: Record<string, unknown> | string;
  signal?: AbortSignal;
  extraHeaders?: Record<string, string>;
  openWhenHidden?: boolean;
  onmessage: (event: EventSourceMessage) => void | Promise<void>;
  onopen?: (response: Response) => void | Promise<void>;
  onerror?: (err: unknown) => number | null | undefined | void;
  onclose?: () => void;
}

export async function sseTransport(
  options: SSETransportOptions
): Promise<void> {
  const fullUrl = isAbsoluteUrl(options.url)
    ? options.url
    : `${await getBaseURL()}${options.url}`;
  await fetchEventSource(fullUrl, {
    method: options.method ?? 'POST',
    openWhenHidden: options.openWhenHidden ?? true,
    signal: options.signal,
    headers: authHeaders(options.url, options.extraHeaders),
    body:
      typeof options.body === 'string'
        ? options.body
        : options.body
          ? JSON.stringify(options.body)
          : undefined,
    onmessage: options.onmessage,
    onopen: options.onopen
      ? async (response) => {
          await options.onopen?.(response);
        }
      : undefined,
    onerror: options.onerror,
    onclose: options.onclose,
  });
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${await getBaseURL()}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function checkLocalServerStale(): Promise<void> {
  // no-op in the standalone web UI
}

export async function waitForBackendReady(): Promise<boolean> {
  return checkBackendHealth();
}
