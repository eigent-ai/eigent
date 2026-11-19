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
  createUpdateCheckScheduler,
  type UpdateCheckOutcome,
  type UpdateCheckSchedulerOptions,
} from '@/lib/updateCheckScheduler';
import { describe, expect, it, vi } from 'vitest';

const HOUR = 60 * 60_000;
const MINUTE = 60_000;

function setup(overrides: Partial<UpdateCheckSchedulerOptions> = {}) {
  let clock = 0;
  let intervalHandler: (() => void) | null = null;
  const check = vi.fn(async (): Promise<UpdateCheckOutcome> => 'succeeded');
  const canCheck = vi.fn(() => true);
  const setIntervalFn = vi.fn((handler: () => void) => {
    intervalHandler = handler;
    return 'timer';
  });
  const clearIntervalFn = vi.fn();
  const scheduler = createUpdateCheckScheduler({
    check,
    canCheck,
    intervalMs: 4 * HOUR,
    jitterMs: 0,
    retryMs: 30 * MINUTE,
    tickMs: 5 * MINUTE,
    now: () => clock,
    random: () => 0,
    setIntervalFn,
    clearIntervalFn,
    ...overrides,
  });
  return {
    scheduler,
    check,
    canCheck,
    setIntervalFn,
    clearIntervalFn,
    advance: (ms: number) => {
      clock += ms;
    },
    fireInterval: () => intervalHandler?.(),
  };
}

describe('createUpdateCheckScheduler', () => {
  it('checks once the interval has passed since the last check', async () => {
    const { scheduler, check, advance } = setup();
    scheduler.start(0);

    advance(4 * HOUR - 1);
    await scheduler.tick();
    expect(check).not.toHaveBeenCalled();

    advance(1);
    await scheduler.tick();
    expect(check).toHaveBeenCalledTimes(1);

    // The wait restarts from the check that just ran.
    advance(HOUR);
    await scheduler.tick();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('spreads checks with jitter drawn after each check', async () => {
    const { scheduler, check, advance } = setup({
      jitterMs: 2 * HOUR,
      random: () => 0.5,
    });
    scheduler.start(0);

    advance(4 * HOUR);
    await scheduler.tick();
    expect(check).not.toHaveBeenCalled();

    advance(HOUR);
    await scheduler.tick();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('waits while a check is unwelcome and runs on the first free tick', async () => {
    const { scheduler, check, canCheck, advance } = setup();
    canCheck.mockReturnValue(false);
    scheduler.start(0);

    advance(4 * HOUR);
    await scheduler.tick();
    advance(5 * MINUTE);
    await scheduler.tick();
    expect(check).not.toHaveBeenCalled();
    expect(canCheck).toHaveBeenCalledTimes(2);

    canCheck.mockReturnValue(true);
    advance(5 * MINUTE);
    await scheduler.tick();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('accepts an async busy check', async () => {
    const { scheduler, check, canCheck, advance } = setup();
    canCheck.mockImplementation((async () => false) as never);
    scheduler.start(0);
    advance(4 * HOUR);
    await scheduler.tick();
    expect(check).not.toHaveBeenCalled();
  });

  it('never runs two checks at once', async () => {
    let finish: (outcome: UpdateCheckOutcome) => void = () => undefined;
    const { scheduler, check, advance } = setup();
    check.mockImplementation(
      () =>
        new Promise<UpdateCheckOutcome>((resolve) => {
          finish = resolve;
        })
    );
    scheduler.start(0);
    advance(4 * HOUR);

    const first = scheduler.tick();
    await Promise.resolve();
    await scheduler.tick();
    await scheduler.poke();
    expect(check).toHaveBeenCalledTimes(1);

    finish('succeeded');
    await first;
    await scheduler.tick();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('retries a failed check sooner and on reconnect', async () => {
    const { scheduler, check, advance } = setup();
    check.mockResolvedValueOnce('failed');
    scheduler.start(0);
    advance(4 * HOUR);
    await scheduler.tick();
    expect(check).toHaveBeenCalledTimes(1);

    // Back online: the failed check runs again right away.
    await scheduler.poke();
    expect(check).toHaveBeenCalledTimes(2);

    // After a success, a reconnect alone does not trigger another check.
    await scheduler.poke();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('retries after the retry delay without a reconnect', async () => {
    const { scheduler, check, advance } = setup();
    scheduler.recordCheck('failed', 0);
    scheduler.start();

    advance(30 * MINUTE - 1);
    await scheduler.tick();
    expect(check).not.toHaveBeenCalled();

    advance(1);
    await scheduler.tick();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('counts a thrown check as failed and reports it', async () => {
    const onError = vi.fn();
    const { scheduler, check, advance } = setup({ onError });
    check.mockRejectedValueOnce(new Error('offline'));
    scheduler.start(0);
    advance(4 * HOUR);
    await scheduler.tick();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    await scheduler.poke();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('restarts the wait when the clock moves backwards', async () => {
    const { scheduler, check, advance } = setup();
    scheduler.start(10 * HOUR);
    advance(0);
    await scheduler.tick();
    expect(check).not.toHaveBeenCalled();

    advance(4 * HOUR);
    await scheduler.tick();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('ticks on its interval and stops cleanly', async () => {
    const {
      scheduler,
      check,
      setIntervalFn,
      clearIntervalFn,
      advance,
      fireInterval,
    } = setup();
    scheduler.start(0);
    expect(setIntervalFn).toHaveBeenCalledWith(
      expect.any(Function),
      5 * MINUTE
    );

    advance(4 * HOUR);
    fireInterval();
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));

    scheduler.stop();
    expect(clearIntervalFn).toHaveBeenCalledWith('timer');
    advance(8 * HOUR);
    await scheduler.tick();
    expect(check).toHaveBeenCalledTimes(1);
  });
});
