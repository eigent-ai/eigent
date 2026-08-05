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

import { ackFromDurableExecution } from './useRemoteControlBridge';

describe('remote command durable ACK replay', () => {
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
});
