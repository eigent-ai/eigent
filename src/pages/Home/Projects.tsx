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

import type { ProjectGroup } from '@/types/history';
import { FolderOpen } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import HomeHubBoard from './components/HomeHubBoard';
import HomeHubBoardCard from './components/HomeHubBoardCard';
import HomeHubCard from './components/HomeHubCard';
import HomeHubGrid from './components/HomeHubGrid';
import HomeHubListItem from './components/HomeHubListItem';
import HomeHubListTable from './components/HomeHubListTable';
import { useHomeHub } from './context';
import { useSpaceLabel } from './hooks/useSpaceLabel';
import {
  compareHubByName,
  compareHubByTimestamp,
  matchesHubNameSearch,
  timestampFromHubValue,
} from './utils';
import { getProjectBoardColumn, groupByBoardColumn } from './utils/boardStatus';

function getProjectCreatedTime(project: ProjectGroup): string | number {
  const taskCreatedTimes = project.tasks
    .map((task) => timestampFromHubValue(task.created_at))
    .filter((time) => time > 0);
  if (taskCreatedTimes.length > 0) {
    return Math.min(...taskCreatedTimes);
  }
  return project.latest_task_date;
}

function ProjectRow({
  project,
  viewMode,
  onProjectDelete,
  onProjectRename,
}: {
  project: ProjectGroup;
  viewMode: 'grid' | 'list' | 'board';
  onProjectDelete?: (projectId: string) => void;
  onProjectRename?: (projectId: string, newName: string) => void;
}) {
  const spaceLabel = useSpaceLabel(project.space_id);
  const sharedProps = {
    kind: 'project' as const,
    project,
    spaceLabel,
    onProjectDelete,
    onProjectRename,
  };

  return viewMode === 'list' ? (
    <HomeHubListItem {...sharedProps} />
  ) : viewMode === 'board' ? (
    <HomeHubBoardCard {...sharedProps} />
  ) : (
    <HomeHubCard {...sharedProps} />
  );
}

export default function Projects() {
  const { t } = useTranslation();
  const {
    viewMode,
    searchQuery,
    sortBy,
    sortDirection,
    projects,
    projectsLoading,
    onProjectDelete,
    onProjectRename,
    chatTasks,
  } = useHomeHub();

  const filteredProjects = useMemo(() => {
    const filtered = !searchQuery.trim()
      ? projects
      : projects.filter((project) => {
          const fallbackName = t('layout.new-project');
          return matchesHubNameSearch(
            searchQuery,
            project.project_name?.trim() || fallbackName
          );
        });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        const fallbackName = t('layout.new-project');
        return compareHubByName(
          a.project_name?.trim() || fallbackName,
          b.project_name?.trim() || fallbackName,
          sortDirection
        );
      }
      if (sortBy === 'updated') {
        return compareHubByTimestamp(
          a.latest_task_date,
          b.latest_task_date,
          sortDirection
        );
      }
      return compareHubByTimestamp(
        getProjectCreatedTime(a),
        getProjectCreatedTime(b),
        sortDirection
      );
    });
  }, [projects, searchQuery, sortBy, sortDirection, t]);

  const boardColumns = useMemo(() => {
    const grouped = groupByBoardColumn(filteredProjects, (project) =>
      getProjectBoardColumn(project, chatTasks)
    );

    return {
      default: grouped.default.map((project) => (
        <ProjectRow
          key={project.project_id}
          project={project}
          viewMode="board"
          onProjectDelete={onProjectDelete}
          onProjectRename={onProjectRename}
        />
      )),
      running: grouped.running.map((project) => (
        <ProjectRow
          key={project.project_id}
          project={project}
          viewMode="board"
          onProjectDelete={onProjectDelete}
          onProjectRename={onProjectRename}
        />
      )),
      awaiting_review: grouped.awaiting_review.map((project) => (
        <ProjectRow
          key={project.project_id}
          project={project}
          viewMode="board"
          onProjectDelete={onProjectDelete}
          onProjectRename={onProjectRename}
        />
      )),
    };
  }, [chatTasks, filteredProjects, onProjectDelete, onProjectRename]);

  if (projectsLoading) {
    return (
      <div className="min-w-0 flex w-full flex-col">
        <div className="pb-12 text-body-sm text-ds-text-neutral-muted-default">
          {t('layout.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex w-full flex-col">
      <div className="mb-12 min-w-0 w-full">
        {projects.length === 0 ? (
          <div className="p-8 flex flex-col items-center justify-center text-center">
            <FolderOpen className="mb-4 h-12 w-12 text-ds-icon-neutral-muted-default" />
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('dashboard.no-projects-found')}
            </div>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="p-8 flex flex-col items-center justify-center text-center">
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('layout.search-no-results')}
            </div>
          </div>
        ) : viewMode === 'board' ? (
          <HomeHubBoard columns={boardColumns} />
        ) : viewMode === 'grid' ? (
          <HomeHubGrid>
            {filteredProjects.map((project) => (
              <ProjectRow
                key={project.project_id}
                project={project}
                viewMode={viewMode}
                onProjectDelete={onProjectDelete}
                onProjectRename={onProjectRename}
              />
            ))}
          </HomeHubGrid>
        ) : (
          <HomeHubListTable kind="project">
            {filteredProjects.map((project) => (
              <ProjectRow
                key={project.project_id}
                project={project}
                viewMode={viewMode}
                onProjectDelete={onProjectDelete}
                onProjectRename={onProjectRename}
              />
            ))}
          </HomeHubListTable>
        )}
      </div>
    </div>
  );
}
