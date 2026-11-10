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
  getSessionNavLeadFromRunStatus,
  isSessionOutcomeKind,
  selectSessionNavRun,
  type SessionNavLeadKind,
} from '@/lib/sessionNavLead';
import { peekProjectEventStore } from '@/store/projectEventStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';
import { useEffect, useState } from 'react';

function sessionOutcomeRunKey(projectId: string): string | null {
  const run = selectSessionNavRun(projectId, [
    runProjectionStore.getProject(projectId),
    peekProjectEventStore(projectId)?.getSnapshot().view,
  ]);
  return run ? `${run.runId}:${run.status}` : null;
}

/** Names the result on show, so the next Run's result counts as new. */
export function sessionOutcomeKey(
  projectId: string,
  kind: SessionNavLeadKind
): string {
  return sessionOutcomeRunKey(projectId) ?? kind;
}

/** Whether this Session's current result has already been read. */
export function isSessionOutcomeSeen(
  projectId: string,
  kind: SessionNavLeadKind,
  seenOutcomes: Readonly<Record<string, string>>
): boolean {
  const seen = seenOutcomes[projectId];
  if (seen === undefined || !isSessionOutcomeKind(kind)) return false;
  const runKey = sessionOutcomeRunKey(projectId);
  if (runKey) return seen === runKey;
  if (seen === kind) return true;
  // After a restart the Run summary loads after the lead. Until it does, a
  // result read before still counts as read when it was the same kind of
  // result; `useSessionOutcomeRuns` checks again once the Run is known.
  const separator = seen.lastIndexOf(':');
  if (separator < 0) return false;
  return (
    getSessionNavLeadFromRunStatus(seen.slice(separator + 1))?.kind === kind
  );
}

/**
 * Re-renders when the Run summaries of `projectIds` change, so rows that
 * call `isSessionOutcomeSeen` check again once a Run is known.
 */
export function useSessionOutcomeRuns(projectIds: readonly string[]): void {
  const [, setVersion] = useState(0);
  const key = projectIds.join('\n');
  useEffect(() => {
    if (!key) return;
    const unsubscribes = key.split('\n').map((projectId) => {
      // Re-render only when the Run a row would compare against changes,
      // not on every event of a running Session.
      let runKey = sessionOutcomeRunKey(projectId);
      return runProjectionStore.subscribeProject(projectId, () => {
        const next = sessionOutcomeRunKey(projectId);
        if (next === runKey) return;
        runKey = next;
        setVersion((version) => version + 1);
      });
    });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [key]);
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
