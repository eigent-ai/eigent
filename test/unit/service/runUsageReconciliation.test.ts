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

import { fetchGet } from '@/api/http';
import { reconcileRunUsage } from '@/service/runUsageReconciliation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({ fetchGet: vi.fn() }));
const fetchGetMock = vi.mocked(fetchGet);
const input = {
  projectId: 'project-1',
  runId: 'run-1',
  terminalEventTypes: ['run.failed', 'run.deadline_reached'],
};

function event(
  sequence: number,
  eventType = 'legacy.request_usage',
  payload: Record<string, unknown> = { agent_id: 'agent-1', tokens: 10 }
) {
  return {
    event_id: `event-${sequence}`,
    project_id: 'project-1',
    run_id: 'run-1',
    sequence,
    run_sequence: sequence,
    // Aggregate version is deliberately not equal to sequence.
    run_version: sequence + 100,
    event_type: eventType,
    legacy_step: eventType.startsWith('legacy.')
      ? eventType.slice('legacy.'.length)
      : null,
    payload,
  };
}

function page(events: ReturnType<typeof event>[], hasMore = false) {
  return {
    run_id: 'run-1',
    after_sequence: events.length ? events[0].sequence - 1 : 0,
    next_sequence: events.at(-1)?.sequence ?? 0,
    has_more: hasMore,
    events,
  };
}

describe('reconcileRunUsage', () => {
  beforeEach(() => {
    fetchGetMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('recovers only the known usage through the irreversible terminal, not its later tail', async () => {
    fetchGetMock.mockResolvedValue(
      page([
        event(1),
        event(2, 'run.failed', {}),
        event(3, 'legacy.request_usage', { tokens: 999 }),
      ])
    );
    await expect(reconcileRunUsage(input)).resolves.toBe(10);
    expect(fetchGetMock).toHaveBeenCalledOnce();
    expect(fetchGetMock).toHaveBeenCalledWith(
      '/runs/run-1/events',
      { after_sequence: 0, limit: 500 },
      undefined,
      { signal: expect.any(AbortSignal) }
    );
  });

  it('reads a second page and truncates its requested count at the exact sequence boundary', async () => {
    fetchGetMock
      .mockResolvedValueOnce(
        page(
          Array.from({ length: 500 }, (_, index) => event(index + 1)),
          true
        )
      )
      .mockResolvedValueOnce(
        page([event(501), event(502, 'run.failed', {})], true)
      );
    await expect(
      reconcileRunUsage({ ...input, throughSequence: 502 })
    ).resolves.toBe(5010);
    expect(fetchGetMock.mock.calls[1][1]).toEqual({
      after_sequence: 500,
      limit: 2,
    });
  });

  it('deduplicates model invocation identities and takes the maximum of overlapping usage sources', async () => {
    const invocation = {
      invocation_id: 'invocation-1',
      attempt_id: 'attempt-1',
      usage: {
        prompt_tokens: 80,
        completion_tokens: 20,
        cache_read_tokens: 80,
      },
    };
    fetchGetMock.mockResolvedValue(
      page([
        event(1, 'model.invocation.completed', invocation),
        event(2, 'model.invocation.completed', invocation),
        event(3, 'legacy.request_usage', { agent_id: 'agent-1', tokens: 100 }),
        event(4, 'legacy.deactivate_agent', {
          agent_id: 'agent-1',
          tokens: 100,
        }),
        event(5, 'run.failed', {}),
      ])
    );
    await expect(reconcileRunUsage(input)).resolves.toBe(100);
  });

  it('preserves separate legacy agent turns and usage accumulated before Resume', async () => {
    fetchGetMock.mockResolvedValue(
      page([
        event(1, 'legacy.request_usage', { agent_id: 'a', tokens: 30 }),
        event(2, 'legacy.deactivate_agent', { agent_id: 'a', tokens: 0 }),
        event(3, 'runtime.interrupted', {}),
        event(4, 'run.attempt_created', { attempt_number: 2 }),
        event(5, 'legacy.activate_agent', { agent_id: 'a' }),
        event(6, 'legacy.deactivate_agent', { agent_id: 'a', tokens: 70 }),
        event(7, 'legacy.request_usage', { agent_id: 'b', tokens: 20 }),
        event(8, 'run.failed', {}),
      ])
    );
    await expect(reconcileRunUsage(input)).resolves.toBe(120);
  });

  it('uses known model counts without inventing missing usage or counting incomplete invocations', async () => {
    fetchGetMock.mockResolvedValue(
      page([
        event(1, 'model.invocation.completed', {
          invocation_id: 'call-1',
          usage: { prompt_tokens: 50, completion_tokens: null },
        }),
        event(2, 'model.invocation.dispatched', {
          invocation_id: 'call-2',
          usage: { prompt_tokens: 999, completion_tokens: 999 },
        }),
        event(3, 'run.deadline_reached', {}),
      ])
    );
    await expect(reconcileRunUsage(input)).resolves.toBe(50);
  });

  it('returns zero only for a complete matching terminal with no known usage', async () => {
    fetchGetMock.mockResolvedValue(page([event(1, 'run.cancelled', {})]));
    await expect(
      reconcileRunUsage({ ...input, terminalEventTypes: ['run.cancelled'] })
    ).resolves.toBe(0);
  });

  it.each([
    [
      'page Run',
      (value: any) => {
        value.run_id = 'another-run';
      },
    ],
    [
      'page Project',
      (value: any) => {
        value.project_id = 'another-project';
      },
    ],
    [
      'starting cursor',
      (value: any) => {
        value.after_sequence = 2;
      },
    ],
    [
      'next cursor',
      (value: any) => {
        value.next_sequence = 10;
      },
    ],
    [
      'event Project',
      (value: any) => {
        value.events[0].project_id = 'another-project';
      },
    ],
    [
      'event Run',
      (value: any) => {
        value.events[0].run_id = 'another-run';
      },
    ],
    [
      'sequence gap',
      (value: any) => {
        value.events[0].sequence = 5;
      },
    ],
    [
      'duplicate event id',
      (value: any) => {
        value.events[1].event_id = value.events[0].event_id;
      },
    ],
    [
      'missing payload',
      (value: any) => {
        value.events[0].payload = null;
      },
    ],
    [
      'negative tokens',
      (value: any) => {
        value.events[0].payload.tokens = -10;
      },
    ],
  ])(
    'rejects %s mismatches rather than reporting an incorrect zero',
    async (_name, corrupt) => {
      const response = page([event(1), event(2, 'run.failed', {})]);
      corrupt(response);
      fetchGetMock.mockResolvedValue(response);
      await expect(reconcileRunUsage(input)).rejects.toThrow();
    }
  );

  it('rejects a fixed boundary whose event is not the requested terminal', async () => {
    fetchGetMock.mockResolvedValue(page([event(1)], true));
    await expect(
      reconcileRunUsage({ ...input, throughSequence: 1 })
    ).rejects.toThrow('matching terminal boundary');
  });

  it('rejects incomplete history and transport failures instead of returning partial usage', async () => {
    fetchGetMock.mockResolvedValueOnce(page([event(1)]));
    await expect(reconcileRunUsage(input)).rejects.toThrow(
      'matching terminal boundary'
    );
    fetchGetMock.mockRejectedValueOnce(new Error('offline'));
    await expect(reconcileRunUsage(input)).rejects.toThrow('offline');
  });

  it('rejects interrupted recovery because another Attempt can Resume', async () => {
    await expect(
      reconcileRunUsage({
        ...input,
        terminalEventTypes: ['runtime.interrupted'],
      })
    ).rejects.toThrow('exact terminal Run');
    expect(fetchGetMock).not.toHaveBeenCalled();
  });

  it('can recover an already-detached completed Run', async () => {
    fetchGetMock.mockResolvedValue(
      page([event(1), event(2, 'run.completed', {})])
    );
    await expect(
      reconcileRunUsage({ ...input, terminalEventTypes: ['run.completed'] })
    ).resolves.toBe(10);
  });

  it('bounds the total scan to 10000 events', async () => {
    fetchGetMock.mockImplementation(async (_url, params) => {
      const cursor = params.after_sequence as number;
      return page(
        Array.from({ length: 500 }, (_, i) => event(cursor + i + 1)),
        true
      );
    });
    await expect(reconcileRunUsage(input)).rejects.toThrow(
      '10000-event scan bound'
    );
    expect(fetchGetMock).toHaveBeenCalledTimes(20);
  });

  it('applies one overall deadline across pages even if fetch ignores abort', async () => {
    vi.useFakeTimers();
    let finishFirst!: (value: unknown) => void;
    let finishSecond!: (value: unknown) => void;
    fetchGetMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSecond = resolve;
          })
      );
    const result = reconcileRunUsage(input).catch((error) => error);
    await vi.advanceTimersByTimeAsync(4_000);
    finishFirst(page([event(1)], true));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchGetMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(fetchGetMock.mock.calls[1][3]?.signal?.aborted).toBe(true);
    finishSecond(page([event(2, 'run.failed', {})]));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchGetMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors caller abort before and during reads and removes its deadline', async () => {
    vi.useFakeTimers();
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(
      reconcileRunUsage({ ...input, signal: alreadyAborted.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchGetMock).not.toHaveBeenCalled();
    const controller = new AbortController();
    fetchGetMock.mockImplementation(() => new Promise(() => {}));
    const result = reconcileRunUsage({
      ...input,
      signal: controller.signal,
    }).catch((error) => error);
    controller.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(fetchGetMock.mock.calls[0][3]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
