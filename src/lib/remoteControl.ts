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
  getProxyBaseURL,
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPatch,
  proxyFetchPost,
} from '@/api/http';

const DESKTOP_INSTANCE_STORAGE_KEY = 'eigent_desktop_instance_id';
const BRIDGE_READY_EVENT = 'eigent-remote-control-bridge-ready';

let remoteControlBridgeConnected = false;

function randomId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return `${prefix}_${cryptoApi.randomUUID().replaceAll('-', '')}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function getRemoteControlDesktopInstanceId(): string {
  try {
    const existing = localStorage.getItem(DESKTOP_INSTANCE_STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const next = randomId('desk');
    localStorage.setItem(DESKTOP_INSTANCE_STORAGE_KEY, next);
    return next;
  } catch {
    return randomId('desk');
  }
}

export function setRemoteControlBridgeConnected(connected: boolean): void {
  remoteControlBridgeConnected = connected;
  window.dispatchEvent(
    new CustomEvent(BRIDGE_READY_EVENT, { detail: { connected } })
  );
}

export function isRemoteControlBridgeConnected(): boolean {
  return remoteControlBridgeConnected;
}

export function waitForRemoteControlBridgeConnected(
  timeoutMs = 2500
): Promise<boolean> {
  if (remoteControlBridgeConnected) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener(BRIDGE_READY_EVENT, onReady);
      resolve(remoteControlBridgeConnected);
    }, timeoutMs);

    const onReady = (event: Event) => {
      const connected = Boolean((event as CustomEvent).detail?.connected);
      if (!connected) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener(BRIDGE_READY_EVENT, onReady);
      resolve(true);
    };

    window.addEventListener(BRIDGE_READY_EVENT, onReady);
  });
}

export async function getRemoteControlWebSocketUrl(path: string) {
  const base = (await getProxyBaseURL()) || window.location.origin;
  const url = new URL(path, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function getRemoteControlWebOrigin(): string {
  const baseUrl =
    import.meta.env.VITE_PROXY_URL || import.meta.env.VITE_BASE_URL;
  const fallbackBaseUrl =
    typeof baseUrl === 'string' && /^https?:\/\//.test(baseUrl)
      ? baseUrl
      : undefined;
  const origin =
    import.meta.env.VITE_REMOTE_CONTROL_WEB_ORIGIN ||
    import.meta.env.VITE_SITE_URL ||
    import.meta.env.VITE_WEB_APP_ORIGIN ||
    fallbackBaseUrl ||
    window.location.origin;
  return String(origin).replace(/\/$/, '');
}

function normalizeRemoteControlUrl(url: string): string {
  if (url.startsWith('/')) {
    return `${getRemoteControlWebOrigin()}${url}`;
  }
  return url;
}

function remoteLinkHeaders(linkToken?: string | null): Record<string, string> {
  if (!linkToken) {
    return {};
  }
  return { 'X-Remote-Control-Token': linkToken };
}

export interface RemoteControlCreateSessionInput {
  desktop_instance_id: string;
  space_id?: string;
  project_id?: string;
  active_task_id?: string;
  brain_session_id?: string;
  initial_project_id?: string;
  initial_task_id?: string;
  initial_history_id?: string;
  title?: string;
  expires_in_seconds?: number;
}

export interface RemoteControlCreateSessionOutput {
  session_id: string;
  url: string;
  expires_at: string;
  bridge_status: string;
  space_id?: string | null;
  space_name?: string | null;
  current_project_id?: string | null;
  current_task_id?: string | null;
  current_history_id?: string | null;
  current_brain_session_id?: string | null;
}

export interface RemoteControlSession {
  session_id: string;
  desktop_instance_id?: string;
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
}

export interface RemoteControlStep {
  step_id: number;
  task_id: string;
  project_id?: string | null;
  step: string;
  data: unknown;
  timestamp?: number | null;
}

export interface RemoteControlCommandResponse {
  command_id: string;
  status: string;
  next_task_id?: string | null;
}

export async function createRemoteControlSession(
  input: RemoteControlCreateSessionInput
): Promise<RemoteControlCreateSessionOutput> {
  const res = await proxyFetchPost('/api/v1/remote-control/sessions', input);
  return { ...res, url: normalizeRemoteControlUrl(res.url) };
}

export async function getRemoteControlSession(
  sessionId: string,
  linkToken: string
): Promise<RemoteControlSession> {
  return proxyFetchGet(
    `/api/v1/remote-control/sessions/${sessionId}`,
    undefined,
    remoteLinkHeaders(linkToken)
  );
}

export async function extendRemoteControlSession(
  sessionId: string,
  extendSeconds: number,
  linkToken?: string | null
): Promise<{ expires_at: string }> {
  return proxyFetchPost(
    `/api/v1/remote-control/sessions/${sessionId}/extend`,
    {
      extend_seconds: extendSeconds,
    },
    remoteLinkHeaders(linkToken)
  );
}

export async function revokeRemoteControlSession(
  sessionId: string,
  linkToken?: string | null
): Promise<void> {
  await proxyFetchDelete(
    `/api/v1/remote-control/sessions/${sessionId}`,
    undefined,
    remoteLinkHeaders(linkToken)
  );
}

export async function listRemoteControlSteps(
  sessionId: string,
  linkToken: string,
  since = 0,
  limit = 200,
  projectId?: string | null
): Promise<{
  items: RemoteControlStep[];
  has_more: boolean;
  next_since: number;
}> {
  return proxyFetchGet(
    `/api/v1/remote-control/sessions/${sessionId}/steps`,
    {
      ...(projectId ? { project_id: projectId } : {}),
      since,
      limit,
      order: 'asc',
    },
    remoteLinkHeaders(linkToken)
  );
}

export async function sendRemoteControlCommand(
  sessionId: string,
  type: string,
  payload: Record<string, unknown>,
  target?: {
    project_id?: string | null;
    task_id?: string | null;
    brain_session_id?: string | null;
  },
  linkToken?: string | null
): Promise<RemoteControlCommandResponse> {
  return proxyFetchPost(
    `/api/v1/remote-control/sessions/${sessionId}/commands`,
    {
      type,
      payload,
      source_channel: 'remote_web',
      target_project_id: target?.project_id,
      target_task_id: target?.task_id,
      target_brain_session_id: target?.brain_session_id,
    },
    remoteLinkHeaders(linkToken)
  );
}

export async function patchRemoteControlTarget(
  sessionId: string,
  input: {
    project_id: string;
    task_id?: string | null;
    history_id?: string | null;
  },
  linkToken?: string | null
): Promise<{
  current_project_id: string;
  current_task_id?: string | null;
  current_history_id?: string | null;
  current_brain_session_id: string;
}> {
  return proxyFetchPatch(
    `/api/v1/remote-control/sessions/${sessionId}/target`,
    input,
    remoteLinkHeaders(linkToken)
  );
}
