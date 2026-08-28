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
  hasSpaceScopedFileRoot,
  type SpaceFileRootSource,
} from '@/lib/spaceLabel';

export type SpaceContentCategory =
  'Documents' | 'Code' | 'Data' | 'Media' | 'Other';

/** Stable render order so the stacked bar and its legend never reshuffle. */
export const SPACE_CONTENT_CATEGORY_ORDER: SpaceContentCategory[] = [
  'Documents',
  'Code',
  'Data',
  'Media',
  'Other',
];

/**
 * Brain caps a single `/files` listing at 500 entries
 * (`list_files(max_entries=500)`), so a response at the cap means "at least
 * this many" rather than an exact total.
 */
export const SPACE_FILE_LISTING_LIMIT = 500;

export type SpaceFileScope = 'space-root' | 'per-project';

export interface SpaceFileTargets {
  scope: SpaceFileScope;
  ids: string[];
}

/**
 * Ordered `/files` attempts for a Space, most authoritative first.
 *
 * A bound Space is listed once by Space id. The per-Project fan-out is kept as
 * a fallback because the binding lives in Brain's local store: a Space carrying
 * a `rootPath` synced from another machine can be unbound here, in which case
 * the Space-scoped listing resolves to nothing and each Project still has its
 * own `project_<id>` root.
 */
export function resolveSpaceFileTargets(
  space: SpaceFileRootSource | null | undefined,
  projectIds: string[]
): SpaceFileTargets[] {
  if (!space) return [];
  const perProject: SpaceFileTargets[] = projectIds.length
    ? [{ scope: 'per-project', ids: projectIds }]
    : [];
  if (hasSpaceScopedFileRoot(space)) {
    return [{ scope: 'space-root', ids: [space.id] }, ...perProject];
  }
  return perProject;
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
