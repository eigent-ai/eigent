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

export const GLOBAL_SEARCH_TYPES = [
  'all',
  'spaces',
  'sessions',
  'tasks',
  'files',
  'automations',
  'dispatch',
] as const;

export type GlobalSearchType = (typeof GLOBAL_SEARCH_TYPES)[number];
export type GlobalSearchItemType = Exclude<GlobalSearchType, 'all'>;

/** Rows shown without a query, and per type in All. */
export const GLOBAL_SEARCH_RECENT_LIMIT = 8;
/** Rows shown inside one type. */
export const GLOBAL_SEARCH_TYPE_LIMIT = 50;

export interface GlobalSearchItem {
  id: string;
  type: GlobalSearchItemType;
  title: string;
  /** Where it lives, shown at the row's end. */
  detail?: string;
  /** Newest first; 0 when unknown. */
  time: number;
  spaceId?: string;
  projectId?: string;
  triggerId?: number;
  /** A Space row's emoji. */
  emoji?: string | null;
}

function matches(item: GlobalSearchItem, needle: string): boolean {
  return (
    item.title.toLowerCase().includes(needle) ||
    Boolean(item.detail?.toLowerCase().includes(needle))
  );
}

/**
 * The rows for a type and query. Titles that start with the query come first,
 * then the newest. With no query, All shows what was worked on last.
 */
export function searchGlobalItems(
  items: readonly GlobalSearchItem[],
  type: GlobalSearchType,
  query: string
): GlobalSearchItem[] {
  const needle = query.trim().toLowerCase();
  const inType = items.filter((item) => type === 'all' || item.type === type);
  const found = needle
    ? inType.filter((item) => matches(item, needle))
    : inType;
  const startsWith = (item: GlobalSearchItem) =>
    needle && item.title.toLowerCase().startsWith(needle) ? 1 : 0;
  const sorted = [...found].sort(
    (a, b) => startsWith(b) - startsWith(a) || b.time - a.time
  );
  if (type !== 'all') return sorted.slice(0, GLOBAL_SEARCH_TYPE_LIMIT);
  if (!needle) {
    return sorted
      .filter((item) => item.type === 'sessions')
      .slice(0, GLOBAL_SEARCH_RECENT_LIMIT);
  }
  // Keep every type reachable: a long Session list mustn't hide the Space.
  const counts = new Map<GlobalSearchItemType, number>();
  return sorted.filter((item) => {
    const count = counts.get(item.type) ?? 0;
    counts.set(item.type, count + 1);
    return count < GLOBAL_SEARCH_RECENT_LIMIT;
  });
}

/** The next type for ← and →, wrapping at the ends. */
export function stepGlobalSearchType(
  type: GlobalSearchType,
  delta: -1 | 1
): GlobalSearchType {
  const count = GLOBAL_SEARCH_TYPES.length;
  const index = GLOBAL_SEARCH_TYPES.indexOf(type);
  return GLOBAL_SEARCH_TYPES[(index + delta + count) % count];
}
