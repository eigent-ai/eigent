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
 * The chat task's top-level `fileList` is not kept in sync, so SidePanel
 * must aggregate every known source.
 */
import { isVisibleAgentFile } from '@/lib/agentFileFilters';

type SidePanelOutputTask = {
  taskAssigning?: Agent[];
  taskInfo?: TaskInfo[];
  taskRunning?: TaskInfo[];
  fileList?: FileInfo[];
  messages?: Pick<Message, 'fileList'>[];
};

function outputFileSources(
  task: SidePanelOutputTask | null | undefined
): FileInfo[][] {
  if (!task) return [];
  return [
    task.fileList ?? [],
    ...(task.taskAssigning ?? []).flatMap((agent) =>
      (agent.tasks ?? []).map((assignedTask) => assignedTask.fileList ?? [])
    ),
    ...(task.taskInfo ?? []).map((plannedTask) => plannedTask.fileList ?? []),
    ...(task.taskRunning ?? []).map(
      (runningTask) => runningTask.fileList ?? []
    ),
    ...(task.messages ?? []).map((message) => message.fileList ?? []),
  ];
}

function fileInfoDedupKey(f: FileInfo): string {
  const rel = (f.relativePath ?? '').trim();
  if (rel) return rel;
  const p = (f.path ?? '').trim();
  if (p) return p;
  return (f.name ?? '').trim();
}

export function mergeSidePanelOutputFiles(
  ...sources: FileInfo[][]
): FileInfo[] {
  const seen = new Set<string>();
  const out: FileInfo[] = [];
  for (const f of sources.flat()) {
    if (!isVisibleAgentFile(f)) continue;
    const k = fileInfoDedupKey(f);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

export function collectSidePanelOutputFiles(
  task: SidePanelOutputTask | null | undefined
): FileInfo[] {
  return mergeSidePanelOutputFiles(...outputFileSources(task));
}

/**
 * A stable signal for filesystem refreshes. Unlike the displayed list, this
 * intentionally keeps duplicate references: writing the same path twice is a
 * meaningful change even though the UI still shows a single file row.
 */
export function getSidePanelOutputFilesRevision(
  task: SidePanelOutputTask | null | undefined
): string {
  return JSON.stringify(
    outputFileSources(task).map((files) =>
      files.map((file) => [
        file.relativePath ?? '',
        file.path ?? '',
        file.name ?? '',
        file.size ?? null,
        file.modifiedAt ?? null,
        file.artifactChange ?? '',
      ])
    )
  );
}
