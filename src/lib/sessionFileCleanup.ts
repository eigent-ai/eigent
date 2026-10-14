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

import { proxyFetchDelete, proxyFetchGet } from '@/api/http';
import { deleteWorkspaceProjectWorkdir } from '@/service/workspaceApi';
import { getAuthStore } from '@/store/authStore';

interface SessionHistoryTask {
  id?: number;
  task_id?: string;
  project_id?: string | null;
}

interface CleanupIdentity {
  email: string | null;
  userId: number | null;
}

export function assertSessionCleanupIdentity(identity: CleanupIdentity) {
  const current = getAuthStore();
  if (current.email !== identity.email || current.user_id !== identity.userId) {
    throw new Error('Session cleanup account changed');
  }
}

/** Keep history available for retry until every local cleanup has succeeded. */
export async function deleteSessionTaskData({
  projectId,
  spaceId,
  email,
  userId,
  knownTasks = [],
  deleteWorkdir = false,
  ipcRenderer,
}: CleanupIdentity & {
  projectId: string;
  spaceId?: string;
  knownTasks?: SessionHistoryTask[];
  /** Also delete the Session's copy/worktree workdir through Brain. */
  deleteWorkdir?: boolean;
  ipcRenderer?: { invoke: (...args: unknown[]) => Promise<unknown> } | null;
}) {
  const identity = { email, userId };
  assertSessionCleanupIdentity(identity);
  let tasks = knownTasks;
  let resolvedSpaceId = spaceId;
  try {
    const history = await proxyFetchGet(
      `/api/v1/chat/histories/grouped/${projectId}`,
      { include_tasks: true }
    );
    if (
      !Array.isArray(history?.tasks) ||
      (history.project_id != null && history.project_id !== projectId)
    ) {
      throw new Error('Invalid Session history response');
    }
    if (history.space_id != null) {
      if (spaceId && history.space_id !== spaceId) {
        throw new Error('Session history belongs to another Space');
      }
      resolvedSpaceId = history.space_id;
    }
    tasks = [...knownTasks, ...history.tasks];
  } catch (error) {
    // A never-run/already-deleted Session may have no server history. Use only
    // its known tasks; a failed lookup must not masquerade as an empty Session.
    if ((error as { status?: number })?.status !== 404) throw error;
  }
  assertSessionCleanupIdentity(identity);
  for (const task of tasks) {
    if (
      !task.task_id ||
      (task.project_id != null && task.project_id !== projectId)
    ) {
      throw new Error('Task does not identify the selected Session');
    }
  }
  if (ipcRenderer) {
    if (!email && userId == null) throw new Error('Missing account identity');
    for (const taskId of new Set(tasks.map((task) => task.task_id))) {
      assertSessionCleanupIdentity(identity);
      const result = (await ipcRenderer.invoke(
        'delete-task-files',
        email ?? '',
        taskId,
        projectId,
        userId,
        resolvedSpaceId
      )) as { success?: boolean } | null;
      if (result?.success !== true)
        throw new Error('Session file cleanup failed');
    }
  }
  if (deleteWorkdir) {
    if (!resolvedSpaceId || !email) {
      throw new Error('Session workdir has no Space owner');
    }
    assertSessionCleanupIdentity(identity);
    await deleteWorkspaceProjectWorkdir(
      resolvedSpaceId,
      projectId,
      email,
      userId
    );
  }
  assertSessionCleanupIdentity(identity);
  const historyIds = new Set(
    tasks.flatMap((task) => (task.id != null ? [task.id] : []))
  );
  for (const historyId of historyIds) {
    assertSessionCleanupIdentity(identity);
    try {
      await proxyFetchDelete(`/api/v1/chat/history/${historyId}`);
    } catch (error) {
      if ((error as { status?: number })?.status !== 404) throw error;
    }
  }
  assertSessionCleanupIdentity(identity);
}
