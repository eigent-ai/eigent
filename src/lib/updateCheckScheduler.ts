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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** A check is due 4 h after the last one, plus up to 2 h of jitter. */
export const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 4 * HOUR_MS;
export const DEFAULT_UPDATE_CHECK_JITTER_MS = 2 * HOUR_MS;
/** How soon a failed check (offline, feed down) is tried again. */
export const DEFAULT_UPDATE_CHECK_RETRY_MS = 30 * MINUTE_MS;
/**
 * How often the scheduler looks at the wall clock. Timers do not advance
 * while the computer sleeps, so a single long timeout could fire hours late
 * after a wake; a short tick that compares wall-clock time does not.
 */
export const DEFAULT_UPDATE_CHECK_TICK_MS = 5 * MINUTE_MS;

export type UpdateCheckOutcome = 'succeeded' | 'failed';

export interface UpdateCheckSchedulerOptions {
  /** Runs one update check. Resolves `failed` when the feed was unreachable. */
  check: () => Promise<UpdateCheckOutcome>;
  /**
   * False while a check would be unwelcome: a task is running, or an update
   * is already downloading or waiting to be installed. A skipped check is
   * deferred to the next tick, not dropped.
   */
  canCheck: () => boolean | Promise<boolean>;
  intervalMs?: number;
  jitterMs?: number;
  retryMs?: number;
  tickMs?: number;
  now?: () => number;
  random?: () => number;
  setIntervalFn?: (handler: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
  onError?: (error: unknown) => void;
}

export interface UpdateCheckScheduler {
  /** Starts ticking; `lastCheckAt` is when the most recent check ran. */
  start: (lastCheckAt?: number) => void;
  /** Records a check that ran outside the scheduler (e.g. at launch). */
  recordCheck: (outcome: UpdateCheckOutcome, at?: number) => void;
  /**
   * The network came back or the computer woke: check now if one is due,
   * or if the last attempt failed.
   */
  poke: () => Promise<void>;
  /** Runs one tick immediately. Exposed for tests. */
  tick: () => Promise<void>;
  stop: () => void;
}

/**
 * Schedules background update checks for an app that stays open for days.
 * It never overlaps two checks and never checks while `canCheck` says no.
 */
export function createUpdateCheckScheduler(
  options: UpdateCheckSchedulerOptions
): UpdateCheckScheduler {
  const intervalMs = Math.max(
    1,
    options.intervalMs ?? DEFAULT_UPDATE_CHECK_INTERVAL_MS
  );
  const jitterMs = Math.max(0, options.jitterMs ?? 0);
  const retryMs = Math.max(
    1,
    Math.min(intervalMs, options.retryMs ?? DEFAULT_UPDATE_CHECK_RETRY_MS)
  );
  const tickMs = Math.max(
    1,
    options.tickMs ?? Math.min(DEFAULT_UPDATE_CHECK_TICK_MS, intervalMs)
  );
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const setIntervalFn =
    options.setIntervalFn ??
    ((handler: () => void, ms: number) => setInterval(handler, ms));
  const clearIntervalFn =
    options.clearIntervalFn ??
    ((handle: unknown) =>
      clearInterval(handle as ReturnType<typeof setInterval>));
  const onError = options.onError ?? (() => undefined);

  let timer: unknown = null;
  let running = false;
  let inFlight = false;
  let lastCheckAt = now();
  let lastFailed = false;
  let nextDelayMs = intervalMs;

  const drawNextDelay = () => {
    nextDelayMs = intervalMs + Math.floor(random() * jitterMs);
  };

  const recordCheck = (outcome: UpdateCheckOutcome, at = now()) => {
    lastCheckAt = at;
    lastFailed = outcome === 'failed';
    drawNextDelay();
  };

  const isDue = (force: boolean) => {
    const elapsed = now() - lastCheckAt;
    // A clock moved backwards (manual change, NTP correction) restarts the wait.
    if (elapsed < 0) {
      lastCheckAt = now();
      return false;
    }
    if (force && lastFailed) return true;
    return elapsed >= (lastFailed ? retryMs : nextDelayMs);
  };

  const run = async (force: boolean) => {
    if (!running || inFlight || !isDue(force)) return;
    inFlight = true;
    try {
      if (!(await options.canCheck())) return;
      if (!running) return;
      let outcome: UpdateCheckOutcome;
      try {
        outcome = await options.check();
      } catch (error) {
        onError(error);
        outcome = 'failed';
      }
      recordCheck(outcome);
    } catch (error) {
      onError(error);
    } finally {
      inFlight = false;
    }
  };

  drawNextDelay();

  return {
    start: (startedAt) => {
      if (running) return;
      running = true;
      if (startedAt !== undefined) lastCheckAt = startedAt;
      timer = setIntervalFn(() => void run(false), tickMs);
    },
    recordCheck,
    poke: () => run(true),
    tick: () => run(false),
    stop: () => {
      running = false;
      if (timer !== null) clearIntervalFn(timer);
      timer = null;
    },
  };
}
