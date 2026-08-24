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

import { fetchGet, fetchPost } from '@/api/http';

export type ProjectRunsResponse = {
  project_id?: unknown;
  runs?: Array<{
    run_id?: unknown;
    status?: unknown;
    total_attempt_elapsed_ms?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
    [key: string]: unknown;
  }>;
  has_more?: unknown;
  cloud_restore_pending?: unknown;
};

type RunControlRequest = (
  url: string,
  data: { request_id: string; reason: string }
) => Promise<unknown>;

type InFlightProjectRunsRequest = {
  controller: AbortController;
  request: Promise<ProjectRunsResponse>;
  settled: boolean;
  subscribers: number;
};

const inFlightProjectRuns = new Map<string, InFlightProjectRunsRequest>();

export const ACTIVE_DURABLE_RUN_STATUSES = [
  'pending',
  'running',
  'waiting_for_user',
] as const;

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  // DOMException can come from a different browser/jsdom realm and therefore
  // fail `instanceof Error`. Preserve its semantic name so a hydration
  // deadline remains retryable instead of looking like navigation cleanup.
  if (
    signal.reason &&
    typeof signal.reason === 'object' &&
    'name' in signal.reason &&
    'message' in signal.reason
  ) {
    const error = new Error(String(signal.reason.message));
    error.name = String(signal.reason.name);
    return error;
  }
  return new DOMException('Project Run loading was aborted', 'AbortError');
}

function waitForCaller<T>(
  request: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(abortError(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    request.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

/**
 * Share concurrent canonical Run-list reads for one Project.
 *
 * The legacy Project projection and the event-native projection hydrate at the
 * same time while the migration flag is enabled. They need the same payload,
 * so issuing two identical SQLite reads only adds work and makes first paint
 * wait behind duplicate traffic. Each caller owns only its subscription. The
 * shared HTTP request is aborted once every subscriber has left, which keeps a
 * previous Space from occupying Brain's RunJournal read lane after navigation.
 */
export function fetchProjectRuns(
  projectId: string,
  limit = 100,
  signal?: AbortSignal
): Promise<ProjectRunsResponse> {
  const key = `${projectId}\u0000${limit}`;
  let entry = inFlightProjectRuns.get(key);
  if (!entry) {
    const controller = new AbortController();
    const request = Promise.resolve(
      fetchGet('/runs', { project_id: projectId, limit }, undefined, {
        signal: controller.signal,
      })
    ) as Promise<ProjectRunsResponse>;
    entry = {
      controller,
      request,
      settled: false,
      subscribers: 0,
    };
    inFlightProjectRuns.set(key, entry);
    void request.then(
      () => {
        entry!.settled = true;
        if (inFlightProjectRuns.get(key) === entry) {
          inFlightProjectRuns.delete(key);
        }
      },
      () => {
        entry!.settled = true;
        if (inFlightProjectRuns.get(key) === entry) {
          inFlightProjectRuns.delete(key);
        }
      }
    );
  }

  const subscribedEntry = entry;
  subscribedEntry.subscribers += 1;
  return waitForCaller(subscribedEntry.request, signal).finally(() => {
    subscribedEntry.subscribers = Math.max(0, subscribedEntry.subscribers - 1);
    if (subscribedEntry.settled || subscribedEntry.subscribers > 0) return;
    if (inFlightProjectRuns.get(key) === subscribedEntry) {
      inFlightProjectRuns.delete(key);
    }
    subscribedEntry.controller.abort();
  });
}

/** Read only canonical Runs that still own live execution state. */
export function fetchActiveProjectRuns(
  projectId: string,
  signal?: AbortSignal
): Promise<ProjectRunsResponse> {
  return fetchGet(
    '/runs',
    {
      project_id: projectId,
      status: ACTIVE_DURABLE_RUN_STATUSES,
      limit: 1,
    },
    undefined,
    { signal }
  ) as Promise<ProjectRunsResponse>;
}

/** Cancel one exact durable Run; callers own stable request-id generation. */
export function cancelProjectRun(
  runId: string,
  requestId: string,
  reason: string,
  request: RunControlRequest = fetchPost
): Promise<unknown> {
  return request(`/runs/${encodeURIComponent(runId)}/cancel`, {
    request_id: requestId,
    reason,
  });
}
