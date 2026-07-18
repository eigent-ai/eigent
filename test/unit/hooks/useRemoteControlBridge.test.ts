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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({
  fetchDelete: vi.fn(),
  fetchPost: vi.fn(),
  fetchPut: vi.fn(),
  getBaseURL: vi.fn(() => Promise.resolve('')),
  proxyFetchGet: vi.fn(() => Promise.resolve({ items: [] })),
  proxyFetchPost: vi.fn(() => Promise.resolve({ id: 'history-id' })),
  proxyFetchPut: vi.fn(),
  sseTransport: vi.fn(() => Promise.resolve()),
  uploadFile: vi.fn(),
  waitForBackendReady: vi.fn(() => Promise.resolve(true)),
}));

import { __remoteControlBridgeTestHooks } from '@/hooks/useRemoteControlBridge';
import { useProjectStore } from '@/store/projectStore';
import { SPACE_SCHEMA_VERSION, useSpaceStore } from '@/store/spaceStore';

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : '',
    },
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as Response;
}

describe('useRemoteControlBridge internals', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
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

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('allows user_message commands for a non-active Project without switching foreground Project', async () => {
    const activeProjectId = useProjectStore
      .getState()
      .createProject('Active Project', undefined, 'project-active');

    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({ has_lock: true, status: 'running' })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

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
    });
    expect(useProjectStore.getState().activeProjectId).toBe(activeProjectId);
    expect(useProjectStore.getState().projects['project-target']).toBeDefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/chat/project-target/status');
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('/chat/project-target');
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

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ has_lock: false, status: 'idle' })
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
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/chat/project-target/status');
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
