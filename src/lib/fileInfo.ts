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

/** Lowercased file extension from a name or path, or '' when there is none. */
export function getFileExtension(value?: string): string {
  if (!value) return '';
  const normalized = value.split(/[?#]/)[0];
  const lastSegment = normalized.split(/[\\/]/).pop() || normalized;
  if (!lastSegment.includes('.')) return '';
  return lastSegment.split('.').pop()?.toLowerCase() || '';
}

/** Remove the link-only sandbox scheme before passing a local path to Electron. */
export function normalizeFileInfoPath(path: string): string {
  return path.replace(/^sandbox:(?=(?:[A-Za-z]:)?[\\/])/i, '');
}

/**
 * Build a minimal {@link FileInfo} from a file path (and optional display name),
 * inferring `type` from the extension and `isRemote` from an http(s) prefix.
 * Used to open the inline preview from chat-message file references where only
 * a path/name is available.
 */
export function fileInfoFromPath(path: string, name?: string): FileInfo {
  const normalizedPath = normalizeFileInfoPath(path);
  const cleanName =
    name || normalizedPath.split(/[\\/]/).pop() || normalizedPath;
  return {
    name: cleanName,
    path: normalizedPath,
    type: getFileExtension(cleanName) || getFileExtension(normalizedPath),
    isRemote: /^https?:\/\//i.test(normalizedPath),
  };
}
