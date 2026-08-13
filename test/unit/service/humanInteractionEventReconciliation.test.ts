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
import { reconcileHumanInteractionEvents } from '@/service/humanInteractionEventReconciliation';
import {
  getProjectEventStore,
  resetProjectEventStoresForTests,
} from '@/store/projectEventStore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({ fetchGet: vi.fn() }));

const fetchGetMock = vi.mocked(fetchGet);

function localEvent(
  sequence: number,
  eventType: string,
  payload: Record<string, unknown>,
  eventId = `${eventType}-${sequence}`
) {
  return {
    event_id: eventId,
    run_id: 'run-1',
    sequence,
    run_version: sequence,
    event_type: eventType,
    legacy_step: null,
    payload,
    created_at: `2026-08-11T10:00:${String(sequence).padStart(2, '0')}.000Z`,
  };
}

describe('reconcileHumanInteractionEvents', () => {
  beforeEach(() => {
    fetchGetMock.mockReset();
    resetProjectEventStoresForTests();
  });

  afterEach(() => resetProjectEventStoresForTests());

  it('paginates from the request sequence and enqueues the durable terminal event', async () => {
    const store = getProjectEventStore('project-1');
    store.enqueue(
      normalizeLocalRunEvent(
        localEvent(1, 'interaction.requested', {
          interaction_id: 'choice-1',
          interaction_type: 'choice',
          options: [{ id: 'a', label: 'A' }],
        }),
        'project-1'
      )
    );
    store.flushAll();
    fetchGetMock
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 2,
        has_more: true,
        events: [localEvent(2, 'activity.updated', { label: 'Working' })],
      })
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 3,
        has_more: false,
        events: [
          localEvent(3, 'interaction.resolved', {
            interaction_id: 'choice-1',
            interaction_type: 'choice',
            decision: { option_id: 'a' },
          }),
        ],
      });

    const terminal = await reconcileHumanInteractionEvents({
      projectId: 'project-1',
      runId: 'run-1',
      interactionId: 'choice-1',
      afterSequence: 1,
    });

    expect(terminal.eventType).toBe('interaction.resolved');
    expect(fetchGetMock).toHaveBeenNthCalledWith(1, '/runs/run-1/events', {
      after_sequence: 1,
      limit: 500,
    });
    expect(fetchGetMock).toHaveBeenNthCalledWith(2, '/runs/run-1/events', {
      after_sequence: 2,
      limit: 500,
    });
    expect(store.getControlSnapshot().interactionById['choice-1'].status).toBe(
      'resolved'
    );
  });

  it('does not synthesize resolution from the successful command response', async () => {
    const store = getProjectEventStore('project-1');
    store.enqueue(
      normalizeLocalRunEvent(
        localEvent(1, 'approval.requested', {
          approval_id: 'approval-1',
          interaction_type: 'approval',
          allowed_scopes: ['once'],
          action_digest: 'digest-1',
        }),
        'project-1'
      )
    );
    store.flushAll();
    fetchGetMock.mockResolvedValue({
      run_id: 'run-1',
      next_sequence: 1,
      has_more: false,
      events: [],
    });

    await expect(
      reconcileHumanInteractionEvents({
        projectId: 'project-1',
        runId: 'run-1',
        interactionId: 'approval-1',
        afterSequence: 1,
      })
    ).rejects.toThrow('durable lifecycle event');

    expect(
      store.getControlSnapshot().interactionById['approval-1'].status
    ).toBe('requested');
  });

  it('does not resolve until the terminal event reaches HumanControlProjection', async () => {
    let scheduledFlush: (() => void) | null = null;
    const store = getProjectEventStore('project-1', {
      scheduleFlush: (callback) => {
        scheduledFlush = callback;
        return () => {
          if (scheduledFlush === callback) scheduledFlush = null;
        };
      },
    });
    store.enqueue(
      normalizeLocalRunEvent(
        localEvent(1, 'interaction.requested', {
          interaction_id: 'question-1',
          interaction_type: 'question',
          request: { question: 'Which file?' },
        }),
        'project-1'
      )
    );
    store.flushAll();
    fetchGetMock.mockResolvedValue({
      run_id: 'run-1',
      next_sequence: 2,
      has_more: false,
      events: [
        localEvent(2, 'interaction.resolved', {
          interaction_id: 'question-1',
          interaction_type: 'question',
          decision: { reply: 'report.md' },
        }),
      ],
    });

    let resolved = false;
    const reconciliation = reconcileHumanInteractionEvents({
      projectId: 'project-1',
      runId: 'run-1',
      interactionId: 'question-1',
      afterSequence: 1,
      projectionTimeoutMs: 1_000,
    }).then((event) => {
      resolved = true;
      return event;
    });
    await vi.waitFor(() => expect(scheduledFlush).not.toBeNull());

    expect(resolved).toBe(false);
    expect(
      store.getControlSnapshot().interactionById['question-1'].status
    ).toBe('requested');
    const flush = scheduledFlush;
    if (!flush) throw new Error('expected a scheduled projection flush');
    flush();

    await expect(reconciliation).resolves.toMatchObject({
      eventType: 'interaction.resolved',
    });
    expect(
      store.getControlSnapshot().interactionById['question-1'].status
    ).toBe('resolved');
  });

  it('rejects when the bounded Project event queue overflows', async () => {
    const store = getProjectEventStore('project-1', {
      maxQueueEvents: 1,
      scheduleFlush: () => () => undefined,
    });
    store.enqueue(
      normalizeLocalRunEvent(
        localEvent(1, 'interaction.requested', {
          interaction_id: 'question-1',
          interaction_type: 'question',
        }),
        'project-1'
      )
    );
    store.flushAll();
    fetchGetMock.mockResolvedValue({
      run_id: 'run-1',
      next_sequence: 3,
      has_more: false,
      events: [
        localEvent(2, 'activity.updated', { label: 'Working' }),
        localEvent(3, 'interaction.resolved', {
          interaction_id: 'question-1',
          interaction_type: 'question',
        }),
      ],
    });

    await expect(
      reconcileHumanInteractionEvents({
        projectId: 'project-1',
        runId: 'run-1',
        interactionId: 'question-1',
        afterSequence: 1,
      })
    ).rejects.toThrow('queue rejected');
    expect(store.getSnapshot().overflowed).toBe(true);
    expect(
      store.getControlSnapshot().interactionById['question-1'].status
    ).toBe('requested');
  });

  it('rejects a projected interaction that does not belong to the requested Run', async () => {
    const store = getProjectEventStore('project-1');
    store.enqueue(
      normalizeLocalRunEvent(
        {
          ...localEvent(1, 'interaction.requested', {
            interaction_id: 'shared-id',
            interaction_type: 'question',
          }),
          run_id: 'run-2',
        },
        'project-1'
      )
    );
    store.flushAll();
    fetchGetMock.mockResolvedValue({
      run_id: 'run-1',
      next_sequence: 1,
      has_more: false,
      events: [
        localEvent(1, 'interaction.resolved', {
          interaction_id: 'shared-id',
          interaction_type: 'question',
        }),
      ],
    });

    await expect(
      reconcileHumanInteractionEvents({
        projectId: 'project-1',
        runId: 'run-1',
        interactionId: 'shared-id',
        afterSequence: 0,
        projectionTimeoutMs: 200,
      })
    ).rejects.toThrow('cross-scope interaction');
  });

  it('rejects a replay event carrying a different Project scope', async () => {
    getProjectEventStore('project-1');
    fetchGetMock.mockResolvedValue({
      run_id: 'run-1',
      next_sequence: 1,
      has_more: false,
      events: [
        {
          ...localEvent(1, 'interaction.resolved', {
            interaction_id: 'question-1',
          }),
          project_id: 'project-2',
        },
      ],
    });

    await expect(
      reconcileHumanInteractionEvents({
        projectId: 'project-1',
        runId: 'run-1',
        interactionId: 'question-1',
        afterSequence: 0,
      })
    ).rejects.toThrow('cross-Project event');
  });
});
