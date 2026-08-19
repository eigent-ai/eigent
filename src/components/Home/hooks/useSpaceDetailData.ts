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
// Licensed under the Apache License, Version 2.0 (the "License");

import {
  getVisibleProjectMetasForSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import type { Trigger } from '@/types';
import type { ProjectGroup } from '@/types/history';
import { useEffect, useMemo } from 'react';
import { useHomeHub } from '../context';

function projectFromMetadata(
  projectId: string,
  spaceId: string,
  name: string,
  updatedAt: number
): ProjectGroup {
  return {
    project_id: projectId,
    space_id: spaceId,
    project_name: name,
    total_tokens: 0,
    task_count: 0,
    total_triggers: 0,
    latest_task_date: new Date(updatedAt).toISOString(),
    last_prompt: '',
    tasks: [],
    total_completed_tasks: 0,
    total_ongoing_tasks: 0,
    average_tokens_per_task: 0,
  };
}

/** One normalized data source for the Space header and all detail tabs. */
export function useSpaceDetailData(spaceId: string) {
  const {
    projects: historyProjects,
    projectsLoading,
    triggers,
    triggersLoading,
  } = useHomeHub();
  const spaces = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);

  useEffect(() => {
    const store = useSpaceStore.getState();
    if (store.shouldSyncProjects(spaceId)) {
      void store.syncProjectsFromServer(spaceId);
    }
  }, [spaceId]);

  const projects = useMemo(() => {
    const historyById = new Map(
      historyProjects
        .filter((project) => project.space_id === spaceId)
        .map((project) => [project.project_id, project])
    );
    const merged = getVisibleProjectMetasForSpace(
      projectsBySpaceId,
      spaceId
    ).map((metadata) => {
      const history = historyById.get(metadata.id);
      historyById.delete(metadata.id);
      return history
        ? {
            ...history,
            space_id: spaceId,
            project_name: metadata.name || history.project_name,
          }
        : projectFromMetadata(
            metadata.id,
            spaceId,
            metadata.name,
            metadata.updatedAt
          );
    });

    return [...merged, ...historyById.values()].sort(
      (left, right) =>
        new Date(right.latest_task_date).getTime() -
        new Date(left.latest_task_date).getTime()
    );
  }, [historyProjects, projectsBySpaceId, spaceId]);

  const projectIds = useMemo(
    () => new Set(projects.map((project) => project.project_id)),
    [projects]
  );

  const spaceTriggers = useMemo<Trigger[]>(
    () =>
      triggers.filter(
        (trigger) =>
          trigger.space_id === spaceId ||
          (!trigger.space_id &&
            Boolean(trigger.project_id && projectIds.has(trigger.project_id)))
      ),
    [projectIds, spaceId, triggers]
  );

  const taskCount = useMemo(
    () =>
      projects.reduce(
        (total, project) =>
          total + Math.max(project.tasks?.length ?? 0, project.task_count ?? 0),
        0
      ),
    [projects]
  );

  return {
    space: spaces[spaceId] ?? null,
    projects,
    triggers: spaceTriggers,
    projectsLoading,
    triggersLoading,
    projectCount: projects.length,
    taskCount,
    triggerCount: spaceTriggers.length,
  };
}
