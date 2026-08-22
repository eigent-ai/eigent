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
  fetchGet,
  fetchPost,
  getBaseURL,
  getLocalControlCapability,
  proxyFetchGet,
} from '@/api/http';
import { isDesktop } from '@/client/platform';
import {
  getRemoteControlDesktopInstanceId,
  getRemoteControlWebSocketUrl,
  setRemoteControlBridgeConnected,
  type RemoteControlBridgeError,
} from '@/lib/remoteControl';
import {
  createFollowUpRequest,
  getRemoteFollowUpByCommandId,
  listPendingFollowUpRequests,
  listPendingRemoteFollowUpRequests,
  terminalContinuationAdmissionRejection,
  type DurableFollowUpRequest,
} from '@/service/followUpQueueApi';
import { humanInteractionDecisionPath } from '@/service/humanInteractionApi';
import { toLocalSpace, type ServerProject } from '@/service/spaceApi';
import { getAuthStore } from '@/store/authStore';
import { useProjectStore } from '@/store/projectStore';
import { projectMetaFromServer, useSpaceStore } from '@/store/spaceStore';
import type { SessionModeType } from '@/types/constants';
import { useEffect, useRef } from 'react';

type BridgeAck = {
  type: 'command_ack';
  command_id: string;
  status: 'acknowledged' | 'failed';
  error_code?: string;
  error?: string;
  result?: Record<string, any>;
  replayed_from_cache?: boolean;
};

type CommandResultBody = {
  status: 'completed' | 'failed';
  event_id: string;
  result: Record<string, any>;
  error_code?: string;
  error?: string;
};

type DurableCommandEvent = {
  event_type?: string;
  payload?: {
    result?: Record<string, any>;
    error_code?: string;
    error?: string;
  };
};

type RemoteCommand = {
  id: string;
  session_id: string;
  user_id: number;
  space_id?: string | null;
  project_id?: string;
  active_task_id?: string | null;
  brain_session_id?: string | null;
  target_project_id?: string;
  target_task_id?: string | null;
  target_brain_session_id?: string | null;
  source_channel: string;
  type: string;
  payload: Record<string, any>;
  next_task_id?: string | null;
  route_version?: number;
  expires_at?: string;
  receipt_grace_until?: string;
  requires_online_receipt_confirmation?: boolean;
};

type CacheEntry =
  | { state: 'in_progress'; promise: Promise<BridgeAck> }
  | { state: 'done'; ack: BridgeAck; completedAt: number };

const CACHE_LIMIT = 200;
const COMMAND_TIMEOUT_MS = 10000;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_COMMANDS = 5;
const PENDING_COMMAND_RESULTS_KEY = 'eigent:remote-command-results:v1';
const PENDING_COMMAND_RESULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_COMMAND_RESULT_LIMIT = 200;
const remoteHistoryHydrationInFlight = new Set<string>();
const BRIDGE_CAPABILITIES = {
  bridge_version: 1,
  commands: [
    'user_message',
    'human_reply',
    'interaction_decision',
    'stop',
    'skip_task',
    'add_task',
    'remove_task',
    'supplement',
    'switch_project_view',
    'space_project_upsert',
    'space_overlay_list',
    'space_apply_project_run',
    'space_refresh_project',
    'space_discard_project_overlays',
  ],
};

type PendingCommandResult = {
  command: RemoteCommand;
  body: CommandResultBody;
  createdAt: number;
};

function readPendingCommandResults(): PendingCommandResult[] {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(PENDING_COMMAND_RESULTS_KEY) || '[]'
    );
    const now = Date.now();
    return Array.isArray(value)
      ? value
          .filter(
            (item) =>
              item?.command?.id &&
              item?.body?.event_id &&
              now - Number(item.createdAt || now) <=
                PENDING_COMMAND_RESULT_TTL_MS
          )
          .map((item) => ({
            ...item,
            createdAt: Number(item.createdAt || now),
          }))
          .slice(-PENDING_COMMAND_RESULT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function writePendingCommandResults(items: PendingCommandResult[]) {
  try {
    window.localStorage.setItem(
      PENDING_COMMAND_RESULTS_KEY,
      JSON.stringify(items.slice(-PENDING_COMMAND_RESULT_LIMIT))
    );
  } catch (error) {
    console.warn(
      '[RemoteControlBridge] Could not persist pending command result',
      error
    );
  }
}

function queuePendingCommandResult(
  item: Omit<PendingCommandResult, 'createdAt'>
): PendingCommandResult {
  const items = readPendingCommandResults();
  const existing = items.find(
    (candidate) => candidate.command.id === item.command.id
  );
  if (existing) {
    if (JSON.stringify(existing.body) !== JSON.stringify(item.body)) {
      console.warn(
        '[RemoteControlBridge] Preserving first durable command outcome',
        {
          command_id: item.command.id,
          existing_event_id: existing.body.event_id,
          ignored_event_id: item.body.event_id,
        }
      );
    }
    return existing;
  }
  const queued = { ...item, createdAt: Date.now() };
  items.push(queued);
  writePendingCommandResults(items);
  return queued;
}

function pendingCommandResult(commandId: string): PendingCommandResult | null {
  return (
    readPendingCommandResults().find(
      (candidate) => candidate.command.id === commandId
    ) || null
  );
}

function removePendingCommandResult(commandId: string) {
  writePendingCommandResults(
    readPendingCommandResults().filter(
      (candidate) => candidate.command.id !== commandId
    )
  );
}

export function ackFromDurableExecution(
  commandId: string,
  event?: DurableCommandEvent | null
): BridgeAck | null {
  if (!event?.event_type) {
    return null;
  }
  const payload = event.payload || {};
  if (event.event_type === 'execution.completed') {
    return {
      type: 'command_ack',
      command_id: commandId,
      status: 'acknowledged',
      result: payload.result || {},
      replayed_from_cache: true,
    };
  }
  if (event.event_type === 'execution.failed') {
    return {
      type: 'command_ack',
      command_id: commandId,
      status: 'failed',
      error_code: payload.error_code || 'COMMAND_FAILED',
      error: payload.error || 'Remote command failed',
      replayed_from_cache: true,
    };
  }
  return null;
}

export function ackFromPendingCommandResult(
  commandId: string,
  body: CommandResultBody
): BridgeAck {
  if (body.status === 'completed') {
    return {
      type: 'command_ack',
      command_id: commandId,
      status: 'acknowledged',
      result: body.result,
      replayed_from_cache: true,
    };
  }
  return {
    type: 'command_ack',
    command_id: commandId,
    status: 'failed',
    error_code: body.error_code || 'COMMAND_FAILED',
    error: body.error || 'Remote command failed',
    replayed_from_cache: true,
  };
}

export function ackFromDurableFollowUp(
  commandId: string,
  followUp: DurableFollowUpRequest
): BridgeAck {
  return {
    type: 'command_ack',
    command_id: commandId,
    status: 'acknowledged',
    result: {
      follow_up_request_id: followUp.request_id,
      queued: followUp.status === 'pending',
      follow_up_status: followUp.status,
      admitted_run_id: followUp.admitted_run_id || undefined,
      admission_error: followUp.last_error || undefined,
    },
    replayed_from_cache: true,
  };
}

function trimCache(cache: Map<string, CacheEntry>) {
  if (cache.size <= CACHE_LIMIT) {
    return;
  }
  const removable = [...cache.entries()]
    .filter(([, entry]) => entry.state === 'done')
    .sort((a, b) => {
      const aTime = a[1].state === 'done' ? a[1].completedAt : 0;
      const bTime = b[1].state === 'done' ? b[1].completedAt : 0;
      return aTime - bTime;
    });
  while (cache.size > CACHE_LIMIT && removable.length) {
    const [commandId] = removable.shift()!;
    cache.delete(commandId);
  }
}

function brainHeaders(command: RemoteCommand): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Channel': 'remote_control',
    'X-Session-ID': getCommandBrainSessionId(command) || '',
    'X-User-ID': String(command.user_id),
  };
}

function getCommandProjectId(command: RemoteCommand): string {
  return command.target_project_id || command.project_id || '';
}

function getCommandBrainSessionId(
  command: RemoteCommand
): string | null | undefined {
  return command.target_brain_session_id || command.brain_session_id;
}

function getCommandHistoryId(command: RemoteCommand): string | null {
  const payload = command.payload || {};
  if (payload.remote_history_id != null) {
    return String(payload.remote_history_id);
  }
  if (payload.history_id != null) {
    return String(payload.history_id);
  }
  const projectId = getCommandProjectId(command);
  return (
    (projectId
      ? useSpaceStore.getState().getProjectMeta(projectId)?.metadata?.historyId
      : undefined) || null
  );
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function payloadErrorMessage(payload: any, fallback: string): string {
  const detail = payload?.detail;
  if (typeof detail === 'string') {
    return detail;
  }
  if (detail && typeof detail === 'object') {
    return detail.message || detail.code || JSON.stringify(detail);
  }
  if (typeof payload?.message === 'string') {
    return payload.message;
  }
  if (typeof payload === 'string' && payload) {
    return payload;
  }
  return fallback;
}

async function getSpaceOperationBaseURL(): Promise<string> {
  const localApiUrl = import.meta.env.VITE_REMOTE_CONTROL_LOCAL_API_URL;
  if (typeof localApiUrl === 'string' && /^https?:\/\//.test(localApiUrl)) {
    return stripTrailingSlash(localApiUrl);
  }
  return getBaseURL();
}

function classifyBridgeError(error: any): any {
  if (error?.name === 'AbortError') {
    const timeoutError: any = new Error('Remote command timed out');
    timeoutError.code = 'BRIDGE_TIMEOUT';
    return timeoutError;
  }
  if (error?.status === 401 || error?.status === 403) {
    const authError: any = new Error('Remote control authentication expired');
    authError.code = 'BRIDGE_AUTH';
    authError.status = error.status;
    getAuthStore().logout();
    return authError;
  }
  return error;
}

async function requestBrain(
  command: RemoteCommand,
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: Record<string, unknown>
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    COMMAND_TIMEOUT_MS
  );
  try {
    const baseURL = await getBaseURL();
    const localControlCapability = await getLocalControlCapability();
    const response = await fetch(`${baseURL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...brainHeaders(command),
        Authorization: `Bearer ${token}`,
        ...(localControlCapability
          ? { 'X-Eigent-Local-Capability': localControlCapability }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 204) {
      return null;
    }
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');
    if (!response.ok) {
      const error: any = new Error(
        payloadErrorMessage(payload, `HTTP ${response.status}`)
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error: any) {
    throw classifyBridgeError(error);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function requestSpaceOperation(
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: Record<string, unknown>
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    COMMAND_TIMEOUT_MS
  );
  try {
    const baseURL = await getSpaceOperationBaseURL();
    const response = await fetch(`${baseURL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 204) {
      return null;
    }
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');
    if (!response.ok) {
      const error: any = new Error(
        payloadErrorMessage(payload, `HTTP ${response.status}`)
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error: any) {
    throw classifyBridgeError(error);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function assertLocalTaskOnline(command: RemoteCommand, token: string) {
  const status = await requestBrain(
    command,
    token,
    'GET',
    `/chat/${getCommandProjectId(command)}/status`
  );
  if (!status?.has_lock) {
    const error: any = new Error('Desktop chat view is offline');
    error.code = 'BRIDGE_LOCAL_TASK_OFFLINE';
    throw error;
  }
}

function scheduleRemoteProjectHistoryHydration(command: RemoteCommand): void {
  const projectId = getCommandProjectId(command);
  if (!projectId || remoteHistoryHydrationInFlight.has(projectId)) {
    return;
  }
  const project = useProjectStore.getState().getProjectById(projectId);
  if (!project?.metadata?.remoteHistoryHydrationPending) {
    return;
  }

  remoteHistoryHydrationInFlight.add(projectId);
  void (async () => {
    try {
      const historyProject = await proxyFetchGet(
        `/api/v1/chat/histories/grouped/${projectId}`,
        { include_tasks: true }
      );
      const tasks = Array.isArray(historyProject?.tasks)
        ? historyProject.tasks
        : [];
      await useProjectStore
        .getState()
        .mergeProjectHistory(
          projectId,
          tasks,
          String(historyProject?.last_prompt || '')
        );
    } catch (error) {
      console.warn(
        '[RemoteControlBridge] Failed to hydrate background Project history:',
        { project_id: projectId },
        error
      );
    } finally {
      remoteHistoryHydrationInFlight.delete(projectId);
    }
  })();
}

function ensureRemoteProjectLoaded(command: RemoteCommand): void {
  const projectId = getCommandProjectId(command);
  if (!projectId) {
    throw new Error('Remote command requires target_project_id');
  }

  const projectStore = useProjectStore.getState();
  const spaceStore = useSpaceStore.getState();
  const payload = command.payload || {};
  const space = payload.space;
  const project = payload.project as ServerProject | undefined;

  if (space) {
    spaceStore.upsertSpaces([toLocalSpace(space)], undefined);
  }
  if (project) {
    spaceStore.upsertProjectMetas([projectMetaFromServer(project)]);
    projectStore.upsertProjectsFromServer([project]);
  }

  const meta = useSpaceStore.getState().getProjectMeta(projectId);
  const historyId = getCommandHistoryId(command);
  const existingProject = useProjectStore.getState().projects[projectId];
  if (existingProject) {
    if (
      historyId &&
      Object.keys(existingProject.chatStores ?? {}).length === 0
    ) {
      useProjectStore.getState().updateProject(projectId, {
        metadata: {
          historyId,
          remoteHistoryHydrationPending: true,
        },
      });
    }
    return;
  }

  useProjectStore
    .getState()
    .createProject(
      String(
        payload.project_name || meta?.name || project?.name || 'Remote Project'
      ),
      meta?.description || project?.description || '',
      projectId,
      undefined,
      historyId ?? undefined,
      false,
      {
        spaceId:
          meta?.spaceId ||
          (payload.space_id ? String(payload.space_id) : undefined) ||
          command.space_id ||
          project?.space_id,
        mode:
          meta?.mode ??
          (project?.mode as SessionModeType | null | undefined) ??
          'single-agent',
        workdirMode: meta?.workdirMode ?? project?.workdir_mode ?? null,
        metadata: {
          ...(meta?.metadata ?? project?.metadata ?? {}),
          ...(historyId ? { historyId } : {}),
          remoteHistoryHydrationPending: Boolean(historyId),
        },
        createdAt: meta?.createdAt,
        updatedAt: meta?.updatedAt,
      }
    );
}

async function startLocalRemoteTask(command: RemoteCommand): Promise<void> {
  const projectId = getCommandProjectId(command);
  const nextTaskId = command.next_task_id;
  if (!projectId || !nextTaskId) {
    throw new Error('Remote user message requires project_id and next_task_id');
  }

  ensureRemoteProjectLoaded(command);

  const payload = command.payload || {};
  const project = useProjectStore.getState().getProjectById(projectId);
  const sessionMode = (project?.mode || 'single-agent') as SessionModeType;
  const content = String(payload.content || payload.question || '');
  const messageAttaches = (Array.isArray(payload.attachments)
    ? payload.attachments.map((value: unknown) => {
        const filePath = String(value);
        return {
          fileName: filePath.split(/[\\/]/).pop() || filePath,
          filePath,
          source: 'local' as const,
        };
      })
    : []) as unknown as File[];
  const historyId = getCommandHistoryId(command);

  const projectStore = useProjectStore.getState();
  let chatStore = projectStore.getChatStore(projectId);
  if (!chatStore) {
    projectStore.createChatStore(projectId);
    chatStore = projectStore.getChatStore(projectId);
  }
  if (!chatStore) {
    throw new Error('Failed to create local Project chat store');
  }

  console.info('[RemoteControlBridge][RC-TRACE] startTask launching', {
    command_id: command.id,
    project_id: projectId,
    next_task_id: nextTaskId,
    session_mode: sessionMode,
    history_id: historyId,
  });

  try {
    await chatStore
      .getState()
      .startTask(
        nextTaskId,
        undefined,
        undefined,
        undefined,
        content,
        messageAttaches,
        undefined,
        projectId,
        sessionMode,
        {
          preserveTaskId: true,
          skipHistoryCreate: historyId != null,
          historyId,
          awaitAdmission: true,
        }
      );
    scheduleRemoteProjectHistoryHydration(command);
  } catch (error: any) {
    if (error && typeof error === 'object' && !error.code) {
      error.code = 'BRIDGE_START_TASK_FAILED';
    }
    console.error(
      '[RemoteControlBridge][RC-TRACE] startTask FAILED before ack:',
      { command_id: command.id, next_task_id: nextTaskId },
      error
    );
    throw error;
  }
}

function seedRemoteFollowUpPrompt(command: RemoteCommand): void {
  const projectId = getCommandProjectId(command);
  const nextTaskId = command.next_task_id;
  const content = String(
    command.payload?.content || command.payload?.question || ''
  );
  if (!projectId || !nextTaskId || !content) {
    return;
  }

  ensureRemoteProjectLoaded(command);

  const projectStore = useProjectStore.getState();
  const prepared = projectStore.appendInitChatStore(projectId, nextTaskId);
  if (!prepared) return;

  const chatState = prepared.chatStore.getState();
  const project = projectStore.getProjectById(projectId);

  const messageId = `remote-command:${command.id}`;
  const alreadySeeded = chatState.tasks[nextTaskId].messages.some(
    (message) => message.id === messageId
  );
  chatState.setNextTaskId(nextTaskId);
  chatState.setTaskSessionMode(
    nextTaskId,
    (project?.mode || 'single-agent') as SessionModeType
  );
  chatState.setTaskSource(nextTaskId, 'user');
  chatState.setIsPending(nextTaskId, true);
  chatState.setHasMessages(nextTaskId, true);
  if (!alreadySeeded) {
    chatState.addMessages(nextTaskId, {
      id: messageId,
      role: 'user',
      content,
      attaches: [],
    });
  }
  scheduleRemoteProjectHistoryHydration(command);
}

function reflectRemoteFollowUpInProject(
  command: RemoteCommand,
  request: DurableFollowUpRequest
): void {
  const projectId = getCommandProjectId(command);
  if (!projectId) return;
  ensureRemoteProjectLoaded(command);
  useProjectStore.getState().restoreQueuedMessage(projectId, {
    task_id: request.request_id,
    run_id: request.request_id,
    content: request.content,
    timestamp: request.created_at * 1000,
    attaches: request.attachment_paths.map((filePath) => ({
      fileName: filePath.split(/[\\/]/).pop() || filePath,
      filePath,
      source: 'local',
    })) as unknown as File[],
    sendNow: request.delivery_mode === 'send_now',
  });
}

async function dispatchPersistedRemoteFollowUp(
  command: RemoteCommand
): Promise<boolean> {
  const projectId = getCommandProjectId(command);
  const requestId = command.next_task_id || command.id;
  if (!projectId || !requestId) {
    throw new Error('Remote follow-up requires Project and request ids');
  }
  const pending = await listPendingFollowUpRequests(projectId);
  const next = pending[0];
  if (!next || next.request_id !== requestId) {
    return !pending.some((item) => item.request_id === requestId);
  }
  const status = await fetchGet(
    `/chat/${encodeURIComponent(projectId)}/status`
  );
  if (status?.has_lock && status?.status !== 'done') {
    return false;
  }
  try {
    if (status?.has_lock) {
      seedRemoteFollowUpPrompt(command);
      await fetchPost(`/chat/${encodeURIComponent(projectId)}`, {
        question: next.content,
        task_id: requestId,
        attaches: next.attachment_paths,
        target: command.payload?.target,
      });
    } else {
      await startLocalRemoteTask(command);
    }
  } catch (error) {
    if (terminalContinuationAdmissionRejection(error)) {
      // Brain atomically closed this request with its typed clarification.
      // Remove only the rebuildable renderer row and never retry it.
      useProjectStore.getState().removeQueuedMessage(projectId, requestId);
    }
    throw error;
  }
  // Brain admits the queue row atomically with the Run Attempt.  A separate
  // renderer acknowledgement could race an exceptionally fast terminal Run
  // and is no longer part of the correctness boundary.
  useProjectStore.getState().removeQueuedMessage(projectId, requestId);
  return true;
}

function commandErrorAck(commandId: string, error: any): BridgeAck {
  return {
    type: 'command_ack',
    command_id: commandId,
    status: 'failed',
    error_code: error?.code || 'BRIDGE_BRAIN_UNREACHABLE',
    error: error?.message || 'Remote command failed',
  };
}

async function executeRemoteCommand(
  command: RemoteCommand,
  token: string,
  scheduleFollowUp?: (command: RemoteCommand) => void
): Promise<BridgeAck> {
  if (
    command.type !== 'user_message' &&
    command.type !== 'interaction_decision'
  ) {
    await assertLocalTaskOnline(command, token);
  }
  const projectId = getCommandProjectId(command);

  switch (command.type) {
    case 'user_message': {
      const requestId = command.next_task_id || command.id;
      // getCommandProjectId falls back to '', which would otherwise be sent as
      // a request to /projects//follow-ups.
      if (!projectId) {
        throw new Error('Remote user_message requires a target Project');
      }
      const content = String(
        command.payload.content || command.payload.question || ''
      );
      const queued = await createFollowUpRequest({
        projectId,
        requestId,
        content,
        attachmentPaths: Array.isArray(command.payload.attachments)
          ? command.payload.attachments.map(String)
          : [],
        source: 'remote_control',
        sourceCommandId: command.id,
      });
      reflectRemoteFollowUpInProject(command, queued);
      const dispatched = await dispatchPersistedRemoteFollowUp(command);
      if (!dispatched) {
        scheduleFollowUp?.({ ...command, next_task_id: requestId });
      }
      return {
        type: 'command_ack',
        command_id: command.id,
        status: 'acknowledged',
        result: {
          follow_up_request_id: requestId,
          queued: !dispatched,
        },
      };
    }
    case 'human_reply': {
      await requestBrain(
        command,
        token,
        'POST',
        `/chat/${projectId}/human-reply`,
        {
          agent: command.payload.agent,
          reply: command.payload.reply || command.payload.content || '',
        }
      );
      break;
    }
    case 'interaction_decision': {
      const runId = String(command.payload.run_id || '');
      const interactionId = String(command.payload.interaction_id || '');
      if (!runId || !interactionId) {
        throw new Error(
          'interaction_decision requires run_id and interaction_id'
        );
      }
      await requestBrain(
        command,
        token,
        'POST',
        humanInteractionDecisionPath(runId, interactionId),
        {
          decision_request_id:
            command.payload.decision_request_id || command.id,
          decision: command.payload.decision || {},
          expected_version: Number(command.payload.expected_version || 0),
          action_digest: command.payload.action_digest || null,
          actor_type: 'user',
          actor_id: String(command.user_id),
          source: 'remote_control',
          continue_active_attempt: true,
        }
      );
      break;
    }
    case 'skip_task': {
      await requestBrain(
        command,
        token,
        'POST',
        `/chat/${projectId}/skip-task`,
        {}
      );
      break;
    }
    case 'stop': {
      await requestBrain(command, token, 'DELETE', `/chat/${projectId}`);
      break;
    }
    case 'add_task': {
      await requestBrain(
        command,
        token,
        'POST',
        `/chat/${projectId}/add-task`,
        {
          content: command.payload.content || '',
          project_id: projectId,
          task_id: command.payload.task_id,
          additional_info: command.payload.additional_info,
          insert_position: command.payload.insert_position,
        }
      );
      break;
    }
    case 'remove_task': {
      const taskId = command.payload.task_id;
      if (!taskId) {
        throw new Error('remove_task requires task_id');
      }
      await requestBrain(
        command,
        token,
        'DELETE',
        `/chat/${projectId}/remove-task/${encodeURIComponent(String(taskId))}`
      );
      break;
    }
    case 'supplement': {
      await requestBrain(command, token, 'PUT', `/chat/${projectId}`, {
        question: command.payload.question || command.payload.content || '',
        task_id: command.payload.task_id,
        attaches: command.payload.attachments || [],
        target: command.payload.target,
      });
      break;
    }
    default:
      throw new Error(`Unsupported remote command: ${command.type}`);
  }

  return {
    type: 'command_ack',
    command_id: command.id,
    status: 'acknowledged',
  };
}

async function executeSwitchProjectView(
  command: RemoteCommand
): Promise<BridgeAck> {
  const projectId = getCommandProjectId(command);
  if (!projectId) {
    throw new Error('switch_project_view requires target_project_id');
  }

  const state = useProjectStore.getState();
  const spaceStore = useSpaceStore.getState();
  const payload = command.payload || {};
  const space = payload.space;
  const project = payload.project as ServerProject | undefined;
  if (space) {
    spaceStore.upsertSpaces([toLocalSpace(space)], String(space.id));
  }
  if (project) {
    spaceStore.upsertProjectMetas([projectMetaFromServer(project)]);
    state.upsertProjectsFromServer([project]);
  }

  if (state.projects[projectId]) {
    state.setActiveProject(projectId);
  } else {
    const taskIds = Array.isArray(payload.task_ids)
      ? payload.task_ids.map(String)
      : [];
    if (taskIds.length > 0) {
      await state.loadProjectFromHistory(
        taskIds,
        String(payload.question || ''),
        projectId,
        payload.history_id ? String(payload.history_id) : undefined,
        payload.project_name ? String(payload.project_name) : undefined,
        payload.space_id
          ? String(payload.space_id)
          : command.space_id || undefined
      );
    } else {
      state.createProject(
        String(payload.project_name || project?.name || 'New Project'),
        project?.description || '',
        projectId,
        undefined,
        payload.history_id ? String(payload.history_id) : undefined,
        true,
        {
          spaceId: payload.space_id
            ? String(payload.space_id)
            : command.space_id || project?.space_id,
          mode: project?.mode ?? 'single-agent',
          workdirMode: project?.workdir_mode ?? null,
          metadata: project?.metadata ?? undefined,
        }
      );
    }
  }

  return {
    type: 'command_ack',
    command_id: command.id,
    status: 'acknowledged',
  };
}

async function executeSpaceProjectUpsert(
  command: RemoteCommand
): Promise<BridgeAck> {
  const payload = command.payload || {};
  const space = payload.space;
  const project = payload.project as ServerProject | undefined;
  if (space) {
    useSpaceStore.getState().upsertSpaces([toLocalSpace(space)], undefined);
  }
  if (project) {
    useSpaceStore
      .getState()
      .upsertProjectMetas([projectMetaFromServer(project)]);
    useProjectStore.getState().upsertProjectsFromServer([project]);
  }
  return {
    type: 'command_ack',
    command_id: command.id,
    status: 'acknowledged',
  };
}

async function executeSpaceCommand(
  command: RemoteCommand,
  token: string
): Promise<BridgeAck> {
  const payload = command.payload || {};
  const spaceId = String(payload.space_id || command.space_id || '');
  const projectId = String(payload.project_id || getCommandProjectId(command));
  if (!spaceId || !projectId) {
    throw new Error(`${command.type} requires space_id and project_id`);
  }
  const spaceStore = useSpaceStore.getState();
  const localSpace = spaceStore.getSpaceById(spaceId);
  const localProject = spaceStore.getProjectMeta(projectId);
  if (!localSpace) {
    const error: any = new Error('Desktop Space is not loaded locally');
    error.code = 'BRIDGE_SPACE_NOT_READY';
    throw error;
  }
  if (!localProject || localProject.spaceId !== spaceId) {
    const error: any = new Error('Desktop Project is not loaded in this Space');
    error.code = 'BRIDGE_SPACE_PROJECT_NOT_READY';
    throw error;
  }
  let result: Record<string, any> | null = null;
  if (command.type === 'space_overlay_list') {
    const query = payload.run_id
      ? `?run_id=${encodeURIComponent(String(payload.run_id))}`
      : '';
    result = await requestSpaceOperation(
      token,
      'GET',
      `/spaces/${encodeURIComponent(spaceId)}/projects/${encodeURIComponent(
        projectId
      )}/overlays${query}`
    );
  } else if (command.type === 'space_apply_project_run') {
    result = await requestSpaceOperation(
      token,
      'POST',
      `/spaces/${encodeURIComponent(spaceId)}/projects/${encodeURIComponent(
        projectId
      )}/apply`,
      {
        run_id: payload.run_id,
        paths: payload.paths,
        force_resolutions: payload.force_resolutions,
      }
    );
  } else if (command.type === 'space_discard_project_overlays') {
    result = await requestSpaceOperation(
      token,
      'POST',
      `/spaces/${encodeURIComponent(spaceId)}/projects/${encodeURIComponent(
        projectId
      )}/discard`,
      {
        run_id: payload.run_id,
        paths: payload.paths,
      }
    );
  } else if (command.type === 'space_refresh_project') {
    result = await requestSpaceOperation(
      token,
      'POST',
      `/spaces/${encodeURIComponent(spaceId)}/projects/${encodeURIComponent(
        projectId
      )}/refresh`,
      { force: Boolean(payload.force) }
    );
  } else {
    throw new Error(`Unsupported Space command: ${command.type}`);
  }
  return {
    type: 'command_ack',
    command_id: command.id,
    status: 'acknowledged',
    result: result || undefined,
  };
}

export const __remoteControlBridgeTestHooks = {
  ackFromDurableFollowUp,
  ackFromPendingCommandResult,
  ensureRemoteProjectLoaded,
  executeRemoteCommand,
  pendingCommandResult,
  queuePendingCommandResult,
  removePendingCommandResult,
  serverBridgeError,
};

function serverBridgeError(message: any): RemoteControlBridgeError | null {
  if (message?.type !== 'error') {
    return null;
  }
  const code =
    typeof message.code === 'string' && message.code
      ? message.code
      : 'bridge_error';
  const text =
    typeof message.message === 'string' && message.message
      ? message.message
      : 'Remote control bridge registration failed.';
  const retryable =
    typeof message.retryable === 'boolean'
      ? message.retryable
      : code !== 'device_owner_mismatch';
  return { code, message: text, retryable };
}

export function useRemoteControlBridge(
  token: string | null | undefined,
  backendReady: boolean
) {
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const rateLimitRef = useRef<number[]>([]);
  const tokenRef = useRef<string | null | undefined>(token);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    if (!backendReady || !token || !isDesktop()) {
      setRemoteControlBridgeConnected(false, null);
      return;
    }

    setRemoteControlBridgeConnected(false, null);

    let stopped = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let reconnectAttempt = 0;
    let desktopInstanceId = '';
    const followUpTimers = new Map<string, number>();
    const followUpAttempts = new Map<string, number>();

    const send = (payload: Record<string, unknown>) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      } else {
        // RC-TRACE: a delivered/ack frame silently dropped here means the
        // server will see the command stuck in pending/delivered forever.
        console.warn(
          '[RemoteControlBridge][RC-TRACE] DROPPED outbound frame, ws not open',
          {
            readyState: ws?.readyState,
            type: payload?.type,
            command_id: (payload as any)?.command_id,
          }
        );
      }
    };

    const sendAck = (ack: BridgeAck) => {
      send(ack);
    };

    const checkRateLimit = () => {
      const now = Date.now();
      const recent = rateLimitRef.current.filter(
        (timestamp) => timestamp >= now - RATE_LIMIT_WINDOW_MS
      );
      if (recent.length >= RATE_LIMIT_MAX_COMMANDS) {
        rateLimitRef.current = recent;
        return false;
      }
      recent.push(now);
      rateLimitRef.current = recent;
      return true;
    };

    const scheduleRemoteFollowUp = (command: RemoteCommand) => {
      const requestId = command.next_task_id || command.id;
      if (stopped || followUpTimers.has(requestId)) return;
      const attempt = followUpAttempts.get(requestId) || 0;
      const delay = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5));
      const timer = window.setTimeout(() => {
        followUpTimers.delete(requestId);
        void dispatchPersistedRemoteFollowUp(command)
          .then((dispatched) => {
            if (dispatched) {
              followUpAttempts.delete(requestId);
              return;
            }
            followUpAttempts.set(requestId, attempt + 1);
            scheduleRemoteFollowUp(command);
          })
          .catch((error) => {
            const rejection = terminalContinuationAdmissionRejection(error);
            if (rejection) {
              followUpAttempts.delete(requestId);
              const projectId = getCommandProjectId(command);
              if (projectId) {
                useProjectStore
                  .getState()
                  .removeQueuedMessage(projectId, requestId);
              }
              console.warn(
                '[RemoteControlBridge] Durable follow-up requires new user intent',
                { request_id: requestId, code: rejection.code }
              );
              return;
            }
            console.warn(
              '[RemoteControlBridge] Durable follow-up dispatch deferred',
              { request_id: requestId, error }
            );
            followUpAttempts.set(requestId, attempt + 1);
            scheduleRemoteFollowUp(command);
          });
      }, delay);
      followUpTimers.set(requestId, timer);
    };

    const executeCommand = (command: RemoteCommand): Promise<BridgeAck> => {
      if (
        command.type === 'switch_project_view' ||
        command.type === 'space_project_upsert' ||
        command.type.startsWith('space_')
      ) {
        return command.type === 'switch_project_view'
          ? executeSwitchProjectView(command)
          : command.type === 'space_project_upsert'
            ? executeSpaceProjectUpsert(command)
            : executeSpaceCommand(command, token);
      }

      if (!checkRateLimit()) {
        return Promise.resolve({
          type: 'command_ack',
          command_id: command.id,
          status: 'failed',
          error_code: 'BRIDGE_RATE_LIMIT',
          error: 'Too many remote commands in a short time',
        });
      }

      return executeRemoteCommand(command, token, scheduleRemoteFollowUp);
    };

    const persistCommandResult = async (
      command: RemoteCommand,
      body: CommandResultBody
    ) => {
      const queued = queuePendingCommandResult({ command, body });
      await fetchPost(
        `/remote-control/commands/${encodeURIComponent(command.id)}/result`,
        queued.body,
        brainHeaders(queued.command)
      );
      removePendingCommandResult(command.id);
    };

    const flushPendingCommandResults = async () => {
      for (const item of readPendingCommandResults()) {
        try {
          await persistCommandResult(item.command, item.body);
        } catch (error) {
          console.warn(
            '[RemoteControlBridge] Pending command result remains queued',
            { command_id: item.command.id, error }
          );
        }
      }
    };

    const persistCommandAndExecute = async (
      command: RemoteCommand
    ): Promise<BridgeAck> => {
      const persisted = await fetchPost(
        '/remote-control/commands/inbox',
        command,
        brainHeaders(command)
      );
      send({
        type: 'command_delivered',
        command_id: command.id,
      });
      const durableAck = ackFromDurableExecution(
        command.id,
        persisted?.execution_event
      );
      if (durableAck) {
        return durableAck;
      }
      const inboxState = persisted?.command?.state;
      if (inboxState === 'accepted') {
        const pendingResult = pendingCommandResult(command.id);
        if (pendingResult) {
          try {
            await persistCommandResult(
              pendingResult.command,
              pendingResult.body
            );
          } catch (error) {
            console.warn(
              '[RemoteControlBridge] Existing execution result remains queued',
              { command_id: command.id, error }
            );
          }
          return ackFromPendingCommandResult(command.id, pendingResult.body);
        }
        if (command.type === 'user_message') {
          try {
            const followUp = await getRemoteFollowUpByCommandId(command.id);
            const recoveredAck = ackFromDurableFollowUp(command.id, followUp);
            await persistCommandResult(command, {
              status: 'completed',
              event_id: `${command.id}:result`,
              result: recoveredAck.result || {},
            });
            return recoveredAck;
          } catch (error: any) {
            if (error?.response?.status !== 404) {
              throw error;
            }
          }
        }
        // A previous renderer durably admitted this command. Re-executing after
        // restart could duplicate an external side effect, so close the unknown
        // outcome explicitly. This event identity is intentionally disjoint
        // from the real execution result lane.
        const unknownAck: BridgeAck = {
          type: 'command_ack',
          command_id: command.id,
          status: 'failed',
          error_code: 'COMMAND_OUTCOME_UNKNOWN_AFTER_RESTART',
          error:
            'The command was admitted before Desktop restarted; it was not replayed.',
        };
        try {
          await persistCommandResult(command, {
            status: 'failed',
            event_id: `${command.id}:recovery-outcome-unknown`,
            result: {},
            error_code: unknownAck.error_code,
            error: unknownAck.error,
          });
        } catch (error) {
          console.warn(
            '[RemoteControlBridge] Outcome-unknown result queued for retry',
            error
          );
        }
        return unknownAck;
      }
      if (inboxState === 'rejected') {
        return {
          type: 'command_ack',
          command_id: command.id,
          status: 'failed',
          error_code: 'COMMAND_REJECTED',
          error: persisted?.command?.last_error || 'Command was rejected',
          replayed_from_cache: true,
        };
      }
      if (inboxState === 'completed' || inboxState === 'failed') {
        return {
          type: 'command_ack',
          command_id: command.id,
          status: 'failed',
          error_code: 'COMMAND_RESULT_INTEGRITY_ERROR',
          error: 'Durable command state has no replayable execution result',
        };
      }
      if (!persisted?.may_execute) {
        await fetchPost(
          `/remote-control/commands/${encodeURIComponent(command.id)}/admission`,
          {
            status: 'rejected',
            event_id: `${command.id}:admission`,
            reason: 'expired_or_receipt_not_confirmed',
          },
          brainHeaders(command)
        );
        return {
          type: 'command_ack',
          command_id: command.id,
          status: 'failed',
          error_code: 'COMMAND_RECEIPT_NOT_CONFIRMED',
          error: 'Command expired or could not pass its receipt gate',
        };
      }

      await fetchPost(
        `/remote-control/commands/${encodeURIComponent(command.id)}/admission`,
        {
          status: 'accepted',
          event_id: `${command.id}:admission`,
        },
        brainHeaders(command)
      );
      let ack: BridgeAck;
      try {
        ack = await executeCommand(command);
      } catch (error) {
        ack = commandErrorAck(command.id, error);
      }
      try {
        await persistCommandResult(command, {
          status: ack.status === 'acknowledged' ? 'completed' : 'failed',
          event_id: `${command.id}:execution-result`,
          result: ack.result || {},
          error_code: ack.error_code,
          error: ack.error,
        });
      } catch (error) {
        // The execution outcome is authoritative. Keep its exact payload in a
        // durable renderer queue and retry it; never replace it with a fake
        // execution.failed ACK caused by an upload/notification failure.
        console.warn('[RemoteControlBridge] Command result queued for retry', {
          command_id: command.id,
          error,
        });
      }
      return ack;
    };

    const handleCommand = (command: RemoteCommand) => {
      console.info('[RemoteControlBridge][RC-TRACE] command received', {
        command_id: command.id,
        type: command.type,
        target_project_id: command.target_project_id,
        target_task_id: command.target_task_id,
        next_task_id: command.next_task_id,
        active_project_id: useProjectStore.getState().activeProjectId,
      });
      const cache = cacheRef.current;
      const existing = cache.get(command.id);
      if (existing?.state === 'done') {
        console.info('[RemoteControlBridge][RC-TRACE] replaying cached ack', {
          command_id: command.id,
          status: existing.ack.status,
        });
        sendAck({ ...existing.ack, replayed_from_cache: true });
        return;
      }
      if (existing?.state === 'in_progress') {
        existing.promise.then(sendAck).catch((error) => {
          sendAck(commandErrorAck(command.id, error));
        });
        return;
      }

      let resolveAck: (ack: BridgeAck) => void;
      const promise = new Promise<BridgeAck>((resolve) => {
        resolveAck = resolve;
      });
      cache.set(command.id, { state: 'in_progress', promise });
      trimCache(cache);

      persistCommandAndExecute(command)
        .then(resolveAck!)
        .catch((error) => resolveAck!(commandErrorAck(command.id, error)));

      promise.then((ack) => {
        cache.set(command.id, {
          state: 'done',
          ack,
          completedAt: Date.now(),
        });
        trimCache(cache);
        console.info('[RemoteControlBridge][RC-TRACE] sending ack', {
          command_id: command.id,
          status: ack.status,
          error_code: ack.error_code,
          error: ack.error,
        });
        sendAck(ack);
      });
    };

    const replayDurableInbox = async () => {
      try {
        const response = await fetchGet(
          '/remote-control/commands/inbox/pending',
          { limit: 100 }
        );
        const items = Array.isArray(response?.items) ? response.items : [];
        for (const item of items) {
          if (item?.payload?.id) {
            handleCommand(item.payload as RemoteCommand);
          }
        }
      } catch (error) {
        console.warn(
          '[RemoteControlBridge] Durable Inbox reconciliation failed',
          error
        );
      }
    };

    const reconcileRemoteFollowUps = async () => {
      try {
        const items = await listPendingRemoteFollowUpRequests();
        for (const item of items) {
          if (!item.source_command_id) continue;
          scheduleRemoteFollowUp({
            id: item.source_command_id,
            session_id: 'durable-follow-up-recovery',
            user_id: 0,
            project_id: item.project_id,
            target_project_id: item.project_id,
            source_channel: 'remote_control',
            type: 'user_message',
            payload: {
              content: item.content,
              attachments: item.attachment_paths,
            },
            next_task_id: item.request_id,
          });
        }
      } catch (error) {
        console.warn(
          '[RemoteControlBridge] Durable follow-up reconciliation failed',
          error
        );
      }
    };

    const connect = async () => {
      let url = '';
      try {
        if (!desktopInstanceId) {
          desktopInstanceId = await getRemoteControlDesktopInstanceId();
        }
        url = await getRemoteControlWebSocketUrl(
          '/api/v1/remote-control/bridge/subscribe'
        );
        if (stopped) {
          return;
        }
        ws = new WebSocket(url);
      } catch (error) {
        console.warn(
          '[RemoteControlBridge] Bridge identity or URL resolution failed',
          error
        );
        if (!stopped) {
          const base = Math.min(30_000, 3_000 * 2 ** reconnectAttempt);
          const delay = base + Math.floor(Math.random() * 1_000);
          reconnectAttempt += 1;
          reconnectTimer = window.setTimeout(() => void connect(), delay);
        }
        return;
      }
      console.info('[RemoteControlBridge][RC-TRACE] connecting bridge ws', {
        url,
        desktop_instance_id: desktopInstanceId,
        attempt: reconnectAttempt,
      });
      ws.onopen = () => {
        send({
          type: 'subscribe',
          desktop_instance_id: desktopInstanceId,
          auth_token: tokenRef.current,
          app_version: import.meta.env.VITE_APP_VERSION || 'dev',
          capabilities: BRIDGE_CAPABILITIES,
        });
        pingTimer = window.setInterval(() => {
          // Piggyback the latest auth token so the server can extend the
          // bridge across short-lived JWT rotations without forcing a
          // reconnect.
          send({ type: 'ping', auth_token: tokenRef.current });
        }, 30000);
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message?.type === 'connected') {
            // Reset backoff only after application-level registration. A raw
            // WebSocket open followed by a policy rejection is not success.
            reconnectAttempt = 0;
            console.info(
              '[RemoteControlBridge][RC-TRACE] bridge registered on server',
              { desktop_instance_id: desktopInstanceId }
            );
            setRemoteControlBridgeConnected(true);
            void flushPendingCommandResults()
              .then(replayDurableInbox)
              .then(reconcileRemoteFollowUps);
            return;
          }
          const bridgeError = serverBridgeError(message);
          if (bridgeError) {
            console.error(
              '[RemoteControlBridge] Bridge registration rejected',
              bridgeError
            );
            setRemoteControlBridgeConnected(false, bridgeError);
            if (!bridgeError.retryable) {
              stopped = true;
              ws?.close(1000, bridgeError.code.slice(0, 120));
            }
            return;
          }
          if (message?.type === 'auth_expired') {
            // JWT expired or rejected. Stop attempting; the auth store will
            // refresh on its own schedule and the hook will rerun with the
            // new token because `tokenRef.current` is captured fresh on
            // the next mount.
            stopped = true;
            setRemoteControlBridgeConnected(false);
            ws?.close();
            getAuthStore().logout();
            return;
          }
          if (message?.type === 'revoke_bridge') {
            // Server has revoked our token (logout / password change).
            stopped = true;
            setRemoteControlBridgeConnected(false);
            ws?.close();
            getAuthStore().logout();
            return;
          }
          if (message?.type === 'remote_command' && message.command?.id) {
            handleCommand(message.command);
          }
        } catch (error) {
          console.warn('[RemoteControlBridge] Invalid message', error);
        }
      };
      ws.onclose = (event) => {
        console.warn('[RemoteControlBridge][RC-TRACE] bridge ws closed', {
          code: event?.code,
          reason: event?.reason,
          wasClean: event?.wasClean,
          stopped,
          attempt: reconnectAttempt,
        });
        if (!stopped && event?.code === 1008) {
          stopped = true;
          setRemoteControlBridgeConnected(false, {
            code: 'bridge_policy_rejected',
            message:
              event?.reason ||
              'Remote control bridge registration was rejected by policy.',
            retryable: false,
          });
        } else {
          setRemoteControlBridgeConnected(false);
        }
        if (pingTimer) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (!stopped) {
          // Jittered exponential backoff to avoid reconnect stampedes on
          // server restarts.
          const base = Math.min(30_000, 3_000 * 2 ** reconnectAttempt);
          const delay = base + Math.floor(Math.random() * 1_000);
          reconnectAttempt += 1;
          reconnectTimer = window.setTimeout(() => void connect(), delay);
        }
      };
      ws.onerror = () => {
        ws?.close();
      };
    };

    void connect();

    return () => {
      stopped = true;
      if (pingTimer) {
        window.clearInterval(pingTimer);
      }
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      for (const timer of followUpTimers.values()) {
        window.clearTimeout(timer);
      }
      followUpTimers.clear();
      followUpAttempts.clear();
      setRemoteControlBridgeConnected(false);
      ws?.close();
    };
  }, [backendReady, token]);
}
