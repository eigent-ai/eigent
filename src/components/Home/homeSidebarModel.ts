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

import type { RunAttentionState } from '@/service/projectRunsApi';
import type { Space, SpaceProjectMeta } from '@/store/spaceStore';

/** Recent Sessions each Space lists before "Show all". */
export const HOME_SPACE_RECENT_SESSIONS = 4;

/** A Space's last activity: its own change or its newest Session's. */
export function spaceLastActivity(
  space: Pick<Space, 'updatedAt'>,
  sessions: readonly Pick<SpaceProjectMeta, 'updatedAt'>[]
): number {
  return sessions.reduce(
    (latest, session) => Math.max(latest, session.updatedAt),
    space.updatedAt
  );
}

/**
 * Order ids by the activity captured when Home opened, newest first. An id
 * the snapshot doesn't know is new since then and goes first, so it shows up
 * without moving the rows the person is looking at.
 */
export function orderBySnapshot(
  ids: readonly string[],
  snapshot: Readonly<Record<string, number>>
): string[] {
  const rank = (id: string) => snapshot[id] ?? Number.POSITIVE_INFINITY;
  return (
    ids
      .map((id, index) => ({ id, index }))
      // Compare instead of subtracting: two new ids are Infinity - Infinity.
      .sort((a, b) => {
        const [rankA, rankB] = [rank(a.id), rank(b.id)];
        if (rankA === rankB) return a.index - b.index;
        return rankA > rankB ? -1 : 1;
      })
      .map(({ id }) => id)
  );
}

/**
 * Sessions waiting for a reply, in the order they started waiting. Rows that
 * stay waiting keep their place; new ones join at the end.
 */
export function nextNeedsYouOrder(
  previous: readonly string[],
  attention: Readonly<Record<string, RunAttentionState>>,
  isListed: (projectId: string) => boolean
): string[] {
  const waiting = (projectId: string) =>
    attention[projectId] === 'waiting' && isListed(projectId);
  const kept = previous.filter(waiting);
  const added = Object.keys(attention).filter(
    (projectId) => waiting(projectId) && !kept.includes(projectId)
  );
  return [...kept, ...added];
}
