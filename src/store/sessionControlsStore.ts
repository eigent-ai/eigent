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

const PINNED_PROJECTS_KEY = 'eigent-pinned-projects';

export type SessionControlAction = 'rename' | 'end' | 'delete';

export interface SessionControlRequest {
  sequence: number;
  action: SessionControlAction;
  projectId: string;
}

function readPinnedProjectIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(PINNED_PROJECTS_KEY) ?? '[]'
    );
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

interface SessionControlsState {
  pinnedProjectIds: string[];
  request: SessionControlRequest | null;
  refreshPinned: () => void;
  togglePinned: (projectId: string) => void;
  requestAction: (action: SessionControlAction, projectId: string) => void;
}

/** Shared presentation commands; SpaceSidebar remains the confirmation owner. */
export const useSessionControlsStore = create<SessionControlsState>(
  (set, get) => ({
    pinnedProjectIds: readPinnedProjectIds(),
    request: null,
    refreshPinned: () => set({ pinnedProjectIds: readPinnedProjectIds() }),
    togglePinned: (projectId) => {
      const next = new Set(get().pinnedProjectIds);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      const pinnedProjectIds = [...next];
      try {
        localStorage.setItem(
          PINNED_PROJECTS_KEY,
          JSON.stringify(pinnedProjectIds)
        );
      } catch {
        // Keep the visible Session state usable when storage is unavailable.
      }
      set({ pinnedProjectIds });
    },
    requestAction: (action, projectId) =>
      set((state) => ({
        request: {
          sequence: (state.request?.sequence ?? 0) + 1,
          action,
          projectId,
        },
      })),
  })
);
