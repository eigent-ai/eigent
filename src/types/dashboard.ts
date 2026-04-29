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

import type { HistoryTask } from './history';

/** Task enriched with project context for the board */
export interface DashboardTask extends HistoryTask {
  project_name: string;
}

/**
 * Board column buckets — ordered as they appear on the board.
 *
 * Numeric status mapping from HistoryTask.status:
 *   0           → todo
 *   1           → in_progress  (running)
 *   2           → done         (completed)
 *   3           → failed
 *   4           → human_review (wait_confirm / human-in-the-loop)
 *   5           → canceled
 *   6           → rework
 *   undefined   → draft        (never submitted)
 */
export type TaskStatusBucket =
  | 'draft'
  | 'todo'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'human_review'
  | 'canceled'
  | 'rework';

/**
 * Board column order — left-to-right visual order (including done & rework).
 */
export const BOARD_COLUMN_ORDER: readonly TaskStatusBucket[] = [
  'draft',
  'todo',
  'in_progress',
  'human_review',
  'done',
  'failed',
  'canceled',
  'rework',
] as const;

/** i18n keys for board bucket labels (`useTranslation`). */
export const TASK_BUCKET_LABEL_KEY: Record<TaskStatusBucket, string> = {
  draft: 'layout.dashboard-draft',
  todo: 'layout.dashboard-todo',
  in_progress: 'layout.dashboard-in-progress',
  done: 'layout.dashboard-done',
  failed: 'layout.failed',
  human_review: 'layout.dashboard-human-review',
  canceled: 'layout.dashboard-canceled',
  rework: 'layout.dashboard-rework',
};

/** Checkbox default: which buckets render as full columns vs the compact strip */
export const DEFAULT_COLUMN_VISIBILITY: Record<TaskStatusBucket, boolean> = {
  draft: true,
  todo: false,
  in_progress: true,
  human_review: true,
  done: true,
  failed: false,
  canceled: false,
  rework: false,
};

export type BoardColumnDef = {
  id: TaskStatusBucket;
  label: string;
  tasks: DashboardTask[];
  hidden?: boolean;
};

/** Normalise numeric HistoryTask.status → board bucket */
export function toBucket(status: number | undefined | null): TaskStatusBucket {
  if (status === undefined || status === null) return 'draft';
  if (status === 0) return 'todo';
  if (status === 1) return 'in_progress';
  if (status === 2) return 'done';
  if (status === 3) return 'failed';
  if (status === 4) return 'human_review';
  if (status === 5) return 'canceled';
  if (status === 6) return 'rework';
  return 'draft';
}
