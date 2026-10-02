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

import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { runProjectionStore } from '@/lib/runEvents/projectionStore';
import {
  fetchProjectRuns,
  projectRunSummaries,
} from '@/service/projectRunsApi';
import { getAuthStore, useAuthStore } from '@/store/authStore';

type Subscriber = {
  current: () => boolean;
  finish: () => void;
};
type SummaryRead = {
  key: string;
  projectId: string;
  accountKey: string;
  controller: AbortController;
  subscribers: Set<Subscriber>;
  started: boolean;
};

// One renderer-wide lane, including overlapping focus/backend/status refreshes.
// Map insertion order is the queue; equal account/Project reads share a slot.
const reads = new Map<string, SummaryRead>();
let activeReads = 0;
const MAX_ACTIVE_READS = 4;

function forget(read: SummaryRead) {
  if (reads.get(read.key) === read) reads.delete(read.key);
}

function hasCurrentSubscribers(read: SummaryRead): boolean {
  for (const subscriber of read.subscribers) {
    if (!subscriber.current()) subscriber.finish();
  }
  return read.subscribers.size > 0;
}

async function readSummary(read: SummaryRead) {
  const timeout = setTimeout(() => read.controller.abort(), 1200);
  try {
    const response = await fetchProjectRuns(
      read.projectId,
      1,
      read.controller.signal,
      read.accountKey
    );
    if (hasCurrentSubscribers(read)) {
      runProjectionStore.upsertRunSummaries(
        read.projectId,
        projectRunSummaries(read.projectId, response)
      );
    }
  } catch {
    // Offline/unsupported Brain keeps the last known or unknown presentation.
  } finally {
    clearTimeout(timeout);
    forget(read);
    for (const subscriber of read.subscribers) subscriber.finish();
    activeReads--;
    pump();
  }
}

function pump() {
  for (const read of reads.values()) {
    if (read.started) continue;
    if (!hasCurrentSubscribers(read)) {
      forget(read);
      continue;
    }
    if (activeReads >= MAX_ACTIVE_READS) break;
    read.started = true;
    activeReads++;
    void readSummary(read);
  }
}

/** Read bounded summaries, never replay events or acquire an execution/SSE owner. */
export async function refreshSessionNavStatuses(
  projectIds: readonly string[],
  accountKey: string,
  isCurrent: (projectId: string) => boolean,
  signal?: AbortSignal
): Promise<void> {
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  const accountIsCurrent = () =>
    getAccountEnvironmentKey(getAuthStore()) === accountKey;
  const unsubscribe = useAuthStore.subscribe(() => {
    if (!accountIsCurrent()) abort();
  });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted || !accountIsCurrent()) abort();
  try {
    const pending = [...new Set(projectIds)].map((projectId) => {
      const current = () =>
        !lifetime.signal.aborted && accountIsCurrent() && isCurrent(projectId);
      if (!current()) return Promise.resolve();
      const key = JSON.stringify([accountKey, projectId]);
      let read = reads.get(key);
      if (!read) {
        read = {
          key,
          projectId,
          accountKey,
          controller: new AbortController(),
          subscribers: new Set(),
          started: false,
        };
        reads.set(key, read);
      }
      const sharedRead = read;
      return new Promise<void>((resolve) => {
        const subscriber: Subscriber = {
          current,
          finish: () => {
            lifetime.signal.removeEventListener('abort', subscriber.finish);
            sharedRead.subscribers.delete(subscriber);
            if (sharedRead.subscribers.size === 0) {
              forget(sharedRead);
              sharedRead.controller.abort();
            }
            resolve();
          },
        };
        sharedRead.subscribers.add(subscriber);
        lifetime.signal.addEventListener('abort', subscriber.finish, {
          once: true,
        });
      });
    });
    pump();
    await Promise.all(pending);
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', abort);
  }
}
