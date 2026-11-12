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
import {
  listOwnedWorkspaceBundles,
  OWNED_WORKSPACE_BUNDLE_LIST_LIMIT,
} from '@/service/workspaceBundleAuthoringApi';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';

export type DeleteSpacePhase = 'idle' | 'stopping' | 'deleting';

export type DeleteSpaceFailure =
  'stop' | 'cleanup' | 'has-sessions' | 'has-bundles' | 'bundles-unchecked';

/** Stopping several Sessions at once stays well under the per-host limit. */
const STOP_CONCURRENCY = 3;

/** The Space is the source of a Workspace Bundle; nothing was touched. */
export class SpaceHasBundlesError extends Error {
  constructor() {
    super('Space is the source of a Workspace Bundle');
    this.name = 'SpaceHasBundlesError';
  }
}

/**
 * The Bundle list was full, so an older Bundle from this Space may be missing
 * from it; nothing was touched.
 */
export class SpaceBundlesUncheckedError extends Error {
  constructor() {
    super('Workspace Bundles could not all be checked');
    this.name = 'SpaceBundlesUncheckedError';
  }
}

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
  if (error instanceof SpaceHasBundlesError) return 'has-bundles';
  if (error instanceof SpaceBundlesUncheckedError) return 'bundles-unchecked';
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

/**
 * The server refuses to delete a Space that is the source of a Workspace
 * Bundle, so check first rather than deleting its Sessions and then failing.
 */
async function assertNoSourceBundles(spaceId: string) {
  let bundles;
  try {
    bundles = await listOwnedWorkspaceBundles();
  } catch (error) {
    // Servers without Workspace Bundles (self-hosted) have no such route.
    if (statusOf(error) === 404) return;
    throw error;
  }
  if (bundles.some((bundle) => bundle.workspace_id === spaceId)) {
    throw new SpaceHasBundlesError();
  }
  // A full list may leave out an older Bundle made from this Space.
  if (bundles.length >= OWNED_WORKSPACE_BUNDLE_LIST_LIMIT) {
    throw new SpaceBundlesUncheckedError();
  }
}

/**
 * The Sessions this deletion removes. Only the server knows which Space a
 * Session is in now: this window's list can be stale after a Session was
 * moved elsewhere, so a Session it alone places here is never touched.
 * A Session the server already marks deleted is included while this window
 * still shows it, so a retry finishes a cleanup that failed part-way.
 */
async function sessionsToDelete(spaceId: string): Promise<string[]> {
  let projects;
  try {
    projects = await proxyFetchSpaceProjects(spaceId);
  } catch (error) {
    // An absent Space is already deleted; nothing on the server to clean.
    ignoreMissing(error);
    return [];
  }
  const local = useSpaceStore.getState().projectsBySpaceId[spaceId] ?? {};
  return projects
    .filter(
      (project) =>
        project.status !== 'archived' ||
        (local[project.id] && local[project.id].status !== 'archived')
    )
    .map((project) => project.id);
}

/**
 * Deletes a Space together with every Session in it, the way deleting each
 * Session would: stop its Tasks, remove its local Task files and history,
 * and mark it deleted on the server. The Space folder on disk is never
 * touched, nor are Session working directories.
 *
 * Only Sessions the server lists in this Space are touched. A Space that is
 * the source of a Workspace Bundle is refused before anything is stopped.
 * Every Session is stopped before anything is removed, so a Session that
 * cannot be stopped leaves the whole Space as it was. Each Session is marked
 * deleted in this Space before its data goes, so one that has left the Space
 * is skipped untouched. A later failure leaves the remaining Sessions in
 * place; calling this again finishes the job.
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
  const sessionIds = await sessionsToDelete(spaceId);
  // With no Session to clean up first, the server's own refusal is enough.
  if (sessionIds.length) await assertNoSourceBundles(spaceId);
  assertSessionCleanupIdentity(identity);
  const deferLocalCleanup = new Map<string, boolean>();
  await forEachLimited(sessionIds, STOP_CONCURRENCY, async (projectId) => {
    deferLocalCleanup.set(projectId, await stopSessionForDeletion(projectId));
  });

  onPhase?.('deleting');
  const projectStore = useProjectRuntimeStore.getState();
  for (const projectId of sessionIds) {
    assertSessionCleanupIdentity(identity);
    // The server only deletes a Space once each of its Sessions is marked
    // deleted. Doing that first also proves the Session is still in this
    // Space: if it has moved, the server answers 404 and its data stays.
    try {
      await proxyUpdateSpaceProject(spaceId, projectId, {
        status: 'archived',
      });
    } catch (error) {
      ignoreMissing(error);
      continue;
    }
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
    useProjectRuntimeStore.getState().removeProject(projectId);
  }

  assertSessionCleanupIdentity(identity);
  await useSpaceStore.getState().deleteSpaceOnServer(spaceId);
}
