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

import {
  mockFetchDelete,
  mockFetchGet,
  mockFetchPost,
  mockFetchPut,
  mockProxyFetchDelete,
  mockProxyFetchGet,
  mockProxyFetchPost,
  mockProxyFetchPut,
  mockSseTransport,
  mockUploadFileToBrain,
  type MockSSETransportOptions,
} from '@web/mock/handlers';

export function getDefaultBrainEndpoint(): string {
  return 'mock://brain';
}

export function resetBaseURL(): void {
  // no-op in mock mode
}

export async function getBaseURL(): Promise<string> {
  return 'mock://brain';
}

export const fetchGet = mockFetchGet;
export const fetchPost = mockFetchPost;
export const fetchPut = mockFetchPut;
export const fetchDelete = mockFetchDelete;

export async function fetchPostForm(
  url: string,
  formData: FormData
): Promise<unknown> {
  const file = formData.get('file');
  if (file instanceof File) {
    return mockUploadFileToBrain(file);
  }
  return { ok: true, url };
}

export const uploadFileToBrain = mockUploadFileToBrain;

export async function sseTransport(
  options: MockSSETransportOptions
): Promise<void> {
  return mockSseTransport(options);
}

export const proxyFetchGet = mockProxyFetchGet;
export const proxyFetchPost = mockProxyFetchPost;
export const proxyFetchPut = mockProxyFetchPut;
export const proxyFetchDelete = mockProxyFetchDelete;

export async function uploadFile(
  url: string,
  formData: FormData
): Promise<unknown> {
  return fetchPostForm(url, formData);
}

export async function checkBackendHealth(): Promise<boolean> {
  return true;
}

export async function checkLocalServerStale(): Promise<void> {
  // no-op
}

export async function waitForBackendReady(): Promise<boolean> {
  return true;
}

export type SSETransportOptions = MockSSETransportOptions;
