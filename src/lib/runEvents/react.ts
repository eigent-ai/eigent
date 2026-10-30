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
// Licensed under the Apache License, Version 2.0 (the "License");

import type {
  ProjectedRun,
  ProjectedWriterWait,
  ProjectViewState,
} from '@/lib/projector';
import { useCallback, useSyncExternalStore } from 'react';
import { runProjectionStore } from './projectionStore';

export function useRunProjectionSelector<T>(
  projectId: string | null,
  selector: (state: ProjectViewState | null) => T
): T {
  const subscribe = useCallback(
    (listener: () => void) =>
      projectId
        ? runProjectionStore.subscribeProject(projectId, listener)
        : () => undefined,
    [projectId]
  );
  const getSnapshot = useCallback(
    () => selector(projectId ? runProjectionStore.getProject(projectId) : null),
    [projectId, selector]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Why a Run is still queued for its Space writer, or null once it is not. */
export function useRunWriterWait(
  projectId: string | null,
  runId: string | null | undefined
): ProjectedWriterWait | null {
  const select = useCallback(
    (state: ProjectViewState | null) =>
      (runId && state?.runs[runId]?.writerWait) || null,
    [runId]
  );
  return useRunProjectionSelector(projectId, select);
}

/** The canonical status of a Run, or null before it is projected. */
export function useProjectedRunStatus(
  projectId: string | null,
  runId: string | null | undefined
): ProjectedRun['status'] | null {
  const select = useCallback(
    (state: ProjectViewState | null) =>
      (runId && state?.runs[runId]?.status) || null,
    [runId]
  );
  return useRunProjectionSelector(projectId, select);
}
