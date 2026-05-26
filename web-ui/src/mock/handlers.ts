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

interface MockEventSourceMessage {
  data: string;
}

export interface MockSSETransportOptions {
  url: string;
  method?: 'GET' | 'POST';
  body?: Record<string, unknown> | string;
  signal?: AbortSignal;
  extraHeaders?: Record<string, string>;
  openWhenHidden?: boolean;
  onmessage: (event: MockEventSourceMessage) => void | Promise<void>;
  onopen?: (response: Response) => void | Promise<void>;
  onerror?: (err: unknown) => number | null | undefined | void;
  onclose?: () => void;
}

import { MOCK_PROVIDERS, MOCK_SUBSCRIPTION, MOCK_USER } from '@web/mock/data';
import {
  appendMockTask,
  createMockHistoryRecord,
  getMockBilling,
  getMockGroupedProjects,
  getMockProfile,
  getMockProjectGroup,
  getMockUser,
  updateMockProfile,
} from '@web/mock/state';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

function matchPath(url: string, pattern: string): boolean {
  if (url === pattern) return true;
  if (pattern.endsWith('*')) {
    return url.startsWith(pattern.slice(0, -1));
  }
  return false;
}

function extractProjectId(url: string): string | null {
  const match = url.match(/\/api\/v1\/chat\/histories\/grouped\/([^/?]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function handleProxyGet(url: string, params?: Record<string, unknown>) {
  const path = url.split('?')[0];

  if (matchPath(path, '/api/v1/chat/histories/grouped')) {
    const projects = getMockGroupedProjects();
    return {
      projects,
      total_projects: projects.length,
      total_tasks: projects.reduce(
        (sum, project) => sum + project.task_count,
        0
      ),
      total_tokens: projects.reduce(
        (sum, project) => sum + project.total_tokens,
        0
      ),
    };
  }

  const projectId = extractProjectId(path);
  if (projectId) {
    return getMockProjectGroup(projectId);
  }

  if (path === '/api/v1/user') {
    return getMockUser();
  }

  if (path === '/api/v1/user/billing-summary') {
    return getMockBilling();
  }

  if (path === '/api/v1/user/key') {
    return { value: MOCK_USER.token };
  }

  if (path === '/api/v1/providers') {
    return { items: MOCK_PROVIDERS };
  }

  if (path === '/api/v1/configs') {
    return [];
  }

  if (path === '/api/v1/subscription') {
    return MOCK_SUBSCRIPTION;
  }

  if (path === '/api/v1/user/current_credits') {
    return { credits: MOCK_USER.credits };
  }

  if (path === '/api/v1/chat/steps') {
    return [];
  }

  if (path === '/api/v1/chat/snapshots') {
    return [];
  }

  if (path.startsWith('/api/v1/chat/share/info/')) {
    return null;
  }

  if (path.startsWith('/api/v1/chat/history/')) {
    return { id: Number(path.split('/').pop()) || 1 };
  }

  console.warn('[web-ui mock] Unhandled GET', path, params);
  return {};
}

async function handleProxyPost(url: string, data?: Record<string, unknown>) {
  const path = url.split('?')[0];

  if (path === '/api/v1/user/auto-login' || path === '/api/v1/user/login') {
    return {
      token: MOCK_USER.token,
      access_token: MOCK_USER.token,
      refresh_token: 'mock-refresh-token',
      token_type: 'bearer',
      email: MOCK_USER.email,
    };
  }

  if (path === '/api/v1/user/refresh') {
    return {
      access_token: MOCK_USER.token,
      refresh_token: 'mock-refresh-token',
      token_type: 'bearer',
      email: MOCK_USER.email,
    };
  }

  if (path === '/api/v1/chat/history') {
    return createMockHistoryRecord();
  }

  if (path === '/api/v1/chat/snapshots') {
    return { id: Date.now() };
  }

  if (path === '/api/v1/user/stat') {
    return { ok: true };
  }

  console.warn('[web-ui mock] Unhandled POST', path, data);
  return {};
}

async function handleProxyPut(url: string, data?: Record<string, unknown>) {
  const path = url.split('?')[0];

  if (path === '/api/v1/user/profile') {
    return updateMockProfile({
      fullname: String(data?.fullname ?? ''),
      nickname: String(data?.nickname ?? ''),
      work_desc: String(data?.work_desc ?? ''),
    });
  }

  if (path.startsWith('/api/v1/chat/history/')) {
    return { ok: true };
  }

  if (path.startsWith('/api/v1/chat/project/') && path.includes('/name')) {
    return { ok: true };
  }

  console.warn('[web-ui mock] Unhandled PUT', path, data);
  return { ok: true };
}

async function handleProxyDelete(url: string) {
  console.warn('[web-ui mock] Unhandled DELETE', url);
  return { ok: true };
}

async function handleBrainGet(url: string, params?: Record<string, unknown>) {
  if (url === '/files') {
    return [];
  }
  console.warn('[web-ui mock] Unhandled brain GET', url, params);
  return {};
}

async function handleBrainPost(url: string, data?: Record<string, unknown>) {
  if (url.startsWith('/task/') && url.endsWith('/start')) {
    return { ok: true };
  }
  console.warn('[web-ui mock] Unhandled brain POST', url, data);
  return { ok: true };
}

async function handleBrainPut(url: string, data?: Record<string, unknown>) {
  if (url.includes('/take-control')) {
    return { ok: true };
  }
  console.warn('[web-ui mock] Unhandled brain PUT', url, data);
  return { ok: true };
}

async function simulateChatStream(options: MockSSETransportOptions) {
  const body =
    typeof options.body === 'string'
      ? JSON.parse(options.body)
      : (options.body as Record<string, unknown> | undefined);

  const question = String(body?.question ?? 'your request');
  const projectId = String(body?.project_id ?? 'mock-project');
  const taskId = String(body?.task_id ?? `mock-task-${Date.now()}`);

  appendMockTask({ projectId, taskId, question });

  const agentReply = `Mock agent response for "${question}". This is local demo data — no server connection was used.`;

  const events = [
    {
      step: 'confirmed',
      data: { question },
    },
    {
      step: 'todo_state',
      data: {
        agent_id: `${taskId}-single-agent`,
        todos: [
          {
            id: 'todo_1',
            content: 'Analyze request',
            active_form: 'Working on your request',
            status: 'in_progress',
          },
        ],
      },
    },
    {
      step: 'wait_confirm',
      data: {
        question,
        content: agentReply,
      },
    },
    {
      step: 'end',
      data: {
        message: '',
        tokens: 24,
      },
    },
  ];

  await options.onopen?.(new Response(null, { status: 200 }));

  for (const event of events) {
    if (options.signal?.aborted) return;
    await delay(350);
    await options.onmessage({ data: JSON.stringify(event) } as never);
  }

  options.onclose?.();
}

export async function mockProxyFetchGet(
  url: string,
  params?: Record<string, unknown>
) {
  await delay(120);
  return handleProxyGet(`${url}${buildQuery(params)}`, params);
}

export async function mockProxyFetchPost(
  url: string,
  data?: Record<string, unknown>
) {
  await delay(120);
  return handleProxyPost(url, data);
}

export async function mockProxyFetchPut(
  url: string,
  data?: Record<string, unknown>
) {
  await delay(80);
  return handleProxyPut(url, data);
}

export async function mockProxyFetchDelete(
  url: string,
  _data?: Record<string, unknown>
) {
  await delay(80);
  return handleProxyDelete(url);
}

export async function mockFetchGet(
  url: string,
  params?: Record<string, unknown>
) {
  await delay(80);
  return handleBrainGet(url, params);
}

export async function mockFetchPost(
  url: string,
  data?: Record<string, unknown>
) {
  await delay(80);
  return handleBrainPost(url, data);
}

export async function mockFetchPut(
  url: string,
  data?: Record<string, unknown>
) {
  await delay(80);
  return handleBrainPut(url, data);
}

export async function mockFetchDelete(
  url: string,
  data?: Record<string, unknown>
) {
  await delay(80);
  console.warn('[web-ui mock] Unhandled brain DELETE', url, data);
  return { ok: true };
}

export async function mockSseTransport(options: MockSSETransportOptions) {
  if (options.url === '/chat' || options.url.endsWith('/chat')) {
    await simulateChatStream(options);
    return;
  }
  console.warn('[web-ui mock] Unhandled SSE', options.url);
  options.onclose?.();
}

export async function mockUploadFileToBrain(file: globalThis.File) {
  await delay(150);
  return {
    file_id: `mock-file-${Date.now()}`,
    filename: file.name,
    size: file.size,
  };
}

export function getMockProfileData() {
  return getMockProfile();
}
