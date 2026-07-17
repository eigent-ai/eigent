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

import { proxyUpdateSpaceProject } from '@/service/spaceApi';
import type { ProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';

export const isProjectAchieved = (
  metadata?: { status?: string } | null
): boolean => metadata?.status === 'completed';

export const setProjectAchievedState = async ({
  projectStore,
  projectId,
  achieved,
  achievedAt = Date.now(),
}: {
  projectStore: ProjectRuntimeStore;
  projectId: string;
  achieved: boolean;
  achievedAt?: number;
}): Promise<void> => {
  const spaceStore = useSpaceStore.getState();
  const projectMeta = spaceStore.getProjectMeta(projectId);
  if (!projectMeta?.spaceId) {
    throw new Error('Project Space not found');
  }

  const metadata = achieved
    ? { status: 'completed' as const, achievedAt }
    : { status: 'active' as const, achievedAt: null };

  if (projectStore.getProjectById(projectId)) {
    projectStore.updateProject(projectId, { metadata });
  }
  spaceStore.updateProjectMeta(projectId, {
    metadata,
  });

  try {
    const updated = await proxyUpdateSpaceProject(
      projectMeta.spaceId,
      projectId,
      { metadata }
    );
    spaceStore.updateProjectMeta(projectId, {
      status: updated.status,
      metadata,
    });
  } catch (error) {
    if (projectStore.getProjectById(projectId)) {
      projectStore.updateProject(projectId, {
        metadata: projectMeta.metadata,
      });
    }
    spaceStore.updateProjectMeta(projectId, {
      status: projectMeta.status,
      metadata: projectMeta.metadata,
    });
    throw error;
  }
};
