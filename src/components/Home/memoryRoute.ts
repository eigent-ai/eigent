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

import type { MemoryScopeType } from '@/service/memoryApi';
import type { ProjectGroup } from '@/types/history';

export interface SpaceDetailMemoryTarget {
  scope: {
    type: Extract<MemoryScopeType, 'space' | 'project'>;
    id: string;
  };
  label?: string;
}

export function memoryEditorSearch(
  spaceId: string,
  projectId?: string
): string {
  const params = new URLSearchParams({
    section: 'spaces',
    spaceId,
    spaceTab: 'memory',
  });
  if (projectId) {
    params.set('memoryScope', 'project');
    params.set('projectId', projectId);
  }
  return `?${params.toString()}`;
}

export function resolveSpaceDetailMemoryTarget(
  spaceId: string,
  searchParams: URLSearchParams,
  projects: ProjectGroup[]
): SpaceDetailMemoryTarget {
  if (searchParams.get('memoryScope') === 'project') {
    const projectId = searchParams.get('projectId');
    const project = projectId
      ? projects.find(
          (candidate) =>
            candidate.project_id === projectId &&
            (!candidate.space_id || candidate.space_id === spaceId)
        )
      : null;
    if (project) {
      return {
        scope: { type: 'project', id: project.project_id },
        label: project.project_name?.trim() || undefined,
      };
    }
  }

  return { scope: { type: 'space', id: spaceId } };
}
