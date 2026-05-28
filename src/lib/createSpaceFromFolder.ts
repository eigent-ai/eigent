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

import type { AppHost } from '@/host';
import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import {
  bindWorkspaceToSpace,
  fetchWorkspaceCapabilities,
  unbindWorkspaceFromBrain,
} from '@/service/workspaceApi';
import type { ProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { isDisposableBlankSpace, useSpaceStore } from '@/store/spaceStore';
import type { TFunction } from 'i18next';

export function getFolderSpaceErrorMessage(error: unknown, t: TFunction) {
  const err = error as {
    status?: number;
    response?: { data?: { detail?: unknown } };
    message?: string;
  };
  const detail = err.response?.data?.detail;
  const code =
    typeof detail === 'object' && detail !== null
      ? String((detail as { code?: unknown }).code || '')
      : '';
  const text = typeof detail === 'string' ? detail : err.message || '';

  if (code === 'workspace_binding_disabled' || err.status === 412) {
    return t('layout.workspace-folder-binding-local-only');
  }
  if (
    code === 'folder_already_bound_to_other_space' ||
    text.includes('already bound') ||
    err.status === 409
  ) {
    return t('layout.workspace-folder-already-bound');
  }
  if (code === 'invalid_workspace_path' || err.status === 403) {
    return t('layout.workspace-folder-unavailable');
  }
  return t('layout.workspace-folder-space-create-failed');
}

export interface CreateSpaceFromFolderInput {
  host: AppHost | null;
  email: string | null | undefined;
  userId: string | number | null | undefined;
  activeSpaceId: string | null;
  projectStore: ProjectRuntimeStore;
  createdFrom: string;
  projectMetadata?: Record<string, unknown>;
  onUnavailable?: () => void;
}

/** Opens the folder picker and creates a new folder-backed Space in one flow. */
export async function createSpaceFromFolderPicker({
  host,
  email,
  userId,
  activeSpaceId,
  projectStore,
  createdFrom,
  projectMetadata,
  onUnavailable,
}: CreateSpaceFromFolderInput): Promise<string | null> {
  const selectFile = host?.electronAPI?.selectFile;
  if (!selectFile || !email) {
    onUnavailable?.();
    return null;
  }

  const previousSpaceId = activeSpaceId;
  const spaceStore = useSpaceStore.getState();

  const capabilities = await fetchWorkspaceCapabilities();
  if (!capabilities.binding_enabled) {
    throw new Error('Workspace folder binding is not available');
  }

  const result = await selectFile({
    properties: ['openDirectory'],
  });
  const folderPath = result?.files?.[0]?.filePath;
  if (!result?.success || !folderPath) {
    return null;
  }

  const folderName =
    folderPath.split(/[\\/]/).filter(Boolean).at(-1) || 'Folder Space';
  let createdSpaceId: string | null = null;
  const spaceId = await spaceStore.createSpaceOnServer({
    name: folderName,
    sourceType: 'folder',
    rootPath: folderPath,
    setActive: false,
    metadata: {
      bindingSource: 'space_local_brain',
    },
  });
  createdSpaceId = spaceId;

  try {
    await bindWorkspaceToSpace({
      space_id: spaceId,
      email,
      user_id: userId,
      path: folderPath,
    });
  } catch (bindError) {
    await spaceStore
      .deleteSpaceOnServer(createdSpaceId)
      .catch((rollbackError) => {
        console.warn(
          '[createSpaceFromFolderPicker] Failed to roll back folder Space:',
          rollbackError
        );
      });
    throw bindError;
  }

  let syncedProject: Awaited<ReturnType<typeof createSyncedProjectInSpace>>;
  try {
    syncedProject = await createSyncedProjectInSpace({
      projectStore,
      spaceId,
      workdirMode: 'direct-write',
      metadata: {
        createdFrom,
        ...projectMetadata,
      },
    });
  } catch (projectError) {
    // Bind succeeded but project creation failed — undo both so we don't
    // leak a Space that's bound but has no Project. Brain unbind first so
    // the next folder pick doesn't see "already bound".
    await unbindWorkspaceFromBrain(spaceId, email, userId).catch(
      (unbindError) => {
        console.warn(
          '[createSpaceFromFolderPicker] Failed to unbind Brain workspace after project-create failure:',
          unbindError
        );
      }
    );
    await spaceStore
      .deleteSpaceOnServer(createdSpaceId)
      .catch((rollbackError) => {
        console.warn(
          '[createSpaceFromFolderPicker] Failed to roll back folder Space after project-create failure:',
          rollbackError
        );
      });
    throw projectError;
  }

  spaceStore.setActiveSpace(syncedProject.spaceId);
  if (
    previousSpaceId &&
    previousSpaceId !== syncedProject.spaceId &&
    isDisposableBlankSpace(
      spaceStore.spaces[previousSpaceId],
      spaceStore.projectsBySpaceId
    )
  ) {
    await spaceStore
      .deleteSpaceOnServer(previousSpaceId)
      .catch((cleanupError) => {
        console.warn(
          '[createSpaceFromFolderPicker] Failed to clean up previous blank Space:',
          cleanupError
        );
      });
  }

  return syncedProject.spaceId;
}
