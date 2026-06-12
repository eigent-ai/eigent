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

import { isLegacySpace, isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import {
  getVisibleProjectMetasForSpace,
  isDisposableBlankSpace,
  useSpaceStore,
  type Space,
} from '@/store/spaceStore';
import { FolderKanban } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import HomeHubBoard from './components/HomeHubBoard';
import HomeHubBoardCard from './components/HomeHubBoardCard';
import HomeHubCard from './components/HomeHubCard';
import HomeHubGrid from './components/HomeHubGrid';
import HomeHubListItem from './components/HomeHubListItem';
import HomeHubListTable from './components/HomeHubListTable';
import { useHomeHub } from './context';
import {
  compareHubByName,
  compareHubByTimestamp,
  matchesHubNameSearch,
} from './utils';
import { getSpaceBoardColumn, groupByBoardColumn } from './utils/boardStatus';

const pathBasename = (path?: string | null) => {
  const value = path?.trim();
  if (!value) return '';
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || value;
};

export default function Spaces() {
  const { t } = useTranslation();
  const {
    viewMode,
    searchQuery,
    projects: hubProjects,
    sortBy,
    sortDirection,
    triggers,
    chatTasks,
  } = useHomeHub();
  const spacesById = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);

  const spaceSections = useMemo(
    () =>
      Object.values(spacesById)
        .filter(
          (space) =>
            space.status !== 'archived' &&
            (space.id === activeSpaceId ||
              !isDisposableBlankSpace(space, projectsBySpaceId))
        )
        .map((space) => ({
          space,
          projects: getVisibleProjectMetasForSpace(projectsBySpaceId, space.id),
        })),
    [activeSpaceId, projectsBySpaceId, spacesById]
  );

  const spaceIdsKey = useMemo(
    () => spaceSections.map(({ space }) => space.id).join('|'),
    [spaceSections]
  );

  useEffect(() => {
    const spaceIds = spaceIdsKey.split('|').filter(Boolean);
    if (spaceIds.length === 0) return;

    const store = useSpaceStore.getState();
    for (const spaceId of spaceIds) {
      const space = store.getSpaceById(spaceId);
      if (!space) continue;
      if (isLegacySpace(space) || store.shouldSyncProjects(space.id)) {
        void store.syncProjectsFromServer(space.id);
      }
    }
  }, [spaceIdsKey]);

  const getSubtitle = useCallback(
    (space: Space) => {
      if (isLocalWorkspaceSpace(space)) {
        return pathBasename(space.rootPath) || space.rootPath || '';
      }
      if (isLegacySpace(space)) {
        return t('layout.spaces-hub-legacy-description');
      }
      return t('layout.spaces-hub-blank-description');
    },
    [t]
  );

  const hubProjectsBySpaceId = useMemo(() => {
    const map = new Map<string, typeof hubProjects>();
    for (const project of hubProjects) {
      if (!project.space_id) continue;
      const list = map.get(project.space_id);
      if (list) {
        list.push(project);
      } else {
        map.set(project.space_id, [project]);
      }
    }
    return map;
  }, [hubProjects]);

  const triggersBySpaceId = useMemo(() => {
    const map = new Map<string, typeof triggers>();
    for (const trigger of triggers) {
      if (!trigger.space_id) continue;
      const list = map.get(trigger.space_id);
      if (list) {
        list.push(trigger);
      } else {
        map.set(trigger.space_id, [trigger]);
      }
    }
    return map;
  }, [triggers]);

  const getSpaceStats = useCallback(
    (spaceId: string, projectCount: number) => {
      const hubForSpace = hubProjects.filter(
        (project) => project.space_id === spaceId
      );
      return {
        projectCount,
        taskCount: hubForSpace.reduce(
          (sum, project) => sum + (project.task_count || 0),
          0
        ),
        triggerCount: hubForSpace.reduce(
          (sum, project) => sum + (project.total_triggers || 0),
          0
        ),
      };
    },
    [hubProjects]
  );

  const filteredSpaceSections = useMemo(() => {
    const filtered = !searchQuery.trim()
      ? spaceSections
      : spaceSections.filter(({ space }) => {
          const untitled = t('layout.spaces-untitled');
          return matchesHubNameSearch(
            searchQuery,
            space.name?.trim() || untitled
          );
        });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        const untitled = t('layout.spaces-untitled');
        return compareHubByName(
          a.space.name?.trim() || untitled,
          b.space.name?.trim() || untitled,
          sortDirection
        );
      }
      if (sortBy === 'updated') {
        return compareHubByTimestamp(
          a.space.updatedAt,
          b.space.updatedAt,
          sortDirection
        );
      }
      return compareHubByTimestamp(
        a.space.createdAt,
        b.space.createdAt,
        sortDirection
      );
    });
  }, [searchQuery, sortBy, sortDirection, spaceSections, t]);

  const boardColumns = useMemo(() => {
    const grouped = groupByBoardColumn(filteredSpaceSections, ({ space }) =>
      getSpaceBoardColumn(
        hubProjectsBySpaceId.get(space.id) ?? [],
        triggersBySpaceId.get(space.id) ?? [],
        chatTasks
      )
    );

    const renderSpaceCard = ({
      space,
      projects,
    }: (typeof filteredSpaceSections)[number]) => {
      const stats = getSpaceStats(space.id, projects.length);
      return (
        <HomeHubBoardCard
          key={space.id}
          kind="space"
          space={space}
          subtitle={getSubtitle(space)}
          isLegacy={isLegacySpace(space)}
          projectCount={stats.projectCount}
          taskCount={stats.taskCount}
          triggerCount={stats.triggerCount}
        />
      );
    };

    return {
      default: grouped.default.map(renderSpaceCard),
      running: grouped.running.map(renderSpaceCard),
      awaiting_review: grouped.awaiting_review.map(renderSpaceCard),
    };
  }, [
    chatTasks,
    filteredSpaceSections,
    getSpaceStats,
    getSubtitle,
    hubProjectsBySpaceId,
    triggersBySpaceId,
  ]);

  return (
    <div className="flex w-full min-w-0 flex-col">
      <div className="mb-12 w-full min-w-0">
        {spaceSections.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <FolderKanban className="mb-4 h-12 w-12 text-ds-icon-neutral-muted-default" />
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('layout.spaces-hub-empty-title')}
            </div>
          </div>
        ) : filteredSpaceSections.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('layout.search-no-results')}
            </div>
          </div>
        ) : viewMode === 'board' ? (
          <HomeHubBoard columns={boardColumns} />
        ) : viewMode === 'grid' ? (
          <HomeHubGrid>
            {filteredSpaceSections.map(({ space, projects }) => {
              const stats = getSpaceStats(space.id, projects.length);
              return (
                <HomeHubCard
                  key={space.id}
                  kind="space"
                  space={space}
                  subtitle={getSubtitle(space)}
                  isLegacy={isLegacySpace(space)}
                  projectCount={stats.projectCount}
                  taskCount={stats.taskCount}
                  triggerCount={stats.triggerCount}
                />
              );
            })}
          </HomeHubGrid>
        ) : (
          <HomeHubListTable kind="space">
            {filteredSpaceSections.map(({ space, projects }) => {
              const stats = getSpaceStats(space.id, projects.length);
              return (
                <HomeHubListItem
                  key={space.id}
                  kind="space"
                  space={space}
                  subtitle={getSubtitle(space)}
                  isLegacy={isLegacySpace(space)}
                  projectCount={stats.projectCount}
                  taskCount={stats.taskCount}
                  triggerCount={stats.triggerCount}
                />
              );
            })}
          </HomeHubListTable>
        )}
      </div>
    </div>
  );
}
