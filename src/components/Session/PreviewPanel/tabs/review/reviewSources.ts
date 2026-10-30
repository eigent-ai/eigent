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

import { collectSidePanelOutputFiles } from '@/components/Session/SidePanel/sections/collectSidePanelOutputFiles';
import { taskIdToCreatedMs } from '@/lib/chatTaskIdTime';

/** The slice of a chat store's state the collector needs. */
export interface ReviewChatEntry {
  tasks: Record<
    string,
    Parameters<typeof collectSidePanelOutputFiles>[0] | undefined
  >;
}

function newestTaskId(taskIds: string[]): string | null {
  let latestId: string | null = null;
  let latestCreatedAt = Number.NEGATIVE_INFINITY;
  let latestOrder = -1;
  for (const [order, id] of taskIds.entries()) {
    const createdAt = taskIdToCreatedMs(id);
    if (
      latestId === null ||
      createdAt > latestCreatedAt ||
      (createdAt === latestCreatedAt && order > latestOrder)
    ) {
      latestId = id;
      latestCreatedAt = createdAt;
      latestOrder = order;
    }
  }
  return latestId;
}

/** The current/latest task across every chat store owned by this project. */
export function selectLatestReviewRunId(
  entries: ReviewChatEntry[]
): string | null {
  return newestTaskId(entries.flatMap(({ tasks }) => Object.keys(tasks)));
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * Absolute paths of every file agents wrote in this project (WRITE_FILE
 * events across all turns), deduped and sorted. Backup files the write
 * toolkit creates are not changes themselves and are skipped.
 *
 * Known gap: this is a write log, so it only ever names files an agent wrote.
 * A file that was written and then deleted still shows up (the caller marks a
 * written path that no longer exists as `deleted`), but a file the agent
 * deleted *without* writing it first is invisible to the review tab. Closing
 * that needs a delete event from the file toolkit; the server-backed overlay
 * path already reports deletions authoritatively.
 */
export function collectChangedFilePaths(
  entries: ReviewChatEntry[],
  runId?: string
): string[] {
  const paths = new Set<string>();
  for (const { tasks } of entries) {
    const selectedTasks = runId ? [tasks[runId]] : Object.values(tasks);
    for (const task of selectedTasks) {
      for (const file of collectSidePanelOutputFiles(task)) {
        const raw = (file.path ?? '').trim();
        if (!raw || !isAbsolutePath(raw)) continue;
        const normalized = raw.replace(/\\/g, '/');
        if (/\.\d{8}_\d{6}\.bak$/.test(normalized)) continue;
        paths.add(normalized);
      }
    }
  }
  return Array.from(paths).sort();
}
