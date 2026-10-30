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

import { runProjectionStore } from '@/lib/runEvents/projectionStore';
import { takeControlOfTask } from '@/lib/taskRuntimeControl';
import type { ChatStore } from '@/store/chatStore';
import { ChatTaskStatus } from '@/types/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';

function createStore(status = ChatTaskStatus.RUNNING) {
  const task = { status, elapsed: 100, taskTime: 1_000 };
  const store = {
    tasks: { 'task-1': task },
    setElapsed: vi.fn((_taskId: string, elapsed: number) => {
      task.elapsed = elapsed;
    }),
    setTaskTime: vi.fn((_taskId: string, taskTime: number) => {
      task.taskTime = taskTime;
    }),
    setStatus: vi.fn((_taskId: string, nextStatus: typeof status) => {
      task.status = nextStatus;
    }),
  } as unknown as Pick<
    ChatStore,
    'tasks' | 'setElapsed' | 'setTaskTime' | 'setStatus'
  >;
  return { store, task };
}

describe('takeControlOfTask', () => {
  it('sends one pause request and updates the live task', async () => {
    const { store, task } = createStore();
    const request = vi.fn().mockResolvedValue(undefined);

    await expect(
      takeControlOfTask({
        chatStore: store,
        action: 'pause',
        projectId: 'project-1',
        taskId: 'task-1',
        request,
        now: () => 1_500,
      })
    ).resolves.toBe(true);

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('/task/project-1/take-control', {
      action: 'pause',
    });
    expect(task).toMatchObject({
      status: ChatTaskStatus.PAUSE,
      elapsed: 600,
      taskTime: 0,
    });
  });

  it('resumes a paused task and restores its state after a request failure', async () => {
    const { store, task } = createStore(ChatTaskStatus.PAUSE);
    const request = vi.fn().mockRejectedValue(new Error('offline'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(
      takeControlOfTask({
        chatStore: store,
        action: 'resume',
        projectId: 'project-1',
        taskId: 'task-1',
        request,
        now: () => 2_000,
      })
    ).resolves.toBe(false);

    expect(request).toHaveBeenCalledWith('/task/project-1/take-control', {
      action: 'resume',
    });
    expect(task).toMatchObject({
      status: ChatTaskStatus.PAUSE,
      elapsed: 100,
      taskTime: 1_000,
    });
    consoleError.mockRestore();
  });

  describe('while the Run waits for the user', () => {
    afterEach(() => runProjectionStore.clear());

    const waitForUser = () =>
      runProjectionStore.upsertRunSummaries('project-1', [
        {
          project_id: 'project-1',
          run_id: 'task-1',
          status: 'waiting_for_user',
          version: 3,
          updated_at: 1,
        },
      ]);

    it('keeps the held time when the task is paused', async () => {
      waitForUser();
      const { store, task } = createStore();
      task.taskTime = 0;

      await takeControlOfTask({
        chatStore: store,
        action: 'pause',
        projectId: 'project-1',
        taskId: 'task-1',
        request: vi.fn().mockResolvedValue(undefined),
        now: () => 1_500,
      });

      expect(task).toMatchObject({
        status: ChatTaskStatus.PAUSE,
        elapsed: 100,
        taskTime: 0,
      });
    });

    it('keeps the clock stopped when the task is resumed', async () => {
      waitForUser();
      const { store, task } = createStore(ChatTaskStatus.PAUSE);
      task.taskTime = 0;

      await takeControlOfTask({
        chatStore: store,
        action: 'resume',
        projectId: 'project-1',
        taskId: 'task-1',
        request: vi.fn().mockResolvedValue(undefined),
        now: () => 2_000,
      });

      expect(task).toMatchObject({
        status: ChatTaskStatus.RUNNING,
        elapsed: 100,
        taskTime: 0,
      });
    });
  });
});
