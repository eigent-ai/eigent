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

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Split view shows at most this many Sessions side by side. */
export const MAX_SESSION_PANES = 3;

const normalizePanes = (panes: readonly unknown[] | undefined): string[] =>
  [
    ...new Set(
      (panes ?? []).filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      )
    ),
  ].slice(0, MAX_SESSION_PANES);

// Sessions shown side by side in each Space, left to right; a per-device
// layout. A Space keeps an entry only while two or more panes are open. The
// focused pane is the active Session, so it is not stored here.
type SessionSplitViewState = {
  panesBySpaceId: Record<string, string[]>;
  /**
   * Show `projectId` to the right of the split that shows `anchorId`, or start
   * a split of the two. Returns false when the split is already full.
   */
  openPane: (spaceId: string, anchorId: string, projectId: string) => boolean;
  /** Put `nextId` in the pane that shows `currentId` (sidebar selection). */
  replacePane: (spaceId: string, currentId: string, nextId: string) => void;
  /** Close one pane; a single remaining pane ends the split. */
  closePane: (spaceId: string, projectId: string) => void;
  /** Drop a Session from every split, for example after it was deleted. */
  forgetSession: (projectId: string) => void;
};

const withPanes = (
  panesBySpaceId: Record<string, string[]>,
  spaceId: string,
  panes: string[]
) => {
  const next = { ...panesBySpaceId };
  if (panes.length >= 2) next[spaceId] = panes;
  else delete next[spaceId];
  return next;
};

export const useSessionSplitViewStore = create<SessionSplitViewState>()(
  persist(
    (set, get) => ({
      panesBySpaceId: {},
      openPane: (spaceId, anchorId, projectId) => {
        // A saved split that does not show the anchor is replaced: the new
        // split starts from the Session the user is looking at.
        const saved = get().panesBySpaceId[spaceId];
        const current = saved?.includes(anchorId) ? saved : [anchorId];
        if (current.includes(projectId)) return true;
        if (current.length >= MAX_SESSION_PANES) return false;
        set((state) => ({
          panesBySpaceId: withPanes(state.panesBySpaceId, spaceId, [
            ...current,
            projectId,
          ]),
        }));
        return true;
      },
      replacePane: (spaceId, currentId, nextId) => {
        const panes = get().panesBySpaceId[spaceId];
        if (!panes?.includes(currentId) || panes.includes(nextId)) return;
        set((state) => ({
          panesBySpaceId: withPanes(
            state.panesBySpaceId,
            spaceId,
            panes.map((id) => (id === currentId ? nextId : id))
          ),
        }));
      },
      closePane: (spaceId, projectId) => {
        const panes = get().panesBySpaceId[spaceId];
        if (!panes?.includes(projectId)) return;
        set((state) => ({
          panesBySpaceId: withPanes(
            state.panesBySpaceId,
            spaceId,
            panes.filter((id) => id !== projectId)
          ),
        }));
      },
      forgetSession: (projectId) => {
        const { panesBySpaceId } = get();
        if (!Object.values(panesBySpaceId).some((p) => p.includes(projectId)))
          return;
        let next = panesBySpaceId;
        for (const [spaceId, panes] of Object.entries(panesBySpaceId))
          next = withPanes(
            next,
            spaceId,
            panes.filter((id) => id !== projectId)
          );
        set({ panesBySpaceId: next });
      },
    }),
    {
      name: 'eigent-session-split-view-v1',
      partialize: (state) => ({ panesBySpaceId: state.panesBySpaceId }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SessionSplitViewState>;
        let panesBySpaceId: Record<string, string[]> = {};
        for (const [spaceId, panes] of Object.entries(
          saved.panesBySpaceId ?? {}
        ))
          panesBySpaceId = withPanes(
            panesBySpaceId,
            spaceId,
            normalizePanes(panes)
          );
        return { ...current, panesBySpaceId };
      },
    }
  )
);

/** Panes of a Space, or an empty list when it is not split. */
export const selectSessionPanes =
  (spaceId: string | null | undefined) =>
  (state: SessionSplitViewState): string[] =>
    (spaceId && state.panesBySpaceId[spaceId]) || EMPTY_PANES;

const EMPTY_PANES: string[] = [];
