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
import { normalizeLocalRunEvent } from '@/lib/projector';
import {
  hydrateProjectEventStore,
  loadOlderProjectChatHistory,
} from '@/service/projectEventStoreHydration';
import { ProjectEventStore } from '@/store/projectEventStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({ fetchGet: vi.fn() }));

const fetchGetMock = vi.mocked(fetchGet);

function localEvent(
  sequence: number,
  runId = 'run-1',
  overrides: Record<string, unknown> = {}
) {
  return {
    event_id: `${runId}-event-${sequence}`,
    run_id: runId,
    sequence,
    run_version: sequence,
    event_type: 'legacy.step',
    legacy_step: 'notice',
    payload: { content: `Notice ${sequence}` },
    created_at: `2026-08-11T10:00:${String(sequence).padStart(2, '0')}.000Z`,
    ...overrides,
  };
}

function runsResponse(overrides: Record<string, unknown> = {}) {
  return {
    project_id: 'project-1',
    runs: [
      {
        run_id: 'run-1',
        status: 'completed',
        version: 2,
        origin: 'local',
        resume_blocked_reason: null,
        updated_at: 1_786_441_602,
        ...overrides,
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('hydrateProjectEventStore', () => {
  beforeEach(() => {
    fetchGetMock.mockReset();
  });

  it('abandons a stuck Run listing within the hydration deadline', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock.mockReturnValueOnce(new Promise(() => undefined));

    await expect(
      hydrateProjectEventStore({
        projectId: 'project-1',
        store,
        runListTimeoutMs: 5,
      })
    ).rejects.toMatchObject({ name: 'TimeoutError' });

    expect(fetchGetMock.mock.calls[0]?.[3]?.signal.aborted).toBe(true);
  });

  it('loads bounded Run pages and atomically replaces the projection', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    const controller = new AbortController();
    fetchGetMock
      .mockResolvedValueOnce(runsResponse())
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 1,
        has_more: true,
        events: [localEvent(1)],
      })
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 2,
        has_more: false,
        events: [
          localEvent(2, 'run-1', {
            event_type: 'run.completed',
            legacy_step: 'end',
          }),
        ],
      });

    await expect(
      hydrateProjectEventStore({
        projectId: 'project-1',
        signal: controller.signal,
        store,
        eventPageSize: 1,
      })
    ).resolves.toMatchObject({
      projectId: 'project-1',
      runCount: 1,
      eventCount: 2,
      pageCount: 2,
    });

    expect(fetchGetMock).toHaveBeenNthCalledWith(
      1,
      '/runs',
      {
        project_id: 'project-1',
        limit: 100,
      },
      undefined,
      { signal: expect.any(AbortSignal) }
    );
    expect(fetchGetMock).toHaveBeenNthCalledWith(
      3,
      '/runs/run-1/events',
      { after_sequence: 1, limit: 1 },
      undefined,
      { signal: expect.any(AbortSignal) }
    );
    expect(store.getSnapshot().view.runs['run-1']).toMatchObject({
      status: 'completed',
      lastSequence: 2,
      runVersion: 2,
      origin: 'local',
      resumeBlockedReason: null,
    });
    expect(store.getSnapshot().chat.nodes.map((node) => node.eventId)).toEqual([
      'run-1-event-1',
      'run-1-event-2',
    ]);
  });

  it('does not lose a live event received while a snapshot page is in flight', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    const page = deferred<{
      run_id: string;
      next_sequence: number;
      has_more: boolean;
      events: unknown[];
    }>();
    fetchGetMock
      .mockResolvedValueOnce(runsResponse({ status: 'running', version: 1 }))
      .mockReturnValueOnce(page.promise);

    const hydration = hydrateProjectEventStore({
      projectId: 'project-1',
      store,
    });
    await vi.waitFor(() => expect(fetchGetMock).toHaveBeenCalledTimes(2));

    expect(
      store.enqueue(normalizeLocalRunEvent(localEvent(2), 'project-1'))
    ).toBe(true);
    store.flushAll();
    expect(store.getSnapshot().chat.nodes).toEqual([]);

    page.resolve({
      run_id: 'run-1',
      next_sequence: 1,
      has_more: false,
      events: [localEvent(1)],
    });
    await hydration;

    expect(store.getPendingEventCount()).toBe(1);
    store.flushAll();
    expect(store.getSnapshot().chat.nodes.map((node) => node.eventId)).toEqual([
      'run-1-event-1',
      'run-1-event-2',
    ]);
  });

  it('cancels the generation with AbortSignal and resumes buffered delivery', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    const controller = new AbortController();
    const runList = deferred<ReturnType<typeof runsResponse>>();
    fetchGetMock.mockReturnValueOnce(runList.promise);

    const hydration = hydrateProjectEventStore({
      projectId: 'project-1',
      signal: controller.signal,
      store,
    });
    await vi.waitFor(() => expect(fetchGetMock).toHaveBeenCalledTimes(1));
    store.enqueue(normalizeLocalRunEvent(localEvent(1), 'project-1'));

    controller.abort();
    store.flushAll();
    expect(store.getSnapshot().chat.nodes.map((node) => node.eventId)).toEqual([
      'run-1-event-1',
    ]);

    runList.resolve(runsResponse());
    await expect(hydration).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('retries instead of publishing empty history while Cloud restore is pending', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock.mockResolvedValueOnce({
      project_id: 'project-1',
      runs: [],
      cloud_restore_pending: true,
    });

    await expect(
      hydrateProjectEventStore({ projectId: 'project-1', store })
    ).rejects.toMatchObject({ code: 'cloud_restore_pending' });
    expect(store.getSnapshot().hasHydratedSnapshot).toBe(false);
  });

  it('stops initial replay at the checkpoint plus one bounded page of concurrent appends', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock
      .mockResolvedValueOnce(runsResponse({ status: 'running', version: 0 }))
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 2,
        has_more: true,
        events: [localEvent(1), localEvent(2)],
      })
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 4,
        has_more: false,
        events: [localEvent(3), localEvent(4)],
      });

    const result = await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 1,
      eventPageSize: 2,
    });

    expect(result).toMatchObject({ eventCount: 1, eventsTruncated: true });
    expect(fetchGetMock).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().view.runs['run-1'].lastSequence).toBe(2);
    expect(store.getSnapshot().history?.beforeByRun['run-1']).toBe(1);
  });

  it('fails closed when replay needs more than the configured page bound', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock.mockResolvedValueOnce(runsResponse()).mockResolvedValueOnce({
      run_id: 'run-1',
      next_sequence: 1,
      has_more: true,
      events: [localEvent(1)],
    });

    await expect(
      hydrateProjectEventStore({
        projectId: 'project-1',
        store,
        eventPageSize: 1,
        maxEventPages: 1,
      })
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
    expect(fetchGetMock).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().revision).toBe(0);
  });

  it('fails closed when replay exceeds the configured byte bound', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock.mockResolvedValueOnce(runsResponse()).mockResolvedValueOnce({
      run_id: 'run-1',
      next_sequence: 1,
      has_more: false,
      events: [localEvent(1)],
    });

    await expect(
      hydrateProjectEventStore({
        projectId: 'project-1',
        store,
        maxBytes: 32,
      })
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
    expect(store.getSnapshot().revision).toBe(0);
  });

  it('rejects non-contiguous replay rather than publishing a partial snapshot', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock.mockResolvedValueOnce(runsResponse()).mockResolvedValueOnce({
      run_id: 'run-1',
      next_sequence: 2,
      has_more: false,
      events: [localEvent(2)],
    });

    await expect(
      hydrateProjectEventStore({ projectId: 'project-1', store })
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(store.getSnapshot().revision).toBe(0);
  });

  it('requires an explicit pagination terminator before committing', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock.mockResolvedValueOnce(runsResponse()).mockResolvedValueOnce({
      run_id: 'run-1',
      next_sequence: 1,
      events: [localEvent(1)],
    });

    await expect(
      hydrateProjectEventStore({ projectId: 'project-1', store })
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(store.getSnapshot().revision).toBe(0);
  });

  it('preserves Run sequence when durable timestamps are skewed', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock.mockResolvedValueOnce(runsResponse()).mockResolvedValueOnce({
      run_id: 'run-1',
      next_sequence: 2,
      has_more: false,
      events: [
        {
          ...localEvent(1),
          created_at: '2026-08-11T10:00:02.000Z',
        },
        {
          ...localEvent(2),
          created_at: '2026-08-11T10:00:01.000Z',
        },
      ],
    });

    await hydrateProjectEventStore({ projectId: 'project-1', store });

    expect(store.getSnapshot().chat.nodes.map((node) => node.eventId)).toEqual([
      'run-1-event-1',
      'run-1-event-2',
    ]);
    expect(store.getSnapshot().view.runs['run-1'].lastSequence).toBe(2);
  });

  it('hydrates a bounded newest tail instead of rejecting a long Run', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock
      .mockResolvedValueOnce(
        runsResponse({ status: 'running', version: 2_501 })
      )
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 2_501,
        has_more: false,
        events: [
          localEvent(2_500, 'run-1', { created_at: 1_786_441_600 }),
          localEvent(2_501, 'run-1', { created_at: 1_786_441_601 }),
        ],
      });

    await expect(
      hydrateProjectEventStore({
        projectId: 'project-1',
        store,
        maxEvents: 2,
      })
    ).resolves.toMatchObject({ eventCount: 2, eventsTruncated: true });

    expect(fetchGetMock).toHaveBeenNthCalledWith(
      2,
      '/runs/run-1/events',
      { after_sequence: 2_499, limit: 31 },
      undefined,
      { signal: expect.any(AbortSignal) }
    );
    expect(store.getSnapshot().view.runs['run-1']).toMatchObject({
      lastSequence: 2_501,
      runVersion: 2_501,
    });
    expect(store.getSnapshot().chat.nodes.map((node) => node.eventId)).toEqual([
      'run-1-event-2500',
      'run-1-event-2501',
    ]);
  });

  it('ring-retains newer events appended after the Run descriptor was read', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock
      .mockResolvedValueOnce(runsResponse({ status: 'running', version: 2 }))
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 3,
        has_more: false,
        events: [
          localEvent(1),
          localEvent(2),
          localEvent(3, 'run-1', {
            event_type: 'run.completed',
            legacy_step: 'end',
          }),
        ],
      });

    await expect(
      hydrateProjectEventStore({
        projectId: 'project-1',
        store,
        maxEvents: 2,
        eventPageSize: 3,
      })
    ).resolves.toMatchObject({ eventCount: 2, eventsTruncated: true });

    expect(store.getSnapshot().chat.nodes.map((node) => node.eventId)).toEqual([
      'run-1-event-2',
      'run-1-event-3',
    ]);
    expect(store.getSnapshot().view.runs['run-1']).toMatchObject({
      status: 'completed',
      lastSequence: 3,
      runVersion: 3,
    });
  });

  it('ring-retains the newest tail in order across multiple wraparounds', async () => {
    // One wraparound can pass by coincidence; this drops three events from a
    // two-slot ring so the unrolled result must come from both ring segments.
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock
      .mockResolvedValueOnce(runsResponse({ status: 'running', version: 2 }))
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 5,
        has_more: false,
        events: [
          localEvent(1),
          localEvent(2),
          localEvent(3),
          localEvent(4),
          localEvent(5, 'run-1', {
            event_type: 'run.completed',
            legacy_step: 'end',
          }),
        ],
      });

    await expect(
      hydrateProjectEventStore({
        projectId: 'project-1',
        store,
        maxEvents: 2,
        eventPageSize: 5,
      })
    ).resolves.toMatchObject({ eventCount: 2, eventsTruncated: true });

    expect(store.getSnapshot().chat.nodes.map((node) => node.eventId)).toEqual([
      'run-1-event-4',
      'run-1-event-5',
    ]);
  });

  it('keeps a newer terminal replay status over a stale Run aggregate', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock
      .mockResolvedValueOnce(runsResponse({ status: 'running', version: 1 }))
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 2,
        has_more: false,
        events: [
          localEvent(1, 'run-1', {
            event_type: 'run.attempt_started',
          }),
          localEvent(2, 'run-1', {
            event_type: 'run.completed',
            legacy_step: 'end',
          }),
        ],
      });

    await hydrateProjectEventStore({ projectId: 'project-1', store });

    expect(store.getSnapshot().view.runs['run-1']).toMatchObject({
      status: 'completed',
      lastSequence: 2,
      runVersion: 2,
    });
  });

  it('projects an unknown aggregate status as non-actionable unknown', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock
      .mockResolvedValueOnce(
        runsResponse({ status: 'future_backend_status', version: 0 })
      )
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 0,
        has_more: false,
        events: [],
      });

    await hydrateProjectEventStore({ projectId: 'project-1', store });

    expect(store.getSnapshot().view.runs['run-1'].status).toBe('unknown');
  });

  it('rejects a forgivingly-normalizable event with no sequence', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    const missingSequence = { ...localEvent(1), sequence: undefined };
    fetchGetMock
      .mockResolvedValueOnce(runsResponse({ status: 'running', version: 1 }))
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 1,
        has_more: false,
        events: [missingSequence],
      });

    await expect(
      hydrateProjectEventStore({ projectId: 'project-1', store })
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(store.getSnapshot().hasHydratedSnapshot).toBe(false);
  });

  it('preserves Run provenance needed to keep restored history read-only', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    fetchGetMock
      .mockResolvedValueOnce(
        runsResponse({
          status: 'interrupted',
          version: 0,
          origin: 'cloud_restore',
          resume_blocked_reason: 'cloud_history_is_read_only',
        })
      )
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 0,
        has_more: false,
        events: [],
      });

    await hydrateProjectEventStore({ projectId: 'project-1', store });

    expect(store.getSnapshot().view.runs['run-1']).toMatchObject({
      origin: 'cloud_restore',
      resumeBlockedReason: 'cloud_history_is_read_only',
    });
  });
});

describe('complete conversation history with bounded replay requests', () => {
  beforeEach(() => {
    fetchGetMock.mockReset();
  });

  function journal(
    eventsByRun: Record<string, ReturnType<typeof localEvent>[]>
  ) {
    fetchGetMock.mockImplementation(async (path, params) => {
      if (path === '/runs') {
        return {
          project_id: 'project-1',
          runs: Object.entries(eventsByRun).map(([runId, events]) => ({
            run_id: runId,
            status: 'running',
            version: events.length,
            updated_at: 1_786_441_600,
            origin: 'local',
          })),
        };
      }
      const runId = path.split('/')[2];
      const after = Number(params?.after_sequence ?? 0);
      const limit = Number(params?.limit ?? 500);
      const remaining = eventsByRun[runId].filter(
        (event) => event.sequence > after
      );
      const events = remaining.slice(0, limit);
      return {
        run_id: runId,
        next_sequence: events.at(-1)?.sequence ?? after,
        has_more: remaining.length > limit,
        events,
      };
    });
  }

  function renderEvents(count = 10, runId = 'run-1') {
    return Array.from({ length: count }, (_, index) =>
      localEvent(index + 1, runId, {
        created_at: 1_786_441_600 + index,
        event_type:
          index === 0
            ? 'user.message'
            : index === 1
              ? 'assistant.final'
              : 'legacy.terminal',
        legacy_step: null,
        payload: {
          content:
            index === 0
              ? 'Original request'
              : index === 1
                ? 'Completed film'
                : `Frame ${index}`,
        },
      })
    );
  }

  it('retains every historical node beyond the old count and heap ceilings, including after live ingestion', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    const events = renderEvents(4_200);
    for (const event of events.slice(2)) {
      event.payload = { content: 'Rendered frame details '.repeat(60) };
    }
    journal({ 'run-1': events });
    await hydrateProjectEventStore({ projectId: 'project-1', store });
    while (store.getSnapshot().history!.beforeByRun['run-1'] > 0) {
      await loadOlderProjectChatHistory({ projectId: 'project-1', store });
    }
    const before = store.getSnapshot();
    expect(before.chat.nodes).toHaveLength(4_200);
    expect(JSON.stringify(before.chat.nodes).length * 2).toBeGreaterThan(
      8 * 1024 * 1024
    );
    store.enqueue(
      normalizeLocalRunEvent(
        localEvent(4_201, 'run-1', {
          created_at: 1_786_445_801,
        }),
        'project-1'
      )
    );
    store.flushAll();
    const after = store.getSnapshot();
    expect(after.chat.nodes).toHaveLength(4_201);
    expect(after.chat.nodes.map((node) => node.runSequence)).toEqual(
      Array.from({ length: 4_201 }, (_, i) => i + 1)
    );
    expect(Object.keys(after.chat.nodeById)).toHaveLength(4_201);
    expect(after.view.eventsTruncated).toBe(false);
    expect(
      fetchGetMock.mock.calls
        .filter(([path]) => path !== '/runs')
        .every(([, params]) => Number(params?.limit) <= 500)
    ).toBe(true);
  });

  it('hydrates canonical execution time even for an older Run skipped by the initial tail', async () => {
    const store = new ProjectEventStore('project-1');
    journal({ 'run-2': renderEvents(4, 'run-2'), 'run-1': renderEvents(2) });
    fetchGetMock.mockResolvedValueOnce({
      project_id: 'project-1',
      runs: [
        {
          run_id: 'run-2',
          status: 'completed',
          version: 4,
          updated_at: 1_786_441_900,
        },
        {
          run_id: 'run-1',
          status: 'completed',
          version: 2,
          updated_at: 1_786_441_800,
          total_attempt_elapsed_ms: 108_200,
        },
      ],
    });
    await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 4,
    });
    expect(store.getSnapshot().view.runs['run-1'].totalAttemptElapsedMs).toBe(
      108_200
    );
    await loadOlderProjectChatHistory({ projectId: 'project-1', store });
    expect(store.getSnapshot().view.runs['run-1'].totalAttemptElapsedMs).toBe(
      108_200
    );
  });

  it('retains user queries and final replies when terminal output fills the store', async () => {
    const store = new ProjectEventStore('project-1', {
      maxChatNodes: 4,
      scheduleFlush: () => () => undefined,
    });
    const events = renderEvents();
    journal({ 'run-1': events });
    await hydrateProjectEventStore({ projectId: 'project-1', store });
    for (let sequence = 11; sequence <= 20; sequence += 1) {
      store.enqueue(
        normalizeLocalRunEvent(
          localEvent(sequence, 'run-1', {
            created_at: 1_786_441_600 + sequence,
            event_type: 'legacy.terminal',
            legacy_step: null,
            payload: { content: `Frame ${sequence}` },
          }),
          'project-1'
        )
      );
      store.flushAll();
    }
    const snapshot = store.getSnapshot();
    expect(snapshot.chat.nodes).toHaveLength(4);
    expect(snapshot.chat.nodes.slice(0, 2).map((node) => node.eventId)).toEqual(
      ['run-1-event-1', 'run-1-event-2']
    );
    expect(Object.keys(snapshot.chat.nodeById)).toHaveLength(4);
    snapshot.chat.nodes.forEach((node, index) =>
      expect(snapshot.chat.nodeIndexById?.[node.id]).toBe(index)
    );
    expect(snapshot.view.runs['run-1'].lastSequence).toBe(20);
  });

  it('reserves byte capacity for dialogue instead of large recent terminal output', async () => {
    const store = new ProjectEventStore('project-1', { maxChatBytes: 2_500 });
    const events = renderEvents(3);
    events[2].payload = { content: 'x'.repeat(1_000) };
    journal({ 'run-1': events });
    await hydrateProjectEventStore({ projectId: 'project-1', store });
    expect(store.getSnapshot().chat.nodes.map((node) => node.eventId)).toEqual([
      'run-1-event-1',
      'run-1-event-2',
    ]);
  });

  it('loads skipped earlier Runs without rewinding the active Run or replaying controls', async () => {
    const store = new ProjectEventStore('project-1');
    journal({ 'run-2': renderEvents(4, 'run-2'), 'run-1': renderEvents(2) });
    await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 4,
    });
    const before = store.getSnapshot();
    expect(before.history?.beforeByRun).toEqual({ 'run-2': 0, 'run-1': 2 });
    await loadOlderProjectChatHistory({ projectId: 'project-1', store });
    const after = store.getSnapshot();
    expect(after.chat.nodeById['run-1-event-1']).toMatchObject({
      kind: 'message',
      role: 'user',
    });
    expect(after.chat.nodeById['run-1-event-2']).toMatchObject({
      kind: 'message',
      purpose: 'final',
    });
    expect(after.view.runs).toBe(before.view.runs);
    expect(after.control).toBe(before.control);
    expect(after.lastEffects).toEqual([]);
    expect(after.view.eventsTruncated).toBe(false);
    expect(after.history?.beforeByRun).toEqual({ 'run-2': 0, 'run-1': 0 });
  });

  it('pages backward through a long Run and preserves live arrivals during the fetch', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    const events = renderEvents();
    journal({ 'run-1': events });
    await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 4,
    });
    expect(store.getSnapshot().history?.beforeByRun['run-1']).toBe(6);
    const page = deferred<unknown>();
    fetchGetMock.mockImplementationOnce(() => page.promise);
    const loading = loadOlderProjectChatHistory({
      projectId: 'project-1',
      store,
      maxEvents: 3,
    });
    store.enqueue(
      normalizeLocalRunEvent(
        localEvent(11, 'run-1', { created_at: 1_786_441_611 }),
        'project-1'
      )
    );
    store.flushAll();
    page.resolve({
      run_id: 'run-1',
      next_sequence: 6,
      has_more: true,
      events: events.slice(3, 6),
    });
    await loading;
    expect(fetchGetMock).toHaveBeenLastCalledWith(
      '/runs/run-1/events',
      { after_sequence: 3, limit: 3 },
      undefined,
      { signal: expect.any(AbortSignal) }
    );
    expect(store.getSnapshot().history?.beforeByRun['run-1']).toBe(3);
    expect(store.getSnapshot().view.runs['run-1'].lastSequence).toBe(11);
    await loadOlderProjectChatHistory({
      projectId: 'project-1',
      store,
      maxEvents: 3,
    });
    expect(
      store.getSnapshot().chat.nodes.map((node) => node.runSequence)
    ).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
    expect(store.getSnapshot().view.eventsTruncated).toBe(false);
  });

  it.each(['gap', 'cross-project', 'oversize', 'abort', 'reset'] as const)(
    'does not publish or advance history on %s',
    async (failure) => {
      const store = new ProjectEventStore('project-1');
      const events = renderEvents(4);
      journal({ 'run-1': events });
      await hydrateProjectEventStore({
        projectId: 'project-1',
        store,
        maxEvents: 2,
      });
      const before = store.getSnapshot();
      const page = deferred<unknown>();
      fetchGetMock.mockImplementationOnce(() => page.promise);
      const controller = new AbortController();
      const loading = loadOlderProjectChatHistory({
        projectId: 'project-1',
        store,
        signal: controller.signal,
      });
      if (failure === 'abort') controller.abort();
      if (failure === 'reset') store.reset();
      const returned = events.slice(0, 2);
      if (failure === 'gap') returned.shift();
      if (failure === 'cross-project')
        returned[0] = { ...returned[0], project_id: 'other-project' };
      if (failure === 'oversize')
        returned[0] = {
          ...returned[0],
          payload: { content: 'x'.repeat(300_000) },
        };
      page.resolve({
        run_id: 'run-1',
        next_sequence: 2,
        has_more: true,
        events: returned,
      });
      await expect(loading).rejects.toMatchObject({
        name:
          failure === 'abort'
            ? 'AbortError'
            : 'ProjectEventStoreHydrationError',
      });
      if (failure === 'reset') {
        expect(store.getSnapshot().chat.nodes).toEqual([]);
        expect(store.getSnapshot().history).toBeUndefined();
      } else {
        expect(store.getSnapshot()).toBe(before);
      }
    }
  );
  it('loads a valid tail larger than 8 MiB by reducing batches without losing receipts', async () => {
    const store = new ProjectEventStore('project-1');
    const events = renderEvents(2_101);
    for (const event of events.slice(2))
      event.payload = { content: 'x'.repeat(4_096) };
    journal({ 'run-1': events });
    await hydrateProjectEventStore({ projectId: 'project-1', store });
    while (store.getSnapshot().history!.beforeByRun['run-1'] > 0) {
      await loadOlderProjectChatHistory({ projectId: 'project-1', store });
    }
    expect(store.getSnapshot().chat.nodes).toHaveLength(2_101);
    expect(store.getSnapshot().view.eventsTruncated).toBe(false);
  });

  it('retains already loaded semantic history through a fresh bounded hydration', async () => {
    const store = new ProjectEventStore('project-1');
    journal({ 'run-1': renderEvents(8) });
    await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 2,
    });
    await loadOlderProjectChatHistory({ projectId: 'project-1', store });
    expect(store.getSnapshot().chat.nodes).toHaveLength(8);
    await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 2,
    });
    expect(store.getSnapshot().chat.nodes).toHaveLength(8);
  });

  it('abandons a pending history request immediately on abort, even if transport never settles', async () => {
    const store = new ProjectEventStore('project-1');
    journal({ 'run-1': renderEvents(4) });
    await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 2,
    });
    fetchGetMock.mockReturnValueOnce(new Promise(() => undefined));
    const controller = new AbortController();
    const loading = loadOlderProjectChatHistory({
      projectId: 'project-1',
      store,
      signal: controller.signal,
    });
    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
  }, 1_000);

  it('stops reading further pages after a reset during replay', async () => {
    const store = new ProjectEventStore('project-1');
    const events = renderEvents(8);
    journal({ 'run-1': events });
    await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 2,
    });
    const page = deferred<unknown>();
    fetchGetMock.mockImplementationOnce(() => page.promise);
    const loading = loadOlderProjectChatHistory({
      projectId: 'project-1',
      store,
      eventPageSize: 2,
    });
    const callCount = fetchGetMock.mock.calls.length;
    store.reset();
    page.resolve({
      run_id: 'run-1',
      next_sequence: 2,
      has_more: true,
      events: events.slice(0, 2),
    });
    await expect(loading).rejects.toMatchObject({
      code: 'replacement_invalidated',
    });
    expect(fetchGetMock).toHaveBeenCalledTimes(callCount);
  });
  it.each([
    'backward',
    'no-progress',
    'oversized-page',
    'cross-run',
    'duplicate',
    'out-of-order',
    'wrong-boundary',
    'null-response',
  ] as const)(
    'rejects a %s history response atomically and permits a clean retry',
    async (failure) => {
      const store = new ProjectEventStore('project-1');
      const events = renderEvents(6);
      journal({ 'run-1': events });
      await hydrateProjectEventStore({
        projectId: 'project-1',
        store,
        maxEvents: 2,
      });
      const before = store.getSnapshot();
      const page: Record<string, unknown> = {
        run_id: 'run-1',
        next_sequence: 4,
        has_more: true,
        events: events.slice(0, 4),
      };
      if (failure === 'backward') page.next_sequence = 1;
      if (failure === 'no-progress') {
        page.events = [];
        page.next_sequence = 0;
      }
      if (failure === 'oversized-page') page.events = events;
      if (failure === 'cross-run') page.run_id = 'other-run';
      if (failure === 'duplicate')
        page.events = [
          events[0],
          { ...events[1], event_id: events[0].event_id },
          ...events.slice(2, 4),
        ];
      if (failure === 'out-of-order')
        page.events = [events[1], events[0], ...events.slice(2, 4)];
      if (failure === 'wrong-boundary') page.after_sequence = 1;
      fetchGetMock.mockResolvedValueOnce(
        failure === 'null-response' ? null : page
      );
      await expect(
        loadOlderProjectChatHistory({ projectId: 'project-1', store })
      ).rejects.toMatchObject({ code: 'invalid_response' });
      expect(store.getSnapshot()).toBe(before);
      await loadOlderProjectChatHistory({ projectId: 'project-1', store });
      expect(store.getSnapshot().chat.nodes).toHaveLength(6);
      expect(store.getSnapshot().view.eventsTruncated).toBe(false);
    }
  );

  it.each([120_000, 140_000, 270_000])(
    'keeps the original 256 KiB event guard for %s-character history payloads',
    async (size) => {
      const store = new ProjectEventStore('project-1');
      const events = renderEvents(3);
      events[0].payload = { content: 'x'.repeat(size) };
      journal({ 'run-1': events });
      await hydrateProjectEventStore({
        projectId: 'project-1',
        store,
        maxEvents: 1,
      });
      const before = store.getSnapshot();
      const loading = loadOlderProjectChatHistory({
        projectId: 'project-1',
        store,
      });
      if (size < 128_000) {
        await loading;
        expect(store.getSnapshot().chat.nodes).toHaveLength(3);
      } else {
        await expect(loading).rejects.toMatchObject({ code: 'limit_exceeded' });
        expect(store.getSnapshot()).toBe(before);
      }
    }
  );

  it('discloses the backend 100-Run cap after every listed event has loaded', async () => {
    const store = new ProjectEventStore('project-1');
    journal(
      Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [
          `run-${i}`,
          renderEvents(2, `run-${i}`),
        ])
      )
    );
    await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 2,
    });
    await loadOlderProjectChatHistory({ projectId: 'project-1', store });
    const after = store.getSnapshot();
    expect(
      Object.values(after.history!.beforeByRun).every((value) => value === 0)
    ).toBe(true);
    expect(after.history!.runsTruncated).toBe(true);
    expect(after.view.eventsTruncated).toBe(true);
    expect(after.chat.nodes).toHaveLength(200);
  });

  it('merges historical interaction receipts without issuing effects or replacing pending live controls', async () => {
    const onEffects = vi.fn();
    const store = new ProjectEventStore('project-1', {
      onEffects,
      scheduleFlush: () => () => undefined,
    });
    const events = renderEvents(5);
    events[0] = localEvent(1, 'run-1', {
      event_type: 'interaction.requested',
      legacy_step: null,
      payload: { interaction_id: 'old', prompt: 'Old request' },
    });
    events[1] = localEvent(2, 'run-1', {
      event_type: 'interaction.resolved',
      legacy_step: null,
      payload: { interaction_id: 'old', content: 'Old reply' },
    });
    journal({ 'run-1': events });
    await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 2,
    });
    store.enqueue(
      normalizeLocalRunEvent(
        localEvent(6, 'run-1', {
          event_type: 'interaction.requested',
          legacy_step: null,
          payload: { interaction_id: 'live', prompt: 'Current decision' },
        }),
        'project-1'
      )
    );
    store.flushAll();
    const before = store.getSnapshot();
    onEffects.mockClear();
    await loadOlderProjectChatHistory({ projectId: 'project-1', store });
    const after = store.getSnapshot();
    expect(after.control).toBe(before.control);
    expect(after.view.runs).toBe(before.view.runs);
    expect(after.view.currentCursor).toBe(before.view.currentCursor);
    expect(onEffects).not.toHaveBeenCalled();
    expect(after.lastEffects).toEqual([]);
    expect(
      after.chat.nodes.some((node) => node.eventId === 'run-1-event-1')
    ).toBe(true);
  });

  it('invalidates old history cursors when a different direct snapshot replaces the store', async () => {
    const store = new ProjectEventStore('project-1');
    journal({ 'run-1': renderEvents(4) });
    await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 2,
    });
    store.replaceSnapshot({
      project_id: 'project-1',
      current_cursor: 0,
      recent_events: [],
    });
    expect(store.getSnapshot().history).toBeUndefined();
  });
  it('keeps a newer live failure and watermark when a refresh returns an older checkpoint', async () => {
    const store = new ProjectEventStore('project-1', {
      scheduleFlush: () => () => undefined,
    });
    journal({ 'run-1': renderEvents(2) });
    await hydrateProjectEventStore({ projectId: 'project-1', store });
    store.enqueue(
      normalizeLocalRunEvent(
        localEvent(3, 'run-1', {
          event_type: 'run.failed',
          legacy_step: null,
          created_at: 1_786_441_603,
        }),
        'project-1'
      )
    );
    store.flushAll();
    const before = store.getSnapshot();
    await hydrateProjectEventStore({ projectId: 'project-1', store });
    expect(store.getSnapshot().view.runs['run-1']).toMatchObject({
      status: 'failed',
      lastSequence: 3,
      runVersion: 3,
    });
    expect(store.getSnapshot().view.currentCursor).toBe(
      before.view.currentCursor
    );
    expect(store.getSnapshot().chat.nodes).toHaveLength(3);
  });

  it('cancels a hung initial page on reset and leaves a new hydration usable', async () => {
    const store = new ProjectEventStore('project-1');
    journal({ 'run-1': renderEvents(2) });
    const normal = fetchGetMock.getMockImplementation()!;
    fetchGetMock.mockImplementation((path, ...args) =>
      path === '/runs' ? normal(path, ...args) : new Promise(() => undefined)
    );
    const loading = hydrateProjectEventStore({ projectId: 'project-1', store });
    await vi.waitFor(() => expect(fetchGetMock).toHaveBeenCalledTimes(2));
    store.reset();
    await expect(loading).rejects.toMatchObject({
      code: 'replacement_invalidated',
    });
    journal({ 'run-1': renderEvents(2) });
    await hydrateProjectEventStore({ projectId: 'project-1', store });
    expect(store.getSnapshot().chat.nodes).toHaveLength(2);
  });

  it('rejects oversized response metadata without advancing history', async () => {
    const store = new ProjectEventStore('project-1');
    journal({ 'run-1': renderEvents(3) });
    await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 1,
    });
    const before = store.getSnapshot();
    fetchGetMock.mockResolvedValueOnce({
      run_id: 'run-1',
      next_sequence: 2,
      has_more: true,
      events: renderEvents(2),
      extra: 'x'.repeat(4 * 1024 * 1024),
    });
    await expect(
      loadOlderProjectChatHistory({ projectId: 'project-1', store })
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
    expect(store.getSnapshot()).toBe(before);
  });

  it('records the receipt time of a canonical elapsed checkpoint', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T00:01:00Z'));
    try {
      const store = new ProjectEventStore('project-1');
      journal({ 'run-1': renderEvents(2) });
      fetchGetMock.mockResolvedValueOnce(
        runsResponse({ total_attempt_elapsed_ms: 60_000 })
      );
      await hydrateProjectEventStore({ projectId: 'project-1', store });
      expect(store.getSnapshot().view.runs['run-1']).toMatchObject({
        totalAttemptElapsedMs: 60_000,
        totalAttemptElapsedAt: '2026-08-19T00:01:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it('turns a hung history page into a retryable timeout without consuming its cursor', async () => {
    const store = new ProjectEventStore('project-1');
    journal({ 'run-1': renderEvents(3) });
    await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 1,
    });
    const before = store.getSnapshot();
    fetchGetMock.mockReturnValueOnce(new Promise(() => undefined));
    await expect(
      loadOlderProjectChatHistory({
        projectId: 'project-1',
        store,
        eventPageTimeoutMs: 5,
      })
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(fetchGetMock.mock.calls.at(-1)![3]!.signal!.aborted).toBe(true);
    expect(store.getSnapshot()).toBe(before);
    await loadOlderProjectChatHistory({ projectId: 'project-1', store });
    expect(store.getSnapshot().chat.nodes).toHaveLength(3);
  });
});
