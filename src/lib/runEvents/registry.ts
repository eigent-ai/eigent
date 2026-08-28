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
// Licensed under the Apache License, Version 2.0 (the "License");

import { fetchGet, sseTransport } from '@/api/http';
import { normalizeLocalRunEvent } from '@/lib/projector';
import { getProjectEventStore } from '@/store/projectEventStore';
import { RunEventIngress } from './ingress';
import {
  runProjectionStore,
  type DurableRunSummaryInput,
} from './projectionStore';
import type { RunEventDeliveryMode } from './types';

type ActiveIngress = {
  projectId: string;
  runId: string;
  controller: AbortController;
  ingress: RunEventIngress;
  promise: Promise<void>;
};

class RunEventStreamError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** Application-level connection owner: at most one local SSE per Run. */
export class RunEventIngressRegistry {
  private readonly active = new Map<string, ActiveIngress>();
  private readonly reconciliations = new Map<string, Promise<void>>();

  ensureLocal(
    projectId: string,
    runId: string,
    options: { reconnect?: boolean } = {}
  ): ActiveIngress {
    const current = this.active.get(runId);
    if (current?.projectId === projectId) return current;
    if (current) this.disconnect(runId);

    const controller = new AbortController();
    const ingress = new RunEventIngress(projectId, runId);
    // One owned stream now feeds both RunProjectionStore and the Project event
    // timeline. Resume from the older watermark so neither consumer can miss a
    // prefix that the other one happened to hydrate first; both stores dedupe
    // replayed event IDs independently.
    const runProjectionSequence =
      runProjectionStore.getRun(projectId, runId)?.lastSequence || 0;
    const projectTimelineSequence =
      getProjectEventStore(projectId).getSnapshot().view.runs[runId]
        ?.lastSequence || 0;
    const lastSequence = Math.min(
      runProjectionSequence,
      projectTimelineSequence
    );
    let replaying = Boolean(options.reconnect || lastSequence > 0);
    let openCount = 0;
    let failures = 0;
    const promise = sseTransport({
      url: `/runs/${encodeURIComponent(runId)}/stream?after_sequence=${lastSequence}`,
      method: 'GET',
      signal: controller.signal,
      openWhenHidden: true,
      async onopen(response) {
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.startsWith('text/event-stream')) {
          throw new RunEventStreamError(
            response.status,
            `Run event stream returned HTTP ${response.status}`
          );
        }
        openCount += 1;
        if (openCount > 1) replaying = true;
      },
      async onmessage(message) {
        if (message.event === 'replay_caught_up') {
          replaying = false;
          runProjectionStore.completeResync(projectId);
          return;
        }
        if (message.event !== 'run_event') return;
        const raw = JSON.parse(message.data);
        ingress.ingest(raw, replaying ? 'reconnect_catch_up' : 'live');

        // The application already owns this canonical Run stream. Feed the
        // same durable envelope into the Project event projection so ChatBox
        // can correlate approval:<toolCallId> with the prepared Tool row while
        // the approval is still pending. Previously this stream updated only
        // runProjectionStore, leaving Normal mode with a legacy ASK and no
        // canonical Tool identity until after the user decided.
        const projectEvent = normalizeLocalRunEvent(raw, projectId);
        getProjectEventStore(projectId).enqueue({
          ...projectEvent,
          raw: null,
        });
      },
      onerror(error) {
        if (controller.signal.aborted) throw error;
        failures += 1;
        if (
          error instanceof RunEventStreamError &&
          error.status === 404 &&
          failures > 5
        ) {
          throw error;
        }
        return Math.min(15_000, 250 * 2 ** Math.min(failures, 6));
      },
    })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn('[RunEventIngressRegistry] stream stopped', {
            projectId,
            runId,
            error,
          });
        }
      })
      .finally(() => {
        if (this.active.get(runId)?.controller === controller) {
          this.active.delete(runId);
        }
      });

    const entry = { projectId, runId, controller, ingress, promise };
    this.active.set(runId, entry);
    return entry;
  }

  ingest(
    projectId: string,
    runId: string,
    raw: unknown,
    deliveryMode: RunEventDeliveryMode
  ): { applied: boolean; gapDetected: boolean } {
    const current = this.active.get(runId);
    const ingress =
      current?.projectId === projectId
        ? current.ingress
        : new RunEventIngress(projectId, runId);
    return ingress.ingest(raw, deliveryMode);
  }

  disconnect(runId: string): void {
    const current = this.active.get(runId);
    if (!current) return;
    this.active.delete(runId);
    current.controller.abort();
  }

  has(runId: string): boolean {
    return this.active.has(runId);
  }

  activeCount(): number {
    return this.active.size;
  }

  reconcileProject(projectId: string): Promise<void> {
    const existing = this.reconciliations.get(projectId);
    if (existing) return existing;
    const promise = (async () => {
      const response = await fetchGet('/runs', {
        project_id: projectId,
        limit: 100,
      });
      const runs = Array.isArray(response?.runs)
        ? (response.runs as DurableRunSummaryInput[])
        : [];
      runProjectionStore.upsertRunSummaries(projectId, runs);
      const returnedRunIds = new Set(runs.map((run) => run.run_id));
      for (const run of runs) {
        if (run.status === 'running') {
          this.ensureLocal(projectId, run.run_id, { reconnect: true });
        } else this.disconnect(run.run_id);
      }
      for (const [runId, active] of this.active) {
        if (active.projectId === projectId && !returnedRunIds.has(runId)) {
          this.disconnect(runId);
        }
      }
    })().finally(() => {
      if (this.reconciliations.get(projectId) === promise) {
        this.reconciliations.delete(projectId);
      }
    });
    this.reconciliations.set(projectId, promise);
    return promise;
  }

  replayRun(projectId: string, runId: string): Promise<void> {
    const current = this.active.get(runId);
    if (current) this.disconnect(runId);
    return this.ensureLocal(projectId, runId, { reconnect: true }).promise;
  }

  clear(): void {
    for (const runId of [...this.active.keys()]) this.disconnect(runId);
    this.reconciliations.clear();
  }
}

export const runEventIngressRegistry = new RunEventIngressRegistry();
