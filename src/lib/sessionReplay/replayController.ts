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
 * Session replay pacing.
 *
 * Replay is read-only: it only decides how many of a Session's stored Run
 * events are visible. The view re-projects the visible prefix with the same
 * projector the live timeline uses, so nothing is sent to Brain and nothing
 * runs again.
 */

export type ReplaySpeed = 1 | 2 | 4 | 'instant';

export const REPLAY_SPEEDS: readonly ReplaySpeed[] = [1, 2, 4, 'instant'];

/** Longest pause between two events at 1×, so long waits do not stall. */
export const REPLAY_MAX_GAP_MS = 2000;

/** Pause used when an event has no usable time. */
export const REPLAY_FALLBACK_GAP_MS = 250;

/** Events due within one tick of each other are shown in the same update. */
export const REPLAY_MIN_TICK_MS = 16;

/** Keeps a burst visible as progress instead of one jump to the end. */
export const REPLAY_MAX_EVENTS_PER_TICK = 50;

/** The fields replay needs from a stored Run event. */
export interface ReplayTimedEvent {
  createdAt: string | null;
}

function eventTimeMs(event: ReplayTimedEvent | undefined): number | null {
  if (!event?.createdAt) return null;
  const parsed = Date.parse(event.createdAt);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Delay before showing `next` after `previous`, following the recorded gap
 * capped at {@link REPLAY_MAX_GAP_MS}, then divided by the speed.
 */
export function replayDelayMs(
  previous: ReplayTimedEvent | undefined,
  next: ReplayTimedEvent | undefined,
  speed: ReplaySpeed
): number {
  if (speed === 'instant') return 0;
  const before = eventTimeMs(previous);
  const after = eventTimeMs(next);
  const recorded =
    before === null || after === null
      ? REPLAY_FALLBACK_GAP_MS
      : Math.max(0, after - before);
  return Math.round(Math.min(recorded, REPLAY_MAX_GAP_MS) / speed);
}

export interface ReplayState {
  /** Number of events visible, from 0 (nothing yet) to `total`. */
  position: number;
  total: number;
  playing: boolean;
  speed: ReplaySpeed;
}

export interface ReplayTimers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const defaultTimers: ReplayTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Owns the play head of one replay. Holds no projection state of its own, so
 * seeking backwards is just a smaller prefix.
 */
export class ReplayController<TEvent extends ReplayTimedEvent> {
  private state: ReplayState;
  private timer: unknown = null;
  private readonly listeners = new Set<(state: ReplayState) => void>();
  private disposed = false;
  private readonly timers: ReplayTimers;

  constructor(
    private readonly events: readonly TEvent[],
    options: {
      speed?: ReplaySpeed;
      timers?: ReplayTimers;
      /** Start with this many events visible (default 0). */
      position?: number;
    } = {}
  ) {
    this.timers = options.timers ?? defaultTimers;
    this.state = {
      position: clamp(options.position ?? 0, 0, events.length),
      total: events.length,
      playing: false,
      speed: options.speed ?? 1,
    };
  }

  getState(): ReplayState {
    return this.state;
  }

  subscribe(listener: (state: ReplayState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  play(): void {
    if (this.disposed || this.state.total === 0) return;
    // Playing from the end starts over, like a media player.
    const position =
      this.state.position >= this.state.total ? 0 : this.state.position;
    this.update({ position, playing: true });
    this.schedule();
  }

  pause(): void {
    this.cancelTimer();
    if (this.state.playing) this.update({ playing: false });
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: ReplaySpeed): void {
    if (speed === this.state.speed) return;
    this.update({ speed });
    if (this.state.playing) {
      this.cancelTimer();
      this.schedule();
    }
  }

  /** Show exactly `position` events. Keeps playing if it was playing. */
  seek(position: number): void {
    const next = clamp(Math.round(position), 0, this.state.total);
    this.cancelTimer();
    const reachedEnd = next >= this.state.total;
    this.update({
      position: next,
      playing: this.state.playing && !reachedEnd,
    });
    if (this.state.playing) this.schedule();
  }

  stepForward(): void {
    this.pause();
    this.seek(this.state.position + 1);
  }

  stepBack(): void {
    this.pause();
    this.seek(this.state.position - 1);
  }

  dispose(): void {
    this.cancelTimer();
    this.disposed = true;
    this.listeners.clear();
  }

  private schedule(): void {
    if (this.disposed || !this.state.playing) return;
    if (this.state.position >= this.state.total) {
      this.update({ playing: false });
      return;
    }
    if (this.state.speed === 'instant') {
      this.update({ position: this.state.total, playing: false });
      return;
    }
    // Events closer together than one tick are shown together, so a burst of
    // streamed deltas does not re-render once per event.
    const start = this.state.position;
    let target = start;
    let delay = 0;
    while (
      target < this.state.total &&
      target - start < REPLAY_MAX_EVENTS_PER_TICK
    ) {
      // The first event shows at once; there is no earlier event to wait from.
      const previous = target > 0 ? this.events[target - 1] : undefined;
      const gap =
        previous === undefined
          ? 0
          : replayDelayMs(previous, this.events[target], this.state.speed);
      // Later events join this update only while they are due within a tick.
      if (target > start && delay + gap >= REPLAY_MIN_TICK_MS) break;
      delay += gap;
      target += 1;
    }
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (this.disposed || !this.state.playing) return;
      this.update({
        position: target,
        playing: target < this.state.total,
      });
      this.schedule();
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private update(patch: Partial<ReplayState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
