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

import type { SSETransportOptions } from '@/api/http';
import {
  normalizeLocalRunEvent,
  type ProjectSnapshotInput,
} from '@/lib/projector';
import { ProjectEventStore } from '@/store/projectEventStore';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProjectRunEventStreamOwner,
  selectCanonicalLiveRuns,
  type EventRecoveryFetch,
  type EventStreamTransport,
} from './projectRunEventStream';

type RunInput = {
  runId: string;
  status?: string;
  sequence?: number;
  version?: number;
  updatedAt?: string;
  origin?: string | null;
  resumeBlockedReason?: string | null;
  eventsTruncated?: boolean;
  truncationRecoveryTarget?: number;
};

function snapshotInput(
  projectId: string,
  runs: RunInput[]
): ProjectSnapshotInput {
  return {
    project_id: projectId,
    current_cursor: 0,
    runs: runs.map((run) => ({
      run_id: run.runId,
      status: run.status ?? 'running',
      expected_next_run_sequence: (run.sequence ?? 0) + 1,
      updated_at: run.updatedAt ?? '2026-08-11T10:00:00.000Z',
      version: run.version ?? run.sequence ?? 0,
      ...(run.eventsTruncated ? { events_truncated: true } : {}),
      ...(run.truncationRecoveryTarget !== undefined
        ? { truncation_recovery_target: run.truncationRecoveryTarget }
        : {}),
      origin: run.origin === undefined ? 'local' : run.origin,
      resume_blocked_reason: run.resumeBlockedReason ?? null,
    })),
    recent_events: [],
  };
}

function hydratedStore(projectId: string, runs: RunInput[]) {
  const store = new ProjectEventStore(projectId, {
    scheduleFlush: () => () => undefined,
  });
  store.replaceSnapshot(snapshotInput(projectId, runs));
  return store;
}

function runEvent(
  sequence: number,
  runId = 'run-1',
  eventType = 'notice.updated'
) {
  return {
    event_id: `${runId}:event:${sequence}`,
    run_id: runId,
    sequence,
    run_version: sequence,
    event_type: eventType,
    legacy_step: null,
    payload: { display_title: `Event ${sequence}` },
    created_at: new Date(
      Date.UTC(2026, 7, 11, 10, 0, 0) + sequence * 1_000
    ).toISOString(),
  };
}

function message(event: string, data: unknown) {
  return {
    id: '',
    event,
    data: typeof data === 'string' ? data : JSON.stringify(data),
  };
}

function unresolvedTransport() {
  const signals: AbortSignal[] = [];
  const transport = vi.fn(
    (options: SSETransportOptions) =>
      new Promise<void>((resolve) => {
        const signal = options.signal;
        if (!signal) return;
        signals.push(signal);
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      })
  );
  return { signals, transport };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

describe('ProjectRunEventStreamOwner', () => {
  it('opens one exact canonical GET stream only after snapshot hydration', async () => {
    const store = hydratedStore('project-1', [{ runId: 'run/1', sequence: 7 }]);
    const pending = unresolvedTransport();
    const owner = new ProjectRunEventStreamOwner({
      projectId: 'project-1',
      store,
      transport: pending.transport,
    });

    owner.updateSnapshot({
      ...store.getSnapshot(),
      hasHydratedSnapshot: false,
    });
    expect(pending.transport).not.toHaveBeenCalled();

    owner.updateSnapshot(store.getSnapshot());
    owner.updateSnapshot(store.getSnapshot());

    expect(pending.transport).toHaveBeenCalledTimes(1);
    expect(pending.transport.mock.calls[0][0]).toMatchObject({
      url: '/runs/run%2F1/stream?after_sequence=7',
      method: 'GET',
      openWhenHidden: true,
      signal: expect.any(AbortSignal),
    });
    expect(owner.getActiveRunIds()).toEqual(['run/1']);

    owner.dispose();
    await vi.waitFor(() => expect(pending.signals[0].aborted).toBe(true));
  });

  it('enqueues only run_event envelopes, strips raw data, and deduplicates by sequence', async () => {
    const store = hydratedStore('project-1', [{ runId: 'run-1', sequence: 1 }]);
    const enqueue = vi.spyOn(store, 'enqueue');
    const transport: EventStreamTransport = vi.fn(async (options) => {
      await options.onmessage(message('heartbeat', { after_sequence: 1 }));
      await options.onmessage(message('runtime_detached', { run_id: 'run-1' }));
      await options.onmessage(message('run_event', runEvent(2)));
      await options.onmessage(message('run_event', runEvent(2)));
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) resolve();
        else
          options.signal?.addEventListener('abort', () => resolve(), {
            once: true,
          });
      });
    });
    const owner = new ProjectRunEventStreamOwner({
      projectId: 'project-1',
      store,
      transport,
    });

    owner.updateSnapshot(store.getSnapshot());
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'run-1:event:2',
        runSequence: 2,
        raw: null,
      })
    );
    store.flushAll();
    expect(store.getSnapshot().view.runs['run-1'].lastSequence).toBe(2);

    owner.dispose();
  });

  it('reconnects a detached stream from the newest accepted Run sequence', async () => {
    const store = hydratedStore('project-1', [{ runId: 'run-1', sequence: 1 }]);
    let callCount = 0;
    const transport: EventStreamTransport = vi.fn(async (options) => {
      callCount += 1;
      if (callCount === 1) {
        await options.onmessage(message('run_event', runEvent(2)));
        await options.onmessage(
          message('runtime_detached', { after_sequence: 2 })
        );
        return;
      }
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) resolve();
        else
          options.signal?.addEventListener('abort', () => resolve(), {
            once: true,
          });
      });
    });
    const owner = new ProjectRunEventStreamOwner({
      projectId: 'project-1',
      store,
      transport,
      reconnectDelayMs: 0,
    });

    owner.updateSnapshot(store.getSnapshot());
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2));

    expect(transport.mock.calls[1][0].url).toBe(
      '/runs/run-1/stream?after_sequence=2'
    );
    owner.dispose();
  });

  it('continues when human-reply reconciliation advances the shared Run first', async () => {
    const store = hydratedStore('project-1', [{ runId: 'run-1', sequence: 3 }]);
    let streamOptions: SSETransportOptions | null = null;
    const transport: EventStreamTransport = vi.fn(
      (options) =>
        new Promise<void>((resolve) => {
          streamOptions = options;
          if (options.signal?.aborted) resolve();
          else
            options.signal?.addEventListener('abort', () => resolve(), {
              once: true,
            });
        })
    );
    const owner = new ProjectRunEventStreamOwner({
      projectId: 'project-1',
      store,
      transport,
    });

    // The stream starts from the interaction request at sequence 3.
    owner.updateSnapshot(store.getSnapshot());
    await vi.waitFor(() => expect(streamOptions).not.toBeNull());

    // The POST reconciliation projects the decision and the first resumed
    // activity before React has supplied that snapshot back to the owner.
    store.enqueue([
      normalizeLocalRunEvent(
        runEvent(4, 'run-1', 'interaction.resolved'),
        'project-1'
      ),
      normalizeLocalRunEvent(runEvent(5, 'run-1', 'tool.started'), 'project-1'),
    ]);
    store.flushAll();
    expect(store.getSnapshot().view.runs['run-1'].lastSequence).toBe(5);

    // A later Todo/tool event must use the shared watermark instead of being
    // mistaken for a 3 -> 6 gap that kills the companion stream.
    await streamOptions!.onmessage(message('run_event', runEvent(6)));
    expect(streamOptions!.signal?.aborted).toBe(false);
    expect(owner.getActiveRunIds()).toEqual(['run-1']);

    store.flushAll();
    expect(store.getSnapshot().view.runs['run-1'].lastSequence).toBe(6);
    expect(store.getSnapshot().view.needsResync).toBe(false);

    owner.dispose();
  });

  it('isolates malformed events without leaking them into the store', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = hydratedStore('project-1', [{ runId: 'run-1', sequence: 0 }]);
    const enqueue = vi.spyOn(store, 'enqueue');
    const transport: EventStreamTransport = vi.fn(async (options) => {
      await options.onmessage(message('run_event', '{not-json'));
      const missingSequence = runEvent(1);
      delete (missingSequence as Partial<typeof missingSequence>).sequence;
      await options.onmessage(message('run_event', missingSequence));
      await options.onmessage(message('run_event', runEvent(1)));
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) resolve();
        else
          options.signal?.addEventListener('abort', () => resolve(), {
            once: true,
          });
      });
    });
    const owner = new ProjectRunEventStreamOwner({
      projectId: 'project-1',
      store,
      transport,
    });

    owner.updateSnapshot(store.getSnapshot());
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'run-1:event:1' })
    );

    owner.dispose();
  });

  it('aborts streams that become ineligible and never connects unsafe Runs', async () => {
    const store = hydratedStore('project-1', [
      { runId: 'local-running', status: 'running' },
      {
        runId: 'cloud-running',
        status: 'running',
        origin: 'cloud_restore',
      },
      {
        runId: 'blocked-running',
        status: 'running',
        resumeBlockedReason: 'workspace_missing',
      },
      { runId: 'completed', status: 'completed' },
      { runId: 'unknown', status: 'unknown' },
    ]);
    const pending = unresolvedTransport();
    const owner = new ProjectRunEventStreamOwner({
      projectId: 'project-1',
      store,
      transport: pending.transport,
    });

    owner.updateSnapshot(store.getSnapshot());

    expect(owner.getActiveRunIds()).toEqual(['local-running']);
    expect(pending.transport).toHaveBeenCalledTimes(1);

    store.replaceSnapshot(
      snapshotInput('project-1', [
        { runId: 'local-running', status: 'completed' },
      ])
    );
    owner.updateSnapshot(store.getSnapshot());

    expect(owner.getActiveRunIds()).toEqual([]);
    expect(pending.signals[0].aborted).toBe(true);
    owner.dispose();
  });

  it('keeps normal SSE detached until recovery reaches the Run target', async () => {
    const store = hydratedStore('project-1', [
      {
        runId: 'run-1',
        status: 'waiting_for_user',
        version: 1,
        eventsTruncated: true,
        truncationRecoveryTarget: 1,
      },
    ]);
    const page = deferred<unknown>();
    let recoverySignal: AbortSignal | undefined;
    const recoveryFetch = vi.fn((...args: Parameters<EventRecoveryFetch>) => {
      recoverySignal = args[3]?.signal;
      return page.promise;
    });
    const pending = unresolvedTransport();
    const owner = new ProjectRunEventStreamOwner({
      projectId: 'project-1',
      store,
      transport: pending.transport,
      recoveryFetch,
    });

    owner.updateSnapshot(store.getSnapshot());
    await vi.waitFor(() => expect(recoveryFetch).toHaveBeenCalledTimes(1));

    expect(owner.getActiveRunIds()).toEqual([]);
    expect(pending.transport).not.toHaveBeenCalled();
    expect(recoverySignal?.aborted).toBe(false);

    page.resolve({
      run_id: 'run-1',
      next_sequence: 1,
      has_more: false,
      events: [runEvent(1)],
    });

    await vi.waitFor(() =>
      expect(store.getSnapshot().view.runs['run-1'].lastSequence).toBe(1)
    );
    await vi.waitFor(() => expect(pending.transport).toHaveBeenCalledTimes(1));
    expect(pending.transport.mock.calls[0][0].url).toBe(
      '/runs/run-1/stream?after_sequence=1'
    );
    expect(
      store.getSnapshot().view.runs['run-1'].truncationRecoveryTarget
    ).toBeUndefined();

    owner.dispose();
  });

  it('recovers every target sequentially even when more than four Runs need replay', async () => {
    const runs = Array.from({ length: 6 }, (_, index) => ({
      runId: `run-${index + 1}`,
      status: 'waiting_for_user',
      version: 1,
      eventsTruncated: true,
      truncationRecoveryTarget: 1,
    }));
    const store = hydratedStore('project-1', runs);
    let activeFetches = 0;
    let maxActiveFetches = 0;
    const recoveryFetch = vi.fn(
      async (...args: Parameters<EventRecoveryFetch>) => {
        activeFetches += 1;
        maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
        await Promise.resolve();
        const runId = decodeURIComponent(args[0].split('/')[2]);
        activeFetches -= 1;
        return {
          run_id: runId,
          next_sequence: 1,
          has_more: false,
          events: [runEvent(1, runId)],
        };
      }
    );
    const pending = unresolvedTransport();
    const owner = new ProjectRunEventStreamOwner({
      projectId: 'project-1',
      store,
      transport: pending.transport,
      recoveryFetch,
    });

    owner.updateSnapshot(store.getSnapshot());

    await vi.waitFor(() =>
      expect(
        runs.every(
          ({ runId }) => store.getSnapshot().view.runs[runId].lastSequence === 1
        )
      ).toBe(true)
    );
    expect(recoveryFetch).toHaveBeenCalledTimes(6);
    expect(maxActiveFetches).toBe(1);
    expect(store.getSnapshot().overflowed).toBe(false);
    await vi.waitFor(() => expect(pending.transport).toHaveBeenCalledTimes(4));

    owner.dispose();
  });

  it('pages a history longer than the store queue without overflowing it', async () => {
    const target = 1_205;
    const store = hydratedStore('project-1', [
      {
        runId: 'long-run',
        status: 'waiting_for_user',
        version: target,
        eventsTruncated: true,
        truncationRecoveryTarget: target,
      },
    ]);
    const recoveryFetch = vi.fn(
      async (...args: Parameters<EventRecoveryFetch>) => {
        const afterSequence = args[1]?.after_sequence ?? 0;
        const limit = args[1]?.limit ?? 0;
        const nextSequence = Math.min(afterSequence + limit, target);
        return {
          run_id: 'long-run',
          next_sequence: nextSequence,
          has_more: nextSequence < target,
          events: Array.from(
            { length: nextSequence - afterSequence },
            (_, index) => runEvent(afterSequence + index + 1, 'long-run')
          ),
        };
      }
    );
    const pending = unresolvedTransport();
    const owner = new ProjectRunEventStreamOwner({
      projectId: 'project-1',
      store,
      transport: pending.transport,
      recoveryFetch,
    });

    owner.updateSnapshot(store.getSnapshot());

    await vi.waitFor(
      () =>
        expect(store.getSnapshot().view.runs['long-run'].lastSequence).toBe(
          target
        ),
      { timeout: 5_000 }
    );
    expect(recoveryFetch).toHaveBeenCalledTimes(13);
    expect(store.getPendingEventCount()).toBe(0);
    expect(store.getSnapshot()).toMatchObject({
      overflowed: false,
      view: { needsResync: false },
    });

    owner.dispose();
  });

  it('aborts an in-flight recovery when the store incarnation resets', async () => {
    const store = hydratedStore('project-1', [
      {
        runId: 'run-1',
        version: 1,
        eventsTruncated: true,
        truncationRecoveryTarget: 1,
      },
    ]);
    const page = deferred<unknown>();
    let recoverySignal: AbortSignal | undefined;
    const recoveryFetch = vi.fn((...args: Parameters<EventRecoveryFetch>) => {
      recoverySignal = args[3]?.signal;
      return page.promise;
    });
    const owner = new ProjectRunEventStreamOwner({
      projectId: 'project-1',
      store,
      recoveryFetch,
    });

    owner.updateSnapshot(store.getSnapshot());
    await vi.waitFor(() => expect(recoveryFetch).toHaveBeenCalledTimes(1));
    store.reset();
    owner.updateSnapshot(store.getSnapshot());

    expect(recoverySignal?.aborted).toBe(true);
    page.resolve({
      run_id: 'run-1',
      next_sequence: 1,
      has_more: false,
      events: [runEvent(1)],
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getSnapshot()).toMatchObject({
      incarnation: 1,
      hasHydratedSnapshot: false,
      view: { runs: {} },
    });
    expect(store.getPendingEventCount()).toBe(0);

    owner.dispose();
  });

  it('aborts an in-flight recovery when the store requires resync', async () => {
    const store = hydratedStore('project-1', [
      {
        runId: 'run-1',
        version: 1,
        eventsTruncated: true,
        truncationRecoveryTarget: 1,
      },
    ]);
    const page = deferred<unknown>();
    let recoverySignal: AbortSignal | undefined;
    const recoveryFetch = vi.fn((...args: Parameters<EventRecoveryFetch>) => {
      recoverySignal = args[3]?.signal;
      return page.promise;
    });
    const owner = new ProjectRunEventStreamOwner({
      projectId: 'project-1',
      store,
      recoveryFetch,
    });

    owner.updateSnapshot(store.getSnapshot());
    await vi.waitFor(() => expect(recoveryFetch).toHaveBeenCalledTimes(1));
    store.enqueue(normalizeLocalRunEvent(runEvent(2, 'run-1'), 'project-1'));
    store.flushAll();
    owner.updateSnapshot(store.getSnapshot());

    expect(store.getSnapshot().view.needsResync).toBe(true);
    expect(recoverySignal?.aborted).toBe(true);
    page.resolve({
      run_id: 'run-1',
      next_sequence: 1,
      has_more: false,
      events: [runEvent(1)],
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getSnapshot().view.runs['run-1'].lastSequence).toBe(0);

    owner.dispose();
  });

  it('leaves the truncation marker fail-closed when a recovery bound is exceeded', async () => {
    const store = hydratedStore('project-1', [
      {
        runId: 'run-1',
        status: 'waiting_for_user',
        version: 3,
        eventsTruncated: true,
        truncationRecoveryTarget: 3,
      },
    ]);
    const recoveryFetch = vi.fn(async () => ({
      run_id: 'run-1',
      next_sequence: 3,
      has_more: false,
      events: [runEvent(1), runEvent(2), runEvent(3)],
    }));
    const pending = unresolvedTransport();
    const owner = new ProjectRunEventStreamOwner({
      projectId: 'project-1',
      store,
      transport: pending.transport,
      recoveryFetch,
      maxRecoveryEvents: 2,
    });

    owner.updateSnapshot(store.getSnapshot());
    await vi.waitFor(() => expect(recoveryFetch).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();
    owner.updateSnapshot(store.getSnapshot());

    expect(recoveryFetch).toHaveBeenCalledTimes(1);
    expect(pending.transport).not.toHaveBeenCalled();
    expect(store.getSnapshot().view.runs['run-1']).toMatchObject({
      lastSequence: 0,
      eventsTruncated: true,
      truncationRecoveryTarget: 3,
    });
    expect(store.getSnapshot().overflowed).toBe(false);

    owner.dispose();
  });

  it('bounds concurrent streams and prioritizes waiting user controls', () => {
    const store = hydratedStore('project-1', [
      {
        runId: 'new-running',
        status: 'running',
        updatedAt: '2026-08-11T12:00:00.000Z',
      },
      {
        runId: 'waiting',
        status: 'waiting_for_user',
        updatedAt: '2026-08-11T10:00:00.000Z',
      },
      {
        runId: 'recovering-waiting',
        status: 'waiting_for_user',
        version: 3,
        eventsTruncated: true,
        truncationRecoveryTarget: 3,
        updatedAt: '2026-08-11T14:00:00.000Z',
      },
      {
        runId: 'pending',
        status: 'pending',
        updatedAt: '2026-08-11T13:00:00.000Z',
      },
    ]);

    expect(
      selectCanonicalLiveRuns(store.getSnapshot(), 2).map((run) => run.runId)
    ).toEqual(['waiting', 'new-running']);
  });
});
