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
import { useSessionWindowsStore } from '@/store/sessionWindowsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useEffect, useMemo } from 'react';

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
 * Saved panes of the Space that are not open in their own window. Deleted
 * Sessions leave the split through `forgetSession`; panes are not filtered by
 * the Space index, which briefly drops a Session while its history reloads.
 */
export function useVisibleSessionPanes(spaceId: string | null | undefined) {
  const panes = useSessionSplitViewStore(selectSessionPanes(spaceId));
  const windowedIds = useSessionWindowsStore((s) => s.openProjectIds);
  return useMemo(
    () => panes.filter((id) => !windowedIds.includes(id)),
    [panes, windowedIds]
  );
}

export type SplitViewUnavailableReason =
  'in-window' | 'no-session' | 'same' | 'full';

/**
 * Why "Open in split view" is unavailable for `projectId`, or null when it is
 * available. `anchorId` is the Session open in this Space, if any; `panes` are
 * the visible panes of its split (empty when not split).
 */
export function getSplitViewUnavailableReason({
  projectId,
  anchorId,
  panes,
  windowedIds,
}: {
  projectId: string;
  anchorId: string | null;
  panes: readonly string[];
  windowedIds: readonly string[];
}): SplitViewUnavailableReason | null {
  if (windowedIds.includes(projectId)) return 'in-window';
  if (panes.includes(projectId)) return null;
  if (!anchorId) return 'no-session';
  if (projectId === anchorId) return 'same';
  if (panes.length >= MAX_SESSION_PANES) return 'full';
  return null;
}
