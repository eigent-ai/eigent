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

import { useHost } from '@/host';
import { DURABLE_RUN_STATUS_CHANGED_EVENT } from '@/lib/events/durableRunEvents';
import type { ProjectedRun } from '@/lib/projector';
import {
  runEventIngressRegistry,
  runProjectionStore,
  useRunProjectionSelector,
} from '@/lib/runEvents';
import { useCallback, useEffect, useMemo } from 'react';

export interface DurableRunSummary {
  run_id: string;
  project_id: string;
  status: string;
  updated_at: number;
  origin?: 'local' | 'cloud_restore' | 'remote';
  resume_blocked_reason?: string | null;
  latest_attempt?: {
    attempt_number: number;
    status: string;
  } | null;
}

type RunsByProject = Record<string, DurableRunSummary | null>;
type InterruptedRunState = RunsByProject | DurableRunSummary | null;

/**
 * Vite Fast Refresh can preserve the pre-map hook state (a single Run or
 * null) after this hook's state shape changes. Normalize that legacy value so
 * any subsequent ChatBox render remains safe without requiring an app restart.
 */
export function normalizeInterruptedRunState(
  value: InterruptedRunState
): RunsByProject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  if ('run_id' in value && 'project_id' in value) {
    const legacyRun = value as DurableRunSummary;
    return { [legacyRun.project_id]: legacyRun };
  }
  return value as RunsByProject;
}

/**
 * Cloud-restored Runs are historical projections, not actionable local
 * interruptions. Keep their provenance in the journal, but do not surface
 * them through the Resume/Cancel product state.
 */
export function actionableInterruptedRun(
  run: DurableRunSummary | null
): DurableRunSummary | null {
  if (run?.origin === 'cloud_restore') return null;
  // A Run without an Attempt is an abandoned admission, not resumable work.
  // Startup reconciliation terminalizes it; suppress the misleading control
  // during the brief interval before that reconciliation reaches the UI.
  return run?.latest_attempt ? run : null;
}

function projectedRunToDurableSummary(
  projectId: string,
  run: ProjectedRun
): DurableRunSummary {
  return {
    run_id: run.runId,
    project_id: projectId,
    status: run.status,
    updated_at: Date.parse(run.updatedAt) / 1000,
    origin: run.origin ?? undefined,
    resume_blocked_reason: run.resumeBlockedReason,
    latest_attempt: run.latestAttempt
      ? {
          attempt_number: run.latestAttempt.attemptNumber,
          status: run.latestAttempt.status,
        }
      : null,
  };
}

/**
 * Loads interrupted state at lifecycle boundaries instead of polling forever.
 *
 * Startup reconciliation completes before the first Desktop render in the
 * normal path. A Brain restart while the renderer survives emits
 * `backend-ready`; returning to the app emits `focus`. Resume/cancel callers
 * also invoke `refresh` explicitly on errors. Those boundaries cover state
 * changes without a GET every five seconds for every open Project.
 */
export function useInterruptedRunStatus(projectId: string | null) {
  const host = useHost();
  const selectInterrupted = useCallback(
    (state: import('@/lib/projector').ProjectViewState | null) => {
      const interrupted = Object.values(state?.runs || {}).filter(
        (candidate) => candidate.status === 'interrupted'
      );
      interrupted.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      );
      return interrupted[0] || null;
    },
    []
  );
  const projectedRun = useRunProjectionSelector(projectId, selectInterrupted);
  const run = useMemo(
    () =>
      projectedRun && projectId
        ? actionableInterruptedRun(
            projectedRunToDurableSummary(projectId, projectedRun)
          )
        : null,
    [projectId, projectedRun]
  );

  const setRun = useCallback(
    (next: DurableRunSummary | null) => {
      if (!projectId) return;
      if (!next) {
        if (projectedRun) {
          runProjectionStore.removeRun(projectId, projectedRun.runId);
        }
        return;
      }
      runProjectionStore.upsertRunSummaries(projectId, [next]);
    },
    [projectId, projectedRun]
  );

  const refresh = useCallback((): Promise<void> => {
    if (!projectId) return Promise.resolve();
    return runEventIngressRegistry
      .reconcileProject(projectId)
      .catch((error) => {
        // Brain can still be booting while the Project shell is visible. Keep
        // the last canonical state until backend-ready/focus retries it.
        if (error?.name !== 'AbortError') {
          console.debug('[RunControl] Run status refresh deferred', error);
        }
      });
  }, [projectId]);

  useEffect(() => {
    void refresh();

    const handleFocus = () => void refresh();
    const handleBackendReady = () => void refresh();
    const handleDurableRunStatusChanged = (event: Event) => {
      const changedProjectId = (event as CustomEvent<{ projectId?: string }>)
        .detail?.projectId;
      if (!changedProjectId || changedProjectId === projectId) {
        void refresh();
      }
    };
    const ipcRenderer = host?.ipcRenderer;
    window.addEventListener('focus', handleFocus);
    window.addEventListener(
      DURABLE_RUN_STATUS_CHANGED_EVENT,
      handleDurableRunStatusChanged
    );
    ipcRenderer?.on('backend-ready', handleBackendReady);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener(
        DURABLE_RUN_STATUS_CHANGED_EVENT,
        handleDurableRunStatusChanged
      );
      ipcRenderer?.off('backend-ready', handleBackendReady);
    };
  }, [host?.ipcRenderer, projectId, refresh]);

  return { run, setRun, refresh };
}
