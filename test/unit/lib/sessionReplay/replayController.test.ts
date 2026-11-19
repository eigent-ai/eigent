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

import {
  REPLAY_FALLBACK_GAP_MS,
  REPLAY_MAX_GAP_MS,
  ReplayController,
  replayDelayMs,
} from '@/lib/sessionReplay/replayController';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const at = (seconds: number) => ({
  createdAt: new Date(Date.UTC(2026, 10, 1, 10, 0, seconds)).toISOString(),
});

describe('replayDelayMs', () => {
  it('follows the recorded gap at 1×', () => {
    expect(replayDelayMs(at(0), at(1), 1)).toBe(1000);
  });

  it('caps long waits at two seconds before applying speed', () => {
    expect(replayDelayMs(at(0), at(40), 1)).toBe(REPLAY_MAX_GAP_MS);
    expect(replayDelayMs(at(0), at(40), 2)).toBe(REPLAY_MAX_GAP_MS / 2);
    expect(replayDelayMs(at(0), at(40), 4)).toBe(REPLAY_MAX_GAP_MS / 4);
  });

  it('is zero at instant speed', () => {
    expect(replayDelayMs(at(0), at(40), 'instant')).toBe(0);
  });

  it('uses a short fallback when a time is missing or out of order', () => {
    expect(replayDelayMs({ createdAt: null }, at(1), 1)).toBe(
      REPLAY_FALLBACK_GAP_MS
    );
    expect(replayDelayMs(at(5), at(1), 1)).toBe(0);
  });
});

describe('ReplayController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const events = [at(0), at(1), at(3), at(60)];

  it('shows events in order, paced by their recorded gaps', () => {
    const controller = new ReplayController(events);
    const positions: number[] = [];
    controller.subscribe((state) => positions.push(state.position));

    controller.play();
    vi.advanceTimersByTime(0);
    expect(controller.getState().position).toBe(1);
    vi.advanceTimersByTime(999);
    expect(controller.getState().position).toBe(1);
    vi.advanceTimersByTime(1);
    expect(controller.getState().position).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(controller.getState().position).toBe(3);
    // The 57-second wait is capped at two seconds.
    vi.advanceTimersByTime(REPLAY_MAX_GAP_MS);
    expect(controller.getState()).toMatchObject({
      position: 4,
      playing: false,
    });
    expect(
      positions.filter((value, index, all) => all[index - 1] !== value)
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it('pauses and resumes from the same place', () => {
    const controller = new ReplayController(events);
    controller.play();
    vi.advanceTimersByTime(1000);
    expect(controller.getState().position).toBe(2);
    controller.pause();
    vi.advanceTimersByTime(60_000);
    expect(controller.getState()).toMatchObject({
      position: 2,
      playing: false,
    });
    controller.play();
    vi.advanceTimersByTime(2000);
    expect(controller.getState().position).toBe(3);
  });

  it('seeks backwards and forwards and clamps to the event range', () => {
    const controller = new ReplayController(events);
    controller.seek(3);
    expect(controller.getState().position).toBe(3);
    controller.seek(1);
    expect(controller.getState().position).toBe(1);
    controller.seek(99);
    expect(controller.getState().position).toBe(4);
    controller.seek(-5);
    expect(controller.getState().position).toBe(0);
  });

  it('steps one event at a time and stops playing', () => {
    const controller = new ReplayController(events);
    controller.play();
    controller.stepForward();
    expect(controller.getState()).toMatchObject({
      position: 1,
      playing: false,
    });
    controller.stepForward();
    controller.stepBack();
    expect(controller.getState().position).toBe(1);
  });

  it('jumps to the end at instant speed', () => {
    const controller = new ReplayController(events, { speed: 'instant' });
    controller.play();
    expect(controller.getState()).toMatchObject({
      position: 4,
      playing: false,
    });
  });

  it('changing speed while playing reschedules the next event', () => {
    const controller = new ReplayController(events);
    controller.play();
    vi.advanceTimersByTime(0);
    controller.setSpeed(4);
    vi.advanceTimersByTime(250);
    expect(controller.getState().position).toBe(2);
  });

  it('shows a burst of close events together', () => {
    const burst = Array.from({ length: 10 }, () => at(0));
    const controller = new ReplayController(burst);
    const updates: number[] = [];
    controller.subscribe((state) => updates.push(state.position));
    controller.play();
    vi.advanceTimersByTime(0);
    expect(controller.getState().position).toBe(10);
    // One update to start playing, one for the whole burst.
    expect(updates).toEqual([0, 10]);
  });

  it('playing from the end starts over', () => {
    const controller = new ReplayController(events, { position: 4 });
    controller.play();
    expect(controller.getState().position).toBe(0);
    expect(controller.getState().playing).toBe(true);
  });

  it('does nothing after dispose', () => {
    const controller = new ReplayController(events);
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.play();
    controller.dispose();
    vi.advanceTimersByTime(10_000);
    expect(controller.getState().position).toBe(0);
    listener.mockClear();
    controller.play();
    expect(listener).not.toHaveBeenCalled();
  });
});
