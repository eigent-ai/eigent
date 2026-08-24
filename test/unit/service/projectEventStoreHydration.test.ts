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
  ProjectEventStoreHydrationError,
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
  beforeEach(() => fetchGetMock.mockReset());

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
      { signal: controller.signal }
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

  it('fails closed when concurrent append scanning exceeds its bounded race window', async () => {
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

    const error = await hydrateProjectEventStore({
      projectId: 'project-1',
      store,
      maxEvents: 1,
      eventPageSize: 2,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ProjectEventStoreHydrationError);
    expect(error).toMatchObject({ code: 'limit_exceeded' });
    expect(store.getSnapshot().revision).toBe(0);
    expect(store.getSnapshot().chat.nodes).toEqual([]);
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
      { after_sequence: 2_499, limit: 500 },
      undefined,
      { signal: undefined }
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
