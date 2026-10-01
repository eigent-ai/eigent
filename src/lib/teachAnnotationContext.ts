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

import type { TeachFeedback } from '@/store/teachModeStore';

const CONTEXT_OPEN = '\n\n<user_annotation_context format="json">\n';
const CONTEXT_CLOSE = '\n</user_annotation_context>';

/** Keep the user's prose as data, with stable Run and source boundaries. */
export function formatTeachAnnotationContext(
  projectId: string,
  annotations: TeachFeedback[]
): string {
  if (annotations.length === 0) return '';

  const byRun = new Map<string | null, TeachFeedback[]>();
  for (const annotation of annotations) {
    const runId = annotation.runId ?? null;
    const group = byRun.get(runId) ?? [];
    group.push(annotation);
    byRun.set(runId, group);
  }

  const context = {
    type: 'session_annotations',
    session_id: projectId,
    runs: [...byRun].map(([runId, entries]) => ({
      run_id: runId,
      annotations: entries
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt || left.id.localeCompare(right.id)
        )
        .map((entry) => ({
          annotation_id: entry.id,
          source: {
            type: entry.sourceType,
            id: entry.sourceId,
            label: entry.contextLabel,
            ...(entry.contextDetail ? { detail: entry.contextDetail } : {}),
            ...(entry.sourcePath ? { path: entry.sourcePath } : {}),
          },
          ...(entry.selectedText
            ? { selected_output: entry.selectedText }
            : {}),
          comment: entry.comment,
          ...(entry.fileReferences?.length
            ? {
                file_references: entry.fileReferences.map((file) => ({
                  session_id: file.projectId,
                  path: file.relativePath,
                })),
              }
            : {}),
        })),
    })),
  };

  return `${CONTEXT_OPEN}${JSON.stringify(context, null, 2).replace(/</g, '\\u003c')}${CONTEXT_CLOSE}`;
}

/** Render a sent annotation payload like attached context, without losing it. */
export function splitTeachAnnotationContext(content: string): {
  message: string;
  annotationCount: number;
} {
  const start = content.lastIndexOf(CONTEXT_OPEN);
  if (start < 0 || !content.endsWith(CONTEXT_CLOSE))
    return { message: content, annotationCount: 0 };
  try {
    const payload = JSON.parse(
      content.slice(start + CONTEXT_OPEN.length, -CONTEXT_CLOSE.length)
    );
    if (payload?.type !== 'session_annotations' || !Array.isArray(payload.runs))
      return { message: content, annotationCount: 0 };
    const annotationCount = payload.runs.reduce(
      (count: number, run: { annotations?: unknown }) =>
        count + (Array.isArray(run.annotations) ? run.annotations.length : 0),
      0
    );
    if (annotationCount === 0) return { message: content, annotationCount: 0 };
    return { message: content.slice(0, start), annotationCount };
  } catch {
    return { message: content, annotationCount: 0 };
  }
}
