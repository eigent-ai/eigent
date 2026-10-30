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

/**
 * Sessions that Send opened before the server accepted them and admitted
 * their first task. Their own composer waits until that start settles, so a
 * message sent there cannot start the same task a second time.
 */
type SessionStartState = {
  startingProjectIds: Record<string, true>;
  markSessionStarting: (projectId: string) => void;
  clearSessionStarting: (projectId: string) => void;
};

export const useSessionStartStore = create<SessionStartState>()((set) => ({
  startingProjectIds: {},
  markSessionStarting: (projectId) =>
    set((state) => ({
      startingProjectIds: { ...state.startingProjectIds, [projectId]: true },
    })),
  clearSessionStarting: (projectId) =>
    set((state) => {
      if (!state.startingProjectIds[projectId]) return state;
      const startingProjectIds = { ...state.startingProjectIds };
      delete startingProjectIds[projectId];
      return { startingProjectIds };
    }),
}));

export const isSessionStarting = (projectId: string | null | undefined) =>
  Boolean(
    projectId && useSessionStartStore.getState().startingProjectIds[projectId]
  );
