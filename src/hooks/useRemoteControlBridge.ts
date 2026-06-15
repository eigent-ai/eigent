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

import { getBaseURL } from '@/api/http';
import { isDesktop } from '@/client/platform';
import {
  getRemoteControlDesktopInstanceId,
  getRemoteControlWebSocketUrl,
  setRemoteControlBridgeConnected,
} from '@/lib/remoteControl';
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
};

type CacheEntry =
  | { state: 'in_progress'; promise: Promise<BridgeAck> }
  | { state: 'done'; ack: BridgeAck; completedAt: number };

const CACHE_LIMIT = 200;
const COMMAND_TIMEOUT_MS = 10000;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_COMMANDS = 5;
const BRIDGE_CAPABILITIES = {
  bridge_version: 1,
  commands: [
    'user_message',
    'human_reply',
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
    const response = await fetch(`${baseURL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...brainHeaders(command),
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

function assertDesktopOnTargetProject(command: RemoteCommand): void {
  const targetProjectId = getCommandProjectId(command);
  const activeProjectId = useProjectStore.getState().activeProjectId;
  if (targetProjectId && activeProjectId === targetProjectId) {
    return;
  }
  const error: any = new Error('Desktop is not on the target project yet');
  error.code = 'BRIDGE_TARGET_NOT_ACTIVE';
  error.details = { activeProjectId, targetProjectId };
  throw error;
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
    spaceStore.upsertSpaces([toLocalSpace(space)], String(space.id));
  }
  if (project) {
    spaceStore.upsertProjectMetas([projectMetaFromServer(project)]);
    projectStore.upsertProjectsFromServer([project]);
  }

  if (projectStore.getProjectById(projectId)) {
    projectStore.setActiveProject(projectId);
    return;
  }

  projectStore.createProject(
    String(payload.project_name || project?.name || 'Remote Project'),
    project?.description || '',
    projectId,
    undefined,
    payload.history_id ? String(payload.history_id) : undefined,
    true,
    {
      spaceId: payload.space_id
        ? String(payload.space_id)
        : command.space_id || project?.space_id,
      mode:
        (project?.mode as SessionModeType | null | undefined) ?? 'single-agent',
      workdirMode: project?.workdir_mode ?? null,
      metadata: project?.metadata ?? undefined,
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
  const historyId =
    payload.remote_history_id != null
      ? String(payload.remote_history_id)
      : payload.history_id != null
        ? String(payload.history_id)
        : null;

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

  const startPromise = chatStore
    .getState()
    .startTask(
      nextTaskId,
      undefined,
      undefined,
      undefined,
      content,
      [],
      undefined,
      projectId,
      sessionMode,
      {
        preserveTaskId: true,
        skipHistoryCreate: historyId != null,
        historyId,
      }
    );

  startPromise.catch((error: any) => {
    // RC-TRACE: this failure is invisible to the remote web page because the
    // command was already acked as acknowledged (fire-and-forget by design).
    console.error(
      '[RemoteControlBridge][RC-TRACE] startTask FAILED after ack:',
      { command_id: command.id, next_task_id: nextTaskId },
      error
    );
  });
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
  const chatStore = projectStore.getChatStore(projectId);
  const chatState = chatStore?.getState();
  const activeTaskId = chatState?.activeTaskId;
  if (
    !chatStore ||
    !chatState ||
    !activeTaskId ||
    !chatState.tasks[activeTaskId]
  ) {
    return;
  }

  const messageId = `remote-command:${command.id}`;
  const alreadySeeded = chatState.tasks[activeTaskId].messages.some(
    (message) => message.id === messageId
  );
  if (alreadySeeded) {
    return;
  }

  chatState.setNextTaskId(nextTaskId);
  chatState.setIsPending(activeTaskId, true);
  chatState.addMessages(activeTaskId, {
    id: messageId,
    role: 'user',
    content,
    attaches: [],
  });
  chatState.setHasMessages(activeTaskId, true);
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
  token: string
): Promise<BridgeAck> {
  if (command.type !== 'user_message') {
    await assertLocalTaskOnline(command, token);
  }
  const projectId = getCommandProjectId(command);

  switch (command.type) {
    case 'user_message': {
      assertDesktopOnTargetProject(command);
      const status = await requestBrain(
        command,
        token,
        'GET',
        `/chat/${projectId}/status`
      );
      console.info(
        '[RemoteControlBridge][RC-TRACE] user_message brain status',
        {
          command_id: command.id,
          project_id: projectId,
          has_lock: status?.has_lock,
          lock_status: status?.status,
          current_task_id: status?.current_task_id,
          branch: status?.has_lock ? 'improve_queue' : 'start_local_task',
        }
      );
      if (status?.has_lock) {
        seedRemoteFollowUpPrompt(command);
        await requestBrain(command, token, 'POST', `/chat/${projectId}`, {
          question: command.payload.content || command.payload.question || '',
          task_id: command.next_task_id,
          attaches: command.payload.attachments || [],
          target: command.payload.target,
        });
        console.info(
          '[RemoteControlBridge][RC-TRACE] improve request queued on brain',
          { command_id: command.id, next_task_id: command.next_task_id }
        );
      } else {
        await startLocalRemoteTask(command);
      }
      break;
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

export function useRemoteControlBridge(token: string | null | undefined) {
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const rateLimitRef = useRef<number[]>([]);
  const tokenRef = useRef<string | null | undefined>(token);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    if (!token || !isDesktop()) {
      setRemoteControlBridgeConnected(false);
      return;
    }

    let stopped = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let reconnectAttempt = 0;
    const desktopInstanceId = getRemoteControlDesktopInstanceId();

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

      return executeRemoteCommand(command, token);
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

      send({
        type: 'command_delivered',
        command_id: command.id,
      });

      executeCommand(command)
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

    const connect = async () => {
      const url = await getRemoteControlWebSocketUrl(
        '/api/v1/remote-control/bridge/subscribe'
      );
      if (stopped) {
        return;
      }
      ws = new WebSocket(url);
      console.info('[RemoteControlBridge][RC-TRACE] connecting bridge ws', {
        url,
        desktop_instance_id: desktopInstanceId,
        attempt: reconnectAttempt,
      });
      ws.onopen = () => {
        reconnectAttempt = 0;
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
            console.info(
              '[RemoteControlBridge][RC-TRACE] bridge registered on server',
              { desktop_instance_id: desktopInstanceId }
            );
            setRemoteControlBridgeConnected(true);
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
        setRemoteControlBridgeConnected(false);
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
          reconnectTimer = window.setTimeout(connect, delay);
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
      setRemoteControlBridgeConnected(false);
      ws?.close();
    };
  }, [token]);
}
