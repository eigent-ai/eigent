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

import { HistoryTask, ProjectGroup as ProjectGroupType } from '@/types/history';
import { ListChecks } from 'lucide-react';
import { useCallback, useMemo } from 'react';
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
} from './utils';
import { getTaskBoardColumn, groupByBoardColumn } from './utils/boardStatus';

type TaskWithContext = HistoryTask & { projectName?: string };

function TaskRow({
  task,
  viewMode,
  project,
  onDelete,
  onShare,
}: {
  task: TaskWithContext;
  viewMode: 'grid' | 'list' | 'board';
  project?: ProjectGroupType;
  onDelete: () => void;
  onShare: () => void;
}) {
  const spaceLabel = useSpaceLabel(task.space_id);
  const sharedProps = {
    kind: 'task' as const,
    task,
    spaceLabel,
    project,
    onDelete,
    onShare,
  };

  return viewMode === 'list' ? (
    <HomeHubListItem {...sharedProps} />
  ) : viewMode === 'board' ? (
    <HomeHubBoardCard {...sharedProps} />
  ) : (
    <HomeHubCard {...sharedProps} />
  );
}

export default function Tasks() {
  const { t } = useTranslation();
  const {
    viewMode,
    searchQuery,
    sortBy,
    sortDirection,
    projects,
    projectsLoading,
    onTaskDelete,
    onTaskShare,
    chatTasks,
  } = useHomeHub();

  const tasks = useMemo<TaskWithContext[]>(() => {
    return projects.flatMap((project) =>
      project.tasks.map((task) => ({
        ...task,
        projectName: project.project_name,
        space_id: task.space_id || project.space_id,
      }))
    );
  }, [projects]);

  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.project_id, project])),
    [projects]
  );

  const filteredTasks = useMemo(() => {
    const filtered = !searchQuery.trim()
      ? tasks
      : tasks.filter((task) => {
          const fallbackName = t('layout.new-project');
          return matchesHubNameSearch(
            searchQuery,
            task.question?.trim() || fallbackName
          );
        });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        const fallbackName = t('layout.new-project');
        return compareHubByName(
          a.question?.trim() || fallbackName,
          b.question?.trim() || fallbackName,
          sortDirection
        );
      }
      if (sortBy === 'updated') {
        return compareHubByTimestamp(
          a.updated_at || a.created_at,
          b.updated_at || b.created_at,
          sortDirection
        );
      }
      return compareHubByTimestamp(a.created_at, b.created_at, sortDirection);
    });
  }, [tasks, searchQuery, sortBy, sortDirection, t]);

  const renderTaskRow = useCallback(
    (task: TaskWithContext, mode: 'grid' | 'list' | 'board') => (
      <TaskRow
        key={task.id}
        task={task}
        viewMode={mode}
        project={projectsById.get(task.project_id)}
        onDelete={() => onTaskDelete(String(task.id))}
        onShare={() => onTaskShare(task.task_id)}
      />
    ),
    [onTaskDelete, onTaskShare, projectsById]
  );

  const boardColumns = useMemo(() => {
    const grouped = groupByBoardColumn(filteredTasks, (task) =>
      getTaskBoardColumn(task, chatTasks)
    );

    return {
      default: grouped.default.map((task) => renderTaskRow(task, 'board')),
      running: grouped.running.map((task) => renderTaskRow(task, 'board')),
      awaiting_review: grouped.awaiting_review.map((task) =>
        renderTaskRow(task, 'board')
      ),
    };
  }, [chatTasks, filteredTasks, renderTaskRow]);

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
        {tasks.length === 0 ? (
          <div className="p-8 flex flex-col items-center justify-center text-center">
            <ListChecks className="mb-4 h-12 w-12 text-ds-icon-neutral-muted-default" />
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('dashboard.no-tasks-found') || t('layout.total-tasks')}
            </div>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="p-8 flex flex-col items-center justify-center text-center">
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('layout.search-no-results')}
            </div>
          </div>
        ) : viewMode === 'board' ? (
          <HomeHubBoard columns={boardColumns} />
        ) : viewMode === 'grid' ? (
          <HomeHubGrid>
            {filteredTasks.map((task) => renderTaskRow(task, 'grid'))}
          </HomeHubGrid>
        ) : (
          <HomeHubListTable kind="task">
            {filteredTasks.map((task) => renderTaskRow(task, 'list'))}
          </HomeHubListTable>
        )}
      </div>
    </div>
  );
}
