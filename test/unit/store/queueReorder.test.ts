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

import { useProjectStore } from '@/store/projectStore';
import { afterEach, expect, it } from 'vitest';
const original = useProjectStore.getState();
type TaskQueue = (typeof original.projects)[string]['queuedMessages'][number];
afterEach(() => useProjectStore.setState(original, true));
function setup(extra: Partial<TaskQueue> = {}) {
  const queue = ['a', 'b', 'c'].map((id) => ({
    task_id: id,
    run_id: id,
    content: id,
    timestamp: 1,
    attaches: [],
    ...(id === 'b' ? extra : {}),
  }));
  useProjectStore.setState({
    projects: { s: { ...original.projects.s, queuedMessages: queue } as any },
  });
  return queue;
}
it('changes the actual dispatcher array and retains the full queued records', () => {
  const queue = setup();
  useProjectStore.getState().reorderQueuedMessage('s', 'a', 'c');
  expect(useProjectStore.getState().projects.s.queuedMessages).toEqual([
    queue[1],
    queue[2],
    queue[0],
  ]);
  useProjectStore.getState().reorderQueuedMessage('s', 'a', 'b');
  expect(useProjectStore.getState().projects.s.queuedMessages).toEqual(queue);
});
it('ignores stale IDs, missing sessions and queues being admitted or prioritized', () => {
  for (const state of [{}, { processing: true }, { sendNow: true }]) {
    const queue = setup(state);
    useProjectStore.getState().reorderQueuedMessage('missing', 'a', 'c');
    useProjectStore.getState().reorderQueuedMessage('s', 'removed', 'c');
    useProjectStore.getState().reorderQueuedMessage('s', 'a', 'removed');
    if ('processing' in state || 'sendNow' in state)
      useProjectStore.getState().reorderQueuedMessage('s', 'a', 'c');
    expect(useProjectStore.getState().projects.s.queuedMessages).toEqual(queue);
  }
});
it('does not reorder tasks owned by external execution sources', () => {
  for (const state of [
    { executionId: 'external' },
    { source: 'remote_control' as const },
    { source: 'scheduled' as const },
  ]) {
    const queue = setup(state);
    useProjectStore.getState().reorderQueuedMessage('s', 'b', 'c');
    useProjectStore.getState().reorderQueuedMessage('s', 'a', 'b');
    expect(useProjectStore.getState().projects.s.queuedMessages).toEqual(queue);
  }
});
