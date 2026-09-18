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

import { ExecutionStatus } from '@/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addLog: vi.fn(),
  modifyLog: vi.fn(() => false),
  proxyFetchPut: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  proxyFetchDelete: vi.fn(),
  proxyFetchGet: vi.fn(),
  proxyFetchPost: vi.fn(),
  proxyFetchPut: mocks.proxyFetchPut,
}));

vi.mock('@/lib/events/appEvents', () => ({
  recordFeatureUsed: vi.fn(),
  recordScheduledTriggerCreated: vi.fn(),
}));

vi.mock('@/store/activityLogStore', () => ({
  ActivityType: {
    TriggerExecuted: 'trigger_executed',
    ExecutionSuccess: 'execution_success',
    ExecutionFailed: 'execution_failed',
    ExecutionCancelled: 'execution_cancelled',
  },
  useActivityLogStore: {
    getState: () => ({
      addLog: mocks.addLog,
      modifyLog: mocks.modifyLog,
    }),
  },
}));

const OUTBOX_KEY = 'eigent.trigger-terminal-outbox.v1';

describe('trigger execution status delivery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes terminal delivery behind a previously issued Running update', async () => {
    let releaseRunning!: () => void;
    mocks.proxyFetchPut
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseRunning = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const { proxyUpdateTriggerExecution } =
      await import('@/service/triggerApi');

    const running = proxyUpdateTriggerExecution('execution-1', {
      status: ExecutionStatus.Running,
    });
    await vi.waitFor(() =>
      expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1)
    );

    const completed = proxyUpdateTriggerExecution('execution-1', {
      status: ExecutionStatus.Completed,
    });
    await Promise.resolve();
    expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1);

    releaseRunning();
    await Promise.all([running, completed]);

    expect(
      mocks.proxyFetchPut.mock.calls.map(([, body]) => body.status)
    ).toEqual([ExecutionStatus.Running, ExecutionStatus.Completed]);
    await proxyUpdateTriggerExecution('execution-1', {
      status: ExecutionStatus.Running,
    });
    expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(2);
  });

  it('lets a terminal receipt advance after a hung Running update times out', async () => {
    vi.useFakeTimers();
    mocks.proxyFetchPut
      .mockImplementationOnce(
        (
          _url: string,
          _body: unknown,
          _headers: unknown,
          options?: { signal?: AbortSignal }
        ) =>
          new Promise<void>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          })
      )
      .mockResolvedValue(undefined);
    const { proxyUpdateTriggerExecution } =
      await import('@/service/triggerApi');

    const runningResult = proxyUpdateTriggerExecution('execution-hung', {
      status: ExecutionStatus.Running,
    }).catch((error) => error);
    await vi.waitFor(() =>
      expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1)
    );
    const completed = proxyUpdateTriggerExecution('execution-hung', {
      status: ExecutionStatus.Completed,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await completed;

    expect(await runningResult).toMatchObject({ name: 'AbortError' });
    expect(
      mocks.proxyFetchPut.mock.calls.map(([, body]) => body.status)
    ).toEqual([ExecutionStatus.Running, ExecutionStatus.Completed]);
    expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
  });

  it('retries a terminal receipt after its network request times out', async () => {
    vi.useFakeTimers();
    mocks.proxyFetchPut
      .mockImplementationOnce(
        (
          _url: string,
          _body: unknown,
          _headers: unknown,
          options?: { signal?: AbortSignal }
        ) =>
          new Promise<void>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          })
      )
      .mockResolvedValue(undefined);
    const { proxyUpdateTriggerExecution } =
      await import('@/service/triggerApi');

    const delivery = proxyUpdateTriggerExecution('execution-timeout', {
      status: ExecutionStatus.Failed,
      error_message: 'Run timed out',
    });
    await vi.waitFor(() =>
      expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1)
    );

    await vi.advanceTimersByTimeAsync(10_250);
    await delivery;

    expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
  });

  it('replays an exhausted terminal delivery from the durable outbox', async () => {
    vi.useFakeTimers();
    mocks.proxyFetchPut.mockRejectedValue(new Error('temporarily unavailable'));
    const firstModule = await import('@/service/triggerApi');

    const firstDelivery = firstModule.proxyUpdateTriggerExecution(
      'execution-durable',
      {
        status: ExecutionStatus.Failed,
        error_message: 'Run failed',
      }
    );
    await vi.runAllTimersAsync();
    await firstDelivery;

    expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(3);
    expect(window.localStorage.getItem(OUTBOX_KEY)).toContain(
      'execution-durable'
    );

    vi.useRealTimers();
    vi.resetModules();
    mocks.proxyFetchPut.mockReset().mockResolvedValue(undefined);
    const recoveredModule = await import('@/service/triggerApi');

    await recoveredModule.flushPendingTriggerExecutionUpdates();

    expect(mocks.proxyFetchPut).toHaveBeenCalledWith(
      '/api/v1/execution/execution-durable',
      expect.objectContaining({ status: ExecutionStatus.Failed }),
      undefined,
      expect.objectContaining({ signal: expect.anything() })
    );
    expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
  });

  it('coalesces pending same-outcome tokens without changing the first receipt', async () => {
    let releaseRunning!: () => void;
    mocks.proxyFetchPut
      .mockReset()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (releaseRunning = resolve))
      )
      .mockResolvedValue(undefined);
    const { proxyUpdateTriggerExecution } =
      await import('@/service/triggerApi');
    const running = proxyUpdateTriggerExecution('pending-tokens', {
      status: ExecutionStatus.Running,
    });
    await vi.waitFor(() =>
      expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1)
    );
    const canonical = proxyUpdateTriggerExecution('pending-tokens', {
      status: ExecutionStatus.Completed,
      tokens_used: 0,
      completed_at: '2026-09-18T00:00:00Z',
      output_data: { result: 'accepted' },
    });
    const legacy = proxyUpdateTriggerExecution('pending-tokens', {
      status: ExecutionStatus.Completed,
      tokens_used: 123,
      completed_at: '2026-09-19T00:00:00Z',
      output_data: { result: 'late' },
      error_message: 'must not replace the receipt',
    });
    expect(
      JSON.parse(window.localStorage.getItem(OUTBOX_KEY)!)[0].updateData
    ).toEqual({
      status: ExecutionStatus.Completed,
      tokens_used: 123,
      completed_at: '2026-09-18T00:00:00Z',
      output_data: { result: 'accepted' },
    });
    releaseRunning();
    await Promise.all([running, canonical, legacy]);
    expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(2);
    expect(mocks.proxyFetchPut.mock.calls[1][1].tokens_used).toBe(123);
    expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
  });

  it('retains richer tokens while the older terminal receipt is in flight', async () => {
    let releaseCanonical!: () => void;
    let releaseLegacy!: () => void;
    mocks.proxyFetchPut
      .mockReset()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (releaseCanonical = resolve))
      )
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (releaseLegacy = resolve))
      );
    const { proxyUpdateTriggerExecution } =
      await import('@/service/triggerApi');
    const canonical = proxyUpdateTriggerExecution('inflight-tokens', {
      status: ExecutionStatus.Completed,
      tokens_used: 0,
    });
    await vi.waitFor(() =>
      expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1)
    );
    const legacy = proxyUpdateTriggerExecution('inflight-tokens', {
      status: ExecutionStatus.Completed,
      tokens_used: 123,
    });
    const lower = proxyUpdateTriggerExecution('inflight-tokens', {
      status: ExecutionStatus.Completed,
      tokens_used: 40,
    });
    await proxyUpdateTriggerExecution('inflight-tokens', {
      status: ExecutionStatus.Failed,
      tokens_used: 999,
    });
    expect(mocks.proxyFetchPut.mock.calls[0][1].tokens_used).toBe(0);
    releaseCanonical();
    await canonical;
    await vi.waitFor(() =>
      expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(2)
    );
    expect(
      JSON.parse(window.localStorage.getItem(OUTBOX_KEY)!)[0].updateData
    ).toEqual({ status: ExecutionStatus.Completed, tokens_used: 123 });
    releaseLegacy();
    await Promise.all([legacy, lower]);
    expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
  });

  it('enriches an already-delivered terminal outcome exactly once', async () => {
    mocks.proxyFetchPut.mockReset().mockResolvedValue(undefined);
    const { proxyUpdateTriggerExecution } =
      await import('@/service/triggerApi');
    await proxyUpdateTriggerExecution('delivered-tokens', {
      status: ExecutionStatus.Failed,
      tokens_used: 0,
      error_message: 'original failure',
      duration_seconds: 8,
    });
    await proxyUpdateTriggerExecution('delivered-tokens', {
      status: ExecutionStatus.Failed,
      tokens_used: 123,
      error_message: 'late different failure',
      duration_seconds: 88,
    });
    for (const tokens of [0, 10, 123]) {
      await proxyUpdateTriggerExecution('delivered-tokens', {
        status: ExecutionStatus.Failed,
        tokens_used: tokens,
      });
    }
    await proxyUpdateTriggerExecution('delivered-tokens', {
      status: ExecutionStatus.Completed,
      tokens_used: 999,
    });
    expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(2);
    expect(mocks.proxyFetchPut.mock.calls[1][1]).toEqual({
      status: ExecutionStatus.Failed,
      tokens_used: 123,
      error_message: 'original failure',
      duration_seconds: 8,
    });
  });

  it('advances to richer tokens after an older request times out and resolves late', async () => {
    vi.useFakeTimers();
    let releaseOlderRequest!: () => void;
    mocks.proxyFetchPut
      .mockReset()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (releaseOlderRequest = resolve))
      )
      .mockResolvedValue(undefined);
    const { proxyUpdateTriggerExecution } =
      await import('@/service/triggerApi');
    const canonical = proxyUpdateTriggerExecution('timeout-tokens', {
      status: ExecutionStatus.Completed,
      tokens_used: 0,
    });
    await vi.waitFor(() =>
      expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1)
    );
    const legacy = proxyUpdateTriggerExecution('timeout-tokens', {
      status: ExecutionStatus.Completed,
      tokens_used: 123,
    });
    await vi.advanceTimersByTimeAsync(10_250);
    await Promise.all([canonical, legacy]);
    releaseOlderRequest();
    await Promise.resolve();
    expect(
      mocks.proxyFetchPut.mock.calls.map(([, body]) => body.tokens_used)
    ).toEqual([0, 123]);
    expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
    await proxyUpdateTriggerExecution('timeout-tokens', {
      status: ExecutionStatus.Completed,
      tokens_used: 100,
    });
    expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(2);
  });

  it('persists failed token enrichment and restores its maximum after restart', async () => {
    vi.useFakeTimers();
    mocks.proxyFetchPut
      .mockReset()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('offline'));
    const firstModule = await import('@/service/triggerApi');
    await firstModule.proxyUpdateTriggerExecution('restart-tokens', {
      status: ExecutionStatus.Completed,
      tokens_used: 0,
      output_data: { result: 'accepted' },
    });
    const enrichment = firstModule.proxyUpdateTriggerExecution(
      'restart-tokens',
      {
        status: ExecutionStatus.Completed,
        tokens_used: 123,
        output_data: { result: 'late' },
      }
    );
    await vi.runAllTimersAsync();
    await enrichment;
    expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(4);

    vi.resetModules();
    mocks.proxyFetchPut.mockReset().mockResolvedValue(undefined);
    const recovered = await import('@/service/triggerApi');
    await recovered.proxyUpdateTriggerExecution('restart-tokens', {
      status: ExecutionStatus.Failed,
      tokens_used: 999,
    });
    await recovered.proxyUpdateTriggerExecution('restart-tokens', {
      status: ExecutionStatus.Completed,
      tokens_used: 1,
    });
    await recovered.flushPendingTriggerExecutionUpdates();
    expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1);
    expect(mocks.proxyFetchPut.mock.calls[0][1]).toEqual({
      status: ExecutionStatus.Completed,
      tokens_used: 123,
      output_data: { result: 'accepted' },
    });
    expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
  });
});
