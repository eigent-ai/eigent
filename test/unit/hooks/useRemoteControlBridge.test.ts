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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({
  fetchDelete: vi.fn(),
  fetchGet: vi.fn(() => Promise.resolve({ items: [] })),
  fetchPost: vi.fn((path: string, body?: Record<string, unknown>) => {
    if (path.endsWith('/follow-ups')) {
      const requestId = String(body?.request_id || 'request-1');
      return Promise.resolve({
        request_id: requestId,
        project_id: path.split('/')[2],
        content: String(body?.content || ''),
        attachment_paths: body?.attachment_paths || [],
        delivery_mode: 'wait',
        status: 'pending',
        source: body?.source || 'local',
        source_command_id: body?.source_command_id || null,
        created_at: 1,
        updated_at: 1,
      });
    }
    return Promise.resolve({});
  }),
  fetchPut: vi.fn(),
  getBaseURL: vi.fn(() => Promise.resolve('')),
  getLocalControlCapability: vi.fn(() =>
    Promise.resolve('renderer-capability')
  ),
  proxyFetchGet: vi.fn(() => Promise.resolve({ items: [] })),
  proxyFetchPost: vi.fn(() => Promise.resolve({ id: 'history-id' })),
  proxyFetchPut: vi.fn(),
  sseTransport: vi.fn(() => Promise.resolve()),
  uploadFile: vi.fn(),
  waitForBackendReady: vi.fn(() => Promise.resolve(true)),
}));

import { fetchGet, fetchPost } from '@/api/http';
import {
  __remoteControlBridgeTestHooks,
  ackFromDurableExecution,
} from '@/hooks/useRemoteControlBridge';
import { useProjectStore } from '@/store/projectStore';
import { SPACE_SCHEMA_VERSION, useSpaceStore } from '@/store/spaceStore';

describe('useRemoteControlBridge internals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchPost).mockImplementation(async (_url, body: any) => ({
      request_id: body?.request_id || 'request-id',
      project_id: 'project-target',
      content: body?.content || '',
      attachment_paths: body?.attachment_paths || [],
      delivery_mode: 'wait',
      status: 'pending',
      source: body?.source || 'remote_control',
      source_command_id: body?.source_command_id || null,
      created_at: 1,
      updated_at: 1,
    }));
    useProjectStore.setState({
      activeProjectId: null,
      projects: {},
      navLeadByProjectId: {},
      historyLoadingProjectIds: {},
      staleProjectIds: new Set(),
    });
    useSpaceStore.setState({
      activeSpaceId: 'space-active',
      spaces: {
        'space-active': {
          id: 'space-active',
          name: 'Active Space',
          sourceType: 'blank',
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      lastVisitedProjectBySpace: {},
      projectsBySpaceId: {},
      projectIdIndex: {},
      projectsSyncedAt: {},
    });
  });

  it('allows user_message commands for a non-active Project without switching foreground Project', async () => {
    const activeProjectId = useProjectStore
      .getState()
      .createProject('Active Project', undefined, 'project-active');

    vi.mocked(fetchGet).mockImplementation(async (url) =>
      url === '/projects/project-target/follow-ups'
        ? {
            items: [
              {
                request_id: 'task-target-next',
                project_id: 'project-target',
                content: 'Continue the target project in the background',
                attachment_paths: [],
                delivery_mode: 'wait',
                status: 'pending',
                source: 'remote_control',
                source_command_id: 'rc_cmd_cross_project',
                created_at: 1,
                updated_at: 1,
              },
            ],
          }
        : { has_lock: true, status: 'running' }
    );

    const ack = await __remoteControlBridgeTestHooks.executeRemoteCommand(
      {
        id: 'rc_cmd_cross_project',
        session_id: 'session-1',
        user_id: 1,
        source_channel: 'remote_control',
        type: 'user_message',
        target_project_id: 'project-target',
        payload: {
          content: 'Continue the target project in the background',
          project_name: 'Target Project',
          space_id: 'space-active',
        },
        next_task_id: 'task-target-next',
      },
      'token'
    );

    expect(ack).toMatchObject({
      type: 'command_ack',
      command_id: 'rc_cmd_cross_project',
      status: 'acknowledged',
      result: { queued: true },
    });
    expect(useProjectStore.getState().activeProjectId).toBe(activeProjectId);
    expect(useProjectStore.getState().projects['project-target']).toBeDefined();
    expect(fetchGet).toHaveBeenCalledWith(
      '/projects/project-target/follow-ups'
    );
    expect(fetchPost).not.toHaveBeenCalledWith(
      '/chat/project-target',
      expect.anything()
    );
    expect(fetchGet).toHaveBeenCalledWith('/chat/project-target/status');
  });

  it('starts local user_message tasks against the target Project without switching foreground Project', async () => {
    const activeProjectId = useProjectStore
      .getState()
      .createProject('Active Project', undefined, 'project-active');
    useProjectStore
      .getState()
      .createProject(
        'Target Project',
        undefined,
        'project-target',
        undefined,
        undefined,
        false,
        { spaceId: 'space-active', mode: 'single-agent' }
      );
    const targetChatStore = useProjectStore
      .getState()
      .getChatStore('project-target');
    const startTask = vi.fn(() => Promise.resolve());
    targetChatStore?.setState({ startTask } as any);

    vi.mocked(fetchGet).mockImplementation(async (url) =>
      url === '/projects/project-target/follow-ups'
        ? {
            items: [
              {
                request_id: 'task-target-next',
                project_id: 'project-target',
                content: 'Start local background task',
                attachment_paths: [],
                delivery_mode: 'wait',
                status: 'pending',
                source: 'remote_control',
                source_command_id: 'rc_cmd_local_start',
                created_at: 1,
                updated_at: 1,
              },
            ],
          }
        : { has_lock: false, status: 'idle' }
    );

    const ack = await __remoteControlBridgeTestHooks.executeRemoteCommand(
      {
        id: 'rc_cmd_local_start',
        session_id: 'session-1',
        user_id: 1,
        source_channel: 'remote_control',
        type: 'user_message',
        target_project_id: 'project-target',
        payload: {
          content: 'Start local background task',
          project_name: 'Target Project',
          space_id: 'space-active',
        },
        next_task_id: 'task-target-next',
      },
      'token'
    );

    expect(ack).toMatchObject({
      type: 'command_ack',
      command_id: 'rc_cmd_local_start',
      status: 'acknowledged',
    });
    expect(useProjectStore.getState().activeProjectId).toBe(activeProjectId);
    expect(startTask).toHaveBeenCalledTimes(1);
    expect(startTask.mock.calls[0]?.[0]).toBe('task-target-next');
    expect(startTask.mock.calls[0]?.[4]).toBe('Start local background task');
    expect(startTask.mock.calls[0]?.[7]).toBe('project-target');
    expect(startTask.mock.calls[0]?.[8]).toBe('single-agent');
    expect(startTask.mock.calls[0]?.[9]).toMatchObject({
      preserveTaskId: true,
      skipHistoryCreate: false,
      historyId: null,
    });
    expect(fetchGet).toHaveBeenCalledWith(
      '/projects/project-target/follow-ups'
    );
    expect(fetchGet).toHaveBeenCalledWith('/chat/project-target/status');
  });

  it('keeps remote history metadata on inactive background Projects', () => {
    const activeProjectId = useProjectStore
      .getState()
      .createProject('Active Project', undefined, 'project-active');

    __remoteControlBridgeTestHooks.ensureRemoteProjectLoaded({
      id: 'rc_cmd_history_meta',
      session_id: 'session-1',
      user_id: 1,
      source_channel: 'remote_control',
      type: 'user_message',
      target_project_id: 'project-target',
      payload: {
        content: 'Start local background task',
        project_name: 'Target Project',
        space_id: 'space-active',
        history_id: 'legacy-history-id',
        remote_history_id: 'remote-history-id',
      },
      next_task_id: 'task-target-next',
    });

    const project = useProjectStore.getState().projects['project-target'];
    expect(useProjectStore.getState().activeProjectId).toBe(activeProjectId);
    expect(project).toBeDefined();
    expect(project.metadata?.historyId).toBe('remote-history-id');
    expect(project.metadata?.remoteHistoryHydrationPending).toBe(true);
  });
});

describe('remote command durable ACK replay', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('treats a device owner mismatch as a terminal bridge error', () => {
    expect(
      __remoteControlBridgeTestHooks.serverBridgeError({
        type: 'error',
        code: 'device_owner_mismatch',
        message: 'Desktop device belongs to another user',
        retryable: false,
      })
    ).toEqual({
      code: 'device_owner_mismatch',
      message: 'Desktop device belongs to another user',
      retryable: false,
    });
  });

  it('replays the canonical completed outcome without executing again', () => {
    expect(
      ackFromDurableExecution('command-1', {
        event_type: 'execution.completed',
        payload: { result: { run_id: 'run-1' } },
      })
    ).toEqual({
      type: 'command_ack',
      command_id: 'command-1',
      status: 'acknowledged',
      result: { run_id: 'run-1' },
      replayed_from_cache: true,
    });
  });

  it('replays the canonical failure rather than an upload error', () => {
    expect(
      ackFromDurableExecution('command-1', {
        event_type: 'execution.failed',
        payload: { error_code: 'TOOL_FAILED', error: 'original failure' },
      })
    ).toMatchObject({
      status: 'failed',
      error_code: 'TOOL_FAILED',
      error: 'original failure',
    });
  });

  it('preserves a queued execution result when restart reconciliation races it', () => {
    const command = {
      id: 'command-1',
      session_id: 'session-1',
      user_id: 1,
      source_channel: 'remote_control' as const,
      type: 'user_message',
      target_project_id: 'project-1',
      payload: {},
    };
    const completed = {
      status: 'completed' as const,
      event_id: 'command-1:execution-result',
      result: { run_id: 'run-1' },
    };

    __remoteControlBridgeTestHooks.queuePendingCommandResult({
      command,
      body: completed,
    });
    const durable = __remoteControlBridgeTestHooks.queuePendingCommandResult({
      command,
      body: {
        status: 'failed',
        event_id: 'command-1:recovery-outcome-unknown',
        result: {},
        error_code: 'COMMAND_OUTCOME_UNKNOWN_AFTER_RESTART',
      },
    });

    expect(durable.body).toEqual(completed);
    expect(
      __remoteControlBridgeTestHooks.ackFromPendingCommandResult(
        command.id,
        durable.body
      )
    ).toMatchObject({
      status: 'acknowledged',
      result: { run_id: 'run-1' },
    });
  });
});
