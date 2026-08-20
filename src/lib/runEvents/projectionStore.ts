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

import {
  completeProjectViewResync,
  createProjectViewState,
  reduceProjectView,
  type ProjectViewState,
  type ProjectedRun,
} from '@/lib/projector';
import type { RunDomainEvent } from './types';

export type DurableRunSummaryInput = {
  run_id: string;
  project_id: string;
  status: string;
  version?: number;
  updated_at: number | string;
  origin?: 'local' | 'cloud_restore' | 'remote';
  resume_blocked_reason?: string | null;
  total_attempt_elapsed_ms?: number | null;
  latest_attempt?: {
    attempt_number: number;
    status: string;
  } | null;
};

export type ProjectionApplyResult = {
  previous: ProjectViewState;
  next: ProjectViewState;
  applied: boolean;
  gapDetected: boolean;
};

const TERMINAL_STATUSES = new Set<ProjectedRun['status']>([
  'completed',
  'failed',
  'cancelled',
]);

function projectedStatus(value: string): ProjectedRun['status'] {
  if (
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'interrupted'
  ) {
    return value;
  }
  return 'running';
}

function isoTimestamp(value: number | string): string {
  if (typeof value === 'number') {
    return new Date(
      value < 10_000_000_000 ? value * 1000 : value
    ).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed)
    ? new Date(0).toISOString()
    : new Date(parsed).toISOString();
}

/** Rebuildable renderer read model. SQLite remains the execution fact source. */
export class RunProjectionStore {
  private readonly projects = new Map<string, ProjectViewState>();
  private readonly listeners = new Map<string, Set<() => void>>();

  getProject(projectId: string): ProjectViewState | null {
    return this.projects.get(projectId) || null;
  }

  getRun(projectId: string, runId: string): ProjectedRun | null {
    return this.projects.get(projectId)?.runs[runId] || null;
  }

  getLatestRun(
    projectId: string,
    predicate: (run: ProjectedRun) => boolean = () => true
  ): ProjectedRun | null {
    const runs = Object.values(this.projects.get(projectId)?.runs || {}).filter(
      predicate
    );
    runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return runs[0] || null;
  }

  apply(event: RunDomainEvent): ProjectionApplyResult {
    const previous =
      this.projects.get(event.projectId) ||
      createProjectViewState(event.projectId, 'live');
    const next = reduceProjectView(previous, event);
    if (next === previous) {
      return { previous, next, applied: false, gapDetected: false };
    }
    this.projects.set(event.projectId, next);
    this.emit(event.projectId);
    return {
      previous,
      next,
      applied: Boolean(next.seenEventIds[event.eventId]),
      gapDetected:
        next.needsResync && next.resyncReason !== previous.resyncReason,
    };
  }

  upsertRunSummaries(
    projectId: string,
    summaries: readonly DurableRunSummaryInput[]
  ): ProjectViewState {
    const previous =
      this.projects.get(projectId) || createProjectViewState(projectId, 'live');
    let changed = !this.projects.has(projectId);
    const runs = { ...previous.runs };
    for (const summary of summaries) {
      if (summary.project_id !== projectId) continue;
      const existing = runs[summary.run_id];
      const incomingStatus = projectedStatus(summary.status);
      // A stale list response must never move a terminal event projection back
      // to running. A newer canonical list result may still repair nonterminal
      // state after renderer restart.
      const status =
        existing &&
        TERMINAL_STATUSES.has(existing.status) &&
        incomingStatus === 'running'
          ? existing.status
          : incomingStatus;
      const nextRun: ProjectedRun = {
        ...existing,
        runId: summary.run_id,
        status,
        lastSequence: existing?.lastSequence || 0,
        runVersion: Math.max(existing?.runVersion || 0, summary.version || 0),
        updatedAt: isoTimestamp(summary.updated_at),
        origin: summary.origin ?? existing?.origin,
        resumeBlockedReason: summary.resume_blocked_reason ?? null,
        latestAttempt: summary.latest_attempt
          ? {
              attemptNumber: summary.latest_attempt.attempt_number,
              status: summary.latest_attempt.status,
            }
          : null,
        totalAttemptElapsedMs: summary.total_attempt_elapsed_ms ?? null,
      };
      if (JSON.stringify(existing) !== JSON.stringify(nextRun)) {
        runs[summary.run_id] = nextRun;
        changed = true;
      }
    }
    if (!changed) return previous;
    const next = { ...previous, runs };
    this.projects.set(projectId, next);
    this.emit(projectId);
    return next;
  }

  replaceProject(projectId: string, state: ProjectViewState): void {
    if (state.projectId !== projectId) {
      throw new Error('Projection project scope mismatch');
    }
    if (this.projects.get(projectId) === state) return;
    this.projects.set(projectId, state);
    this.emit(projectId);
  }

  completeResync(projectId: string): ProjectViewState | null {
    const previous = this.projects.get(projectId);
    if (!previous) return null;
    const next = completeProjectViewResync(previous, previous.currentCursor);
    if (next === previous) return previous;
    this.projects.set(projectId, next);
    this.emit(projectId);
    return next;
  }

  subscribeProject(projectId: string, listener: () => void): () => void {
    let listeners = this.listeners.get(projectId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(projectId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.listeners.delete(projectId);
    };
  }

  clearProject(projectId: string): void {
    if (!this.projects.delete(projectId)) return;
    this.emit(projectId);
  }

  removeRun(projectId: string, runId: string): void {
    const previous = this.projects.get(projectId);
    if (!previous?.runs[runId]) return;
    const runs = { ...previous.runs };
    delete runs[runId];
    this.projects.set(projectId, { ...previous, runs });
    this.emit(projectId);
  }

  clear(): void {
    const projectIds = [...this.projects.keys()];
    this.projects.clear();
    projectIds.forEach((projectId) => this.emit(projectId));
  }

  private emit(projectId: string): void {
    for (const listener of [...(this.listeners.get(projectId) || [])]) {
      try {
        listener();
      } catch (error) {
        console.error('[RunProjectionStore] subscriber failed', error);
      }
    }
  }
}

export const runProjectionStore = new RunProjectionStore();
