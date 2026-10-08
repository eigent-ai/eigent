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

const events = {
  query: () =>
    runEvent(1, 'user.message', 0, {
      role: 'user',
      content: 'Rebuild the report',
    }),
  started: () => runEvent(2, 'run.attempt_started', 0),
  approvalRequested: () =>
    runEvent(3, 'approval.requested', 2_000, {
      approval_id: 'approval-1',
      prompt: { question: 'Allow the write?' },
    }),
  approved: () =>
    runEvent(4, 'approval.decided', 62_000, {
      approval_id: 'approval-1',
      decision: 'approved',
      continued_attempt: true,
    }),
};

function store(): ProjectEventStore {
  const value = new ProjectEventStore(projectId, {
    scheduleFlush: () => () => undefined,
  });
  stores.push(value);
  return value;
}

function deliver(value: ProjectEventStore, raw: Record<string, unknown>) {
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

function ElapsedProbe({ run }: { run: TimelineRunView }) {
  return <output data-testid="elapsed">{useRunElapsedMs(run)}</output>;
}

function readElapsedMs(): number {
  return Number(screen.getByTestId('elapsed').textContent);
}

afterEach(() => {
  stores.splice(0).forEach((value) => value.dispose());
  vi.useRealTimers();
});

describe('Run elapsed time across an approval wait', () => {
  it('stays continuous when the Session is reopened during the wait and then approved', () => {
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    const readings: number[] = [];

    // Live: the Attempt runs for 2s, then waits 60s for an approval.
    const live = store();
    deliver(live, events.query());
    deliver(live, events.started());
    const liveView = render(<ElapsedProbe run={timelineRun(live)} />);
    act(() => vi.advanceTimersByTime(2_000));
    readings.push(readElapsedMs());
    deliver(live, events.approvalRequested());
    liveView.rerender(<ElapsedProbe run={timelineRun(live)} />);
    readings.push(readElapsedMs());
    act(() => vi.advanceTimersByTime(60_000));
    readings.push(readElapsedMs());
    liveView.unmount();

    // Reopening the Session rebuilds it from the Run listing, measured at
    // read time, plus a bounded newest event tail that no longer contains the
    // Attempt start (as for any long task).
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
          total_attempt_elapsed_ms: 62_000,
          totalAttemptElapsedAt: iso(62_000),
        },
      ],
      recent_events: [events.approvalRequested()],
      events_truncated: true,
    });
    const reopenedView = render(<ElapsedProbe run={timelineRun(reopened)} />);
    readings.push(readElapsedMs());

    // "Approve once" continues the same Attempt, which then runs for 3s.
    deliver(reopened, events.approved());
    expect(reopened.getSnapshot().view.runs[runId].status).toBe('running');
    reopenedView.rerender(<ElapsedProbe run={timelineRun(reopened)} />);
    readings.push(readElapsedMs());
    act(() => vi.advanceTimersByTime(3_000));
    readings.push(readElapsedMs());

    expect(readings).toEqual([2_000, 2_000, 62_000, 62_000, 62_000, 65_000]);
  });
});
