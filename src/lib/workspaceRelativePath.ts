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
 * Normalize a backend-owned workspace-relative file identity.
 *
 * This deliberately rejects absolute paths, URLs and traversal instead of
 * guessing a relative path from a local machine path or basename.
 */
export function normalizeWorkspaceRelativePath(
  value: string | null | undefined
): string | null {
  const normalized = normalizeRelativePath((value || '').trim());
  if (!normalized || normalized.startsWith('/')) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) return null;

  const segments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      decoded.includes('\0')
    ) {
      return null;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join('/') : null;
}

function isWindowsDrivePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * Turn a portable workspace-relative identity into a local preview path.
 * Rejects URLs, absolute relatives, and traversal. The Electron preview
 * loader still authorizes the result against registered Space roots.
 */
export function resolveWorkspaceFilePath(
  workspaceRoot: string | null | undefined,
  relativePath: string | null | undefined
): string {
  const root = (workspaceRoot || '').trim();
  const relative = normalizeWorkspaceRelativePath(relativePath);
  if (!root || !relative) return '';
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(root) && !isWindowsDrivePath(root)) {
    return '';
  }

  const usesBackslash = root.includes('\\') && !root.includes('/');
  const separator = usesBackslash ? '\\' : '/';
  const trimmedRoot = root.replace(/[/\\]+$/, '');
  return `${trimmedRoot}${separator}${
    usesBackslash ? relative.replace(/\//g, '\\') : relative
  }`;
}

/**
 * Return a display path scoped to the current workspace root.
 * Absolute local paths and remote preview URLs are intentionally never shown.
 */
export function getWorkspaceRelativeFilePath(file: FileInfo): string {
  const relativePath = normalizeWorkspaceRelativePath(file.relativePath);
  if (relativePath) {
    const relativeSegments = relativePath.split('/');
    const normalizedName = normalizeRelativePath((file.name || '').trim());
    const basename = relativeSegments.at(-1);
    return normalizedName && basename !== normalizedName
      ? `${relativePath}/${normalizedName}`
      : relativePath;
  }

  if (file.name?.trim()) return file.name.trim();

  const normalizedPath = (file.path || '').replace(/\\/g, '/');
  const withoutQuery = normalizedPath.split(/[?#]/, 1)[0];
  return withoutQuery.split('/').filter(Boolean).pop() || 'File';
}
