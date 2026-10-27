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
// Licensed under the Apache License, Version 2.0 (the "License");

import { AgentStep } from '@/types/constants';

export interface TaskDurationState {
  taskTime: number;
  elapsed: number;
}

export interface HistoricalRunDuration {
  totalAttemptElapsedMs?: number;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Freeze a live task clock at a terminal/interrupted boundary.
 *
 * `elapsed` contains previously settled attempts and `taskTime` is the start
 * of the current live attempt. Keeping this calculation in one place avoids
 * error paths setting FINISHED first and consequently rendering "Worked for
 * 0s" even though the task had been active for minutes.
 */
export function settleTaskElapsedMs(
  task: TaskDurationState,
  endedAtMs = Date.now()
): number {
  const prior = Number.isFinite(task.elapsed) ? Math.max(0, task.elapsed) : 0;
  if (!Number.isFinite(task.taskTime) || task.taskTime <= 0) return prior;
  return prior + Math.max(0, endedAtMs - task.taskTime);
}

function epochToMs(value: number): number {
  // RunJournal timestamps are Unix seconds. Accept milliseconds too so this
  // helper remains safe if a remote API serializes them as JS timestamps.
  return value < 100_000_000_000 ? value * 1000 : value;
}

/**
 * Pick the best durable duration available while rebuilding history.
 *
 * Local Runs normally have attempt rows, whose aggregate excludes the time
 * Desktop was offline between attempts. Cloud-restored legacy Runs do not;
 * for those, the persisted Run creation/update boundary is an intentionally
 * approximate but honest fallback and prevents a multi-minute failed Run
 * from being presented as "Worked for 0s".
 */
export function resolveHistoricalRunElapsedMs({
  totalAttemptElapsedMs,
  createdAt,
  updatedAt,
}: HistoricalRunDuration): number | undefined {
  if (
    typeof totalAttemptElapsedMs === 'number' &&
    Number.isFinite(totalAttemptElapsedMs) &&
    totalAttemptElapsedMs >= 0
  ) {
    return totalAttemptElapsedMs;
  }
  if (
    typeof createdAt !== 'number' ||
    !Number.isFinite(createdAt) ||
    typeof updatedAt !== 'number' ||
    !Number.isFinite(updatedAt)
  ) {
    return undefined;
  }
  return Math.max(0, epochToMs(updatedAt) - epochToMs(createdAt));
}

/**
 * Track the time a played-back Run spent waiting for the user.
 *
 * Playback measures a Run by the span of its recorded steps, which includes
 * every wait for an answer or approval. A request opens a wait at its first
 * recorded step (the journal can carry the same request twice) and its first
 * recorded outcome closes it. Overlapping waits count once; a wait still open
 * when playback ends is not counted.
 */
export function createPlaybackUserWaitTracker() {
  const open = new Set<string>();
  const closed = new Set<string>();
  let waitingSinceMs: number | null = null;
  let waitedMs = 0;
  return {
    observe(step: unknown, interactionId: unknown, atMs: number) {
      if (typeof interactionId !== 'string' || !interactionId) return;
      if (closed.has(interactionId)) return;
      if (step === AgentStep.ASK && !open.has(interactionId)) {
        if (open.size === 0) waitingSinceMs = atMs;
        open.add(interactionId);
      } else if (step === AgentStep.HUMAN_REPLY && open.delete(interactionId)) {
        closed.add(interactionId);
        if (open.size === 0 && waitingSinceMs !== null) {
          waitedMs += Math.max(0, atMs - waitingSinceMs);
          waitingSinceMs = null;
        }
      }
    },
    waitedMs: () => waitedMs,
  };
}
