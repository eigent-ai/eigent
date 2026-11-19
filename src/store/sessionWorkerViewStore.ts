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

/** Sessions whose worker rows the person expanded or collapsed, per device. */
const EXPANDED_KEY = 'eigent-session-worker-rows-expanded';

function readExpanded(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(EXPANDED_KEY) ?? '{}'
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
      )
    );
  } catch {
    return {};
  }
}

function writeExpanded(value: Record<string, boolean>) {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(value));
  } catch {
    // Storage may be unavailable; the choice then lasts for this window only.
  }
}

interface SessionWorkerViewState {
  /** Open worker timeline per Session (projectId → worker key). */
  selectedWorkerByProject: Record<string, string>;
  /** Explicit expand/collapse choice per Session; absent = default. */
  expandedByProject: Record<string, boolean>;
  openWorker: (projectId: string, workerKey: string) => void;
  closeWorker: (projectId: string) => void;
  setExpanded: (projectId: string, expanded: boolean) => void;
}

export const useSessionWorkerViewStore = create<SessionWorkerViewState>(
  (set) => ({
    selectedWorkerByProject: {},
    expandedByProject: readExpanded(),
    openWorker: (projectId, workerKey) =>
      set((state) => ({
        selectedWorkerByProject: {
          ...state.selectedWorkerByProject,
          [projectId]: workerKey,
        },
      })),
    closeWorker: (projectId) =>
      set((state) => {
        if (!(projectId in state.selectedWorkerByProject)) return state;
        const { [projectId]: _closed, ...rest } = state.selectedWorkerByProject;
        return { selectedWorkerByProject: rest };
      }),
    setExpanded: (projectId, expanded) =>
      set((state) => {
        const expandedByProject = {
          ...state.expandedByProject,
          [projectId]: expanded,
        };
        writeExpanded(expandedByProject);
        return { expandedByProject };
      }),
  })
);

/**
 * Collapsed by default, or as the person last left it. Always expanded while
 * a worker waits for a reply or approval, so the request is not hidden.
 */
export function resolveWorkerRowsExpanded(
  explicit: boolean | undefined,
  hasWaitingWorker: boolean
): boolean {
  return hasWaitingWorker || explicit === true;
}
