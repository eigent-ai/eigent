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
import type { CanonicalProjectEvent } from '@/lib/projector/types';
import {
  getProjectEventStore,
  type ProjectEventStore,
} from '@/store/projectEventStore';

const PAGE_LIMIT = 500;
const MAX_PAGES = 20;
const DEFAULT_PROJECTION_TIMEOUT_MS = 5_000;
/** Legacy requests replay from zero, so cap the one-shot scan at 10k facts. */
export const MAX_RECONCILIATION_SCAN_EVENTS = PAGE_LIMIT * MAX_PAGES;

type RunEventsPage = {
  run_id?: unknown;
  next_sequence?: unknown;
  has_more?: unknown;
  events?: unknown;
};

export type ReconcileHumanInteractionEventsInput = {
  projectId: string;
  runId: string;
  interactionId: string;
  /** Durable sequence of the request event, not a ChatTimeline row index. */
  afterSequence: number;
  /** Primarily useful for bounded tests; production uses five seconds. */
  projectionTimeoutMs?: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function interactionIdForEvent(event: CanonicalProjectEvent): string | null {
  const payload = record(event.payload);
  const value = payload.interaction_id ?? payload.approval_id;
  return typeof value === 'string' && value ? value : null;
}

function isTerminalInteractionEvent(
  event: CanonicalProjectEvent,
  interactionId: string
): boolean {
  if (interactionIdForEvent(event) !== interactionId) return false;
  return (
    event.eventType === 'interaction.resolved' ||
    event.eventType === 'interaction.expired' ||
    event.eventType === 'interaction.cancelled' ||
    event.eventType === 'interaction.canceled' ||
    event.eventType === 'approval.decided' ||
    event.eventType === 'approval.expired' ||
    event.eventType === 'approval.expired_rejected' ||
    event.eventType === 'approval.cancelled' ||
    event.eventType === 'approval.canceled'
  );
}

function nextCursor(page: RunEventsPage, current: number): number {
  const value = page.next_sequence;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < current
  ) {
    throw new Error('Run event replay returned an invalid next_sequence');
  }
  return value;
}

function waitForProjectedTerminal(
  store: ProjectEventStore,
  input: {
    projectId: string;
    runId: string;
    interactionId: string;
    terminalEventId: string;
    timeoutMs: number;
  }
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: () => void = () => undefined;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      if (timeout) clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };

    const inspect = () => {
      const control = store.getControlSnapshot();
      if (control.projectId !== input.projectId) {
        finish(new Error('Human-control projection changed Project scope'));
        return;
      }
      const interaction = control.interactionById[input.interactionId];
      if (!interaction) return;
      if (
        interaction.projectId !== input.projectId ||
        interaction.runId !== input.runId
      ) {
        finish(
          new Error(
            'Human-control projection returned a cross-scope interaction'
          )
        );
        return;
      }
      if (
        control.seenEventIds[input.terminalEventId] &&
        interaction.status !== 'requested'
      ) {
        finish();
      }
    };

    unsubscribe = store.subscribe(inspect);
    timeout = setTimeout(
      () =>
        finish(
          new Error(
            'Durable lifecycle event was not confirmed by the human-control projection'
          )
        ),
      input.timeoutMs
    );
    inspect();
  });
}

/**
 * Pull the canonical lifecycle facts written by a successful decision POST
 * into the shared ProjectEventStore. The POST response is deliberately not
 * converted into a synthetic resolution event: the durable journal remains
 * the only authority for removing a control from BottomBox.
 */
export async function reconcileHumanInteractionEvents({
  projectId,
  runId,
  interactionId,
  afterSequence,
  projectionTimeoutMs = DEFAULT_PROJECTION_TIMEOUT_MS,
}: ReconcileHumanInteractionEventsInput): Promise<CanonicalProjectEvent> {
  if (!projectId || !runId || !interactionId) {
    throw new Error('Human interaction reconciliation requires durable ids');
  }

  const store = getProjectEventStore(projectId);
  let cursor = Math.max(0, Math.floor(afterSequence));
  let scannedEvents = 0;
  const timeoutMs =
    Number.isFinite(projectionTimeoutMs) && projectionTimeoutMs > 0
      ? projectionTimeoutMs
      : DEFAULT_PROJECTION_TIMEOUT_MS;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    const rawPage = (await fetchGet(
      `/runs/${encodeURIComponent(runId)}/events`,
      {
        after_sequence: cursor,
        limit: PAGE_LIMIT,
      }
    )) as RunEventsPage;

    if (rawPage.run_id !== undefined && rawPage.run_id !== runId) {
      throw new Error('Run event replay returned a different Run');
    }
    if (!Array.isArray(rawPage.events)) {
      throw new Error('Run event replay did not return an events array');
    }
    scannedEvents += rawPage.events.length;
    if (scannedEvents > MAX_RECONCILIATION_SCAN_EVENTS) {
      throw new Error(
        `Human interaction reconciliation exceeded the bounded ${MAX_RECONCILIATION_SCAN_EVENTS}-event legacy scan; a Project resync is required`
      );
    }

    const events = rawPage.events.map((raw) =>
      normalizeLocalRunEvent(raw, projectId)
    );
    if (events.some((event) => event.projectId !== projectId)) {
      throw new Error('Run event replay contained a cross-Project event');
    }
    if (events.some((event) => event.runId !== runId)) {
      throw new Error('Run event replay contained a cross-Run event');
    }
    if (!store.enqueue(events)) {
      throw new Error('Project event queue rejected the decision lifecycle');
    }

    const terminal = events.find((event) =>
      isTerminalInteractionEvent(event, interactionId)
    );
    if (terminal) {
      await waitForProjectedTerminal(store, {
        projectId,
        runId,
        interactionId,
        terminalEventId: terminal.eventId,
        timeoutMs,
      });
      return terminal;
    }

    if (rawPage.has_more !== true) break;
    if (pageIndex === MAX_PAGES - 1) {
      throw new Error(
        `Human interaction reconciliation exceeded the bounded ${MAX_RECONCILIATION_SCAN_EVENTS}-event legacy scan; a Project resync is required`
      );
    }
    const next = nextCursor(rawPage, cursor);
    if (next <= cursor) {
      throw new Error('Run event replay cursor did not advance');
    }
    cursor = next;
  }

  throw new Error(
    'Decision was accepted but its durable lifecycle event is not available'
  );
}
