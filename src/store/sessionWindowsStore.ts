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

import type { SessionWindowTarget } from '@/lib/sessionWindows';
import { create } from 'zustand';

export interface OpenInMainRequest extends SessionWindowTarget {
  sequence: number;
}

// The main window's view of which Sessions are open in their own window or
// tab. A Session lives in one place: while its window is open, the main window
// does not show it.
type SessionWindowsState = {
  openProjectIds: string[];
  /** Latest request to show a Session in the main window; the sidebar runs it. */
  openInMainRequest: OpenInMainRequest | null;
  markOpen: (projectId: string) => void;
  markClosed: (projectId: string) => void;
  setOpen: (projectIds: string[]) => void;
  requestOpenInMain: (target: SessionWindowTarget) => void;
};

export const useSessionWindowsStore = create<SessionWindowsState>((set) => ({
  openProjectIds: [],
  openInMainRequest: null,
  markOpen: (projectId) =>
    set((state) =>
      state.openProjectIds.includes(projectId)
        ? state
        : { openProjectIds: [...state.openProjectIds, projectId] }
    ),
  markClosed: (projectId) =>
    set((state) =>
      state.openProjectIds.includes(projectId)
        ? {
            openProjectIds: state.openProjectIds.filter(
              (id) => id !== projectId
            ),
          }
        : state
    ),
  setOpen: (projectIds) => set({ openProjectIds: [...new Set(projectIds)] }),
  requestOpenInMain: (target) =>
    set((state) => ({
      openProjectIds: state.openProjectIds.filter(
        (id) => id !== target.projectId
      ),
      openInMainRequest: {
        ...target,
        sequence: (state.openInMainRequest?.sequence ?? 0) + 1,
      },
    })),
}));
