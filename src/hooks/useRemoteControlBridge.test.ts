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
  __remoteControlBridgeTestHooks,
  ackFromDurableExecution,
} from './useRemoteControlBridge';

describe('remote command durable ACK replay', () => {
  beforeEach(() => {
    window.localStorage.clear();
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
