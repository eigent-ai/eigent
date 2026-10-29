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

import type { AppHost } from '@/host/types';
import type { SessionNavLeadKind } from '@/lib/sessionNavLead';

/**
 * A Session can open in its own window (desktop) or browser tab (web). That
 * window renders only the Session; the main window keeps the sidebar, the
 * Space and every background job.
 */

export const SESSION_WINDOW_PATH_PREFIX = '/session-window/';
export const SESSION_WINDOW_ROUTE = '/session-window/:spaceId/:projectId';

export interface SessionWindowTarget {
  spaceId: string;
  projectId: string;
}

export type SessionControlActionMessage = 'rename' | 'end' | 'delete';

/** Messages between the main window and Session windows. */
export type SessionWindowMessage =
  /** Main window asks every Session window to announce itself. */
  | { type: 'who-is-open' }
  | ({ type: 'opened' } & SessionWindowTarget)
  | ({ type: 'closed' } & SessionWindowTarget)
  /** Show the Session in the main window again. */
  | ({ type: 'open-in-main' } & SessionWindowTarget)
  /** Main window takes the Session back; its window closes. */
  | ({ type: 'close-window' } & SessionWindowTarget)
  /** Main window started a Run for this Session; its window reloads it. */
  | ({ type: 'reload-session' } & SessionWindowTarget)
  /** A Session menu action; the main window owns the confirmation. */
  | ({
      type: 'session-control';
      action: SessionControlActionMessage;
    } & SessionWindowTarget)
  /** Sidebar status of a Session shown in its own window. */
  | ({
      type: 'nav-lead';
      kind: SessionNavLeadKind;
      spin?: boolean;
    } & SessionWindowTarget);

export type SessionWindowRole = 'main' | 'session';

export function sessionWindowPath({ spaceId, projectId }: SessionWindowTarget) {
  return `${SESSION_WINDOW_PATH_PREFIX}${encodeURIComponent(
    spaceId
  )}/${encodeURIComponent(projectId)}`;
}

/** The Session a window shows, read from its route; null in the main window. */
export function parseSessionWindowPath(
  pathname: string
): SessionWindowTarget | null {
  if (!pathname.startsWith(SESSION_WINDOW_PATH_PREFIX)) return null;
  const [spaceId, projectId, ...rest] = pathname
    .slice(SESSION_WINDOW_PATH_PREFIX.length)
    .split('/');
  if (!spaceId || !projectId || rest.some(Boolean)) return null;
  try {
    return {
      spaceId: decodeURIComponent(spaceId),
      projectId: decodeURIComponent(projectId),
    };
  } catch {
    return null;
  }
}

/** Route of this document: the hash route on desktop, the path on the web. */
function currentRoutePath(): string {
  if (typeof window === 'undefined') return '/';
  const hash = window.location.hash;
  if (hash.startsWith('#/')) return hash.slice(1).split('?')[0];
  return window.location.pathname;
}

export function getSessionWindowTarget(): SessionWindowTarget | null {
  return parseSessionWindowPath(currentRoutePath());
}

/** Fixed for the document's life: a window never changes role. */
export function getSessionWindowRole(): SessionWindowRole {
  return getSessionWindowTarget() ? 'session' : 'main';
}

const NAV_LEAD_KINDS = [
  'error',
  'warning',
  'hitl',
  'blocked',
  'splitting',
  'running',
  'finished',
  'idle',
];

const isTarget = (value: Record<string, unknown>) =>
  typeof value.spaceId === 'string' && typeof value.projectId === 'string';

function isSessionWindowMessage(value: unknown): value is SessionWindowMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'who-is-open':
      return true;
    case 'opened':
    case 'closed':
    case 'open-in-main':
    case 'close-window':
    case 'reload-session':
      return isTarget(message);
    case 'session-control':
      return (
        isTarget(message) &&
        ['rename', 'end', 'delete'].includes(message.action as string)
      );
    case 'nav-lead':
      return (
        isTarget(message) && NAV_LEAD_KINDS.includes(message.kind as string)
      );
    default:
      return false;
  }
}

// Desktop windows talk through the main process; web tabs use a
// BroadcastChannel, which reaches every tab of the same origin.
const BROADCAST_CHANNEL_NAME = 'eigent-session-windows';
const IPC_POST_CHANNEL = 'session-window:post';
const IPC_MESSAGE_CHANNEL = 'session-window:message';

let channelHost: AppHost | null = null;
let broadcastChannel: BroadcastChannel | null = null;

export function initSessionWindows(host: AppHost) {
  channelHost = host;
}

const desktopIpc = () => channelHost?.ipcRenderer ?? null;

function getBroadcastChannel(): BroadcastChannel | null {
  if (broadcastChannel) return broadcastChannel;
  if (typeof BroadcastChannel === 'undefined') return null;
  broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  return broadcastChannel;
}

export function postSessionWindowMessage(message: SessionWindowMessage) {
  const ipc = desktopIpc();
  if (ipc) {
    ipc.send(IPC_POST_CHANNEL, message);
    return;
  }
  getBroadcastChannel()?.postMessage(message);
}

const listeners = new Set<(message: SessionWindowMessage) => void>();
let transportAttached = false;

// One transport listener fans out to every subscriber. The desktop preload
// wraps listeners, so `off` cannot remove them; attach exactly once instead.
function attachTransport() {
  if (transportAttached) return;
  const deliver = (message: unknown) => {
    if (!isSessionWindowMessage(message)) return;
    for (const listener of [...listeners]) listener(message);
  };
  const ipc = desktopIpc();
  if (ipc) {
    ipc.on(IPC_MESSAGE_CHANNEL, (_event: unknown, message: unknown) =>
      deliver(message)
    );
    transportAttached = true;
    return;
  }
  const channel = getBroadcastChannel();
  if (!channel) return;
  channel.addEventListener('message', (event: MessageEvent) =>
    deliver(event.data)
  );
  transportAttached = true;
}

export function onSessionWindowMessage(
  listener: (message: SessionWindowMessage) => void
): () => void {
  attachTransport();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const tabName = (projectId: string) => `eigent-session-${projectId}`;

/**
 * Opens the Session in its own window (desktop) or tab (web), or brings the
 * open one forward.
 */
export async function openSessionWindow(target: SessionWindowTarget) {
  const ipc = desktopIpc();
  if (ipc) {
    await ipc.invoke('session-window:open', target);
    return;
  }
  const url = sessionWindowPath(target);
  // An empty URL returns a tab of this name without reloading it.
  const existing = window.open('', tabName(target.projectId));
  if (!existing) return;
  try {
    if (existing.location.pathname !== url) existing.location.href = url;
  } catch {
    existing.location.href = url;
  }
  existing.focus();
}

/** Session window: show this Session in the main window and close. */
export async function returnSessionWindowToMain(target: SessionWindowTarget) {
  const ipc = desktopIpc();
  if (ipc) {
    await ipc.invoke('session-window:return-to-main', target);
    return;
  }
  postSessionWindowMessage({ type: 'open-in-main', ...target });
  window.opener?.focus?.();
  window.close();
}

/** Desktop: Session windows the main process has open right now. */
export async function listOpenSessionWindows(): Promise<string[] | null> {
  const ipc = desktopIpc();
  if (!ipc) return null;
  try {
    const ids: unknown = await ipc.invoke('session-window:list');
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}
