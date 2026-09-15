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
import { normalizeLocalRunEvent, projectSnapshot } from '@/lib/projector';
import { selectPendingHumanControls } from '@/lib/projector/control';
import type { DurableRunSummaryInput } from '@/lib/projector/runSummary';
import { runProjectionStore } from '@/lib/runEvents/projectionStore';
import {
  hydrateProjectEventStore,
  loadOlderProjectChatHistory,
} from '@/service/projectEventStoreHydration';
import { selectCanonicalLiveRuns } from '@/service/projectRunEventStream';
import { RunStateReconciler } from '@/service/runStateReconciliation';
import { ProjectEventStore } from '@/store/projectEventStore';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({ fetchGet: vi.fn(), sseTransport: vi.fn() }));
const get = vi.mocked(fetchGet);
const projectId = 'project-fixture';
const runId = 'run-fixture';
const at = '2026-01-01T00:00:00.000Z';
const stores: ProjectEventStore[] = [];

function store() {
  const value = new ProjectEventStore(projectId, {
    scheduleFlush: () => () => undefined,
  });
  stores.push(value);
  return value;
}

function receipt(
  sequence: number,
  id = runId,
  eventType = 'interaction.requested'
) {
  return {
    project_id: projectId,
    run_id: id,
    event_id: `${id}:${sequence}`,
    sequence,
    run_version: sequence,
    event_type: eventType,
    payload: {
      interaction_id: `${id}-question-${sequence}`,
      prompt: 'Continue?',
    },
    created_at: at,
  };
}

function summary(
  status: string,
  version: number,
  id = runId
): DurableRunSummaryInput {
  return {
    project_id: projectId,
    run_id: id,
    version,
    status,
    origin: 'local',
    updated_at: at,
    resume_blocked_reason: null,
    latest_attempt: { attempt_number: 1, status: 'failed' },
    total_attempt_elapsed_ms: 5_000,
  };
}

async function reconcile(
  value: ProjectEventStore,
  status: string,
  version: number
) {
  get.mockResolvedValueOnce(summary(status, version));
  const reader = new RunStateReconciler(projectId, runId, value);
  await reader.request();
  reader.dispose();
}

function seed(value: ProjectEventStore) {
  value.replaceSnapshot({
    project_id: projectId,
    current_cursor: 0,
    runs: [
      { ...summary('waiting_for_user', 2), expected_next_run_sequence: 3 },
    ],
    recent_events: [receipt(1), receipt(2)],
  });
}

afterEach(() => {
  stores.splice(0).forEach((value) => value.dispose());
  runProjectionStore.clear();
  get.mockReset();
});

describe('Run checkpoints with semantic history refresh', () => {
  it.each(['failed', 'completed', 'cancelled'])(
    'keeps a newer %s GET across a refresh with the same event cursor and timestamp',
    async (status) => {
      const value = store();
      const events = [receipt(1), receipt(2)];
      const serveHistory = async (url: string) =>
        url === '/runs'
          ? {
              project_id: projectId,
              runs: [
                {
                  ...summary('waiting_for_user', 2),
                  total_attempt_elapsed_ms: 1_000,
                },
              ],
            }
          : {
              project_id: projectId,
              run_id: runId,
              after_sequence: 0,
              next_sequence: 2,
              has_more: false,
              events,
            };
      get.mockImplementation(serveHistory);
      await hydrateProjectEventStore({ projectId, store: value });
      await reconcile(value, status, 5);
      const before = value.getSnapshot();
      expect(before.view.runs[runId]).toMatchObject({
        status,
        runVersion: 5,
        lastSequence: 2,
      });

      get.mockImplementation(serveHistory);
      await hydrateProjectEventStore({ projectId, store: value });
      const after = value.getSnapshot();
      expect(after.view.runs[runId]).toEqual(before.view.runs[runId]);
      expect(after.view.currentCursor).toBe(before.view.currentCursor);
      expect(after.chat.nodes).toEqual(before.chat.nodes);
      expect(selectPendingHumanControls(after.control)).toEqual([]);
      expect(after.history?.beforeByRun).toEqual(before.history?.beforeByRun);

      value.enqueue(
        normalizeLocalRunEvent(
          { ...receipt(3, runId, 'assistant.final'), run_version: 6 },
          projectId
        )
      );
      value.flushAll();
      expect(value.getSnapshot().view.runs[runId]).toMatchObject({
        status,
        runVersion: 6,
        lastSequence: 3,
        totalAttemptElapsedMs: 5_000,
        totalAttemptElapsedAt: before.view.runs[runId].totalAttemptElapsedAt,
        latestAttempt: { attemptNumber: 1, status: 'failed' },
      });
    }
  );

  it('keeps a same-version conflicting snapshot from replacing the known terminal outcome', async () => {
    const value = store();
    seed(value);
    await reconcile(value, 'failed', 5);
    const previous = value.getSnapshot().view;
    const refreshed = projectSnapshot(
      {
        project_id: projectId,
        current_cursor: 0,
        runs: [
          {
            ...summary('running', 5),
            expected_next_run_sequence: 4,
            updated_at: '2026-01-01T00:00:01.000Z',
          },
        ],
        recent_events: [],
      },
      previous
    );
    expect(refreshed.runs[runId]).toMatchObject({
      status: 'failed',
      runVersion: 5,
      lastSequence: 3,
      totalAttemptElapsedAt: previous.runs[runId].totalAttemptElapsedAt,
    });
  });

  it('keeps the fresher elapsed receipt at the same Run version while accepting a newer event cursor', async () => {
    const value = store();
    seed(value);
    await reconcile(value, 'failed', 5);
    const previous = value.getSnapshot().view;
    const refreshed = projectSnapshot(
      {
        project_id: projectId,
        current_cursor: 0,
        runs: [
          {
            ...summary('failed', 5),
            expected_next_run_sequence: 4,
            total_attempt_elapsed_ms: 1_000,
            totalAttemptElapsedAt: at,
          },
        ],
        recent_events: [],
      },
      previous
    );
    expect(refreshed.runs[runId]).toMatchObject({
      status: 'failed',
      runVersion: 5,
      lastSequence: 3,
      totalAttemptElapsedMs: 5_000,
      totalAttemptElapsedAt: previous.runs[runId].totalAttemptElapsedAt,
    });
  });

  it('accepts a newer Run version without rewinding an already observed event cursor', () => {
    const value = store();
    seed(value);
    const current = value.getSnapshot().view;
    const previous = {
      ...current,
      runs: {
        ...current.runs,
        [runId]: { ...current.runs[runId], lastSequence: 4 },
      },
    };
    const refreshed = projectSnapshot(
      {
        project_id: projectId,
        current_cursor: 0,
        runs: [{ ...summary('failed', 5), expected_next_run_sequence: 3 }],
        recent_events: [],
      },
      previous
    );
    expect(refreshed.runs[runId]).toMatchObject({
      status: 'failed',
      runVersion: 5,
      lastSequence: 4,
    });
  });

  it.each(['failed', 'completed', 'cancelled', 'interrupted'])(
    'keeps a known %s checkpoint when refresh receives only newer observation receipts',
    async (status) => {
      const value = store();
      seed(value);
      await reconcile(value, status, 5);
      const before = value.getSnapshot().view;
      const refreshed = projectSnapshot(
        {
          project_id: projectId,
          current_cursor: 0,
          runs: [
            {
              ...summary('waiting_for_user', 2),
              expected_next_run_sequence: 3,
              total_attempt_elapsed_ms: 1_000,
            },
          ],
          recent_events: [
            receipt(1),
            receipt(2),
            { ...receipt(3, runId, 'assistant.final'), run_version: 6 },
          ],
        },
        before
      );
      expect(refreshed.runs[runId]).toMatchObject({
        status,
        runVersion: 6,
        lastSequence: 3,
        totalAttemptElapsedMs: 5_000,
        totalAttemptElapsedAt: before.runs[runId].totalAttemptElapsedAt,
        latestAttempt: before.runs[runId].latestAttempt,
      });
      expect(refreshed.currentCursor).toBe(before.currentCursor);
    }
  );

  it.each(['pending', 'running', 'waiting_for_user', 'cancelling'])(
    'invalidates an active %s elapsed checkpoint on newer terminal execution',
    async (status) => {
      const value = store();
      seed(value);
      await reconcile(value, status, 3);
      value.enqueue(
        normalizeLocalRunEvent(
          { ...receipt(3, runId, 'run.failed'), run_version: 4 },
          projectId
        )
      );
      value.flushAll();
      expect(value.getSnapshot().view.runs[runId]).toMatchObject({
        status: 'failed',
        runVersion: 4,
        totalAttemptElapsedMs: null,
        totalAttemptElapsedAt: null,
      });
    }
  );

  it.each(['failed', 'completed', 'cancelled'])(
    'finishes forward control history after a %s GET without reviving requests or consuming active capacity',
    async (status) => {
      const value = store();
      const activeId = 'active-run-fixture';
      const endedEvents = Array.from({ length: 132 }, (_, i) => receipt(i + 1));
      const activeEvents = [
        receipt(1, activeId, 'run.attempt_started'),
        receipt(2, activeId),
      ];
      const history = {
        beforeByRun: { [runId]: 131, [activeId]: 1 },
        runsTruncated: false,
      };
      const replacement = value.beginSnapshotReplacement()!;
      expect(
        value.commitSnapshotReplacement(
          replacement,
          {
            project_id: projectId,
            current_cursor: 0,
            runs: [
              {
                ...summary('waiting_for_user', 132),
                expected_next_run_sequence: 133,
              },
              {
                ...summary('waiting_for_user', 2, activeId),
                expected_next_run_sequence: 3,
              },
            ],
            recent_events: [endedEvents[131], activeEvents[1]],
          },
          history
        )
      ).toBe(true);
      const normalize = (event: ReturnType<typeof receipt>) =>
        normalizeLocalRunEvent(event, projectId);
      expect(
        value.appendControlHistory(
          value.getControlReplayCursor()!,
          endedEvents.slice(0, 64).map(normalize),
          { [runId]: 64, [activeId]: 0 }
        )
      ).toBe(true);
      const checkpoint = value.getControlReplayCursor();
      await reconcile(value, status, 133);
      const terminal = value.getSnapshot();
      expect(value.getControlReplayCursor()).toBe(checkpoint);
      expect(terminal.history).toBe(history);
      expect(terminal.view.eventsTruncated).toBe(true);
      expect(selectEventNativeActiveRunId(terminal, null)).toBeNull();

      expect(
        value.prependChatHistory(
          [...endedEvents.slice(0, 131), activeEvents[0]].map(normalize),
          history,
          {
            ...history,
            beforeByRun: { [runId]: 0, [activeId]: 0 },
          }
        )
      ).toBe(true);
      expect(
        value.appendControlHistory(
          value.getControlReplayCursor()!,
          endedEvents.slice(64, 129).map(normalize),
          { [runId]: 129, [activeId]: 0 }
        )
      ).toBe(true);
      expect(value.getSnapshot().view.eventsTruncated).toBe(true);
      expect(
        selectEventNativeActiveRunId(value.getSnapshot(), null)
      ).toBeNull();
      expect(
        value.appendControlHistory(
          value.getControlReplayCursor()!,
          [...endedEvents.slice(129), ...activeEvents].map(normalize),
          { [runId]: 132, [activeId]: 2 }
        )
      ).toBe(true);

      const after = value.getSnapshot();
      expect(after.control).toBe(terminal.control);
      expect(after.view.runs).toBe(terminal.view.runs);
      expect(after.view.currentCursor).toBe(terminal.view.currentCursor);
      expect(after.chat.nodes).toHaveLength(134);
      expect(
        after.control.interactionById[`${runId}-question-132`].status
      ).toBe('requested');
      expect(
        selectPendingHumanControls(after.control).map((item) => item.runId)
      ).toEqual([activeId]);
      expect(after.overflowed).toBe(false);
      expect(after.view.eventsTruncated).toBe(false);
      expect(value.getControlReplayCursor()).toBeNull();
      expect(selectEventNativeActiveRunId(after, null)).toBe(activeId);
    }
  );

  it.each([
    { previousStatus: 'waiting_for_user', count: 7, maxEvents: 1 },
    { previousStatus: 'interrupted', count: 7, maxEvents: 1 },
    { previousStatus: 'interrupted', count: 2_004, maxEvents: undefined },
  ])(
    'accepts a newer running aggregate when the recovery receipt is outside the refresh tail: $previousStatus / $count',
    async ({ previousStatus, count, maxEvents }) => {
      const value = store();
      const events = [
        receipt(1, runId, 'run.attempt_started'),
        {
          ...receipt(
            2,
            runId,
            previousStatus === 'interrupted'
              ? 'run.interrupted'
              : 'interaction.requested'
          ),
          payload: { interaction_id: 'question', prompt: 'Continue?' },
        },
        {
          ...receipt(
            3,
            runId,
            previousStatus === 'interrupted'
              ? 'run.attempt_started'
              : 'interaction.resolved'
          ),
          payload: { interaction_id: 'question', continued_attempt: true },
        },
        ...Array.from({ length: count - 3 }, (_, index) => ({
          ...receipt(index + 4, runId, 'tool.completed'),
          payload: { tool_call_id: `call-${index}`, tool_name: 'read_file' },
        })),
      ];
      let visible = 2;
      get.mockImplementation(async (url, params) => {
        if (url === '/runs')
          return {
            project_id: projectId,
            runs: [
              {
                ...summary(visible === 2 ? previousStatus : 'running', visible),
                total_attempt_elapsed_ms: 1_000,
              },
            ],
          };
        if (url !== `/runs/${runId}/events`)
          throw new Error('Unexpected fixture request');
        const after = Number(params?.after_sequence ?? 0);
        const page = events
          .filter(
            (event) => event.sequence > after && event.sequence <= visible
          )
          .slice(0, Number(params?.limit));
        const next = page.at(-1)?.sequence ?? after;
        return {
          project_id: projectId,
          run_id: runId,
          after_sequence: after,
          next_sequence: next,
          has_more: next < visible,
          events: page,
        };
      });
      await hydrateProjectEventStore({ projectId, store: value });
      expect(value.getSnapshot().view.runs[runId].status).toBe(previousStatus);
      visible = count;
      await hydrateProjectEventStore({ projectId, store: value, maxEvents });
      const tail = value.getSnapshot();
      expect(tail.view.eventsTruncated).toBe(true);
      expect(value.getControlReplayCursor()).not.toBeNull();
      expect(selectEventNativeActiveRunId(tail, null)).toBeNull();

      await loadOlderProjectChatHistory({ projectId, store: value });
      const complete = value.getSnapshot();
      expect(complete.view.eventsTruncated).toBe(false);
      expect(value.getControlReplayCursor()).toBeNull();
      expect(complete.chat.nodes).toHaveLength(count);
      expect(complete.chat.nodeById[`${runId}:3`]).toBeDefined();
      expect(selectPendingHumanControls(complete.control)).toEqual([]);
      for (const snapshot of [tail, complete])
        expect(snapshot.view.runs[runId]).toMatchObject({
          status: 'running',
          runVersion: count,
          lastSequence: count,
        });
      expect(
        selectCanonicalLiveRuns(complete).map((run) => run.runId)
      ).toContain(runId);

      await reconcile(value, 'running', count);
      const afterGet = value.getSnapshot();
      expect(get).toHaveBeenLastCalledWith(
        `/runs/${runId}`,
        undefined,
        undefined,
        { signal: expect.any(AbortSignal) }
      );
      expect(
        get.mock.calls.filter(([url]) => url === `/runs/${runId}`)
      ).toHaveLength(1);
      expect(afterGet.view.runs[runId]).toMatchObject({
        status: 'running',
        runVersion: count,
        lastSequence: count,
        totalAttemptElapsedMs: 5_000,
      });
      expect(afterGet.chat).toBe(complete.chat);
      expect(afterGet.control).toBe(complete.control);
      expect(afterGet.history).toBe(complete.history);
      expect(afterGet.view.currentCursor).toBe(complete.view.currentCursor);
    }
  );

  it.each(['waiting_for_user', 'interrupted'])(
    'uses a newer aggregate before folding a contiguous observation onto an old %s checkpoint',
    (previousStatus) => {
      const previous = projectSnapshot({
        project_id: projectId,
        current_cursor: 0,
        runs: [
          { ...summary(previousStatus, 2), expected_next_run_sequence: 3 },
        ],
        recent_events: [],
      });
      const refreshed = projectSnapshot(
        {
          project_id: projectId,
          current_cursor: 0,
          runs: [
            {
              ...summary('running', 3),
              expected_next_run_sequence: 4,
              total_attempt_elapsed_ms: 1_000,
              totalAttemptElapsedAt: at,
            },
          ],
          recent_events: [receipt(3, runId, 'tool.completed')],
        },
        previous
      );
      expect(refreshed.runs[runId]).toMatchObject({
        status: 'running',
        runVersion: 3,
        lastSequence: 3,
        totalAttemptElapsedMs: 1_000,
        totalAttemptElapsedAt: at,
      });
    }
  );

  it.each(['failed', 'completed', 'cancelled'])(
    'retains a final %s checkpoint and elapsed time across a sparse observation tail',
    async (status) => {
      const value = store();
      seed(value);
      await reconcile(value, status, 5);
      const previous = value.getSnapshot().view;
      const refreshed = projectSnapshot(
        {
          project_id: projectId,
          current_cursor: 0,
          runs: [
            {
              ...summary('waiting_for_user', 2),
              expected_next_run_sequence: 3,
            },
          ],
          recent_events: [receipt(7, runId, 'assistant.final')],
          events_truncated: true,
        },
        previous
      );
      expect(refreshed.runs[runId]).toMatchObject({
        status,
        runVersion: 7,
        lastSequence: 7,
        totalAttemptElapsedMs: 5_000,
        totalAttemptElapsedAt: previous.runs[runId].totalAttemptElapsedAt,
        latestAttempt: previous.runs[runId].latestAttempt,
      });
      expect(refreshed.eventsTruncated).toBe(true);
      expect(refreshed.currentCursor).toBe(previous.currentCursor);
    }
  );
});
