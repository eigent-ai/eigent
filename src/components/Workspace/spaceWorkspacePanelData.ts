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

import type { Space } from '@/store/spaceStore';
import type { HistoryTask } from '@/types/history';

export type SpaceContentCategory =
  'Documents' | 'Code' | 'Data' | 'Media' | 'Other';

export function hasUserBoundLocalFolder(space: Space | null | undefined) {
  if (!space) return false;
  if (space.sourceType === 'folder') return true;
  return (
    space.metadata?.bindingSource === 'space_local_brain' &&
    space.metadata?.localWorkspaceSource !== 'scratch_space'
  );
}

const DOCUMENT_EXTENSIONS = new Set([
  'doc',
  'docx',
  'md',
  'pdf',
  'ppt',
  'pptx',
  'rtf',
  'txt',
]);
const CODE_EXTENSIONS = new Set([
  'c',
  'cpp',
  'css',
  'go',
  'html',
  'java',
  'js',
  'jsx',
  'kt',
  'php',
  'py',
  'rb',
  'rs',
  'sh',
  'swift',
  'ts',
  'tsx',
  'vue',
]);
const DATA_EXTENSIONS = new Set([
  'csv',
  'json',
  'parquet',
  'sql',
  'tsv',
  'xls',
  'xlsx',
  'xml',
  'yaml',
  'yml',
]);
const MEDIA_EXTENSIONS = new Set([
  'aac',
  'avi',
  'gif',
  'jpeg',
  'jpg',
  'm4a',
  'mov',
  'mp3',
  'mp4',
  'png',
  'svg',
  'wav',
  'webm',
  'webp',
]);

export function categorizeSpaceFile(filename: string): SpaceContentCategory {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'Documents';
  if (CODE_EXTENSIONS.has(extension)) return 'Code';
  if (DATA_EXTENSIONS.has(extension)) return 'Data';
  if (MEDIA_EXTENSIONS.has(extension)) return 'Media';
  return 'Other';
}

export function getSpaceAgeInDays(createdAt: number, now = Date.now()) {
  if (!Number.isFinite(createdAt) || createdAt <= 0 || createdAt > now) {
    return 1;
  }
  return Math.max(1, Math.ceil((now - createdAt) / (24 * 60 * 60 * 1000)));
}

export function getSpaceSummaryVariantIndex(spaceId: string) {
  let hash = 0;
  for (const character of spaceId) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % 3;
}

function buildDayActivity(
  tasks: Pick<HistoryTask, 'created_at' | 'updated_at'>[],
  dayCount: number,
  now = Date.now()
) {
  const localDayKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(startOfToday);
    date.setDate(startOfToday.getDate() - (dayCount - 1 - index));
    return {
      key: localDayKey(date),
      label: new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(
        date
      ),
      shortLabel: new Intl.DateTimeFormat(undefined, {
        month: 'numeric',
        day: 'numeric',
      }).format(date),
      count: 0,
    };
  });
  const countsByKey = new Map(days.map((day) => [day.key, day]));

  tasks.forEach((task) => {
    const timestamp = task.created_at ?? task.updated_at;
    if (!timestamp) return;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return;
    const key = localDayKey(date);
    const day = countsByKey.get(key);
    if (day) day.count += 1;
  });

  return days;
}

export function buildSevenDayActivity(
  tasks: Pick<HistoryTask, 'created_at' | 'updated_at'>[],
  now = Date.now()
) {
  return buildDayActivity(tasks, 7, now);
}

export function buildThirtyDayActivity(
  tasks: Pick<HistoryTask, 'created_at' | 'updated_at'>[],
  now = Date.now()
) {
  return buildDayActivity(tasks, 30, now);
}
