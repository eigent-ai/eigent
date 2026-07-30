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

type AgentFileLike = {
  path?: string;
  relativePath?: string;
  name?: string;
  source?: string;
  isFolder?: boolean;
};

const RUNTIME_ONLY_DIRS = new Set(['camel_logs']);
const TASK_ROOT_NAME_PATTERN =
  /^task_(?:task_)?(?:\d{10,}(?:-\d+)?|[0-9a-f]{12,}(?:-[0-9a-f]{4,})*)$/i;

function pathSegments(value: string | undefined): string[] {
  return (value || '').replace(/\\/g, '/').split('/').filter(Boolean);
}

function basename(value: string | undefined): string {
  const segments = pathSegments(value);
  return segments[segments.length - 1] || '';
}

export function isRuntimeOnlyAgentFile(file: AgentFileLike): boolean {
  if (file.source === 'camel_log') return true;

  const segments = [
    ...pathSegments(file.relativePath),
    ...pathSegments(file.path),
    file.name || '',
  ];

  return segments.some((segment) => RUNTIME_ONLY_DIRS.has(segment));
}

export function isAgentTaskRootEntry(file: AgentFileLike): boolean {
  const name = file.name || basename(file.path);
  if (!TASK_ROOT_NAME_PATTERN.test(name)) return false;

  const relativeSegments = pathSegments(file.relativePath);
  if (relativeSegments.length === 0) return basename(file.path) === name;

  return relativeSegments.length === 1 && relativeSegments[0] === name;
}

export function isVisibleAgentFile(file: AgentFileLike): boolean {
  return (
    !file.isFolder &&
    !isRuntimeOnlyAgentFile(file) &&
    !isAgentTaskRootEntry(file)
  );
}

export function filterVisibleAgentFiles<T extends AgentFileLike>(
  files: T[]
): T[] {
  return files.filter(isVisibleAgentFile);
}
