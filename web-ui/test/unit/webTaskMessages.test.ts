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

import { AgentStep, ChatTaskStatus } from '@/types/constants';
import {
  getWebTaskElapsedMs,
  isDisplayableAgentMessage,
  shouldShowWebTaskLoading,
} from '@web/lib/webTaskMessages';
import { describe, expect, it } from 'vitest';

describe('webTaskMessages', () => {
  it('hides internal agent steps without user-facing content', () => {
    expect(
      isDisplayableAgentMessage({
        id: '1',
        role: 'agent',
        content: '',
        step: AgentStep.TO_SUB_TASKS,
      })
    ).toBe(false);
    expect(
      isDisplayableAgentMessage({
        id: '2',
        role: 'agent',
        content: 'Done',
        step: AgentStep.END,
      })
    ).toBe(true);
  });

  it('shows loading while running without an agent reply after the last user turn', () => {
    expect(
      shouldShowWebTaskLoading({
        status: ChatTaskStatus.RUNNING,
        isPending: false,
        taskTime: Date.now(),
        elapsed: 0,
        messages: [
          { id: 'u1', role: 'user', content: 'Hello' },
          {
            id: 'a1',
            role: 'agent',
            content: '',
            step: AgentStep.TO_SUB_TASKS,
          },
        ],
      })
    ).toBe(true);
  });

  it('computes elapsed time from taskTime while active', () => {
    const now = 10_000;
    expect(
      getWebTaskElapsedMs(
        {
          status: ChatTaskStatus.RUNNING,
          isPending: false,
          taskTime: 4_000,
          elapsed: 1_000,
        },
        now
      )
    ).toBe(7_000);
  });
});
