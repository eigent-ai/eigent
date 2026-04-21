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

/**
 * Output files from agent runs are stored on each plan subtask under
 * `taskAssigning[].tasks[].fileList` (see `addFileList` on WRITE_FILE).
 * The chat task's top-level `fileList` is not kept in sync, so the side
 * panel must aggregate from assigning agents.
 */
function fileInfoDedupKey(f: FileInfo): string {
  const p = (f.path ?? '').trim();
  if (p) return p;
  return (f.name ?? '').trim() || 'unknown';
}

export function collectSidePanelOutputFiles(
  task:
    | {
        taskAssigning?: Agent[];
        fileList?: FileInfo[];
      }
    | null
    | undefined
): FileInfo[] {
  if (!task) return [];
  const nested = (task.taskAssigning ?? []).flatMap((agent) =>
    agent.tasks.flatMap((t) => t.fileList ?? [])
  );
  const top = task.fileList ?? [];
  const seen = new Set<string>();
  const out: FileInfo[] = [];
  for (const f of [...top, ...nested]) {
    const k = fileInfoDedupKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}
