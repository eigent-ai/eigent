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
};

const RUNTIME_ONLY_DIRS = new Set(['camel_logs']);

function pathSegments(value: string | undefined): string[] {
  return (value || '').replace(/\\/g, '/').split('/').filter(Boolean);
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

export function filterVisibleAgentFiles<T extends AgentFileLike>(
  files: T[]
): T[] {
  return files.filter((file) => !isRuntimeOnlyAgentFile(file));
}
