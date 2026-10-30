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

import { fetchGet } from '@/api/http';
import { isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import { proxyFetchTriggers } from '@/service/triggerApi';
import { fetchWorkspaceGitStatus } from '@/service/workspaceGitApi';
import type { Space } from '@/store/spaceStore';
import { TriggerStatus, type Trigger } from '@/types';
import { useEffect, useState } from 'react';

/** Automations are listed per account; this many cover one Space's share. */
const AUTOMATION_PAGE_SIZE = 100;
const RECENT_FILE_COUNT = 5;

export interface SpaceOverviewRecentFile {
  name: string;
  relativePath: string;
  /** Last change in ms; a newly created file is also its latest change. */
  modifiedAt: number | null;
}

export interface SpaceOverviewStats {
  /** Files in the Space folder, as the Files tab lists them. */
  files: { count: number; recent: SpaceOverviewRecentFile[] } | null;
  automations: { total: number; active: number } | null;
  /** Folder Spaces only; `enabled` is false until version history is on. */
  versionHistory: {
    enabled: boolean;
    branch: string | null;
    unsavedChanges: number;
    unsavedChangesTruncated: boolean;
  } | null;
}

const EMPTY_SPACE_OVERVIEW_STATS: SpaceOverviewStats = {
  files: null,
  automations: null,
  versionHistory: null,
};

interface SpaceOverviewIdentity {
  email: string | null;
  userId: string | number | null;
}

async function loadSpaceFiles(
  space: Space,
  sessionIds: readonly string[],
  identity: SpaceOverviewIdentity,
  signal: AbortSignal
): Promise<NonNullable<SpaceOverviewStats['files']>> {
  // A folder Space lists its whole folder; a cloud Space lists each Session's
  // files, which is what the Files tab shows for each.
  const targets = isLocalWorkspaceSpace(space) ? [space.id] : sessionIds;
  const lists = await Promise.all(
    targets.map((projectId) =>
      fetchGet(
        '/files',
        {
          project_id: projectId,
          email: identity.email ?? '',
          space_id: space.id,
          ...(identity.userId != null
            ? { user_id: String(identity.userId) }
            : {}),
        },
        undefined,
        { signal }
      )
    )
  );
  const files: SpaceOverviewRecentFile[] = lists.flatMap((list: unknown) =>
    Array.isArray(list)
      ? list.map((item: Record<string, unknown>) => {
          const name = typeof item.filename === 'string' ? item.filename : '';
          const relativePath =
            (typeof item.relativePath === 'string' && item.relativePath) ||
            (typeof item.relative_path === 'string' && item.relative_path) ||
            name;
          return {
            name,
            relativePath,
            modifiedAt:
              typeof item.modifiedAt === 'number' ? item.modifiedAt : null,
          };
        })
      : []
  );
  const recent = files
    .filter((file) => file.modifiedAt !== null)
    .sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0))
    .slice(0, RECENT_FILE_COUNT);
  return { count: files.length, recent };
}

async function countSpaceAutomations(sessionIds: readonly string[]) {
  const response = await proxyFetchTriggers(
    undefined,
    undefined,
    1,
    AUTOMATION_PAGE_SIZE
  );
  const sessions = new Set(sessionIds);
  const items: Trigger[] = Array.isArray(response?.items) ? response.items : [];
  const inSpace = items.filter(
    (trigger) => trigger.project_id && sessions.has(trigger.project_id)
  );
  return {
    total: inSpace.length,
    active: inSpace.filter((trigger) => trigger.status === TriggerStatus.Active)
      .length,
  };
}

/**
 * Loads the Space panel's remote counts. Each count loads on its own, so one
 * unavailable service leaves only its box without a value.
 */
export function useSpaceOverviewStats(
  space: Space | null,
  sessionIds: readonly string[],
  identity: SpaceOverviewIdentity
): SpaceOverviewStats {
  const [stats, setStats] = useState(EMPTY_SPACE_OVERVIEW_STATS);
  const spaceId = space?.id ?? null;
  const sessionKey = sessionIds.join(',');
  const { email, userId } = identity;

  useEffect(() => {
    setStats(EMPTY_SPACE_OVERVIEW_STATS);
    if (!space) return;
    const controller = new AbortController();
    const { signal } = controller;
    const sessions = sessionKey ? sessionKey.split(',') : [];
    const settle = <K extends keyof SpaceOverviewStats>(
      key: K,
      load: () => Promise<SpaceOverviewStats[K]>
    ) => {
      load().then(
        (value) => {
          if (!signal.aborted) setStats((prev) => ({ ...prev, [key]: value }));
        },
        () => undefined
      );
    };

    settle('files', () =>
      loadSpaceFiles(space, sessions, { email, userId }, signal)
    );
    settle('automations', () => countSpaceAutomations(sessions));
    if (isLocalWorkspaceSpace(space)) {
      settle('versionHistory', async () => {
        const status = await fetchWorkspaceGitStatus(space.id, {
          email: email ?? '',
          userId,
        });
        return {
          enabled: status.enabled,
          branch:
            status.diagnostics?.repo_state.branch_or_detached_head ?? null,
          unsavedChanges: status.pending_managed_paths?.length ?? 0,
          unsavedChangesTruncated: Boolean(
            status.pending_managed_paths_truncated
          ),
        };
      });
    }

    return () => controller.abort();
    // `space` is read through its id; a renamed Space keeps its counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, sessionKey, email, userId]);

  return stats;
}
