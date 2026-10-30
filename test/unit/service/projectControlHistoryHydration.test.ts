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
import { selectEventNativeActiveRunId } from '@/components/ChatBox/runControlArbitration';
import { normalizeLocalRunEvent } from '@/lib/projector';
import {
  selectActiveHumanControl,
  selectPendingHumanControls,
} from '@/lib/projector/control';
import {
  hydrateProjectEventStore,
  loadOlderProjectChatHistory,
} from '@/service/projectEventStoreHydration';
import {
  ProjectEventStore,
  type ProjectEventStoreOptions,
} from '@/store/projectEventStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({ fetchGet: vi.fn() }));
const get = vi.mocked(fetchGet);
const projectId = 'project-1';
const runId = 'run-1';

function receipt(
  sequence: number,
  eventType = 'legacy.terminal',
  payload: Record<string, unknown> = { content: 'Work receipt' }
) {
  return {
    event_id: `event-${sequence}`,
    run_id: runId,
    sequence,
    run_version: sequence,
    event_type: eventType,
    payload,
    legacy_step: null,
    created_at: 1_786_441_600 + sequence,
  };
}
function request(sequence: number, id: string, prompt = 'Pending question') {
  return receipt(sequence, 'interaction.requested', {
    interaction_id: id,
    interaction_type: 'question',
    prompt,
  });
}
function eventsOfLength(count: number) {
  return Array.from({ length: count }, (_, index) => receipt(index + 1));
}
function journal(events: ReturnType<typeof receipt>[], origin = 'local') {
  get.mockImplementation(async (url, params) => {
    if (url === '/runs')
      return {
        project_id: projectId,
        runs: [
          {
            run_id: runId,
            status: 'waiting_for_user',
            version: events.length,
            origin,
            updated_at: 1_786_441_600 + events.length,
          },
        ],
      };
    const after = Number(params?.after_sequence ?? 0);
    const limit = Number(params?.limit ?? 500);
    const page = events.slice(after, after + limit);
    return {
      run_id: runId,
      project_id: projectId,
      after_sequence: after,
      next_sequence: page.at(-1)?.sequence ?? after,
      has_more: after + page.length < events.length,
      events: page,
    };
  });
}
function makeStore(options: ProjectEventStoreOptions = {}) {
  return new ProjectEventStore(projectId, {
    scheduleFlush: () => () => undefined,
    ...options,
  });
}
function ingest(
  store: ProjectEventStore,
  event: ReturnType<typeof receipt>,
  cloudCursor: number | null = null
) {
  expect(
    store.enqueue({ ...normalizeLocalRunEvent(event, projectId), cloudCursor })
  ).toBe(true);
  store.flushAll();
}
function pendingIds(store: ProjectEventStore) {
  return selectPendingHumanControls(store.getSnapshot().control).map(
    (item) => item.interactionId
  );
}
async function drain(store: ProjectEventStore, maxEvents?: number) {
  do {
    await loadOlderProjectChatHistory({ projectId, store, maxEvents });
  } while (
    Object.values(store.getSnapshot().history?.beforeByRun ?? {}).some(
      (before) => before > 0
    )
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function finishDisplay(
  store: ProjectEventStore,
  events: ReturnType<typeof receipt>[]
) {
  const history = store.getSnapshot().history!;
  expect(
    store.prependChatHistory(
      events
        .slice(0, history.beforeByRun[runId])
        .map((event) => normalizeLocalRunEvent(event, projectId)),
      history,
      { ...history, beforeByRun: { [runId]: 0 } }
    )
  ).toBe(true);
}

beforeEach(() => get.mockReset());

describe('durable control history checkpoints', () => {
  it('restores parallel pending requests across 4,201 receipts before releasing control protection', async () => {
    const events = eventsOfLength(4_201);
    events[0] = request(1, 'prefix-question');
    events[4_200] = request(4_201, 'tail-question');
    journal(events);
    const onEffects = vi.fn();
    const store = makeStore({ onEffects });
    await hydrateProjectEventStore({ projectId, store });
    const before = store.getSnapshot();
    expect(pendingIds(store)).toEqual(['tail-question']);
    expect(selectEventNativeActiveRunId(before, null)).toBeNull();
    const readyPending: string[][] = [];
    store.subscribe(() => {
      if (!store.getSnapshot().view.eventsTruncated)
        readyPending.push(pendingIds(store));
    });
    await drain(store);
    expect(store.getSnapshot().chat.nodes).toHaveLength(4_201);
    expect(pendingIds(store)).toEqual(['prefix-question', 'tail-question']);
    expect(
      selectActiveHumanControl(store.getSnapshot().control)?.interactionId
    ).toBe('prefix-question');
    expect(selectEventNativeActiveRunId(store.getSnapshot(), null)).toBe(runId);
    expect(readyPending).toEqual([['prefix-question', 'tail-question']]);
    expect(store.getSnapshot().view.runs).toBe(before.view.runs);
    expect(store.getSnapshot().view.currentCursor).toBe(
      before.view.currentCursor
    );
    expect(store.getControlReplayCursor()).toBeNull();
    expect(onEffects).not.toHaveBeenCalled();
    expect(
      get.mock.calls.every(
        ([url]) => url === '/runs' || url === '/runs/run-1/events'
      )
    ).toBe(true);
    expect(
      get.mock.calls
        .filter(([url]) => url !== '/runs')
        .every(([, params]) => Number(params?.limit) <= 31)
    ).toBe(true);
  });

  it.each([
    'interaction.resolved',
    'interaction.expired',
    'interaction.cancelled',
    'approval.decided',
    'approval.expired',
    'approval.cancelled',
  ])(
    'does not revive a request after %s was compacted beyond 200 terminal receipts',
    async (eventType) => {
      const events = eventsOfLength(2_280);
      events[0] = eventType.startsWith('approval.')
        ? receipt(1, 'approval.requested', {
            interaction_id: 'prefix-question',
            approval_id: 'approval-1',
            interaction_type: 'approval',
            prompt: 'Approve operation',
          })
        : request(1, 'prefix-question');
      events[399] = receipt(400, eventType, {
        interaction_id: 'prefix-question',
        approval_id: 'approval-1',
      });
      for (let sequence = 500; sequence < 711; sequence++) {
        events[sequence - 1] = receipt(sequence, 'interaction.resolved', {
          interaction_id: `terminal-${sequence}`,
        });
      }
      events[2_279] = request(2_280, 'tail-question');
      journal(events);
      const store = makeStore();
      await hydrateProjectEventStore({ projectId, store });
      expect(
        store.getSnapshot().control.interactionById['prefix-question']
      ).toBeUndefined();
      expect(store.getSnapshot().control.orderedInteractionIds).toHaveLength(
        201
      );
      await drain(store);
      expect(store.getSnapshot().view.eventsTruncated).toBe(false);
      expect(pendingIds(store)).toEqual(['tail-question']);
      expect(
        store.getSnapshot().control.orderedInteractionIds.length
      ).toBeLessThanOrEqual(201);
    }
  );

  it.each(['resolved', 'expired', 'cancelled'])(
    'preserves newer live %s and requests after terminal compaction during backfill',
    async (status) => {
      const events = eventsOfLength(10);
      events[0] = request(1, 'prefix-question');
      events[9] = request(10, 'tail-question');
      journal(events);
      const store = makeStore();
      await hydrateProjectEventStore({ projectId, store, maxEvents: 2 });
      ingest(
        store,
        receipt(11, `interaction.${status}`, {
          interaction_id: 'prefix-question',
        }),
        1
      );
      for (let sequence = 12; sequence <= 222; sequence++) {
        ingest(
          store,
          receipt(sequence, 'interaction.resolved', {
            interaction_id: `terminal-${sequence}`,
          }),
          sequence - 10
        );
      }
      ingest(store, request(223, 'live-question'), 213);
      expect(
        store.getSnapshot().control.interactionById['prefix-question']
      ).toBeUndefined();
      const before = store.getSnapshot();
      await drain(store, 2);
      expect(pendingIds(store)).toEqual(['tail-question', 'live-question']);
      expect(store.getSnapshot().view.runs).toBe(before.view.runs);
      expect(store.getSnapshot().view.currentCursor).toBe(213);
      expect(store.getSnapshot().view.eventsTruncated).toBe(false);
      expect(
        store.getSnapshot().control.orderedInteractionIds.length
      ).toBeLessThanOrEqual(202);
    }
  );

  it.each(['requested', 'resolved', 'expired', 'cancelled'])(
    'keeps a newer live %s while an older refresh is in flight',
    async (status) => {
      const events = [request(1, 'question-1'), receipt(2)];
      journal(events);
      const store = makeStore();
      await hydrateProjectEventStore({ projectId, store });
      const listing = deferred<unknown>();
      get.mockImplementationOnce(() => listing.promise);
      const refresh = hydrateProjectEventStore({ projectId, store });
      expect(
        store.enqueue(
          normalizeLocalRunEvent(
            status === 'requested'
              ? request(3, 'question-2')
              : receipt(3, `interaction.${status}`, {
                  interaction_id: 'question-1',
                }),
            projectId
          )
        )
      ).toBe(true);
      listing.resolve({
        project_id: projectId,
        runs: [
          {
            run_id: runId,
            status: 'waiting_for_user',
            version: 2,
            origin: 'local',
            updated_at: 1_786_441_602,
          },
        ],
      });
      await refresh;
      store.flushAll();
      expect(store.getSnapshot().view.runs[runId].lastSequence).toBe(3);
      expect(pendingIds(store)).toEqual(
        status === 'requested' ? ['question-1', 'question-2'] : []
      );
      // Repeat the stale read after the live event has left ingress's queue.
      await hydrateProjectEventStore({ projectId, store });
      expect(store.getSnapshot().view.runs[runId].runVersion).toBe(3);
      expect(pendingIds(store)).toEqual(
        status === 'requested' ? ['question-1', 'question-2'] : []
      );
      expect(store.getSnapshot().view.eventsTruncated).toBe(false);
    }
  );

  it('does not revive compacted terminal controls when a complete checkpoint receives a stale refresh', async () => {
    const events = [request(1, 'old-question'), receipt(2)];
    journal(events);
    const store = makeStore();
    await hydrateProjectEventStore({ projectId, store });
    ingest(
      store,
      receipt(3, 'interaction.resolved', { interaction_id: 'old-question' })
    );
    for (let sequence = 4; sequence < 215; sequence++) {
      ingest(
        store,
        receipt(sequence, 'interaction.resolved', {
          interaction_id: `terminal-${sequence}`,
        })
      );
    }
    const before = store.getSnapshot();
    expect(before.control.interactionById['old-question']).toBeUndefined();
    await hydrateProjectEventStore({ projectId, store });
    expect(store.getSnapshot().control).toBe(before.control);
    expect(pendingIds(store)).toEqual([]);
    expect(store.getSnapshot().view.runs[runId].lastSequence).toBe(214);
  });

  it.each(['count', 'bytes'] as const)(
    'fails closed atomically when historical pending %s exceed the hard limit',
    async (limit) => {
      const events = eventsOfLength(4_201);
      const count = limit === 'count' ? 129 : 32;
      for (let index = 0; index < count; index++) {
        events[index] = request(
          index + 1,
          `pending-${index}`,
          limit === 'bytes' ? 'x'.repeat(40_000) : 'Question'
        );
      }
      journal(events);
      const store = makeStore();
      await hydrateProjectEventStore({ projectId, store });
      const safeControl = store.getSnapshot().control;
      const cursor = store.getControlReplayCursor();
      await expect(drain(store)).rejects.toMatchObject({
        code: 'replacement_invalidated',
      });
      expect(store.getControlReplayCursor()).toBe(cursor);
      expect(store.getSnapshot().control).toBe(safeControl);
      expect(store.getSnapshot().overflowed).toBe(true);
      expect(store.getSnapshot().view.resyncReason).toBe(
        `frontend_pending_control_${limit}_overflow`
      );
      expect(
        selectEventNativeActiveRunId(store.getSnapshot(), null)
      ).toBeNull();
    }
  );

  it('bounds lifecycle evidence buffered during a control rebuild and fails closed on overflow', async () => {
    const events = eventsOfLength(4);
    events[0] = request(1, 'prefix-question');
    journal(events);
    const store = makeStore({ maxQueueEvents: 2 });
    await hydrateProjectEventStore({ projectId, store, maxEvents: 1 });
    ingest(
      store,
      receipt(5, 'interaction.resolved', { interaction_id: 'prefix-question' })
    );
    ingest(
      store,
      receipt(6, 'interaction.resolved', { interaction_id: 'other-question' })
    );
    const before = store.getSnapshot();
    ingest(
      store,
      receipt(7, 'interaction.resolved', { interaction_id: 'third-question' })
    );
    expect(store.getSnapshot().view.resyncReason).toBe(
      'frontend_control_replay_overflow'
    );
    expect(store.getSnapshot().control).toBe(before.control);
    expect(store.getSnapshot().view.runs).toBe(before.view.runs);
    expect(store.getSnapshot().overflowed).toBe(true);
  });

  it.each([
    'gap',
    'cross-scope',
    'oversize',
    'abort',
    'reset',
    'replacement',
    'timeout',
  ] as const)(
    'retains control readiness and its cursor on a %s failure',
    async (failure) => {
      const events = [
        request(1, 'prefix-question'),
        receipt(2),
        receipt(3),
        request(4, 'tail-question'),
      ];
      journal(events);
      const store = makeStore();
      await hydrateProjectEventStore({ projectId, store, maxEvents: 2 });
      finishDisplay(store, events);
      const before = store.getSnapshot();
      const cursor = store.getControlReplayCursor()!;
      expect(before.view.eventsTruncated).toBe(true);
      const page = deferred<unknown>();
      get.mockImplementationOnce(() => page.promise);
      const abort = new AbortController();
      const loading = loadOlderProjectChatHistory({
        projectId,
        store,
        signal: abort.signal,
        eventPageTimeoutMs: failure === 'timeout' ? 5 : undefined,
      });
      const rejected = expect(loading).rejects.toBeDefined();
      if (failure === 'abort') abort.abort();
      if (failure === 'reset') store.reset();
      if (failure === 'replacement')
        store.replaceSnapshot({
          project_id: projectId,
          current_cursor: 0,
          recent_events: [],
        });
      if (failure !== 'timeout') {
        page.resolve({
          run_id: runId,
          project_id: failure === 'cross-scope' ? 'project-2' : projectId,
          after_sequence: 0,
          next_sequence: 4,
          has_more: false,
          events:
            failure === 'gap'
              ? events.slice(1)
              : failure === 'oversize'
                ? [
                    request(1, 'prefix-question', 'x'.repeat(140_000)),
                    ...events.slice(1),
                  ]
                : events,
        });
      }
      await rejected;
      if (failure === 'reset' || failure === 'replacement') {
        expect(store.getControlReplayCursor()).toBeNull();
        expect(store.getSnapshot().chat.nodes).toEqual([]);
        expect(
          store.appendControlHistory(
            cursor,
            events.map((event) => normalizeLocalRunEvent(event, projectId)),
            { [runId]: 4 }
          )
        ).toBe(false);
      } else {
        expect(store.getSnapshot()).toBe(before);
        expect(store.getControlReplayCursor()).toBe(cursor);
        expect(
          selectEventNativeActiveRunId(store.getSnapshot(), null)
        ).toBeNull();
      }
    }
  );

  it('resumes a failed control batch from its last committed forward cursor', async () => {
    const events = [
      request(1, 'prefix-question'),
      receipt(2),
      receipt(3),
      request(4, 'tail-question'),
    ];
    journal(events);
    const store = makeStore();
    await hydrateProjectEventStore({ projectId, store, maxEvents: 2 });
    finishDisplay(store, events);
    const serve = get.getMockImplementation()!;
    get.mockImplementation(async (...args) => {
      if (args[0] !== '/runs' && args[1]?.after_sequence === 2)
        throw new Error('Offline');
      return serve(...args);
    });
    await expect(
      loadOlderProjectChatHistory({ projectId, store, maxEvents: 2 })
    ).rejects.toThrow('Offline');
    const cursor = store.getControlReplayCursor()!;
    expect(cursor.afterByRun[runId]).toBe(2);
    expect(store.getSnapshot().view.eventsTruncated).toBe(true);
    expect(pendingIds(store)).toEqual(['tail-question']);
    get.mockImplementation(serve);
    get.mockClear();
    await loadOlderProjectChatHistory({ projectId, store, maxEvents: 2 });
    expect(get.mock.calls[0][1]?.after_sequence).toBe(2);
    expect(pendingIds(store)).toEqual(['prefix-question', 'tail-question']);
    expect(store.appendControlHistory(cursor, [], cursor.afterByRun)).toBe(
      false
    );
    expect(store.getSnapshot().view.eventsTruncated).toBe(false);
  });

  it('includes live requests and resolutions received while a forward control page is pending', async () => {
    const events = [
      request(1, 'prefix-question'),
      receipt(2),
      receipt(3),
      request(4, 'tail-question'),
    ];
    journal(events);
    const store = makeStore();
    await hydrateProjectEventStore({ projectId, store, maxEvents: 2 });
    finishDisplay(store, events);
    const page = deferred<unknown>();
    get.mockImplementationOnce(() => page.promise);
    const loading = loadOlderProjectChatHistory({ projectId, store });
    ingest(
      store,
      receipt(5, 'interaction.resolved', { interaction_id: 'prefix-question' }),
      1
    );
    ingest(store, request(6, 'live-question'), 2);
    const before = store.getSnapshot();
    expect(before.view.eventsTruncated).toBe(true);
    page.resolve({
      run_id: runId,
      after_sequence: 0,
      next_sequence: 4,
      has_more: false,
      events,
    });
    await loading;
    expect(pendingIds(store)).toEqual(['tail-question', 'live-question']);
    expect(store.getSnapshot().view.runs).toBe(before.view.runs);
    expect(store.getSnapshot().view.currentCursor).toBe(2);
    expect(store.getSnapshot().view.eventsTruncated).toBe(false);
  });

  it('restores canonical request provenance without making a cloud-restored Run actionable', async () => {
    const events = [request(1, 'prefix-question'), receipt(2), receipt(3)];
    journal(events, 'cloud_restore');
    const store = makeStore();
    await hydrateProjectEventStore({ projectId, store, maxEvents: 1 });
    await drain(store);
    expect(pendingIds(store)).toEqual(['prefix-question']);
    expect(selectActiveHumanControl(store.getSnapshot().control)).toMatchObject(
      { requestSource: 'canonical', requestEventType: 'interaction.requested' }
    );
    expect(selectEventNativeActiveRunId(store.getSnapshot(), null)).toBeNull();
    expect(store.getSnapshot().view.runs[runId].origin).toBe('cloud_restore');
  });
});
