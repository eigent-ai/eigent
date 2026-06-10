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

import { generateUniqueId } from '@/lib';
import { isLegacySpace } from '@/lib/spaceLabel';
import {
  proxyCreateSpaceProject,
  proxyEnsureLegacySpace,
} from '@/service/spaceApi';
import type {
  ProjectMode,
  ProjectRuntimeStore,
  ProjectWorkdirMode,
} from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';

/**
 * Thrown when something tries to create a Project inside a legacy Space. Legacy
 * Spaces are read-only — see {@link canCreateProjectInSpace}. UI entry points
 * disable creation up front; this is the backstop that guarantees the invariant
 * for any caller that slips through.
 */
export class LegacySpaceProjectError extends Error {
  constructor() {
    super('Cannot create a Project inside a legacy Space.');
    this.name = 'LegacySpaceProjectError';
  }
}

interface CreateSyncedProjectInSpaceInput {
  projectStore: ProjectRuntimeStore;
  spaceId: string;
  name?: string;
  description?: string;
  mode?: ProjectMode | null;
  workdirMode?: ProjectWorkdirMode | null;
  metadata?: Record<string, unknown>;
  setActive?: boolean;
}

interface CreateSyncedProjectInSpaceResult {
  projectId: string;
  spaceId: string;
}

export const resolveServerBackedSpaceId = async (
  projectStore: ProjectRuntimeStore,
  spaceId: string
): Promise<string> => {
  if (!spaceId.startsWith('legacy_')) {
    return spaceId;
  }

  const legacySpace = await proxyEnsureLegacySpace();
  const spaceStore = useSpaceStore.getState();
  spaceStore.upsertSpaces([legacySpace], legacySpace.id);

  Object.values(projectStore.projects).forEach((project) => {
    if (
      !project.spaceId ||
      project.spaceId === spaceId ||
      project.spaceId.startsWith('legacy_')
    ) {
      projectStore.setProjectSpace(project.id, legacySpace.id);
    }
  });

  if (spaceId !== legacySpace.id) {
    spaceStore.deleteSpace(spaceId);
  }

  return legacySpace.id;
};

export const createSyncedProjectInSpace = async ({
  projectStore,
  spaceId,
  name = 'new project',
  description,
  mode,
  workdirMode,
  metadata,
  setActive = true,
}: CreateSyncedProjectInSpaceInput): Promise<CreateSyncedProjectInSpaceResult> => {
  // Reject legacy Spaces before `resolveServerBackedSpaceId` runs any of its
  // ensure/remap side effects. A bare `legacy_` id is always legacy; otherwise
  // consult the loaded Space metadata.
  const requestedSpace = useSpaceStore.getState().getSpaceById(spaceId);
  if (
    spaceId.startsWith('legacy_') ||
    (requestedSpace && isLegacySpace(requestedSpace))
  ) {
    throw new LegacySpaceProjectError();
  }

  const resolvedSpaceId = await resolveServerBackedSpaceId(
    projectStore,
    spaceId
  );
  const projectId = generateUniqueId();
  const projectMetadata = {
    ...metadata,
    serverSynced: true,
  };

  await proxyCreateSpaceProject(resolvedSpaceId, {
    id: projectId,
    name,
    description,
    mode,
    workdir_mode: workdirMode,
    metadata: projectMetadata,
  });

  const localProjectId = projectStore.createProject(
    name,
    description,
    projectId,
    undefined,
    undefined,
    setActive,
    {
      spaceId: resolvedSpaceId,
      mode,
      workdirMode,
      metadata: projectMetadata,
    }
  );

  return {
    projectId: localProjectId,
    spaceId: resolvedSpaceId,
  };
};
