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

/** Controls whether SidePanel shows only the current run or every run. */
export type SessionPanelScope = 'latest' | 'all';

export interface SessionPanelScopedItem {
  historical: boolean;
  createdAt: number;
  updatedAt: number;
}

export function selectSessionPanelRuns<
  T extends { isCurrent: boolean; createdAt: number; updatedAt: number },
>(runs: T[], scope: SessionPanelScope): T[] {
  const sorted = [...runs].sort(
    (a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt
  );
  return scope === 'latest'
    ? sorted.filter((run) => run.isCurrent).slice(0, 1)
    : sorted;
}

/**
 * Split items into the current run's rows and a collapsed "earlier runs" group.
 * In `latest` scope the panel is already fed only the current run, so anything
 * still flagged historical is dropped rather than shown.
 */
export function arrangeSessionPanelItems<T extends SessionPanelScopedItem>(
  items: T[],
  scope: SessionPanelScope,
  order: 'newest' | 'source' = 'newest'
): { primary: T[]; earlier: T[] } {
  const sorted =
    order === 'source'
      ? [...items]
      : [...items].sort(
          (a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt
        );
  const primary = sorted.filter((item) => !item.historical);

  return scope === 'latest'
    ? { primary, earlier: [] }
    : { primary, earlier: sorted.filter((item) => item.historical) };
}
