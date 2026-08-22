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

import { resolveWorkSessionDisplayName } from '@/lib/spaceLabel';
import type { ProjectGroup } from '@/types/history';
import { MessageCircle } from 'lucide-react';
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
import { SpaceDetailListSkeleton } from './SpaceDetailLoadingSkeleton';
import {
  compareHubByName,
  compareHubByTimestamp,
  matchesHubNameSearch,
  timestampFromHubValue,
} from './utils';
import {
  getWorkSessionBoardColumn,
  groupByBoardColumn,
} from './utils/boardStatus';

function getWorkSessionCreatedTime(workSession: ProjectGroup): string | number {
  const taskCreatedTimes = workSession.tasks
    .map((task) => timestampFromHubValue(task.created_at))
    .filter((time) => time > 0);
  if (taskCreatedTimes.length > 0) {
    return Math.min(...taskCreatedTimes);
  }
  return workSession.latest_task_date;
}

function WorkSessionRow({
  workSession,
  viewMode,
  onWorkSessionDelete,
  onWorkSessionRename,
}: {
  workSession: ProjectGroup;
  viewMode: 'grid' | 'list' | 'board';
  onWorkSessionDelete?: (projectId: string) => void;
  onWorkSessionRename?: (projectId: string, newName: string) => void;
}) {
  const spaceLabel = useSpaceLabel(workSession.space_id);
  const sharedProps = {
    kind: 'project' as const,
    project: workSession,
    spaceLabel,
    onWorkSessionDelete,
    onWorkSessionRename,
  };

  return viewMode === 'list' ? (
    <HomeHubListItem {...sharedProps} />
  ) : viewMode === 'board' ? (
    <HomeHubBoardCard {...sharedProps} />
  ) : (
    <HomeHubCard {...sharedProps} />
  );
}

interface WorkSessionsProps {
  workSessionsOverride?: ProjectGroup[];
  presentation?: 'home' | 'space-detail';
}

export default function WorkSessions({
  workSessionsOverride,
  presentation = 'home',
}: WorkSessionsProps = {}) {
  const { t } = useTranslation();
  const {
    viewMode,
    searchQuery,
    sortBy,
    sortDirection,
    projects: homeWorkSessions,
    projectsLoading: workSessionsLoading,
    onWorkSessionDelete,
    onWorkSessionRename,
    chatTasks,
  } = useHomeHub();
  const workSessions = workSessionsOverride ?? homeWorkSessions;
  const effectiveViewMode = presentation === 'space-detail' ? 'list' : viewMode;
  const effectiveSearchQuery =
    presentation === 'space-detail' ? '' : searchQuery;

  const filteredWorkSessions = useMemo(() => {
    const filtered = !effectiveSearchQuery.trim()
      ? workSessions
      : workSessions.filter((workSession) => {
          return matchesHubNameSearch(
            effectiveSearchQuery,
            resolveWorkSessionDisplayName(
              workSession.project_name,
              workSession.project_id,
              t('layout.new-project')
            )
          );
        });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        return compareHubByName(
          resolveWorkSessionDisplayName(
            a.project_name,
            a.project_id,
            t('layout.new-project')
          ),
          resolveWorkSessionDisplayName(
            b.project_name,
            b.project_id,
            t('layout.new-project')
          ),
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
        getWorkSessionCreatedTime(a),
        getWorkSessionCreatedTime(b),
        sortDirection
      );
    });
  }, [effectiveSearchQuery, sortBy, sortDirection, t, workSessions]);

  const boardColumns = useMemo(() => {
    const grouped = groupByBoardColumn(filteredWorkSessions, (workSession) =>
      getWorkSessionBoardColumn(workSession, chatTasks)
    );

    return {
      default: grouped.default.map((workSession) => (
        <WorkSessionRow
          key={workSession.project_id}
          workSession={workSession}
          viewMode="board"
          onWorkSessionDelete={onWorkSessionDelete}
          onWorkSessionRename={onWorkSessionRename}
        />
      )),
      running: grouped.running.map((workSession) => (
        <WorkSessionRow
          key={workSession.project_id}
          workSession={workSession}
          viewMode="board"
          onWorkSessionDelete={onWorkSessionDelete}
          onWorkSessionRename={onWorkSessionRename}
        />
      )),
      awaiting_review: grouped.awaiting_review.map((workSession) => (
        <WorkSessionRow
          key={workSession.project_id}
          workSession={workSession}
          viewMode="board"
          onWorkSessionDelete={onWorkSessionDelete}
          onWorkSessionRename={onWorkSessionRename}
        />
      )),
    };
  }, [
    chatTasks,
    filteredWorkSessions,
    onWorkSessionDelete,
    onWorkSessionRename,
  ]);

  if (workSessionsLoading) {
    if (presentation === 'space-detail') {
      return <SpaceDetailListSkeleton kind="project" />;
    }
    return (
      <div className="flex w-full min-w-0 flex-col">
        <div className="pb-12 text-body-sm text-ds-text-neutral-muted-default">
          {t('layout.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col">
      <div className="mb-12 w-full min-w-0">
        {workSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <MessageCircle className="mb-4 h-12 w-12 text-ds-icon-neutral-muted-default" />
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('dashboard.no-projects-found')}
            </div>
          </div>
        ) : filteredWorkSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('layout.search-no-results')}
            </div>
          </div>
        ) : effectiveViewMode === 'board' ? (
          <HomeHubBoard columns={boardColumns} />
        ) : effectiveViewMode === 'grid' ? (
          <HomeHubGrid>
            {filteredWorkSessions.map((workSession) => (
              <WorkSessionRow
                key={workSession.project_id}
                workSession={workSession}
                viewMode={effectiveViewMode}
                onWorkSessionDelete={onWorkSessionDelete}
                onWorkSessionRename={onWorkSessionRename}
              />
            ))}
          </HomeHubGrid>
        ) : (
          <HomeHubListTable kind="project">
            {filteredWorkSessions.map((workSession) => (
              <WorkSessionRow
                key={workSession.project_id}
                workSession={workSession}
                viewMode={effectiveViewMode}
                onWorkSessionDelete={onWorkSessionDelete}
                onWorkSessionRename={onWorkSessionRename}
              />
            ))}
          </HomeHubListTable>
        )}
      </div>
    </div>
  );
}
