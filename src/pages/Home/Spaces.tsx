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

import { isLegacySpace } from '@/lib/spaceLabel';
import {
  getVisibleProjectMetasForSpace,
  isDisposableBlankSpace,
  useSpaceStore,
  type Space,
} from '@/store/spaceStore';
import { FolderKanban } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import HomeHubCard from './components/HomeHubCard';
import HomeHubListItem from './components/HomeHubListItem';
import SectionHeader from './components/SectionHeader';
import { useHomeHub } from './context';
import { capitalizeLabel, matchesHubNameSearch } from './utils';

const pathBasename = (path?: string | null) => {
  const value = path?.trim();
  if (!value) return '';
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || value;
};

export default function Spaces() {
  const { t } = useTranslation();
  const { viewMode, searchQuery, projects: hubProjects } = useHomeHub();
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
        }))
        .sort((a, b) => {
          const legacyDelta =
            Number(isLegacySpace(b.space)) - Number(isLegacySpace(a.space));
          if (legacyDelta !== 0) return legacyDelta;
          return b.space.updatedAt - a.space.updatedAt;
        }),
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

  const getSubtitle = (space: Space) => {
    if (space.sourceType === 'folder') {
      return pathBasename(space.rootPath) || space.rootPath || '';
    }
    if (isLegacySpace(space)) {
      return t('layout.spaces-hub-legacy-description');
    }
    return t('layout.spaces-hub-blank-description');
  };

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
    if (!searchQuery.trim()) return spaceSections;
    const untitled = t('layout.spaces-untitled');
    return spaceSections.filter(({ space }) =>
      matchesHubNameSearch(searchQuery, space.name?.trim() || untitled)
    );
  }, [searchQuery, spaceSections, t]);

  return (
    <div className="flex w-full min-w-0 flex-col">
      <SectionHeader
        title={capitalizeLabel(t('layout.spaces'))}
        searchPlaceholder={t('layout.search-spaces')}
      />

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
        ) : viewMode === 'grid' ? (
          <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>
        ) : (
          <div className="flex flex-col gap-3">
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
          </div>
        )}
      </div>
    </div>
  );
}
