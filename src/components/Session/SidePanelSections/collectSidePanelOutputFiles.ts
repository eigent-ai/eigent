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
 * Output files from agent runs can arrive from multiple places:
 * `taskAssigning[].tasks[].fileList` for WRITE_FILE events, `messages[].fileList`
 * for final-summary extraction, and occasionally task-level mirrors.
 * The chat task's top-level `fileList` is not kept in sync, so the side panel
 * must aggregate every known source.
 */
function fileInfoDedupKey(f: FileInfo): string {
  const rel = (f.relativePath ?? '').trim();
  if (rel) return rel;
  const p = (f.path ?? '').trim();
  if (p) return p;
  return (f.name ?? '').trim();
}

export function collectSidePanelOutputFiles(
  task:
    | {
        taskAssigning?: Agent[];
        taskInfo?: TaskInfo[];
        taskRunning?: TaskInfo[];
        fileList?: FileInfo[];
        messages?: Pick<Message, 'fileList'>[];
      }
    | null
    | undefined
): FileInfo[] {
  if (!task) return [];
  const assigned = (task.taskAssigning ?? []).flatMap((agent) =>
    (agent.tasks ?? []).flatMap((t) => t.fileList ?? [])
  );
  const planned = (task.taskInfo ?? []).flatMap((t) => t.fileList ?? []);
  const running = (task.taskRunning ?? []).flatMap((t) => t.fileList ?? []);
  const messages = (task.messages ?? []).flatMap((m) => m.fileList ?? []);
  const top = task.fileList ?? [];
  const seen = new Set<string>();
  const out: FileInfo[] = [];
  for (const f of [...top, ...assigned, ...planned, ...running, ...messages]) {
    const k = fileInfoDedupKey(f);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}
