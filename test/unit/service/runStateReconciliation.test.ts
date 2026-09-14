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
import { normalizeLocalRunEvent } from '@/lib/projector';
import { selectPendingHumanControls } from '@/lib/projector/control';
import { runProjectionStore } from '@/lib/runEvents/projectionStore';
import {
  RunEventIngressRegistry,
  runEventIngressRegistry,
} from '@/lib/runEvents/registry';
import { ProjectRunEventStreamOwner } from '@/service/projectRunEventStream';
import { reconcileLegacyRunState } from '@/service/reconcileLegacyRunState';
import { RunStateReconciler } from '@/service/runStateReconciliation';
import {
  getProjectEventStore,
  resetProjectEventStoresForTests,
} from '@/store/projectEventStore';
import { ChatTaskStatus } from '@/types/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchGetMock, sseTransportMock } = vi.hoisted(() => ({
  fetchGetMock: vi.fn(),
  sseTransportMock: vi.fn(),
}));
vi.mock('@/api/http', () => ({
  fetchGet: fetchGetMock,
  sseTransport: sseTransportMock,
}));

const projectId = 'project-fixture';
const runId = 'run-fixture';
const timestamp = '2026-01-01T00:00:00.000Z';

function event(sequence: number, eventType: string, payload = {}, id = runId) {
  return {
    event_id: `${id}:${sequence}`,
    project_id: projectId,
    run_id: id,
    sequence,
    run_version: sequence,
    event_type: eventType,
    payload,
    created_at: timestamp,
  };
}

function summary(status: string, version = 3) {
  return {
    project_id: projectId,
    run_id: runId,
    status,
    version,
    origin: 'local',
    resume_blocked_reason: null,
    updated_at: timestamp,
    latest_attempt: { attempt_number: 1, status },
    total_attempt_elapsed_ms: 1200,
  };
}

function seed() {
  const store = getProjectEventStore(projectId);
  store.replaceSnapshot({
    project_id: projectId,
    current_cursor: 0,
    runs: [
      {
        run_id: runId,
        status: 'waiting_for_user',
        version: 2,
        expected_next_run_sequence: 3,
        updated_at: timestamp,
        origin: 'local',
        resume_blocked_reason: null,
      },
    ],
    recent_events: [
      event(1, 'run.attempt_started'),
      event(2, 'interaction.requested', {
        interaction_id: 'question-fixture',
        interaction_type: 'question',
        prompt: 'Continue?',
      }),
    ],
  });
  runProjectionStore.upsertRunSummaries(projectId, [
    summary('waiting_for_user', 2),
  ]);
  return store;
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('stream to canonical state reconciliation', () => {
  let registry: RunEventIngressRegistry;
  let streams: SSETransportOptions[];
  let owners: ProjectRunEventStreamOwner[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    resetProjectEventStoresForTests();
    runProjectionStore.clear();
    registry = new RunEventIngressRegistry();
    streams = [];
    owners = [];
    sseTransportMock.mockImplementation((options: SSETransportOptions) => {
      streams.push(options);
      return new Promise<void>((resolve) => {
        options.signal?.addEventListener('abort', () => resolve(), {
          once: true,
        });
      });
    });
  });

  afterEach(() => {
    registry.clear();
    runEventIngressRegistry.clear();
    owners.forEach((owner) => owner.dispose());
    resetProjectEventStoresForTests();
    vi.useRealTimers();
  });

  it.each(['failed', 'completed', 'cancelled'])(
    'recovers missing run.%s after a network error without erasing history',
    async (status) => {
      const store = seed();
      const before = store.getSnapshot();
      fetchGetMock.mockResolvedValue(summary(status));
      registry.ensureLocal(projectId, runId);
      streams[0].onerror?.(new TypeError('NetworkError'));
      await settle();
      expect(fetchGetMock).toHaveBeenCalledWith(
        `/runs/${runId}`,
        undefined,
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      const after = store.getSnapshot();
      expect(after.view.runs[runId]).toMatchObject({
        status,
        runVersion: 3,
        lastSequence: 2,
      });
      expect(after.chat).toBe(before.chat);
      expect(after.view.currentCursor).toBe(before.view.currentCursor);
      expect(after.control.interactionById).toEqual(
        before.control.interactionById
      );
      expect(selectPendingHumanControls(after.control)).toEqual([]);
      expect(runProjectionStore.getRun(projectId, runId)?.status).toBe(status);
    }
  );

  it.each([
    'runtime_detached',
    'runtime_error',
    'replay_required',
    'replay_caught_up',
  ])('reads canonical state on %s', async (marker) => {
    const store = seed();
    fetchGetMock.mockResolvedValue(summary('failed'));
    registry.ensureLocal(projectId, runId, { reconnect: true });
    await streams[0].onmessage({
      id: '',
      event: marker,
      data: JSON.stringify({ run_id: runId }),
    });
    await settle();
    expect(store.getSnapshot().view.runs[runId].status).toBe('failed');
  });

  it('keeps a genuinely active request actionable after detach', async () => {
    const store = seed();
    fetchGetMock.mockResolvedValue(summary('waiting_for_user', 2));
    registry.ensureLocal(projectId, runId);
    await streams[0].onmessage({
      id: '',
      event: 'runtime_detached',
      data: '{}',
    });
    await settle();
    expect(store.getSnapshot().view.runs[runId].status).toBe(
      'waiting_for_user'
    );
    expect(
      selectPendingHumanControls(store.getSnapshot().control)
    ).toHaveLength(1);
    expect(streams[0].signal?.aborted).toBe(false);
  });

  it('does not apply an old failure over a newer live attempt', async () => {
    const store = seed();
    let resolve!: (value: unknown) => void;
    fetchGetMock.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    registry.ensureLocal(projectId, runId);
    streams[0].onerror?.(new TypeError('NetworkError'));
    store.enqueue(
      normalizeLocalRunEvent(event(3, 'run.attempt_started'), projectId)
    );
    store.flushAll();
    runProjectionStore.upsertRunSummaries(projectId, [summary('running', 4)]);
    resolve(summary('failed', 2));
    await settle();
    expect(store.getSnapshot().view.runs[runId]).toMatchObject({
      status: 'running',
      runVersion: 3,
    });
    expect(runProjectionStore.getRun(projectId, runId)?.status).toBe('running');
  });

  it('discards late responses and stream callbacks after same-id reset', async () => {
    const store = seed();
    let resolve!: (value: unknown) => void;
    fetchGetMock.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    registry.ensureLocal(projectId, runId);
    streams[0].onerror?.(new TypeError('NetworkError'));
    store.reset();
    resolve(summary('failed'));
    await settle();
    await streams[0].onmessage({
      id: '',
      event: 'run_event',
      data: JSON.stringify(event(1, 'run.failed')),
    });
    store.flushAll();
    expect(store.getSnapshot().view.runs).toEqual({});
  });

  it('reconciles companion stream detach without waiting for EOF', async () => {
    const store = seed();
    fetchGetMock.mockResolvedValue(summary('cancelled'));
    const owner = new ProjectRunEventStreamOwner({
      projectId,
      store,
      transport: sseTransportMock,
    });
    owners.push(owner);
    owner.updateSnapshot(store.getSnapshot());
    await streams[0].onmessage({
      id: '',
      event: 'runtime_detached',
      data: '{}',
    });
    await settle();
    expect(store.getSnapshot().view.runs[runId].status).toBe('cancelled');
  });

  it('keeps assistant.final distinct from Run completion and receives a later failure', async () => {
    const store = seed();
    const owner = new ProjectRunEventStreamOwner({
      projectId,
      store,
      transport: sseTransportMock,
    });
    owners.push(owner);
    owner.updateSnapshot(store.getSnapshot());
    await streams[0].onmessage({
      id: '',
      event: 'run_event',
      data: JSON.stringify({
        ...event(3, 'assistant.final'),
        legacy_step: 'end',
      }),
    });
    store.flushAll();
    expect(streams[0].signal?.aborted).toBe(false);
    expect(store.getSnapshot().view.runs[runId].status).not.toBe('completed');
    await streams[0].onmessage({
      id: '',
      event: 'run_event',
      data: JSON.stringify(event(4, 'run.failed')),
    });
    store.flushAll();
    expect(store.getSnapshot().view.runs[runId].status).toBe('failed');
  });
  it.each([
    { project_id: 'another-session' },
    { run_id: 'another-run' },
    { version: -1 },
    { version: 2.5 },
    { status: 'unknown-status' },
    { updated_at: 'invalid' },
    { origin: 'unknown' },
    { total_attempt_elapsed_ms: -10 },
    { latest_attempt: { attempt_number: -1, status: 'failed' } },
  ])('rejects malformed or foreign snapshots: %j', async (invalid) => {
    const store = seed();
    fetchGetMock.mockResolvedValue({ ...summary('failed'), ...invalid });
    registry.ensureLocal(projectId, runId);
    streams[0].onerror?.(new TypeError('NetworkError'));
    await settle();
    expect(store.getSnapshot().view.runs[runId].status).toBe(
      'waiting_for_user'
    );
    expect(
      selectPendingHumanControls(store.getSnapshot().control)
    ).toHaveLength(1);
  });

  it('times out an uncooperative GET and retries at the next boundary', async () => {
    const store = seed();
    let resolveOld!: (value: unknown) => void;
    fetchGetMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      })
    );
    registry.ensureLocal(projectId, runId);
    streams[0].onerror?.(new TypeError('NetworkError'));
    await vi.advanceTimersByTimeAsync(5001);
    expect(fetchGetMock.mock.calls[0][3].signal.aborted).toBe(true);
    expect(store.getSnapshot().view.runs[runId].status).toBe(
      'waiting_for_user'
    );
    fetchGetMock.mockResolvedValue(summary('cancelled', 4));
    await streams[0].onmessage({
      id: '',
      event: 'replay_caught_up',
      data: '{}',
    });
    await settle();
    resolveOld(summary('completed', 3));
    await settle();
    expect(store.getSnapshot().view.runs[runId].status).toBe('cancelled');
  });

  it('reconciles EOF even when there was no error callback', async () => {
    const store = seed();
    fetchGetMock.mockResolvedValue(summary('failed'));
    sseTransportMock.mockResolvedValue(undefined);
    await registry.ensureLocal(projectId, runId).promise;
    expect(store.getSnapshot().view.runs[runId].status).toBe('failed');
  });

  it('reconciles a reopened SSE and keeps live requests during network failure', async () => {
    const store = seed();
    fetchGetMock.mockRejectedValue(new TypeError('Offline'));
    registry.ensureLocal(projectId, runId);
    const response = () =>
      new Response(null, { headers: { 'content-type': 'text/event-stream' } });
    await streams[0].onopen?.(response());
    streams[0].onerror?.(new TypeError('NetworkError'));
    await settle();
    expect(
      selectPendingHumanControls(store.getSnapshot().control)
    ).toHaveLength(1);
    fetchGetMock.mockResolvedValue(summary('completed'));
    await streams[0].onopen?.(response());
    await settle();
    expect(store.getSnapshot().view.runs[runId].status).toBe('completed');
  });

  it('does not let detached callbacks or GETs from an old owner affect its replacement', async () => {
    const store = seed();
    let resolveOld!: (value: unknown) => void;
    fetchGetMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      })
    );
    registry.ensureLocal(projectId, runId);
    streams[0].onerror?.(new TypeError('NetworkError'));
    registry.disconnect(runId);
    registry.ensureLocal(projectId, runId);
    resolveOld(summary('failed'));
    await streams[0].onmessage({
      id: '',
      event: 'run_event',
      data: JSON.stringify(event(3, 'run.failed')),
    });
    await settle();
    store.flushAll();
    expect(store.getSnapshot().view.runs[runId].status).toBe(
      'waiting_for_user'
    );
    expect(streams[1].signal?.aborted).toBe(false);
  });

  it('honors a newer queued live version when a terminal GET returns', async () => {
    const store = seed();
    let resolve!: (value: unknown) => void;
    fetchGetMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    registry.ensureLocal(projectId, runId);
    streams[0].onerror?.(new TypeError('NetworkError'));
    store.enqueue(
      normalizeLocalRunEvent(event(3, 'run.attempt_started'), projectId)
    );
    resolve(summary('failed', 2));
    await settle();
    expect(store.getSnapshot().view.runs[runId]).toMatchObject({
      status: 'running',
      runVersion: 3,
      lastSequence: 3,
    });
  });

  it('waits for the history snapshot owner, then reads fresh state without moving its cursor', async () => {
    const store = seed();
    const replacement = store.beginSnapshotReplacement()!;
    fetchGetMock.mockResolvedValue(summary('failed'));
    registry.ensureLocal(projectId, runId);
    streams[0].onerror?.(new TypeError('NetworkError'));
    await settle();
    expect(fetchGetMock).not.toHaveBeenCalled();
    store.cancelSnapshotReplacement(replacement);
    await vi.advanceTimersByTimeAsync(51);
    expect(store.getSnapshot().view.runs[runId]).toMatchObject({
      status: 'failed',
      lastSequence: 2,
    });
  });

  it('keeps original failure and recovered-stage receipts across GETs and duplicate terminal replay', async () => {
    const store = seed();
    store.enqueue([
      normalizeLocalRunEvent(
        event(3, 'run.failed', { reason: 'original failure' }),
        projectId
      ),
      normalizeLocalRunEvent(
        event(4, 'assistant.final', {
          message: 'Recovered-stage only; original attempt failed',
        }),
        projectId
      ),
    ]);
    store.flushAll();
    const before = store.getSnapshot().chat;
    fetchGetMock.mockResolvedValue({
      ...summary('completed', 5),
      latest_attempt: { attempt_number: 1, status: 'failed' },
    });
    const reconciler = new RunStateReconciler(projectId, runId, store);
    await reconciler.request();
    const terminal = normalizeLocalRunEvent(
      event(5, 'run.completed', {
        correction_of: `${runId}:3`,
        recovered_stage: true,
      }),
      projectId
    );
    store.enqueue(terminal);
    store.flushAll();
    const afterReplay = store.getSnapshot();
    store.enqueue(terminal);
    store.flushAll();
    expect(store.getSnapshot()).toBe(afterReplay);
    for (const node of before.nodes)
      expect(afterReplay.chat.nodeById[node.id]).toEqual(node);
    expect(afterReplay.view.runs[runId].latestAttempt?.status).toBe('failed');
    expect(afterReplay.view.runs[runId].status).toBe('completed');
    expect(afterReplay.view.runs[runId].lastSequence).toBe(5);
    reconciler.dispose();
  });

  it('closes only the failed legacy Task without changing its messages', async () => {
    seed();
    fetchGetMock.mockResolvedValue(summary('failed'));
    const task = { messages: [{ content: 'original failure' }] };
    const state = {
      tasks: { [runId]: task, other: { messages: [] } },
      setStatus: vi.fn(),
      setDurableRunStatus: vi.fn(),
      setIsPending: vi.fn(),
      setActiveAsk: vi.fn(),
      setActiveAskList: vi.fn(),
      setTaskTime: vi.fn(),
      setElapsed: vi.fn(),
    };
    await reconcileLegacyRunState({
      projectId,
      runId,
      getState: () => state as never,
      isCurrent: () => true,
    });
    expect(state.setStatus).toHaveBeenCalledWith(
      runId,
      ChatTaskStatus.FINISHED
    );
    expect(state.setDurableRunStatus).toHaveBeenCalledWith(runId, 'failed');
    expect(state.setElapsed).toHaveBeenCalledWith(runId, 1200);
    expect(state.tasks[runId]).toBe(task);
    expect(state.setStatus).toHaveBeenCalledTimes(1);
  });

  it('does not clear the legacy UI after its captured Session or Run changed', async () => {
    seed();
    fetchGetMock.mockResolvedValue(summary('failed'));
    const getState = vi.fn();
    await reconcileLegacyRunState({
      projectId,
      runId,
      getState,
      isCurrent: () => false,
    });
    expect(getState).not.toHaveBeenCalled();
  });

  it('does not remove active streams absent from a capped listing, or revive requests after clear', async () => {
    seed();
    registry.ensureLocal(projectId, runId);
    fetchGetMock.mockResolvedValueOnce({
      project_id: projectId,
      runs: [],
      has_more: true,
    });
    await registry.reconcileProject(projectId);
    expect(registry.has(runId)).toBe(true);
    let resolve!: (value: unknown) => void;
    fetchGetMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const pending = registry.reconcileProject(projectId);
    registry.clear();
    resolve({ project_id: projectId, runs: [summary('running', 5)] });
    await pending;
    expect(registry.activeCount()).toBe(0);
    expect(runProjectionStore.getRun(projectId, runId)?.status).toBe(
      'waiting_for_user'
    );
  });

  it('finishes the terminal duration GET while React retires the companion stream', async () => {
    const store = seed();
    let resolve!: (value: unknown) => void;
    fetchGetMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const owner = new ProjectRunEventStreamOwner({
      projectId,
      store,
      transport: sseTransportMock,
    });
    owners.push(owner);
    owner.updateSnapshot(store.getSnapshot());
    await streams[0].onmessage({
      id: '',
      event: 'run_event',
      data: JSON.stringify(event(3, 'run.failed')),
    });
    store.flushAll();
    owner.updateSnapshot(store.getSnapshot());
    resolve(summary('failed'));
    await settle();
    expect(store.getSnapshot().view.runs[runId].totalAttemptElapsedMs).toBe(
      1200
    );
  });

  it('replays an original failure behind a newer audited outcome without rewinding status', async () => {
    const store = seed();
    fetchGetMock.mockResolvedValue({
      ...summary('completed', 5),
      latest_attempt: { attempt_number: 1, status: 'failed' },
    });
    const reconciler = new RunStateReconciler(projectId, runId, store);
    await reconciler.request();
    store.enqueue(
      normalizeLocalRunEvent(
        event(3, 'run.failed', { reason: 'original failure' }),
        projectId
      )
    );
    store.flushAll();
    expect(store.getSnapshot().view.runs[runId]).toMatchObject({
      status: 'completed',
      runVersion: 5,
      lastSequence: 3,
    });
    expect(
      store
        .getSnapshot()
        .chat.nodes.some((node) => node.eventType === 'run.failed')
    ).toBe(true);
    reconciler.dispose();
  });

  it('inactive requests do not consume the capacity reserved for real active HITL', () => {
    const store = getProjectEventStore(projectId, { maxPendingControls: 1 });
    for (let i = 0; i < 4; i++) {
      const id = `ended-${i}`;
      store.enqueue(
        normalizeLocalRunEvent(
          event(
            1,
            'interaction.requested',
            { interaction_id: `q-${i}`, prompt: 'Continue?' },
            id
          ),
          projectId
        )
      );
      store.flushAll();
      store.enqueue(
        normalizeLocalRunEvent(event(2, 'run.failed', {}, id), projectId)
      );
      store.flushAll();
    }
    store.enqueue(
      normalizeLocalRunEvent(
        event(
          1,
          'interaction.requested',
          { interaction_id: 'live-question', prompt: 'Continue?' },
          'live-run'
        ),
        projectId
      )
    );
    store.flushAll();
    expect(store.getSnapshot().overflowed).toBe(false);
    expect(
      selectPendingHumanControls(store.getSnapshot().control).map(
        (request) => request.runId
      )
    ).toEqual(['live-run']);
  });
  it('keeps the live stream when a stale list response races queued execution', async () => {
    const store = seed();
    registry.ensureLocal(projectId, runId);
    let resolve!: (value: unknown) => void;
    fetchGetMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const pending = registry.reconcileProject(projectId);
    store.enqueue(
      normalizeLocalRunEvent(event(3, 'run.attempt_started'), projectId)
    );
    resolve({ project_id: projectId, runs: [summary('failed', 2)] });
    await pending;
    expect(registry.has(runId)).toBe(true);
    expect(store.getSnapshot().view.runs[runId].status).toBe('running');
  });

  it('coalesces repeated errors while retaining one follow-up read for later boundaries', async () => {
    seed();
    let resolve!: (value: unknown) => void;
    fetchGetMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    fetchGetMock.mockResolvedValue(summary('failed'));
    registry.ensureLocal(projectId, runId);
    for (let i = 0; i < 5; i++)
      streams[0].onerror?.(new TypeError('NetworkError'));
    expect(fetchGetMock).toHaveBeenCalledTimes(1);
    resolve(summary('waiting_for_user', 2));
    await settle();
    expect(fetchGetMock).toHaveBeenCalledTimes(2);
    expect(
      getProjectEventStore(projectId).getSnapshot().view.runs[runId].status
    ).toBe('failed');
  });

  it('invalidates a pending GET when a same-id snapshot is explicitly replaced', async () => {
    const store = seed();
    let resolve!: (value: unknown) => void;
    fetchGetMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    registry.ensureLocal(projectId, runId);
    streams[0].onerror?.(new TypeError('NetworkError'));
    store.replaceSnapshot({
      project_id: projectId,
      current_cursor: 0,
      runs: [],
      recent_events: [],
    });
    resolve(summary('failed'));
    await settle();
    expect(store.getSnapshot().view.runs).toEqual({});
    expect(runProjectionStore.getRun(projectId, runId)).toBeNull();
  });
});
