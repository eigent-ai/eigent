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

import { presentChatSemanticEntities } from '@/components/ChatBox/EventTimeline/presentationPolicy';
import { useRunElapsedMs } from '@/components/ChatBox/TimelineModes/shared';
import { normalizeLocalRunEvent } from '@/lib/projector';
import { selectRenderableChatNodes } from '@/lib/projector/chat';
import {
  composeTimelineRuns,
  reconcileTimelineRuns,
  type TimelineRunView,
} from '@/lib/projector/chat/presentation';
import { ProjectEventStore } from '@/store/projectEventStore';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const projectId = 'project-elapsed';
const runId = 'run-elapsed';
const startedAt = Date.parse('2026-10-01T10:00:00.000Z');
const stores: ProjectEventStore[] = [];

function iso(offsetMs: number): string {
  return new Date(startedAt + offsetMs).toISOString();
}

type RawRunEvent = ReturnType<typeof runEvent>;

function runEvent(
  sequence: number,
  eventType: string,
  offsetMs: number,
  payload: Record<string, unknown> = {}
) {
  return {
    project_id: projectId,
    run_id: runId,
    event_id: `${runId}:${sequence}`,
    sequence,
    run_version: sequence,
    event_type: eventType,
    payload,
    created_at: iso(offsetMs),
  };
}

type WaitKind = 'approval' | 'question';

const waitEvents: Record<
  WaitKind,
  {
    requested: (sequence: number, offsetMs: number, id: string) => RawRunEvent;
    answered: (
      sequence: number,
      offsetMs: number,
      id: string,
      payload?: Record<string, unknown>
    ) => RawRunEvent;
  }
> = {
  approval: {
    requested: (sequence, offsetMs, id) =>
      runEvent(sequence, 'approval.requested', offsetMs, {
        approval_id: id,
        prompt: { question: 'Allow the write?' },
      }),
    answered: (sequence, offsetMs, id, payload = {}) =>
      runEvent(sequence, 'approval.decided', offsetMs, {
        approval_id: id,
        decision: 'approved',
        continued_attempt: true,
        remaining_interaction_count: 0,
        ...payload,
      }),
  },
  question: {
    requested: (sequence, offsetMs, id) =>
      runEvent(sequence, 'interaction.requested', offsetMs, {
        interaction_id: id,
        interaction_type: 'question',
        request: { question: 'Which region?' },
      }),
    answered: (sequence, offsetMs, id, payload = {}) =>
      runEvent(sequence, 'interaction.resolved', offsetMs, {
        interaction_id: id,
        interaction_type: 'question',
        decision: { answer: 'eu-west' },
        continued_attempt: true,
        remaining_interaction_count: 0,
        ...payload,
      }),
  },
};

const events = {
  query: () =>
    runEvent(1, 'user.message', 0, {
      role: 'user',
      content: 'Rebuild the report',
    }),
  started: () => runEvent(2, 'run.attempt_started', 0),
  completed: (sequence: number, offsetMs: number) =>
    runEvent(sequence, 'run.completed', offsetMs),
};

function store(): ProjectEventStore {
  const value = new ProjectEventStore(projectId, {
    scheduleFlush: () => () => undefined,
  });
  stores.push(value);
  return value;
}

function deliver(value: ProjectEventStore, raw: RawRunEvent) {
  value.enqueue(normalizeLocalRunEvent(raw, projectId));
  value.flushAll();
}

function timelineRun(value: ProjectEventStore): TimelineRunView {
  const snapshot = value.getSnapshot();
  const runs = reconcileTimelineRuns(
    composeTimelineRuns(
      presentChatSemanticEntities(selectRenderableChatNodes(snapshot.chat))
    ),
    snapshot.view.runs
  );
  const run = runs.find((candidate) => candidate.runId === runId);
  if (!run) throw new Error('Run was not composed');
  return run;
}

function ElapsedProbe({
  run,
  paused = false,
}: {
  run: TimelineRunView;
  paused?: boolean;
}) {
  return <output data-testid="elapsed">{useRunElapsedMs(run, paused)}</output>;
}

/** Render a Session's timer and read it as the clock advances. */
function watch(value: ProjectEventStore) {
  let paused = false;
  const show = () => <ElapsedProbe paused={paused} run={timelineRun(value)} />;
  const view = render(show());
  return {
    read(): number {
      view.rerender(show());
      return Number(screen.getByTestId('elapsed').textContent);
    },
    setPaused(next: boolean) {
      paused = next;
      view.rerender(show());
    },
    unmount: () => view.unmount(),
  };
}

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

afterEach(() => {
  stores.splice(0).forEach((value) => value.dispose());
  vi.useRealTimers();
});

describe('Run elapsed time leaves out waiting for the user', () => {
  it.each<WaitKind>(['approval', 'question'])(
    'holds still during a %s wait, across a Session reload, and finishes with the active time',
    (kind) => {
      vi.useFakeTimers();
      vi.setSystemTime(startedAt);
      const { requested, answered } = waitEvents[kind];
      const readings: number[] = [];

      // Live: the Attempt works for 2s, then waits 60s for the user.
      const live = store();
      deliver(live, events.query());
      deliver(live, events.started());
      const liveTimer = watch(live);
      advance(2_000);
      readings.push(liveTimer.read());
      deliver(live, requested(3, 2_000, 'wait-1'));
      readings.push(liveTimer.read());
      advance(60_000);
      readings.push(liveTimer.read());
      liveTimer.unmount();

      // Reopening the Session during the wait rebuilds it from the Run
      // listing, which reports the time worked before the wait, plus a
      // bounded newest event tail without the Attempt start.
      const reopened = store();
      reopened.replaceSnapshot({
        project_id: projectId,
        current_cursor: 0,
        runs: [
          {
            run_id: runId,
            status: 'waiting_for_user',
            run_version: 3,
            expected_next_run_sequence: 4,
            updated_at: iso(2_000),
            origin: 'local',
            total_attempt_elapsed_ms: 2_000,
            totalAttemptElapsedAt: iso(62_000),
          },
        ],
        recent_events: [requested(3, 2_000, 'wait-1')],
        events_truncated: true,
      });
      const reopenedTimer = watch(reopened);
      readings.push(reopenedTimer.read());
      advance(30_000);
      readings.push(reopenedTimer.read());

      // The answer continues the same Attempt, which then works for 3s.
      deliver(reopened, answered(4, 92_000, 'wait-1'));
      expect(reopened.getSnapshot().view.runs[runId].status).toBe('running');
      readings.push(reopenedTimer.read());
      advance(3_000);
      readings.push(reopenedTimer.read());

      // The Run finishes; its final read reports the same active time.
      deliver(reopened, events.completed(5, 95_000));
      readings.push(reopenedTimer.read());
      expect(
        reopened.reconcileRunSummary(
          {
            run_id: runId,
            project_id: projectId,
            status: 'completed',
            version: 5,
            updated_at: iso(95_000),
            origin: 'local',
            total_attempt_elapsed_ms: 5_000,
          },
          reopened.getIncarnation()
        )
      ).toBe(true);
      advance(10_000);
      readings.push(reopenedTimer.read());

      expect(readings).toEqual([
        2_000, 2_000, 2_000, 2_000, 2_000, 2_000, 5_000, 5_000, 5_000,
      ]);
    }
  );

  it('finishes a Run watched live from its start with the active time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    const { requested, answered } = waitEvents.approval;
    const live = store();
    deliver(live, events.query());
    deliver(live, events.started());
    const timer = watch(live);
    advance(2_000);
    deliver(live, requested(3, 2_000, 'approval-1'));
    advance(60_000);
    deliver(live, answered(4, 62_000, 'approval-1'));
    const readings = [timer.read()];
    advance(3_000);
    readings.push(timer.read());
    deliver(live, events.completed(5, 65_000));
    advance(10_000);
    readings.push(timer.read());

    expect(readings).toEqual([2_000, 5_000, 5_000]);
  });

  it('leaves out overlapping approvals once', () => {
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    const { requested, answered } = waitEvents.approval;
    const live = store();
    deliver(live, events.query());
    deliver(live, events.started());
    const timer = watch(live);
    advance(2_000);
    // Two workers ask at once: 2s-30s and 10s-50s are one wait.
    deliver(live, requested(3, 2_000, 'approval-1'));
    advance(8_000);
    deliver(live, requested(4, 10_000, 'approval-2'));
    advance(20_000);
    deliver(
      live,
      answered(5, 30_000, 'approval-1', {
        continued_attempt: false,
        remaining_interaction_count: 1,
      })
    );
    // The other request is still open, so the Run keeps waiting.
    expect(live.getSnapshot().view.runs[runId].status).toBe('waiting_for_user');
    const readings = [timer.read()];
    advance(20_000);
    readings.push(timer.read());
    deliver(live, answered(6, 50_000, 'approval-2'));
    advance(3_000);
    readings.push(timer.read());

    expect(readings).toEqual([2_000, 2_000, 5_000]);
  });

  it('keeps an earlier pause out of the time held during a wait', () => {
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    const { requested, answered } = waitEvents.approval;
    const live = store();
    deliver(live, events.query());
    deliver(live, events.started());
    const timer = watch(live);
    // Works 2s, is paused by the user for 10s, then works 2s more.
    advance(2_000);
    timer.setPaused(true);
    advance(10_000);
    timer.setPaused(false);
    advance(2_000);
    const readings = [timer.read()];
    deliver(live, requested(3, 14_000, 'approval-1'));
    readings.push(timer.read());
    advance(60_000);
    readings.push(timer.read());
    deliver(live, answered(4, 74_000, 'approval-1'));
    readings.push(timer.read());
    advance(1_000);
    readings.push(timer.read());

    expect(readings).toEqual([4_000, 4_000, 4_000, 4_000, 5_000]);
  });

  it.each([13_000, 3_000])(
    'does not move when a wait starts or ends after a pause and a run read of %d ms',
    (listedTotal) => {
      vi.useFakeTimers();
      vi.setSystemTime(startedAt);
      const { requested, answered } = waitEvents.approval;
      const live = store();
      deliver(live, events.query());
      deliver(live, events.started());
      const timer = watch(live);
      // Works 2s, is paused for 10s, works 1s, then the Run is read again.
      advance(2_000);
      timer.setPaused(true);
      advance(10_000);
      timer.setPaused(false);
      advance(1_000);
      live.reconcileRunSummary(
        {
          run_id: runId,
          project_id: projectId,
          status: 'running',
          version: 2,
          updated_at: iso(0),
          origin: 'local',
          total_attempt_elapsed_ms: listedTotal,
        },
        live.getIncarnation()
      );
      advance(1_000);
      const beforeWait = timer.read();
      deliver(live, requested(3, 14_000, 'approval-1'));
      const readings = [timer.read()];
      advance(30_000);
      readings.push(timer.read());
      deliver(live, answered(4, 44_000, 'approval-1'));
      readings.push(timer.read());

      expect(readings).toEqual([beforeWait, beforeWait, beforeWait]);
    }
  );

  it('adds nothing for a pause taken while waiting for the user', () => {
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    const { requested, answered } = waitEvents.approval;
    const live = store();
    deliver(live, events.query());
    deliver(live, events.started());
    const timer = watch(live);
    advance(2_000);
    deliver(live, requested(3, 2_000, 'approval-1'));
    // The user pauses for 10s in the middle of the 60s wait.
    advance(10_000);
    timer.setPaused(true);
    advance(10_000);
    const readings = [timer.read()];
    timer.setPaused(false);
    advance(40_000);
    deliver(live, answered(4, 62_000, 'approval-1'));
    readings.push(timer.read());
    advance(3_000);
    readings.push(timer.read());

    expect(readings).toEqual([2_000, 2_000, 5_000]);
  });
});
