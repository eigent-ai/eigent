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
  createScratchWorkspaceForSpace,
  fetchWorkspaceCurrent,
} from '@/service/workspaceApi';
import { type Space, useSpaceStore } from '@/store/spaceStore';

interface EnsureScratchSpaceWorkspaceBindingInput {
  email: string | null | undefined;
  userId: string | number | null | undefined;
  space: Space | null | undefined;
}

const pendingBindings = new Map<string, Promise<string | null>>();

function bindingKey(
  email: string,
  userId: string | number | null | undefined,
  spaceId: string
) {
  return `${email}|${userId ?? ''}|${spaceId}`;
}

function rememberLocalWorkspaceRoot(spaceId: string, rootPath: string) {
  useSpaceStore.getState().updateSpace(spaceId, {
    rootPath,
    metadata: {
      localWorkspaceRoot: rootPath,
      localWorkspaceSource: 'scratch_space',
    },
  });
}

export async function ensureScratchSpaceWorkspaceBinding({
  email,
  userId,
  space,
}: EnsureScratchSpaceWorkspaceBindingInput): Promise<string | null> {
  if (!space || space.sourceType !== 'blank') return space?.rootPath ?? null;
  if (space.rootPath) return space.rootPath;
  if (!email) return null;

  const key = bindingKey(email, userId, space.id);
  const existing = pendingBindings.get(key);
  if (existing) return existing;

  const bindingPromise = (async () => {
    try {
      const current = await fetchWorkspaceCurrent(
        space.id,
        email,
        userId
      ).catch(() => null);
      if (current?.bound && current.workspace_root) {
        rememberLocalWorkspaceRoot(space.id, current.workspace_root);
        return current.workspace_root;
      }

      const bound = await createScratchWorkspaceForSpace({
        space_id: space.id,
        email,
        user_id: userId,
      });
      const workspaceRoot = bound.workspace_root;
      if (!workspaceRoot) return null;
      rememberLocalWorkspaceRoot(space.id, workspaceRoot);
      return workspaceRoot;
    } catch (error) {
      console.warn(
        `[scratchSpaceWorkspace] Failed to bind scratch Space ${space.id}:`,
        error
      );
      return null;
    }
  })();

  pendingBindings.set(key, bindingPromise);
  try {
    return await bindingPromise;
  } finally {
    pendingBindings.delete(key);
  }
}
