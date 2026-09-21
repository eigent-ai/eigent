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

import { generateUniqueId } from '@/lib';
import type { DurableRunSummaryInput } from '@/lib/projector/runSummary';

export type ResumeRequestOwner = {
  accountKey: string;
  projectId: string;
  runId: string;
};

type ResumeRequest = {
  requestId: string;
  afterAttemptNumber: number;
};

const fallback = new Map<string, ResumeRequest>();
const volatile = new Set<string>();
const active = new Set<string>();
const listeners = new Set<() => void>();
let revision = 0;
const keyFor = (owner: ResumeRequestOwner) =>
  `eigent:resume:${JSON.stringify([owner.accountKey, owner.projectId, owner.runId])}`;

function changed() {
  revision += 1;
  listeners.forEach((listener) => listener());
}

export const subscribeResumeRequests = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const resumeRequestsRevision = () => revision;

function read(owner: ResumeRequestOwner): ResumeRequest | null {
  const key = keyFor(owner);
  if (volatile.has(key)) return fallback.get(key) ?? null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) ?? 'null');
    return value &&
      typeof value.requestId === 'string' &&
      Number.isSafeInteger(value.afterAttemptNumber) &&
      value.afterAttemptNumber > 0
      ? value
      : null;
  } catch {
    return fallback.get(key) ?? null;
  }
}

/** Retain the identity across unknown/failed ACKs, including renderer reloads. */
export function beginResumeRequest(
  owner: ResumeRequestOwner,
  run: DurableRunSummaryInput
): string {
  const key = keyFor(owner);
  const previous = read(owner);
  const latest = run.latest_attempt;
  // A canonical ended Attempt proves that the earlier request cannot execute
  // again. An unchanged interruption or missing ACK provides no such proof.
  const previousEnded =
    previous &&
    latest &&
    latest.attempt_number > previous.afterAttemptNumber &&
    ['interrupted', 'completed', 'failed', 'cancelled'].includes(latest.status);
  const request =
    previous && !previousEnded
      ? previous
      : {
          requestId: `resume:${owner.runId}:${generateUniqueId()}`,
          afterAttemptNumber: latest?.attempt_number ?? 1,
        };
  fallback.set(key, request);
  try {
    window.sessionStorage.setItem(key, JSON.stringify(request));
    volatile.delete(key);
  } catch {
    // Storage-disabled windows still retain the identity in memory.
    volatile.add(key);
  }
  active.add(key);
  changed();
  return request.requestId;
}

/** Finish only the captured owner/request, never the current account's ticket. */
export function finishResumeRequest(
  owner: ResumeRequestOwner,
  requestId: string,
  accepted: boolean
) {
  if (read(owner)?.requestId !== requestId) return;
  const key = keyFor(owner);
  active.delete(key);
  if (accepted) {
    fallback.delete(key);
    try {
      window.sessionStorage.removeItem(key);
      volatile.delete(key);
    } catch {
      volatile.add(key);
    }
  }
  changed();
}

/** A failed local Resume may own one pending Attempt, never arbitrary work. */
export function pendingResumeRequest(
  owner: ResumeRequestOwner,
  run: DurableRunSummaryInput
): string | null {
  const request = read(owner);
  return request &&
    !active.has(keyFor(owner)) &&
    run.run_id === owner.runId &&
    run.project_id === owner.projectId &&
    run.origin !== 'cloud_restore' &&
    !run.resume_blocked_reason &&
    run.status === 'pending' &&
    run.latest_attempt?.status === 'pending' &&
    run.latest_attempt.attempt_number > request.afterAttemptNumber &&
    run.latest_attempt.resume_request_id === request.requestId
    ? request.requestId
    : null;
}
