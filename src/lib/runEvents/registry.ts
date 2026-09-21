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
import {
  RUN_RECONCILIATION_MARKERS,
  RunStateReconciler,
  TERMINAL_RUN_EVENTS,
} from '@/service/runStateReconciliation';
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
  reconciler: RunStateReconciler;
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
  private readonly runReads = new Map<
    string,
    { reconciler: RunStateReconciler; promise: Promise<void> }
  >();
  private generation = 0;

  ensureLocal(
    projectId: string,
    runId: string,
    options: { reconnect?: boolean } = {}
  ): ActiveIngress {
    const current = this.active.get(runId);
    if (current?.projectId === projectId && current.reconciler.isCurrent())
      return current;
    if (current) this.disconnect(runId);

    const controller = new AbortController();
    const projectEventStore = getProjectEventStore(projectId);
    const incarnation = projectEventStore.getIncarnation();
    const isCurrent = () =>
      !controller.signal.aborted &&
      this.active.get(runId)?.controller === controller &&
      projectEventStore.isCurrentIncarnation(incarnation);
    const reconciler = new RunStateReconciler(
      projectId,
      runId,
      projectEventStore,
      isCurrent
    );
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
    const entry = {
      projectId,
      runId,
      controller,
      ingress,
      reconciler,
      promise: Promise.resolve(),
    };
    this.active.set(runId, entry);
    const promise = sseTransport({
      url: `/runs/${encodeURIComponent(runId)}/stream?after_sequence=${lastSequence}`,
      method: 'GET',
      signal: controller.signal,
      openWhenHidden: true,
      async onopen(response) {
        if (!isCurrent()) return;
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.startsWith('text/event-stream')) {
          throw new RunEventStreamError(
            response.status,
            `Run event stream returned HTTP ${response.status}`
          );
        }
        openCount += 1;
        if (openCount > 1) {
          replaying = true;
          void reconciler.request();
        }
      },
      async onmessage(message) {
        if (!isCurrent()) return;
        if (RUN_RECONCILIATION_MARKERS.has(message.event))
          void reconciler.request();
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
        projectEventStore.enqueue({
          ...projectEvent,
          raw: null,
        });
        if (TERMINAL_RUN_EVENTS.has(projectEvent.eventType))
          void reconciler.request();
      },
      onerror(error) {
        if (controller.signal.aborted) throw error;
        if (!isCurrent()) throw error;
        void reconciler.request();
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
      onclose() {
        void reconciler.request();
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
      .finally(async () => {
        await reconciler.request();
        reconciler.dispose();
        if (this.active.get(runId)?.controller === controller) {
          this.active.delete(runId);
        }
      });

    entry.promise = promise;
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
    current.reconciler.dispose();
    current.controller.abort();
  }

  /** Compatibility stream boundaries share the canonical owner when present. */
  reconcileRun(projectId: string, runId: string): Promise<void> {
    const current = this.active.get(runId);
    if (current?.projectId === projectId && current.reconciler.isCurrent())
      return current.reconciler.request();
    const key = `${projectId}\u0000${runId}`;
    const pending = this.runReads.get(key);
    if (pending?.reconciler.isCurrent()) {
      // Keep the later boundary while sharing this owner's cleanup promise.
      void pending.reconciler.request();
      return pending.promise;
    }
    pending?.reconciler.dispose();
    const generation = this.generation;
    const reconciler = new RunStateReconciler(
      projectId,
      runId,
      getProjectEventStore(projectId),
      () => this.generation === generation
    );
    const promise = reconciler.request().finally(() => {
      reconciler.dispose();
      if (this.runReads.get(key)?.reconciler === reconciler)
        this.runReads.delete(key);
    });
    this.runReads.set(key, { reconciler, promise });
    return promise;
  }

  has(runId: string): boolean {
    return this.active.get(runId)?.reconciler.isCurrent() ?? false;
  }

  activeCount(): number {
    return this.active.size;
  }

  reconcileProject(projectId: string): Promise<void> {
    const existing = this.reconciliations.get(projectId);
    if (existing) return existing;
    const generation = this.generation;
    const store = getProjectEventStore(projectId);
    const incarnation = store.getIncarnation();
    const promise = (async () => {
      const response = await fetchGet('/runs', {
        project_id: projectId,
        limit: 100,
      });
      if (
        this.generation !== generation ||
        !store.isCurrentIncarnation(incarnation) ||
        (response?.project_id && response.project_id !== projectId)
      )
        return;
      const runs = Array.isArray(response?.runs)
        ? (response.runs as DurableRunSummaryInput[]).filter(
            (run) =>
              run &&
              run.project_id === projectId &&
              typeof run.run_id === 'string'
          )
        : [];
      store.flushAll();
      for (const run of runs) {
        if (run.project_id !== projectId) continue;
        const knownRuns = [
          store.getSnapshot().view.runs[run.run_id],
          runProjectionStore.getRun(projectId, run.run_id),
        ];
        if (
          knownRuns.some(
            (known) =>
              known &&
              (!Number.isSafeInteger(run.version) ||
                run.version! < known.runVersion ||
                (run.version === known.runVersion &&
                  known.status !== 'unknown' &&
                  run.status !== known.status))
          )
        )
          continue;
        store.reconcileRunSummary(run, incarnation);
        runProjectionStore.upsertRunSummaries(projectId, [run]);
        const latest = runProjectionStore.getRun(projectId, run.run_id);
        if (
          latest?.origin === 'local' &&
          !latest.resumeBlockedReason &&
          ['pending', 'running', 'waiting_for_user', 'cancelling'].includes(
            latest.status
          )
        ) {
          this.ensureLocal(projectId, run.run_id, { reconnect: true });
        } else this.disconnect(run.run_id);
      }
      // Absence from the bounded /runs listing is never evidence of termination.
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
    this.generation += 1;
    for (const read of this.runReads.values()) read.reconciler.dispose();
    this.runReads.clear();
    for (const runId of [...this.active.keys()]) this.disconnect(runId);
    this.reconciliations.clear();
  }
}

export const runEventIngressRegistry = new RunEventIngressRegistry();
