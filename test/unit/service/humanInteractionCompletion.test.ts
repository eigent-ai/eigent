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

import { completeHumanInteraction } from '@/service/humanInteractionCompletion';
import { useChatStore as createChatStore } from '@/store/chatStore';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/store/projectStore', () => ({
  useProjectStore: { getState: () => ({ activeProjectId: null }) },
}));

describe('canonical human interaction completion', () => {
  it.each(['approval', 'question'] as const)(
    'advances the exact %s ask once with zero or one queued ask',
    (type) => {
      for (const queued of [false, true]) {
        const store = createChatStore();
        const id = store.getState().create();
        store.getState().setActiveTaskId(id);
        store.getState().setActiveAsk(id, 'worker');
        store.getState().setDurableRunStatus(id, 'waiting_for_user');
        store.getState().addMessages(id, {
          id: 'ask',
          role: 'agent',
          step: 'ask',
          agent_name: 'worker',
          content: '?',
          interaction: {
            interaction_id: 'current',
            interaction_type: type,
            run_id: id,
          },
        });
        if (queued)
          store.getState().setActiveAskList(id, [
            {
              id: 'next',
              role: 'agent',
              step: 'ask',
              agent_name: 'next-worker',
              content: '?',
              interaction: {
                interaction_id: 'next',
                interaction_type: 'question',
                run_id: id,
              },
            },
          ]);
        completeHumanInteraction(store.getState(), id, 'current');
        completeHumanInteraction(store.getState(), id, 'current');
        const task = store.getState().tasks[id];
        expect(task.activeAsk).toBe(queued ? 'next-worker' : '');
        expect(task.askList).toHaveLength(0);
        expect(
          task.messages.filter((message) => message.id === 'next')
        ).toHaveLength(queued ? 1 : 0);
        expect(task.durableRunStatus).toBe('waiting_for_user');
      }
    }
  );

  it('does not advance a different interaction or selected Run', () => {
    const store = createChatStore();
    const id = store.getState().create();
    store.getState().setActiveTaskId(id);
    store.getState().setActiveAsk(id, 'worker');
    store.getState().addMessages(id, {
      id: 'ask',
      role: 'agent',
      step: 'ask',
      agent_name: 'worker',
      content: '?',
      interaction: {
        interaction_id: 'current',
        interaction_type: 'approval',
        run_id: id,
      },
    });
    completeHumanInteraction(store.getState(), id, 'other');
    expect(store.getState().tasks[id].activeAsk).toBe('worker');
    store.getState().setActiveTaskId(store.getState().create());
    completeHumanInteraction(store.getState(), id, 'current');
    expect(store.getState().tasks[id].resolvedInteractionIds).not.toContain(
      'current'
    );
  });
});
