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

import {
  assertSessionCleanupIdentity,
  deleteSessionTaskData,
} from '@/lib/sessionFileCleanup';
import { SessionStopError, stopSessionForDeletion } from '@/lib/sessionStop';
import {
  proxyFetchSpaceProjects,
  proxyUpdateSpaceProject,
} from '@/service/spaceApi';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';

export type DeleteSpacePhase = 'idle' | 'stopping' | 'deleting';

export type DeleteSpaceFailure =
  'stop' | 'cleanup' | 'has-sessions' | 'has-bundles';

/** Stopping several Sessions at once stays well under the per-host limit. */
const STOP_CONCURRENCY = 3;

function statusOf(error: unknown) {
  return (error as { status?: number } | null)?.status;
}

function ignoreMissing(error: unknown) {
  if (statusOf(error) !== 404) throw error;
}

function conflictCode(error: unknown): string | undefined {
  if (statusOf(error) !== 409) return undefined;
  const detail = (
    error as { response?: { data?: { detail?: { code?: unknown } } } }
  ).response?.data?.detail;
  return typeof detail?.code === 'string' ? detail.code : undefined;
}

/** Maps a failed Space deletion to the explanation the dialog shows. */
export function classifyDeleteSpaceFailure(error: unknown): DeleteSpaceFailure {
  if (error instanceof SessionStopError) return 'stop';
  const code = conflictCode(error);
  if (code === 'space_has_projects') return 'has-sessions';
  if (code === 'space_has_bundles') return 'has-bundles';
  return 'cleanup';
}

async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>
) {
  let next = 0;
  let failed = false;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (!failed && next < items.length) {
        try {
          await work(items[next++]);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    })()
  );
  await Promise.all(lanes);
}

/** The Space's Sessions that have not been deleted yet, server and local. */
async function liveSessionIds(spaceId: string): Promise<string[]> {
  const ids = new Set<string>();
  try {
    for (const project of await proxyFetchSpaceProjects(spaceId)) {
      if (project.status !== 'archived') ids.add(project.id);
    }
  } catch (error) {
    // An absent Space is already deleted; its local Sessions still go.
    ignoreMissing(error);
  }
  const local = useSpaceStore.getState().projectsBySpaceId[spaceId] ?? {};
  for (const meta of Object.values(local)) {
    if (meta.status !== 'archived') ids.add(meta.id);
  }
  return [...ids];
}

/**
 * Deletes a Space together with every Session in it, the way deleting each
 * Session would: stop its Tasks, remove its local Task files and history,
 * and mark it deleted on the server. The Space folder on disk is never
 * touched, nor are Session working directories.
 *
 * Every Session is stopped before anything is removed, so a Session that
 * cannot be stopped leaves the whole Space as it was. A later failure leaves
 * the remaining Sessions in place; calling this again finishes the job.
 */
export async function deleteSpaceAndSessions(
  spaceId: string,
  {
    identity,
    ipcRenderer,
    onPhase,
  }: {
    identity: { email: string | null; userId: number | null };
    ipcRenderer?: { invoke: (...args: unknown[]) => Promise<unknown> } | null;
    onPhase?: (phase: Exclude<DeleteSpacePhase, 'idle'>) => void;
  }
): Promise<void> {
  assertSessionCleanupIdentity(identity);
  onPhase?.('stopping');
  const sessionIds = await liveSessionIds(spaceId);
  const deferLocalCleanup = new Map<string, boolean>();
  await forEachLimited(sessionIds, STOP_CONCURRENCY, async (projectId) => {
    deferLocalCleanup.set(projectId, await stopSessionForDeletion(projectId));
  });

  onPhase?.('deleting');
  const projectStore = useProjectRuntimeStore.getState();
  for (const projectId of sessionIds) {
    assertSessionCleanupIdentity(identity);
    const chatState = projectStore.peekActiveChatStore(projectId)?.getState();
    await deleteSessionTaskData({
      projectId,
      spaceId,
      ...identity,
      knownTasks: Object.keys(chatState?.tasks ?? {}).map((taskId) => ({
        task_id: taskId,
        project_id: projectId,
      })),
      deferLocalCleanup: deferLocalCleanup.get(projectId) ?? false,
      ipcRenderer,
    });
    assertSessionCleanupIdentity(identity);
    // Unlike a single Session deletion this must succeed: the server only
    // deletes a Space once each of its Sessions is marked deleted.
    await proxyUpdateSpaceProject(spaceId, projectId, {
      status: 'archived',
    }).catch(ignoreMissing);
    assertSessionCleanupIdentity(identity);
    useProjectRuntimeStore.getState().removeProject(projectId);
  }

  assertSessionCleanupIdentity(identity);
  await useSpaceStore.getState().deleteSpaceOnServer(spaceId);
}
