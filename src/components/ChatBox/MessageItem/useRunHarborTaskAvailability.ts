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

import {
  fetchRunHarborTaskAvailability,
  type RunHarborTaskAvailability,
  type RunHarborTaskUnavailableReason,
} from '@/service/workspaceGitApi';
import { useSpaceStore } from '@/store/spaceStore';
import { useEffect, useState } from 'react';

const AVAILABILITY_RETRY_MS = 1500;
const AVAILABILITY_RETRIES = 3;

// A Task's Git boundary is written while it finishes, so a Task that has just
// completed can briefly report these reasons before it becomes available.
const SETTLING_REASONS = new Set<RunHarborTaskUnavailableReason>([
  'run_not_completed',
  'run_git_not_finalized',
]);

// Runs already known to be savable, so remounted cards skip the request, and
// the checks in flight, so the actions beside each other share one.
const availableRunIds = new Set<string>();
const inflight = new Map<string, Promise<RunHarborTaskAvailability>>();

/** Test seam: the cache outlives a render tree, so suites must reset it. */
export function resetHarborTaskAvailabilityCache(): void {
  availableRunIds.clear();
  inflight.clear();
}

function checkAvailability(runId: string) {
  let request = inflight.get(runId);
  if (!request) {
    request = fetchRunHarborTaskAvailability(runId).finally(() => {
      inflight.delete(runId);
    });
    inflight.set(runId, request);
  }
  return request;
}

interface RunHarborTaskAvailabilityInput {
  runId?: string;
  projectId?: string | null;
  /** Availability is checked only once the Task has completed. */
  completed: boolean;
}

/**
 * Whether a completed Task can be saved as a Harbor task: it changed files
 * that Eigent recorded in its Git history. Unknown availability is false.
 */
export function useRunHarborTaskAvailability({
  runId,
  projectId,
  completed,
}: RunHarborTaskAvailabilityInput) {
  const spaceId = useSpaceStore((state) =>
    projectId ? (state.getProjectMeta(projectId)?.spaceId ?? null) : null
  );
  const eligible =
    completed && !!runId && !!spaceId && !spaceId.startsWith('legacy_');
  const [available, setAvailable] = useState(
    () => eligible && availableRunIds.has(runId!)
  );

  useEffect(() => {
    if (!eligible || !runId) {
      setAvailable(false);
      return;
    }
    if (availableRunIds.has(runId)) {
      setAvailable(true);
      return;
    }
    setAvailable(false);
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const check = (attempt: number) => {
      checkAvailability(runId)
        .then((result) => {
          if (cancelled) return;
          if (result.available) {
            availableRunIds.add(runId);
            setAvailable(true);
          } else if (
            result.reason &&
            SETTLING_REASONS.has(result.reason) &&
            attempt < AVAILABILITY_RETRIES
          ) {
            retry = setTimeout(() => check(attempt + 1), AVAILABILITY_RETRY_MS);
          }
        })
        .catch(() => {
          // Unknown availability keeps the actions hidden.
        });
    };
    check(0);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [eligible, runId]);

  return { available: eligible && available, spaceId };
}
