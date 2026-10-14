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

import { fetchDelete, fetchPost } from '@/api/http';
import {
  cancelSessionExecution,
  executionScope,
  fetchSessionExecutionRoute,
  fetchSessionExecutions,
  type ExecutionScope,
  type SessionExecutionRequest,
} from '@/service/executionApi';
import {
  cancelFollowUpRequest,
  invalidatePendingFollowUps,
  listPendingFollowUpRequests,
} from '@/service/followUpQueueApi';
import {
  cancelProjectRun,
  fetchActiveProjectRuns,
} from '@/service/projectRunsApi';
import { assessCloseRunState } from '@/service/runCloseGuard';

const STOP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const SETTLE_GRACE_MS = 1_000;

/** The Session may still be running; nothing has been cleaned up. */
export class SessionStopError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Session could not be stopped', options);
    this.name = 'SessionStopError';
  }
}

function ignoreEnded(error: unknown) {
  const status = (error as { status?: number })?.status;
  if (status !== 404 && status !== 409) throw error;
}

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    });
    work.then(resolve, reject);
  });
}

function delay(ms: number, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return untilAborted(
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
    signal
  ).finally(() => clearTimeout(timer));
}

async function openManagedExecutions(scope: ExecutionScope) {
  const open: SessionExecutionRequest[] = [];
  let cursor: number | null = 0;
  while (cursor !== null) {
    const page = await fetchSessionExecutions(scope, cursor);
    open.push(
      ...page.items.filter(
        (request) =>
          request.status !== 'cancelled' && request.settlement !== 'settled'
      )
    );
    cursor = page.next_cursor;
  }
  return open;
}

async function requestSessionStop(projectId: string, signal: AbortSignal) {
  const scope = { ...executionScope(projectId), signal };
  const route = await fetchSessionExecutionRoute(scope);
  if (route.route === 'managed') {
    const open = await openManagedExecutions(scope);
    await Promise.all(
      open.map((request) =>
        cancelSessionExecution(scope, request.request_id).catch(ignoreEnded)
      )
    );
    return;
  }

  invalidatePendingFollowUps(projectId);
  const followUps = await listPendingFollowUpRequests(projectId);
  await Promise.all(
    followUps.map((followUp) =>
      cancelFollowUpRequest(projectId, followUp.request_id).catch(ignoreEnded)
    )
  );
  // Run cancel awaits the execution; 404/409 mean the Run already ended.
  // The idempotent request id is resent on every delete retry and the Run
  // poll below is the gate, so this bypasses the control recovery registry.
  const { runs = [] } = await fetchActiveProjectRuns(projectId, signal, 100);
  await Promise.all(
    runs.flatMap((run) =>
      typeof run.run_id === 'string'
        ? [
            cancelProjectRun(
              run.run_id,
              `session-delete:${run.run_id}`,
              'session_deleted',
              (url, body) => fetchPost(url, body)
            ).catch(ignoreEnded),
          ]
        : []
    )
  );
  // Tear down the legacy TaskLock; the Run poll below is the real gate.
  await fetchDelete(`/chat/${encodeURIComponent(projectId)}`).catch(
    () => undefined
  );
}

/**
 * Stop every queued and active Run of a Session and wait until the canonical
 * Run registry reports none. Throws `SessionStopError` on timeout or failure,
 * in which case callers must not start any cleanup.
 */
export async function stopSessionAndWait(
  projectId: string,
  timeoutMs = STOP_TIMEOUT_MS
): Promise<void> {
  const controller = new AbortController();
  const { signal } = controller;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await untilAborted(requestSessionStop(projectId, signal), signal);
    while (
      (await untilAborted(
        assessCloseRunState({
          projectIds: [projectId],
          legacyActive: false,
          signal,
        }),
        signal
      )) !== 'idle'
    ) {
      await delay(POLL_INTERVAL_MS, signal);
    }
    await delay(SETTLE_GRACE_MS, signal);
  } catch (error) {
    throw new SessionStopError({ cause: error });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
