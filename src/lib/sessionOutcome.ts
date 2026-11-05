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

import { runProjectionStore } from '@/lib/runEvents/projectionStore';
import {
  isSessionOutcomeKind,
  selectSessionNavRun,
  type SessionNavLeadKind,
} from '@/lib/sessionNavLead';
import { peekProjectEventStore } from '@/store/projectEventStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';

/** Names the result on show, so the next Run's result counts as new. */
export function sessionOutcomeKey(
  projectId: string,
  kind: SessionNavLeadKind
): string {
  const run = selectSessionNavRun(projectId, [
    runProjectionStore.getProject(projectId),
    peekProjectEventStore(projectId)?.getSnapshot().view,
  ]);
  return run ? `${run.runId}:${run.status}` : kind;
}

/** Whether this Session's current result has already been read. */
export function isSessionOutcomeSeen(
  projectId: string,
  kind: SessionNavLeadKind,
  seenOutcomes: Readonly<Record<string, string>>
): boolean {
  return (
    isSessionOutcomeKind(kind) &&
    seenOutcomes[projectId] === sessionOutcomeKey(projectId, kind)
  );
}

/** Remember that the Session's current result has been read. */
export function markSessionOutcomeSeen(projectId: string): void {
  const kind =
    useProjectRuntimeStore.getState().navLeadByProjectId[projectId]?.kind;
  if (!kind || !isSessionOutcomeKind(kind)) return;
  useSessionControlsStore
    .getState()
    .setSessionOutcomeSeen(projectId, sessionOutcomeKey(projectId, kind));
}
