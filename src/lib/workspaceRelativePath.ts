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

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

/**
 * Return a display path scoped to the current workspace root.
 * Absolute local paths and remote preview URLs are intentionally never shown.
 */
export function getWorkspaceRelativeFilePath(file: FileInfo): string {
  const relativePath = normalizeRelativePath((file.relativePath || '').trim());
  const relativeSegments = relativePath.split('/').filter(Boolean);
  if (
    relativePath &&
    !relativePath.startsWith('/') &&
    !/^[A-Za-z]:\//.test(relativePath) &&
    !relativePath.includes('://') &&
    !relativeSegments.includes('..')
  ) {
    return relativePath;
  }

  if (file.name?.trim()) return file.name.trim();

  const normalizedPath = (file.path || '').replace(/\\/g, '/');
  const withoutQuery = normalizedPath.split(/[?#]/, 1)[0];
  return withoutQuery.split('/').filter(Boolean).pop() || 'File';
}
