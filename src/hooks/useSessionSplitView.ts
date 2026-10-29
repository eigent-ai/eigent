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

import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  MAX_SESSION_PANES,
  selectSessionPanes,
  useSessionSplitViewStore,
} from '@/store/sessionSplitViewStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useEffect } from 'react';

/** How long a Session may be missing before it counts as deleted. */
export const DELETE_CONFIRM_DELAY_MS = 2000;

/**
 * Selecting a Session that is not shown replaces the focused pane, so the
 * sidebar keeps working while the Space is split.
 */
export function useSessionSplitFocusTracking() {
  useEffect(
    () =>
      useProjectRuntimeStore.subscribe((state, previous) => {
        const nextId = state.activeProjectId;
        const previousId = previous.activeProjectId;
        if (!nextId || !previousId || nextId === previousId) return;
        const spaces = useSpaceStore.getState();
        const spaceId = spaces.getProjectMeta(previousId)?.spaceId;
        if (!spaceId || spaces.getProjectMeta(nextId)?.spaceId !== spaceId)
          return;
        useSessionSplitViewStore
          .getState()
          .replacePane(spaceId, previousId, nextId);
      }),
    []
  );
}

/**
 * A deleted Session leaves the split. Reloading a Session's history removes
 * and recreates its entry, so a Session counts as deleted only when it is
 * still missing a moment later.
 */
export function useForgetDeletedSplitSessions() {
  useEffect(() => {
    const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();
    const confirmDelete = (projectId: string) => {
      pendingDeletes.delete(projectId);
      if (useSpaceStore.getState().projectIdIndex[projectId]) return;
      useSessionSplitViewStore.getState().forgetSession(projectId);
    };
    const stopWatchingDeletes = useSpaceStore.subscribe((state, previous) => {
      if (state.projectIdIndex === previous.projectIdIndex) return;
      for (const projectId of Object.keys(previous.projectIdIndex)) {
        if (state.projectIdIndex[projectId] || pendingDeletes.has(projectId))
          continue;
        pendingDeletes.set(
          projectId,
          setTimeout(() => confirmDelete(projectId), DELETE_CONFIRM_DELAY_MS)
        );
      }
    });
    return () => {
      stopWatchingDeletes();
      pendingDeletes.forEach((timer) => clearTimeout(timer));
    };
  }, []);
}

/**
 * Saved panes of the Space. Deleted Sessions leave the split through
 * `forgetSession`; panes are not filtered by the Space index, which briefly
 * drops a Session while its history reloads.
 */
export function useVisibleSessionPanes(spaceId: string | null | undefined) {
  return useSessionSplitViewStore(selectSessionPanes(spaceId));
}

export type SplitViewUnavailableReason = 'no-session' | 'same' | 'full';

/**
 * Why "Open in split view" is unavailable for `projectId`, or null when it is
 * available. `anchorId` is the Session open in this Space, if any; `panes` are
 * the visible panes of its split (empty when not split).
 */
export function getSplitViewUnavailableReason({
  projectId,
  anchorId,
  panes,
}: {
  projectId: string;
  anchorId: string | null;
  panes: readonly string[];
}): SplitViewUnavailableReason | null {
  if (panes.includes(projectId)) return null;
  if (!anchorId) return 'no-session';
  if (projectId === anchorId) return 'same';
  if (panes.length >= MAX_SESSION_PANES) return 'full';
  return null;
}
