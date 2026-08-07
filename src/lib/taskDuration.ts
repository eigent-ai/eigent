// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");

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
