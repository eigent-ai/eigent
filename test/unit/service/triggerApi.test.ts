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
      expect.objectContaining({ status: ExecutionStatus.Failed })
    );
    expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
  });
});
