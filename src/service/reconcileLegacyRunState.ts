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

import { TERMINAL_RUN_STATUSES } from '@/lib/projector/runSummary';
import { runEventIngressRegistry } from '@/lib/runEvents';
import type { ChatStore } from '@/store/chatStore';
import { getProjectEventStore } from '@/store/projectEventStore';
import { ChatTaskStatus } from '@/types/constants';

type LegacyRunState = Pick<
  ChatStore,
  | 'tasks'
  | 'setStatus'
  | 'setDurableRunStatus'
  | 'setIsPending'
  | 'setActiveAsk'
  | 'setActiveAskList'
  | 'setTaskTime'
  | 'setElapsed'
>;

/** Close only the captured compatibility Run after canonical confirmation. */
export async function reconcileLegacyRunState({
  projectId,
  runId,
  getState,
  isCurrent,
}: {
  projectId: string;
  runId: string;
  getState: () => LegacyRunState;
  isCurrent: () => boolean;
}): Promise<void> {
  const store = getProjectEventStore(projectId);
  const incarnation = store.getIncarnation();
  await runEventIngressRegistry.reconcileRun(projectId, runId);
  if (!isCurrent() || !store.isCurrentIncarnation(incarnation)) return;
  const run = store.getSnapshot().view.runs[runId];
  const state = getState();
  if (!state.tasks[runId] || !run || !TERMINAL_RUN_STATUSES.has(run.status))
    return;
  // FINISHED closes the transport UI; durableRunStatus retains failed/cancelled.
  state.setDurableRunStatus(
    runId,
    run.status as 'completed' | 'failed' | 'cancelled'
  );
  state.setStatus(runId, ChatTaskStatus.FINISHED);
  state.setIsPending(runId, false);
  state.setActiveAsk(runId, '');
  state.setActiveAskList(runId, []);
  state.setTaskTime(runId, 0);
  if (run.totalAttemptElapsedMs != null)
    state.setElapsed(runId, run.totalAttemptElapsedMs);
}
