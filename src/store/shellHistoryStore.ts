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

/** How many places Back can step through. */
export const SHELL_HISTORY_LIMIT = 50;

/**
 * One place in the main window. Most moves change store state rather than the
 * URL (a tab, Home or the Space view, the open Session), so the URL alone
 * can't restore a place.
 */
export interface ShellPlaceEntry {
  /** Pathname and search. */
  path: string;
  /** Router state, which carries Home and Settings' way back. */
  routerState: unknown;
  shellPlace: 'home' | 'space';
  spaceId: string | null;
  workspaceTab: string;
  spaceWorkspaceTab: string;
  projectId: string | null;
}

/** Entries with the same key are the same place. */
export function shellPlaceKey(entry: ShellPlaceEntry): string {
  if (entry.path !== '/') return entry.path;
  return JSON.stringify([
    entry.shellPlace,
    entry.spaceId,
    entry.workspaceTab,
    entry.workspaceTab === 'space-workspace' ? entry.spaceWorkspaceTab : null,
    entry.projectId,
  ]);
}

interface ShellHistoryState {
  entries: ShellPlaceEntry[];
  index: number;
  /** Add a new place, dropping anything Forward could have reached. */
  record: (entry: ShellPlaceEntry) => void;
  /** Correct the current place without adding one. */
  replace: (entry: ShellPlaceEntry) => void;
  /** Move the pointer `delta` places and return that entry. */
  step: (delta: -1 | 1) => ShellPlaceEntry | null;
  /** Put the pointer back, for a step that didn't open anything. */
  setIndex: (index: number) => void;
}

export const useShellHistoryStore = create<ShellHistoryState>((set, get) => ({
  entries: [],
  index: -1,
  record: (entry) =>
    set((state) => {
      const current = state.entries[state.index];
      if (current && shellPlaceKey(current) === shellPlaceKey(entry)) {
        return state;
      }
      const entries = [...state.entries.slice(0, state.index + 1), entry].slice(
        -SHELL_HISTORY_LIMIT
      );
      return { entries, index: entries.length - 1 };
    }),
  replace: (entry) =>
    set((state) => {
      if (state.index < 0) return state;
      const entries = [...state.entries];
      entries[state.index] = entry;
      return { entries };
    }),
  step: (delta) => {
    const { entries, index } = get();
    const next = index + delta;
    if (next < 0 || next >= entries.length) return null;
    set({ index: next });
    return entries[next];
  },
  setIndex: (index) =>
    set((state) =>
      index >= -1 && index < state.entries.length ? { index } : state
    ),
}));
