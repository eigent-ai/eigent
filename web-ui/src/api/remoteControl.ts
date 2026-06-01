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

const REMOTE_TOKEN_HEADER = 'X-Remote-Control-Token';

export class RemoteControlError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly payload: unknown;
  constructor(
    status: number,
    message: string,
    code: string | null,
    payload: unknown
  ) {
    super(message);
    this.name = 'RemoteControlError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

function extractErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, any>;
  const detail = record.detail;
  if (detail && typeof detail === 'object' && typeof detail.code === 'string') {
    return detail.code;
  }
  if (typeof record.code === 'string') {
    return record.code;
  }
  return null;
}

export type RemoteControlSession = {
  session_id: string;
  desktop_instance_id: string;
  space_id?: string | null;
  space_name?: string | null;
  project_id?: string | null;
  active_task_id?: string | null;
  brain_session_id?: string | null;
  current_project_id?: string | null;
  current_task_id?: string | null;
  current_history_id?: string | null;
  current_brain_session_id?: string | null;
  title: string;
  status: string;
  bridge_status: 'online' | 'offline' | string;
  execution_mode: string;
  capabilities: Record<string, unknown>;
  created_at: string | null;
  expires_at: string;
};

export type RemoteControlSpace = {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  source_type: 'blank' | 'folder' | 'legacy' | string;
  root_path?: string | null;
  status: string;
  schema_version: number;
  metadata?: Record<string, unknown> | null;
};

export type RemoteControlProject = {
  id: string;
  user_id: string;
  space_id: string;
  name: string;
  description?: string | null;
  mode?: 'single-agent' | 'workforce' | string | null;
  status: string;
  workdir_mode?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type RemoteControlOverlay = {
  id: number;
  space_id: string;
  project_id: string;
  run_id: string;
  path: string;
  status: string;
  hash?: string | null;
  base_hash?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type RemoteControlTarget = {
  project_id: string | null;
  task_id: string | null;
  brain_session_id: string | null;
};

export type ReadyRemoteControlTarget = {
  project_id: string;
  task_id: string | null;
  brain_session_id: string;
};

export type RemoteControlStep = {
  step_id: number;
  task_id: string;
  project_id?: string | null;
  step: string;
  data: unknown;
  timestamp?: number | null;
};

export type RemoteControlCommandResponse = {
  command_id: string;
  status: string;
  next_task_id?: string | null;
};

type RemoteFetchOptions = {
  method?: string;
  token: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | null | undefined>;
};

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

function shouldUseAbsoluteApiOrigin(): boolean {
  return import.meta.env.VITE_USE_LOCAL_PROXY === 'false';
}

function apiOriginForHttp(): string {
  const proxyUrl = import.meta.env.VITE_PROXY_URL;
  if (shouldUseAbsoluteApiOrigin() && isHttpUrl(proxyUrl)) {
    return stripTrailingSlash(proxyUrl);
  }
  return window.location.origin;
}

function apiOriginForWebSocket(): string {
  const proxyUrl = import.meta.env.VITE_PROXY_URL;
  if (shouldUseAbsoluteApiOrigin() && isHttpUrl(proxyUrl)) {
    return stripTrailingSlash(proxyUrl);
  }
  return window.location.origin;
}

function buildApiUrl(
  path: string,
  params?: RemoteFetchOptions['params']
): string {
  const url = new URL(path, apiOriginForHttp());
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function describeRemoteError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, any>;
    const detail = record.detail;
    if (typeof detail === 'string') {
      return detail;
    }
    if (detail && typeof detail === 'object') {
      return String(detail.message || detail.code || JSON.stringify(detail));
    }
    return String(record.message || record.error || fallback);
  }
  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }
  return fallback;
}

async function remoteFetch<T>(
  path: string,
  { method = 'GET', token, body, params }: RemoteFetchOptions
): Promise<T> {
  const response = await fetch(buildApiUrl(path, params), {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      [REMOTE_TOKEN_HEADER]: token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');
  if (!response.ok) {
    throw new RemoteControlError(
      response.status,
      describeRemoteError(payload, `HTTP ${response.status}`),
      extractErrorCode(payload),
      payload
    );
  }
  return payload as T;
}

export function getRemoteControlTarget(
  session: RemoteControlSession
): RemoteControlTarget {
  return {
    project_id: session.current_project_id || session.project_id || null,
    task_id: session.current_task_id || session.active_task_id || null,
    brain_session_id:
      session.current_brain_session_id || session.brain_session_id || null,
  };
}

export function isRemoteControlTargetReady(
  target: RemoteControlTarget | null
): target is ReadyRemoteControlTarget {
  return Boolean(target?.project_id && target?.brain_session_id);
}

export function getRemoteControlEventSocketUrl(sessionId: string): string {
  const url = new URL(
    `/api/v1/remote-control/sessions/${encodeURIComponent(
      sessionId
    )}/events/subscribe`,
    apiOriginForWebSocket()
  );
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function getRemoteControlSession(
  sessionId: string,
  token: string
): Promise<RemoteControlSession> {
  return remoteFetch(`/api/v1/remote-control/sessions/${sessionId}`, {
    token,
  });
}

export function listRemoteControlProjects(
  sessionId: string,
  token: string
): Promise<{ space: RemoteControlSpace; items: RemoteControlProject[] }> {
  return remoteFetch(`/api/v1/remote-control/sessions/${sessionId}/projects`, {
    token,
  });
}

export function createRemoteControlProject(
  sessionId: string,
  token: string,
  input: {
    name: string;
    description?: string;
    mode?: 'single-agent' | 'workforce';
  }
): Promise<RemoteControlProject> {
  return remoteFetch(`/api/v1/remote-control/sessions/${sessionId}/projects`, {
    token,
    method: 'POST',
    body: {
      mode: 'single-agent',
      ...input,
    },
  });
}

export function listRemoteControlSteps(
  sessionId: string,
  token: string,
  projectId: string | null,
  since = 0,
  limit = 200
): Promise<{
  items: RemoteControlStep[];
  has_more: boolean;
  next_since: number;
}> {
  return remoteFetch(`/api/v1/remote-control/sessions/${sessionId}/steps`, {
    token,
    params: {
      ...(projectId ? { project_id: projectId } : {}),
      since,
      limit,
      order: 'asc',
    },
  });
}

export function sendRemoteControlCommand(
  sessionId: string,
  token: string,
  type: string,
  payload: Record<string, unknown>,
  target?: RemoteControlTarget | null
): Promise<RemoteControlCommandResponse> {
  return remoteFetch(`/api/v1/remote-control/sessions/${sessionId}/commands`, {
    token,
    method: 'POST',
    body: {
      source_channel: 'remote_web',
      type,
      payload,
      target_project_id: target?.project_id,
      target_task_id: target?.task_id,
      target_brain_session_id: target?.brain_session_id,
    },
  });
}

export function patchRemoteControlTarget(
  sessionId: string,
  token: string,
  input: {
    project_id: string;
    task_id?: string | null;
    history_id?: string | null;
  }
): Promise<{
  space_id?: string | null;
  current_project_id: string;
  current_task_id?: string | null;
  current_history_id?: string | null;
  current_brain_session_id: string;
  desktop_ready: 'pending' | 'ready' | 'failed';
}> {
  return remoteFetch(`/api/v1/remote-control/sessions/${sessionId}/target`, {
    token,
    method: 'PATCH',
    body: input,
  });
}

export function listRemoteControlOverlays(
  sessionId: string,
  token: string,
  projectId: string,
  runId?: string | null
): Promise<{
  space_id: string;
  project_id: string;
  overlays: RemoteControlOverlay[];
}> {
  return remoteFetch(
    `/api/v1/remote-control/sessions/${sessionId}/projects/${projectId}/overlays`,
    {
      token,
      params: runId ? { run_id: runId } : undefined,
    }
  );
}

export function applyRemoteControlProjectRun(
  sessionId: string,
  token: string,
  projectId: string,
  input: { run_id: string; paths?: string[] | null; confirm: boolean }
): Promise<RemoteControlCommandResponse> {
  return remoteFetch(
    `/api/v1/remote-control/sessions/${sessionId}/projects/${projectId}/apply`,
    {
      token,
      method: 'POST',
      body: input,
    }
  );
}

export function discardRemoteControlProjectOverlays(
  sessionId: string,
  token: string,
  projectId: string,
  input: { run_id?: string | null; paths?: string[] | null; confirm: boolean }
): Promise<RemoteControlCommandResponse> {
  return remoteFetch(
    `/api/v1/remote-control/sessions/${sessionId}/projects/${projectId}/discard`,
    {
      token,
      method: 'POST',
      body: input,
    }
  );
}

export function refreshRemoteControlProject(
  sessionId: string,
  token: string,
  projectId: string,
  input: { force?: boolean } = {}
): Promise<RemoteControlCommandResponse> {
  return remoteFetch(
    `/api/v1/remote-control/sessions/${sessionId}/projects/${projectId}/refresh`,
    {
      token,
      method: 'POST',
      body: input,
    }
  );
}

export function extendRemoteControlSession(
  sessionId: string,
  token: string,
  extendSeconds: number
): Promise<{ expires_at: string }> {
  return remoteFetch(`/api/v1/remote-control/sessions/${sessionId}/extend`, {
    token,
    method: 'POST',
    body: { extend_seconds: extendSeconds },
  });
}

export function revokeRemoteControlSession(
  sessionId: string,
  token: string
): Promise<void> {
  return remoteFetch(`/api/v1/remote-control/sessions/${sessionId}`, {
    token,
    method: 'DELETE',
  });
}
