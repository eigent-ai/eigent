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
import { useHost } from '@/host';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface DurableRunSummary {
  run_id: string;
  project_id: string;
  status: string;
  updated_at: number;
  origin?: 'local' | 'cloud_restore';
  resume_blocked_reason?: string | null;
  latest_attempt?: {
    attempt_number: number;
    status: string;
  } | null;
}

function sameRunSummary(
  left: DurableRunSummary | null,
  right: DurableRunSummary | null
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.run_id === right.run_id &&
    left.project_id === right.project_id &&
    left.status === right.status &&
    left.updated_at === right.updated_at &&
    left.origin === right.origin &&
    left.resume_blocked_reason === right.resume_blocked_reason &&
    left.latest_attempt?.attempt_number ===
      right.latest_attempt?.attempt_number &&
    left.latest_attempt?.status === right.latest_attempt?.status
  );
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
  const [runsByProject, setRunsByProject] = useState<
    Record<string, DurableRunSummary | null>
  >({});
  const inFlightRef = useRef<{
    projectId: string;
    promise: Promise<void>;
  } | null>(null);
  const run = projectId ? (runsByProject[projectId] ?? null) : null;

  const setRun = useCallback(
    (next: DurableRunSummary | null) => {
      if (!projectId) return;
      setRunsByProject((current) =>
        sameRunSummary(current[projectId] ?? null, next)
          ? current
          : { ...current, [projectId]: next }
      );
    },
    [projectId]
  );

  const refresh = useCallback((): Promise<void> => {
    if (!projectId) {
      return Promise.resolve();
    }

    const existing = inFlightRef.current;
    if (existing?.projectId === projectId) return existing.promise;

    const promise = (async () => {
      try {
        const result = await fetchGet('/runs', {
          project_id: projectId,
          status: 'interrupted',
          limit: 1,
        });
        const next = Array.isArray(result?.runs) ? result.runs[0] : null;
        // Store by Project so a late response can never paint another
        // Project's banner or overwrite its newer result.
        setRunsByProject((current) => {
          const nextRun = next || null;
          return sameRunSummary(current[projectId] ?? null, nextRun)
            ? current
            : { ...current, [projectId]: nextRun };
        });
      } catch (error: any) {
        // Brain can still be booting while the Project shell is visible. Keep
        // the last canonical state until backend-ready/focus retries it.
        if (error?.name !== 'AbortError') {
          console.debug('[RunControl] Run status refresh deferred', error);
        }
      }
    })().finally(() => {
      if (inFlightRef.current?.promise === promise) {
        inFlightRef.current = null;
      }
    });

    inFlightRef.current = { projectId, promise };
    return promise;
  }, [projectId]);

  useEffect(() => {
    void refresh();

    const handleFocus = () => void refresh();
    const handleBackendReady = () => void refresh();
    const ipcRenderer = host?.ipcRenderer;
    window.addEventListener('focus', handleFocus);
    ipcRenderer?.on('backend-ready', handleBackendReady);
    return () => {
      window.removeEventListener('focus', handleFocus);
      ipcRenderer?.off('backend-ready', handleBackendReady);
    };
  }, [host?.ipcRenderer, refresh]);

  return { run, setRun, refresh };
}
