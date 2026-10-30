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

import { hasUnfinishedLegacyTask } from '@/lib/unfinishedLegacyTask';
import { describe, expect, it } from 'vitest';

describe('unfinished task in this window', () => {
  const task = (overrides: Record<string, unknown> = {}) => ({
    status: 'pending',
    isPending: false,
    activeAsk: '',
    ...overrides,
  });
  const store = (...tasks: ReturnType<typeof task>[]) => ({
    tasks: Object.fromEntries(tasks.map((item, index) => [`t${index}`, item])),
  });

  it.each([
    ['starting (sent, no reply yet)', task({ isPending: true })],
    ['running its first model call', task({ status: 'running' })],
    ['running a tool', task({ status: 'running', isPending: false })],
    ['paused for the user', task({ status: 'pause' })],
    ['waiting for an answer', task({ activeAsk: 'Developer Agent' })],
  ])('counts a task %s', (_label, unfinished) => {
    expect(
      hasUnfinishedLegacyTask([undefined, store(task(), unfinished)])
    ).toBe(true);
  });

  it.each([
    ['a fresh empty task', task()],
    ['a finished task', task({ status: 'finished' })],
    ['a replayed running task', task({ status: 'running', type: 'replay' })],
    ['a shared task', task({ isPending: true, type: 'share' })],
  ])('ignores %s', (_label, idle) => {
    expect(hasUnfinishedLegacyTask([store(idle), undefined])).toBe(false);
  });
});
