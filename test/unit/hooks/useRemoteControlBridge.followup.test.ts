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

import { fetchGet, fetchPost } from '@/api/http';
import { __remoteControlBridgeTestHooks } from '@/hooks/useRemoteControlBridge';
import {
  createFollowUpRequest,
  listPendingFollowUpRequests,
  markFollowUpRequestAdmitted,
} from '@/service/followUpQueueApi';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const restoreQueuedMessage = vi.fn();
const removeQueuedMessage = vi.fn();
const startTask = vi.fn();

vi.mock('@/api/http', () => ({
  fetchGet: vi.fn(),
  fetchPost: vi.fn(),
  getBaseURL: vi.fn(() => 'http://localhost:5001'),
  getLocalControlCapability: vi.fn(() => 'capability'),
  proxyFetchGet: vi.fn(),
}));

vi.mock('@/service/followUpQueueApi', () => ({
  createFollowUpRequest: vi.fn(),
  getRemoteFollowUpByCommandId: vi.fn(),
  listPendingFollowUpRequests: vi.fn(),
  listPendingRemoteFollowUpRequests: vi.fn(),
  markFollowUpRequestAdmitted: vi.fn(),
  terminalContinuationAdmissionRejection: (error: any) => {
    const detail = error?.response?.data?.detail;
    return detail?.interaction_type === 'continuation_clarification' &&
      detail?.code === 'continuation_clarification_required'
      ? detail
      : null;
  },
}));

vi.mock('@/store/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      projects: { 'project-1': { chatStores: {} } },
      getProjectById: () => ({ mode: 'single-agent' }),
      getChatStore: () => ({ getState: () => ({ startTask }) }),
      restoreQueuedMessage,
      removeQueuedMessage,
    }),
  },
}));

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: {
    getState: () => ({
      getProjectMeta: vi.fn(),
      upsertSpaces: vi.fn(),
      upsertProjectMetas: vi.fn(),
      resetForUser: vi.fn(),
      ensureLegacySpace: vi.fn(),
    }),
  },
  projectMetaFromServer: vi.fn(),
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({ logout: vi.fn() }),
}));

describe('Remote Control durable follow-up admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createFollowUpRequest).mockResolvedValue({
      request_id: 'run-2',
      project_id: 'project-1',
      content: 'continue the report',
      attachment_paths: [],
      delivery_mode: 'wait',
      status: 'pending',
      source: 'remote_control',
      source_command_id: 'command-1',
      created_at: 1,
      updated_at: 1,
    });
    vi.mocked(listPendingFollowUpRequests).mockResolvedValue([
      {
        request_id: 'run-2',
        project_id: 'project-1',
        content: 'continue the report',
        attachment_paths: [],
        delivery_mode: 'wait',
        status: 'pending',
        source: 'remote_control',
        source_command_id: 'command-1',
        created_at: 1,
        updated_at: 1,
      },
    ]);
    vi.mocked(fetchGet).mockResolvedValue({
      has_lock: true,
      status: 'processing',
    });
    vi.mocked(markFollowUpRequestAdmitted).mockResolvedValue({} as never);
    startTask.mockResolvedValue(undefined);
  });

  it('persists an active-Run phone message instead of calling /chat directly', async () => {
    const schedule = vi.fn();
    const command = {
      id: 'command-1',
      session_id: 'session-1',
      user_id: 1,
      source_channel: 'remote_control',
      type: 'user_message',
      target_project_id: 'project-1',
      next_task_id: 'run-2',
      payload: { content: 'continue the report' },
    };

    const ack = await __remoteControlBridgeTestHooks.executeRemoteCommand(
      command,
      'token',
      schedule
    );

    expect(createFollowUpRequest).toHaveBeenCalledWith({
      projectId: 'project-1',
      requestId: 'run-2',
      content: 'continue the report',
      attachmentPaths: [],
      source: 'remote_control',
      sourceCommandId: 'command-1',
    });
    expect(schedule).toHaveBeenCalledWith(command);
    expect(fetchPost).not.toHaveBeenCalledWith(
      '/chat/project-1',
      expect.anything()
    );
    expect(ack).toMatchObject({
      status: 'acknowledged',
      result: { follow_up_request_id: 'run-2', queued: true },
    });
  });

  it('reconstructs an enqueue acknowledgement from its durable queue row', () => {
    expect(
      __remoteControlBridgeTestHooks.ackFromDurableFollowUp('command-1', {
        request_id: 'run-2',
        project_id: 'project-1',
        content: 'continue the report',
        attachment_paths: [],
        delivery_mode: 'wait',
        status: 'admitted',
        admitted_run_id: 'run-2',
        source: 'remote_control',
        source_command_id: 'command-1',
        created_at: 1,
        updated_at: 2,
      })
    ).toMatchObject({
      status: 'acknowledged',
      replayed_from_cache: true,
      result: {
        follow_up_request_id: 'run-2',
        queued: false,
        follow_up_status: 'admitted',
        admitted_run_id: 'run-2',
      },
    });
  });

  it('relies on Brain atomic admission after an idle Project stream opens', async () => {
    vi.mocked(fetchGet).mockResolvedValue({ has_lock: false, status: 'idle' });
    const command = {
      id: 'command-1',
      session_id: 'session-1',
      user_id: 1,
      source_channel: 'remote_control',
      type: 'user_message',
      target_project_id: 'project-1',
      next_task_id: 'run-2',
      payload: { content: 'continue the report' },
    };

    await __remoteControlBridgeTestHooks.executeRemoteCommand(command, 'token');

    expect(startTask).toHaveBeenCalledWith(
      'run-2',
      undefined,
      undefined,
      undefined,
      'continue the report',
      [],
      undefined,
      'project-1',
      'single-agent',
      expect.objectContaining({ preserveTaskId: true, awaitAdmission: true })
    );
    expect(markFollowUpRequestAdmitted).not.toHaveBeenCalled();
    expect(removeQueuedMessage).toHaveBeenCalledWith('project-1', 'run-2');
  });

  it('keeps the durable row pending when idle admission is rejected', async () => {
    vi.mocked(fetchGet).mockResolvedValue({ has_lock: false, status: 'idle' });
    startTask.mockRejectedValueOnce(new Error('admission rejected'));
    const command = {
      id: 'command-1',
      session_id: 'session-1',
      user_id: 1,
      source_channel: 'remote_control',
      type: 'user_message',
      target_project_id: 'project-1',
      next_task_id: 'run-2',
      payload: { content: 'continue the report' },
    };

    await expect(
      __remoteControlBridgeTestHooks.executeRemoteCommand(command, 'token')
    ).rejects.toThrow('admission rejected');
    expect(markFollowUpRequestAdmitted).not.toHaveBeenCalled();
    expect(removeQueuedMessage).not.toHaveBeenCalled();
  });

  it('removes the renderer row after a durable continuation clarification', async () => {
    vi.mocked(fetchGet).mockResolvedValue({ has_lock: false, status: 'idle' });
    const error: any = new Error('Say what should continue');
    error.response = {
      data: {
        detail: {
          code: 'continuation_clarification_required',
          message: 'Say what should continue',
          interaction_type: 'continuation_clarification',
          project_state_version: 2,
        },
      },
    };
    startTask.mockRejectedValueOnce(error);
    const command = {
      id: 'command-1',
      session_id: 'session-1',
      user_id: 1,
      source_channel: 'remote_control',
      type: 'user_message',
      target_project_id: 'project-1',
      next_task_id: 'run-2',
      payload: { content: 'continue the report' },
    };

    await expect(
      __remoteControlBridgeTestHooks.executeRemoteCommand(command, 'token')
    ).rejects.toThrow('Say what should continue');
    expect(markFollowUpRequestAdmitted).not.toHaveBeenCalled();
    expect(removeQueuedMessage).toHaveBeenCalledWith('project-1', 'run-2');
  });
});
