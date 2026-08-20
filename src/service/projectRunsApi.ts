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

const inFlightProjectRuns = new Map<string, Promise<ProjectRunsResponse>>();

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
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
 * wait behind duplicate traffic. The underlying request deliberately has no
 * caller-owned AbortSignal: cancelling one projection must not cancel the
 * response still needed by the other projection.
 */
export function fetchProjectRuns(
  projectId: string,
  limit = 100,
  signal?: AbortSignal
): Promise<ProjectRunsResponse> {
  const key = `${projectId}\u0000${limit}`;
  let request = inFlightProjectRuns.get(key);
  if (!request) {
    request = Promise.resolve(
      fetchGet('/runs', { project_id: projectId, limit })
    ) as Promise<ProjectRunsResponse>;
    inFlightProjectRuns.set(key, request);
    void request.then(
      () => {
        if (inFlightProjectRuns.get(key) === request) {
          inFlightProjectRuns.delete(key);
        }
      },
      () => {
        if (inFlightProjectRuns.get(key) === request) {
          inFlightProjectRuns.delete(key);
        }
      }
    );
  }
  return waitForCaller(request, signal);
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
