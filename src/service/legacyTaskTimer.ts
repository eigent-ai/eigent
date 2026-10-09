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

/**
 * The task timer of the default chat view counts the time a task worked.
 * Like the Run totals from the backend (`total_attempt_elapsed_ms`), it
 * leaves out the time the Run waits for the user: for an approval, or for an
 * answer to a question the task asked.
 *
 * A chat task keeps that time in `elapsed` (time already counted) and
 * `taskTime` (start of the segment being counted, or 0 while the clock is
 * stopped). The signal is the projected Run status, which the Run's own event
 * stream keeps current whichever chat view is shown. It stays
 * `waiting_for_user` until the last open request is answered, and becomes
 * `running` only when the answer continues the Run.
 */

import {
  isStoppedRunStatus,
  TERMINAL_RUN_STATUSES,
} from '@/lib/projector/runSummary';
import { runProjectionStore } from '@/lib/runEvents/projectionStore';
import { settleTaskElapsedMs } from '@/lib/taskDuration';
import type { ChatStore, VanillaChatStore } from '@/store/chatStore';
import { ChatTaskStatus } from '@/types/constants';

type TaskTimerState = Pick<ChatStore, 'tasks' | 'setElapsed' | 'setTaskTime'>;

/** Whether the Run of a chat task is waiting for an approval or an answer. */
export function isRunWaitingForUser(
  projectId: string | null | undefined,
  runId: string
): boolean {
  return (
    Boolean(projectId) &&
    runProjectionStore.getRun(projectId!, runId)?.status === 'waiting_for_user'
  );
}

/** Stop a counting task clock and keep the time it counted, as a pause does. */
export function stopTaskTimer(
  state: TaskTimerState,
  taskId: string,
  now = Date.now()
): void {
  const task = state.tasks[taskId];
  if (!task || task.taskTime === 0) return;
  state.setElapsed(taskId, settleTaskElapsedMs(task, now));
  state.setTaskTime(taskId, 0);
}

/**
 * Returns a check that keeps a task clock in step with its Run's waits for
 * the user; call it whenever the Run projection changes. It stops the clock
 * while the Run waits and restarts it once the Run continues. A user pause
 * stays in force, and a decision that ends the Run leaves the clock stopped.
 * A clock stopped by a wait stays held through any status between the wait
 * and the Run continuing, such as the `interrupted` projected for a request
 * cancelled while another one is still open.
 */
export function createTaskTimerWaitSync({
  projectId,
  runId,
  getState,
  now = Date.now,
}: {
  projectId: string;
  runId: string;
  getState: () => TaskTimerState;
  now?: () => number;
}): () => void {
  let held = false;
  return () => {
    const state = getState();
    const status = runProjectionStore.getRun(projectId, runId)?.status;
    const task = state.tasks[runId];
    if (status === 'waiting_for_user') {
      held = true;
      if (task) stopTaskTimer(state, runId, now());
      return;
    }
    if (!held) return;
    if (status && TERMINAL_RUN_STATUSES.has(status)) {
      held = false;
      return;
    }
    if (status !== 'running') return;
    held = false;
    if (task?.status === ChatTaskStatus.RUNNING && task.taskTime === 0)
      state.setTaskTime(runId, now());
  };
}

const restoredTaskTimers = new Map<string, () => void>();

/**
 * Follow the Run of a task restored while the Run was still active. The
 * restored task keeps counting from the Run's measured total; this holds its
 * clock during later waits for the user and settles it on the Run's measured
 * total once the task ends. Returns a dispose function.
 */
export function followRestoredTaskTimer({
  projectId,
  runId,
  chatStore,
  now = Date.now,
}: {
  projectId: string;
  runId: string;
  chatStore: VanillaChatStore;
  now?: () => number;
}): () => void {
  restoredTaskTimers.get(runId)?.();
  const syncWait = createTaskTimerWaitSync({
    projectId,
    runId,
    getState: chatStore.getState,
    now,
  });
  let disposed = false;
  let unsubscribeRun = () => {};
  let unsubscribeTask = () => {};
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribeRun();
    unsubscribeTask();
    if (restoredTaskTimers.get(runId) === dispose)
      restoredTaskTimers.delete(runId);
  };
  const update = () => {
    if (disposed) return;
    const state = chatStore.getState();
    const task = state.tasks[runId];
    if (!task) {
      dispose();
      return;
    }
    syncWait();
    const run = runProjectionStore.getRun(projectId, runId);
    const total = run?.totalAttemptElapsedMs;
    if (
      !run ||
      !isStoppedRunStatus(run.status) ||
      task.status !== ChatTaskStatus.FINISHED ||
      typeof total !== 'number' ||
      !Number.isFinite(total) ||
      total < 0
    )
      return;
    if (task.taskTime !== 0) state.setTaskTime(runId, 0);
    if (task.elapsed !== total) state.setElapsed(runId, total);
    if (TERMINAL_RUN_STATUSES.has(run.status)) dispose();
  };
  restoredTaskTimers.set(runId, dispose);
  unsubscribeRun = runProjectionStore.subscribeProject(projectId, update);
  let taskStatus = chatStore.getState().tasks[runId]?.status;
  unsubscribeTask = chatStore.subscribe((state) => {
    const nextStatus = state.tasks[runId]?.status;
    if (nextStatus === taskStatus) return;
    taskStatus = nextStatus;
    update();
  });
  update();
  return dispose;
}
