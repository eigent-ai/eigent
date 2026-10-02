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

import { proxyFetchPut } from '@/api/http';
import type { ProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';

type ProjectNameStore = Pick<
  ProjectRuntimeStore,
  'getProjectById' | 'updateProject'
>;
type SpaceNameStore = Pick<
  ReturnType<typeof useSpaceStore.getState>,
  'getProjectMeta' | 'updateProjectMeta'
>;

/** Keep the title responsive while the existing Project name API saves. */
export async function renameSession(
  projectId: string,
  name: string,
  projectStore: ProjectNameStore,
  spaceStore: SpaceNameStore,
  persistName: (
    url: string
  ) => Promise<{ code?: number } | undefined> = proxyFetchPut
): Promise<void> {
  const previousProject = projectStore.getProjectById(projectId);
  const previousMeta = spaceStore.getProjectMeta(projectId);
  if (!previousProject && !previousMeta) {
    throw new Error(`Session ${projectId} was not found`);
  }
  if (
    (!previousProject || previousProject.name === name) &&
    (!previousMeta || previousMeta.name === name)
  ) {
    return;
  }

  if (previousProject) {
    projectStore.updateProject(projectId, {
      name,
      metadata: { ...previousProject.metadata, nameSource: 'manual' },
    });
  }
  if (previousMeta) {
    spaceStore.updateProjectMeta(projectId, {
      name,
      metadata: { ...previousMeta.metadata, nameSource: 'manual' },
    });
  }

  try {
    const response = await persistName(
      `/api/v1/chat/project/${projectId}/name?new_name=${encodeURIComponent(name)}`
    );
    if (response?.code !== undefined && response.code !== 0) {
      throw new Error(`Failed to update session name: ${response.code}`);
    }
  } catch (error) {
    // A newer rename may have changed either cache while this request was in
    // flight. Never roll that newer title back with an older failure.
    const currentProject = projectStore.getProjectById(projectId);
    const currentMeta = spaceStore.getProjectMeta(projectId);
    const stillOptimistic =
      (!previousProject || currentProject?.name === name) &&
      (!previousMeta || currentMeta?.name === name);
    if (stillOptimistic) {
      if (previousProject) {
        projectStore.updateProject(projectId, {
          name: previousProject.name,
          metadata: {
            ...previousProject.metadata,
            nameSource: previousProject.metadata?.nameSource,
          },
        });
      }
      if (previousMeta) {
        spaceStore.updateProjectMeta(projectId, {
          name: previousMeta.name,
          metadata: {
            ...previousMeta.metadata,
            nameSource: previousMeta.metadata?.nameSource,
          },
        });
      }
    }
    throw error;
  }
}
