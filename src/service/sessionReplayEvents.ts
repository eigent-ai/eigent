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
import {
  normalizeLocalRunEvent,
  type CanonicalProjectEvent,
} from '@/lib/projector';
import { isStoppedRunStatus } from '@/lib/projector/runSummary';
import { fetchProjectRuns } from './projectRunsApi';

/** Page size for `/runs/{runId}/events`; Brain accepts up to 5,000. */
const EVENT_PAGE_SIZE = 500;
/** Upper bound for one replay, across all of a Session's Runs. */
export const SESSION_REPLAY_MAX_EVENTS = 20_000;

export interface SessionReplayRun {
  runId: string;
  status: string;
  createdAt: string | null;
  events: CanonicalProjectEvent[];
}

export interface SessionReplayData {
  projectId: string;
  /** Finished Runs, oldest first. */
  runs: SessionReplayRun[];
  /** Every event of `runs`, in Run order then sequence order. */
  events: CanonicalProjectEvent[];
  /** Runs left out because they have not finished yet. */
  unfinishedRunCount: number;
  /** True when the event cap was reached and later events were left out. */
  truncated: boolean;
}

type RunEventsPage = {
  next_sequence?: unknown;
  has_more?: unknown;
  events?: unknown;
};

function timestampText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Brain sends seconds; anything this large is already milliseconds.
    return new Date(value > 1e12 ? value : value * 1000).toISOString();
  }
  return null;
}

function orderTime(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

async function readRunEvents(
  projectId: string,
  runId: string,
  budget: { remaining: number },
  signal?: AbortSignal
): Promise<{ events: CanonicalProjectEvent[]; truncated: boolean }> {
  const events: CanonicalProjectEvent[] = [];
  let afterSequence = 0;
  for (;;) {
    if (budget.remaining <= 0) return { events, truncated: true };
    const page = (await fetchGet(
      `/runs/${encodeURIComponent(runId)}/events`,
      {
        after_sequence: afterSequence,
        limit: Math.min(EVENT_PAGE_SIZE, budget.remaining),
      },
      undefined,
      { signal }
    )) as RunEventsPage | null;
    const rawEvents = Array.isArray(page?.events) ? page.events : [];
    for (const raw of rawEvents) {
      try {
        events.push(normalizeLocalRunEvent(raw, projectId));
        budget.remaining -= 1;
      } catch {
        // A malformed event cannot be replayed; the rest still can.
      }
    }
    const next = Number(page?.next_sequence);
    if (
      page?.has_more !== true ||
      rawEvents.length === 0 ||
      !Number.isFinite(next) ||
      next <= afterSequence
    ) {
      return { events, truncated: false };
    }
    afterSequence = next;
  }
}

/**
 * Read a Session's finished Runs and their stored events for replay or
 * sharing. Read-only: it uses the same endpoints as history hydration.
 */
export async function loadSessionReplayData(
  projectId: string,
  options: { signal?: AbortSignal; maxEvents?: number } = {}
): Promise<SessionReplayData> {
  const response = await fetchProjectRuns(projectId, 100, options.signal);
  const listed = Array.isArray(response?.runs) ? response.runs : [];
  const descriptors = listed
    .filter(
      (run): run is typeof run & { run_id: string; status: string } =>
        typeof run.run_id === 'string' && typeof run.status === 'string'
    )
    .map((run) => ({
      runId: run.run_id,
      status: run.status,
      createdAt: timestampText(run.created_at),
    }));
  const finished = descriptors
    .filter((run) => isStoppedRunStatus(run.status))
    .sort((a, b) => orderTime(a.createdAt) - orderTime(b.createdAt));

  const budget = {
    remaining: options.maxEvents ?? SESSION_REPLAY_MAX_EVENTS,
  };
  const runs: SessionReplayRun[] = [];
  let truncated = false;
  for (const run of finished) {
    if (budget.remaining <= 0) {
      truncated = true;
      break;
    }
    const result = await readRunEvents(
      projectId,
      run.runId,
      budget,
      options.signal
    );
    truncated ||= result.truncated;
    const events = result.events
      .filter((event) => event.runId === run.runId)
      .sort((a, b) => a.runSequence - b.runSequence);
    runs.push({ ...run, events });
  }

  return {
    projectId,
    runs,
    events: runs.flatMap((run) => run.events),
    unfinishedRunCount: descriptors.length - finished.length,
    truncated,
  };
}
