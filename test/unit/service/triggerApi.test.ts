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
  fetchGet: vi.fn(),
  auth: { user_id: 1, email: 'one@example.invalid' },
}));

vi.mock('@/api/http', () => ({
  fetchGet: mocks.fetchGet,
  proxyFetchDelete: vi.fn(),
  proxyFetchGet: vi.fn(),
  proxyFetchPost: vi.fn(),
  proxyFetchPut: mocks.proxyFetchPut,
}));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => mocks.auth }));

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
    mocks.auth = { user_id: 1, email: 'one@example.invalid' };
    mocks.fetchGet.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('unobserved durable terminal recovery', () => {
    const BINDINGS_KEY = 'eigent.trigger-run-bindings.v1';
    const summary = (status: string, overrides = {}) => ({
      run_id: 'run-1',
      project_id: 'project-1',
      status,
      version: 4,
      updated_at: 1_800_000_000,
      origin: 'local',
      latest_attempt: { attempt_number: 1, status },
      ...overrides,
    });
    const journal = (status: string) => ({
      run_id: 'run-1',
      after_sequence: 0,
      next_sequence: 2,
      has_more: false,
      events: [
        {
          event_id: 'usage',
          project_id: 'project-1',
          run_id: 'run-1',
          sequence: 1,
          run_sequence: 1,
          event_type: 'model.invocation.completed',
          payload: {
            invocation_id: 'invocation-1',
            usage: { prompt_tokens: 80, completion_tokens: 43 },
          },
        },
        {
          event_id: 'terminal',
          project_id: 'project-1',
          run_id: 'run-1',
          sequence: 2,
          run_sequence: 2,
          event_type: `run.${status}`,
          payload: {},
        },
      ],
    });
    const respond = (status: string, overrides = {}) =>
      mocks.fetchGet.mockImplementation((path) =>
        Promise.resolve(
          path === '/runs/run-1' ? summary(status, overrides) : journal(status)
        )
      );
    const start = async () => {
      mocks.proxyFetchPut.mockReset().mockResolvedValue(undefined);
      const api = await import('@/service/triggerApi');
      api.trackTriggerExecutionRun('execution-1', 'project-1', 'run-1');
      await api.proxyUpdateTriggerExecution('execution-1', {
        status: ExecutionStatus.Running,
      });
      expect(window.localStorage.getItem(BINDINGS_KEY)).toContain('run-1');
      expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
      return api;
    };

    it.each(['completed', 'failed', 'cancelled'])(
      'rebuilds modules after renderer loss and delivers canonical %s once without executing the Run',
      async (status) => {
        await start();
        vi.resetModules();
        respond(status);
        const recovered = await import('@/service/triggerApi');
        await Promise.all([
          recovered.flushPendingTriggerExecutionUpdates(),
          recovered.flushPendingTriggerExecutionUpdates(),
        ]);
        expect(
          mocks.proxyFetchPut.mock.calls.map(([, data]) => data.status)
        ).toEqual(['running', status]);
        expect(mocks.proxyFetchPut.mock.calls.at(-1)?.[1].tokens_used).toBe(
          123
        );
        expect(window.localStorage.getItem(BINDINGS_KEY)).toBeNull();
        expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
        vi.resetModules();
        await (
          await import('@/service/triggerApi')
        ).flushPendingTriggerExecutionUpdates();
        expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(2);
        expect(mocks.fetchGet.mock.calls.map(([path]) => path)).toEqual([
          '/runs/run-1',
          '/runs/run-1/events',
        ]);
      }
    );

    it.each(['network', 'timeout'])(
      'delivers terminal first but retries %s usage failure after renderer loss',
      async (failure) => {
        vi.useFakeTimers();
        const api = await start();
        mocks.fetchGet.mockImplementation((path) =>
          path === '/runs/run-1'
            ? Promise.resolve(summary('completed'))
            : failure === 'network'
              ? Promise.reject(new Error('temporary Journal failure'))
              : new Promise(() => {})
        );
        const first = api.flushPendingTriggerExecutionUpdates();
        await vi.advanceTimersByTimeAsync(5_000);
        await first;
        expect(mocks.proxyFetchPut.mock.calls.at(-1)?.[1]).toMatchObject({
          status: 'completed',
          tokens_used: 0,
        });
        const saved = JSON.parse(window.localStorage.getItem(BINDINGS_KEY)!)[0];
        expect(saved.terminalDelivery).toEqual({
          status: 'completed',
          tokens: 0,
        });
        expect(saved.reconciledUsage).toBeUndefined();
        vi.resetModules();
        respond('completed');
        const recovered = await import('@/service/triggerApi');
        await recovered.flushPendingTriggerExecutionUpdates();
        expect(mocks.proxyFetchPut.mock.calls.at(-1)?.[1]).toMatchObject({
          status: 'completed',
          tokens_used: 123,
        });
        expect(window.localStorage.getItem(BINDINGS_KEY)).toBeNull();
        const calls = mocks.proxyFetchPut.mock.calls.length;
        await recovered.flushPendingTriggerExecutionUpdates();
        expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(calls);
      }
    );

    it.each([0, 123])(
      'retains live terminal ACK through reload until validated usage %s converges',
      async (tokens) => {
        const api = await start();
        await api.proxyUpdateTriggerExecution('execution-1', {
          status: ExecutionStatus.Completed,
          tokens_used: 0,
        });
        expect(window.localStorage.getItem(BINDINGS_KEY)).toContain(
          'terminalDelivery'
        );
        expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
        vi.resetModules();
        mocks.fetchGet.mockImplementation((path) => {
          const page = journal('completed');
          page.events[0].payload = {
            invocation_id: 'invocation-1',
            usage: { prompt_tokens: tokens, completion_tokens: 0 },
          };
          return Promise.resolve(
            path === '/runs/run-1' ? summary('completed') : page
          );
        });
        const recovered = await import('@/service/triggerApi');
        mocks.auth = { user_id: 2, email: 'two@example.invalid' };
        await recovered.flushPendingTriggerExecutionUpdates();
        expect(mocks.fetchGet).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(BINDINGS_KEY)).not.toBeNull();
        mocks.auth = { user_id: 1, email: 'one@example.invalid' };
        await recovered.flushPendingTriggerExecutionUpdates();
        expect(mocks.proxyFetchPut.mock.calls.at(-1)?.[1].tokens_used).toBe(
          tokens
        );
        // A real zero is a successful read, not a reason to scan forever or
        // duplicate the terminal write which the previous renderer delivered.
        expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(tokens === 0 ? 2 : 3);
        expect(window.localStorage.getItem(BINDINGS_KEY)).toBeNull();
        vi.resetModules();
        mocks.fetchGet.mockClear();
        await (
          await import('@/service/triggerApi')
        ).flushPendingTriggerExecutionUpdates();
        expect(mocks.fetchGet).not.toHaveBeenCalled();
      }
    );

    it('retains read-complete usage and retries failed enrichment after another module rebuild', async () => {
      vi.useFakeTimers();
      const api = await start();
      await api.proxyUpdateTriggerExecution('execution-1', {
        status: ExecutionStatus.Completed,
        tokens_used: 0,
      });
      respond('completed');
      mocks.proxyFetchPut.mockRejectedValue(new Error('offline'));
      const failed = api.flushPendingTriggerExecutionUpdates();
      await vi.runAllTimersAsync();
      await failed;
      const saved = JSON.parse(window.localStorage.getItem(BINDINGS_KEY)!)[0];
      expect(saved.terminalDelivery).toEqual({
        status: 'completed',
        tokens: 0,
      });
      expect(saved.reconciledUsage).toEqual({
        status: 'completed',
        tokens: 123,
      });
      vi.resetModules();
      mocks.fetchGet
        .mockClear()
        .mockRejectedValue(new Error('Journal unavailable again'));
      mocks.proxyFetchPut.mockReset().mockResolvedValue(undefined);
      const recovered = await import('@/service/triggerApi');
      await recovered.flushPendingTriggerExecutionUpdates();
      expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1);
      expect(mocks.proxyFetchPut.mock.calls[0][1]).toMatchObject({
        status: 'completed',
        tokens_used: 123,
      });
      expect(mocks.fetchGet).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(BINDINGS_KEY)).toBeNull();
      expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
    });

    it.each([
      'pending',
      'running',
      'waiting_for_user',
      'interrupted',
      'unknown',
    ])(
      'retains %s without inventing a terminal, then reconciles after Resume/completion',
      async (status) => {
        await start();
        vi.resetModules();
        const recovered = await import('@/service/triggerApi');
        respond(status);
        await recovered.flushPendingTriggerExecutionUpdates();
        expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1);
        expect(window.localStorage.getItem(BINDINGS_KEY)).toContain('run-1');
        respond('completed', {
          latest_attempt: { attempt_number: 2, status: 'completed' },
        });
        await recovered.flushPendingTriggerExecutionUpdates();
        expect(mocks.proxyFetchPut.mock.calls.at(-1)?.[1].status).toBe(
          'completed'
        );
      }
    );

    it.each(['network', 'missing', 'run', 'project', 'version'])(
      'keeps exact identity after %s lookup failure and recovers on a later pass',
      async (failure) => {
        const api = await start();
        if (failure === 'network')
          mocks.fetchGet.mockRejectedValue(new Error('offline'));
        else if (failure === 'missing')
          mocks.fetchGet.mockResolvedValue(undefined);
        else
          respond(
            'completed',
            failure === 'run'
              ? { run_id: 'other-run' }
              : failure === 'project'
                ? { project_id: 'other-project' }
                : { version: -1 }
          );
        await api.flushPendingTriggerExecutionUpdates();
        expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1);
        expect(window.localStorage.getItem(BINDINGS_KEY)).toContain('run-1');
        respond('completed');
        await api.flushPendingTriggerExecutionUpdates();
        expect(mocks.proxyFetchPut.mock.calls.at(-1)?.[1].status).toBe(
          'completed'
        );
      }
    );

    it('bounds a hung lookup, ignores its late response and retries exact identity', async () => {
      vi.useFakeTimers();
      const api = await start();
      let release!: (value: unknown) => void;
      mocks.fetchGet.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      const first = api.flushPendingTriggerExecutionUpdates();
      await vi.advanceTimersByTimeAsync(5_000);
      await first;
      release(summary('completed'));
      await Promise.resolve();
      expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1);
      expect(mocks.fetchGet.mock.calls[0][3].signal.aborted).toBe(true);
      respond('completed');
      await api.flushPendingTriggerExecutionUpdates();
      expect(mocks.proxyFetchPut.mock.calls.at(-1)?.[1].status).toBe(
        'completed'
      );
    });

    it('retains association and scoped outbox after bounded reporting failure, then retries after reload', async () => {
      vi.useFakeTimers();
      const api = await start();
      respond('completed');
      mocks.proxyFetchPut.mockRejectedValue(new Error('offline'));
      const failed = api.flushPendingTriggerExecutionUpdates();
      await vi.runAllTimersAsync();
      await failed;
      expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(4);
      expect(window.localStorage.getItem(BINDINGS_KEY)).toContain('run-1');
      expect(window.localStorage.getItem(OUTBOX_KEY)).toContain('accountKey');
      vi.resetModules();
      mocks.proxyFetchPut.mockResolvedValue(undefined);
      await (
        await import('@/service/triggerApi')
      ).flushPendingTriggerExecutionUpdates();
      expect(window.localStorage.getItem(BINDINGS_KEY)).toBeNull();
      expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
    });

    it('does not query or deliver another account binding, including account change during lookup', async () => {
      const api = await start();
      mocks.auth = { user_id: 2, email: 'two@example.invalid' };
      respond('completed');
      await api.flushPendingTriggerExecutionUpdates();
      expect(mocks.fetchGet).not.toHaveBeenCalled();
      expect(() =>
        api.trackTriggerExecutionRun('execution-1', 'project-1', 'run-1')
      ).toThrow('different Run or account');
      mocks.auth = { user_id: 1, email: 'one@example.invalid' };
      mocks.fetchGet.mockImplementationOnce(async () => {
        mocks.auth = { user_id: 2, email: 'two@example.invalid' };
        return summary('completed');
      });
      await api.flushPendingTriggerExecutionUpdates();
      expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1);
      mocks.auth = { user_id: 1, email: 'one@example.invalid' };
      await api.flushPendingTriggerExecutionUpdates();
      expect(mocks.proxyFetchPut.mock.calls.at(-1)?.[1].status).toBe(
        'completed'
      );
    });

    it('will not rebind an execution except after an exact typed admission rejection', async () => {
      const api = await start();
      expect(() =>
        api.trackTriggerExecutionRun('execution-1', 'project-1', 'other-run')
      ).toThrow();
      api.forgetRejectedTriggerRun('execution-1', 'project-1', 'wrong-run');
      expect(() =>
        api.trackTriggerExecutionRun('execution-1', 'project-1', 'other-run')
      ).toThrow();
      api.forgetRejectedTriggerRun('execution-1', 'project-1', 'run-1');
      api.trackTriggerExecutionRun('execution-1', 'project-1', 'other-run');
      expect(window.localStorage.getItem(BINDINGS_KEY)).toContain('other-run');
    });

    it('refuses late binding if the account changed during local preflight', async () => {
      const { getAccountEnvironmentKey } =
        await import('@/lib/authEnvironment');
      const api = await import('@/service/triggerApi');
      const expectedAccount = getAccountEnvironmentKey(mocks.auth);
      mocks.auth = { user_id: 2, email: 'two@example.invalid' };
      expect(() =>
        api.trackTriggerExecutionRun(
          'execution-1',
          'project-1',
          'run-1',
          expectedAccount
        )
      ).toThrow('account changed before admission');
      expect(window.localStorage.getItem(BINDINGS_KEY)).toBeNull();
    });

    it('retains a pre-admission failure receipt for its captured account without a Run binding', async () => {
      const { getAccountEnvironmentKey } =
        await import('@/lib/authEnvironment');
      const api = await import('@/service/triggerApi');
      const expectedAccount = getAccountEnvironmentKey(mocks.auth);
      mocks.auth = { user_id: 2, email: 'two@example.invalid' };
      await api.proxyUpdateTriggerExecution(
        'unsubmitted-execution',
        { status: ExecutionStatus.Failed },
        { projectId: 'project-1' },
        expectedAccount
      );
      expect(mocks.proxyFetchPut).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(BINDINGS_KEY)).toBeNull();
      expect(
        JSON.parse(window.localStorage.getItem(OUTBOX_KEY)!)[0].accountKey
      ).toBe(expectedAccount);
      mocks.auth = { user_id: 1, email: 'one@example.invalid' };
      mocks.proxyFetchPut.mockResolvedValue(undefined);
      await api.flushPendingTriggerExecutionUpdates();
      expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
      expect(mocks.fetchGet).not.toHaveBeenCalled();
    });

    it('retains an exhausted scoped receipt while signed in to another account', async () => {
      vi.useFakeTimers();
      const api = await start();
      respond('completed');
      mocks.proxyFetchPut.mockRejectedValue(new Error('offline'));
      const delivery = api.flushPendingTriggerExecutionUpdates();
      await vi.runAllTimersAsync();
      await delivery;
      const savedReceipt = window.localStorage.getItem(OUTBOX_KEY);
      vi.resetModules();
      mocks.auth = { user_id: 2, email: 'two@example.invalid' };
      mocks.proxyFetchPut.mockReset().mockResolvedValue(undefined);
      mocks.fetchGet.mockClear();
      const recovered = await import('@/service/triggerApi');
      await recovered.flushPendingTriggerExecutionUpdates();
      expect(mocks.proxyFetchPut).not.toHaveBeenCalled();
      expect(mocks.fetchGet).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(OUTBOX_KEY)).toBe(savedReceipt);
      mocks.auth = { user_id: 1, email: 'one@example.invalid' };
      await recovered.flushPendingTriggerExecutionUpdates();
      expect(mocks.proxyFetchPut).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
      expect(window.localStorage.getItem(BINDINGS_KEY)).toBeNull();
    });

    it('does not retain an unpersisted admission or forget a binding when storage fails', async () => {
      const api = await import('@/service/triggerApi');
      const originalSave = vi
        .mocked(window.localStorage.setItem)
        .getMockImplementation()!;
      const save = vi
        .mocked(window.localStorage.setItem)
        .mockImplementationOnce(() => {
          throw new Error('storage unavailable');
        });
      try {
        expect(() =>
          api.trackTriggerExecutionRun('execution-1', 'project-1', 'run-1')
        ).toThrow('storage unavailable');
        expect(window.localStorage.getItem(BINDINGS_KEY)).toBeNull();
        api.trackTriggerExecutionRun('execution-1', 'project-1', 'other-run');
      } finally {
        save.mockImplementation(originalSave);
      }
      const originalRemove = vi
        .mocked(window.localStorage.removeItem)
        .getMockImplementation()!;
      const remove = vi
        .mocked(window.localStorage.removeItem)
        .mockImplementationOnce(() => {
          throw new Error('storage unavailable');
        });
      try {
        expect(() =>
          api.forgetRejectedTriggerRun('execution-1', 'project-1', 'other-run')
        ).toThrow('storage unavailable');
        expect(() =>
          api.trackTriggerExecutionRun('execution-1', 'project-1', 'run-1')
        ).toThrow('different Run or account');
        expect(window.localStorage.getItem(BINDINGS_KEY)).toContain(
          'other-run'
        );
      } finally {
        remove.mockImplementation(originalRemove);
      }
    });

    it('bounds each pass to ten lookups and visits unchecked bindings on a later pass', async () => {
      vi.useFakeTimers();
      const api = await import('@/service/triggerApi');
      for (let index = 0; index < 12; index += 1) {
        api.trackTriggerExecutionRun(
          `execution-${index}`,
          'project-1',
          `run-${index}`
        );
      }
      mocks.fetchGet.mockRejectedValue(new Error('temporarily offline'));
      await Promise.all([
        api.flushPendingTriggerExecutionUpdates(),
        api.flushPendingTriggerExecutionUpdates(),
      ]);
      expect(mocks.fetchGet).toHaveBeenCalledTimes(10);
      await vi.advanceTimersByTimeAsync(30_000);
      await api.flushPendingTriggerExecutionUpdates();
      expect(mocks.fetchGet).toHaveBeenCalledTimes(20);
      expect(mocks.fetchGet.mock.calls[10][0]).toBe('/runs/run-10');
      expect(mocks.fetchGet.mock.calls[11][0]).toBe('/runs/run-11');
      expect(
        JSON.parse(window.localStorage.getItem(BINDINGS_KEY)!)
      ).toHaveLength(12);
      expect(mocks.proxyFetchPut).not.toHaveBeenCalled();
    });
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
