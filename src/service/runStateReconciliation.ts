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
import type { DurableRunSummaryInput } from '@/lib/projector/runSummary';
import { runProjectionStore } from '@/lib/runEvents/projectionStore';
import type { ProjectEventStore } from '@/store/projectEventStore';

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export const RUN_RECONCILIATION_MARKERS = new Set([
  'runtime_detached',
  'runtime_error',
  'replay_required',
  'replay_caught_up',
]);
export const TERMINAL_RUN_EVENTS = new Set([
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.deadline_reached',
  'run.interrupted',
  'runtime.interrupted',
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseSummary(
  raw: unknown,
  projectId: string,
  runId: string
): DurableRunSummaryInput {
  const value = record(raw);
  if (
    !value ||
    value.project_id !== projectId ||
    value.run_id !== runId ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 0 ||
    ![
      'pending',
      'running',
      'waiting_for_user',
      'cancelling',
      'completed',
      'failed',
      'cancelled',
      'interrupted',
    ].includes(String(value.status)) ||
    !['local', 'cloud_restore', 'remote'].includes(String(value.origin)) ||
    (typeof value.updated_at !== 'number' &&
      typeof value.updated_at !== 'string') ||
    (typeof value.updated_at === 'number'
      ? !Number.isFinite(value.updated_at)
      : !Number.isFinite(Date.parse(value.updated_at))) ||
    (value.resume_blocked_reason != null &&
      typeof value.resume_blocked_reason !== 'string') ||
    (value.total_attempt_elapsed_ms != null &&
      (typeof value.total_attempt_elapsed_ms !== 'number' ||
        !Number.isFinite(value.total_attempt_elapsed_ms) ||
        value.total_attempt_elapsed_ms < 0)) ||
    JSON.stringify(raw).length * 2 > MAX_RESPONSE_BYTES
  )
    throw new Error('Invalid canonical Run snapshot');
  // Older Brain versions expose attempts but not the convenient latest field.
  const latest =
    value.latest_attempt ??
    (Array.isArray(value.attempts) ? value.attempts.at(-1) : undefined);
  if (
    latest != null &&
    (!record(latest) ||
      !Number.isSafeInteger(latest.attempt_number) ||
      latest.attempt_number < 1 ||
      typeof latest.status !== 'string')
  ) {
    throw new Error('Invalid canonical Run attempt');
  }
  return { ...value, latest_attempt: latest } as DurableRunSummaryInput;
}

/** Read-only, exact-Run status reconciliation owned by one stream lifetime. */
export class RunStateReconciler {
  private inFlight: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private disposed = false;
  private requestedAgain = false;
  private readonly incarnation: number;

  constructor(
    private readonly projectId: string,
    private readonly runId: string,
    private readonly store: ProjectEventStore,
    private readonly isOwnerCurrent: () => boolean = () => true
  ) {
    this.incarnation = store.getIncarnation();
  }

  isCurrent(): boolean {
    return (
      !this.disposed &&
      this.store.isCurrentIncarnation(this.incarnation) &&
      this.isOwnerCurrent()
    );
  }

  request(): Promise<void> {
    if (!this.isCurrent()) return Promise.resolve();
    if (this.inFlight) {
      this.requestedAgain = true;
      return this.inFlight;
    }
    const promise = (async () => {
      do {
        this.requestedAgain = false;
        await this.read();
      } while (this.requestedAgain && this.isCurrent());
    })().finally(() => {
      if (this.inFlight === promise) this.inFlight = null;
    });
    this.inFlight = promise;
    return promise;
  }

  private async read(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () =>
          reject(new Error('Canonical Run read cancelled or timed out'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      });
      // Hydration owns its atomic snapshot transaction. Wait outside it so a
      // status GET cannot be overwritten by an older in-flight history read.
      if (this.store.isSnapshotReplacementActive())
        await Promise.race([
          (async () => {
            while (
              this.store.isSnapshotReplacementActive() &&
              this.isCurrent() &&
              !controller.signal.aborted
            ) {
              await new Promise<void>((resolve) => setTimeout(resolve, 50));
            }
          })(),
          aborted,
        ]);
      if (!this.isCurrent() || controller.signal.aborted) return;
      const raw = await Promise.race([
        fetchGet(
          `/runs/${encodeURIComponent(this.runId)}`,
          undefined,
          undefined,
          { signal: controller.signal }
        ),
        aborted,
      ]);
      if (!this.isCurrent() || controller.signal.aborted) return;
      if (this.store.isSnapshotReplacementActive()) {
        this.requestedAgain = true;
        return;
      }
      const summary = parseSummary(raw, this.projectId, this.runId);
      this.store.flushAll();
      const knownRuns = [
        this.store.getSnapshot().view.runs[this.runId],
        runProjectionStore.getRun(this.projectId, this.runId),
      ];
      if (
        knownRuns.some(
          (run) =>
            run &&
            (summary.version! < run.runVersion ||
              (summary.version === run.runVersion &&
                run.status !== 'unknown' &&
                summary.status !== run.status))
        )
      )
        return;
      this.store.reconcileRunSummary(summary, this.incarnation);
      if (!this.isCurrent()) return;
      runProjectionStore.upsertRunSummaries(this.projectId, [summary]);
    } catch {
      // Transport failure is not execution failure. Keep the last canonical
      // facts; the next reconnect/focus/stream boundary can retry this GET.
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      if (this.controller === controller) this.controller = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
  }
}
