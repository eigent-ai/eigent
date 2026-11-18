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
  createPlaybackUserWaitTracker,
  resolveHistoricalRunElapsedMs,
  settleTaskElapsedMs,
} from '@/lib/taskDuration';
import { AgentStep } from '@/types/constants';
import { describe, expect, it } from 'vitest';

describe('settleTaskElapsedMs', () => {
  it('adds the live attempt to previously settled elapsed time', () => {
    expect(
      settleTaskElapsedMs({ taskTime: 1_000, elapsed: 2_000 }, 8_500)
    ).toBe(9_500);
  });

  it('keeps an already settled duration unchanged', () => {
    expect(settleTaskElapsedMs({ taskTime: 0, elapsed: 12_345 }, 99_000)).toBe(
      12_345
    );
  });
});

describe('resolveHistoricalRunElapsedMs', () => {
  it('prefers the canonical attempt aggregate', () => {
    expect(
      resolveHistoricalRunElapsedMs({
        totalAttemptElapsedMs: 12_345,
        createdAt: 100,
        updatedAt: 200,
      })
    ).toBe(12_345);
  });

  it('uses RunJournal Unix-second boundaries for cloud-restored history', () => {
    expect(
      resolveHistoricalRunElapsedMs({
        createdAt: 1_786_101_992.187,
        updatedAt: 1_786_102_022.109,
      })
    ).toBeCloseTo(29_922, 0);
  });

  it('does not invent a duration without both boundaries', () => {
    expect(resolveHistoricalRunElapsedMs({ createdAt: 123 })).toBeUndefined();
  });
});

describe('createPlaybackUserWaitTracker', () => {
  it('leaves question and approval waits out of a restored Run', () => {
    const waits = createPlaybackUserWaitTracker();
    // Journal order: the request, then its legacy ask frame for the same id.
    waits.observe(AgentStep.ASK, 'question-1', 4_000);
    waits.observe(AgentStep.ACTIVATE_TOOLKIT, undefined, 4_100);
    waits.observe(AgentStep.ASK, 'question-1', 4_200);
    waits.observe(AgentStep.HUMAN_REPLY, 'question-1', 14_231);
    waits.observe(AgentStep.HUMAN_REPLY, 'question-1', 14_300);
    waits.observe(AgentStep.ASK, 'approval:run-1:call-1', 20_000);
    waits.observe(AgentStep.HUMAN_REPLY, 'approval:run-1:call-1', 36_831);

    expect(waits.waitedMs()).toBe(10_231 + 16_831);
  });

  it('counts overlapping waits once and ignores a wait still open', () => {
    const waits = createPlaybackUserWaitTracker();
    waits.observe(AgentStep.ASK, 'a', 1_000);
    waits.observe(AgentStep.ASK, 'b', 2_000);
    waits.observe(AgentStep.HUMAN_REPLY, 'a', 3_000);
    waits.observe(AgentStep.HUMAN_REPLY, 'b', 5_000);
    waits.observe(AgentStep.ASK, 'c', 6_000);
    waits.observe(AgentStep.HUMAN_REPLY, 'unknown', 7_000);

    expect(waits.waitedMs()).toBe(4_000);
  });
});
