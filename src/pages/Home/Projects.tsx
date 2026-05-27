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
import HomeHubCard from './components/HomeHubCard';
import HomeHubListItem from './components/HomeHubListItem';
import SectionHeader from './components/SectionHeader';
import { useHomeHub } from './context';
import { useSpaceLabel } from './hooks/useSpaceLabel';
import { capitalizeLabel, matchesHubNameSearch } from './utils';

function ProjectRow({
  project,
  viewMode,
  onProjectDelete,
  onProjectRename,
}: {
  project: ProjectGroup;
  viewMode: 'grid' | 'list';
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

  return viewMode === 'grid' ? (
    <HomeHubCard {...sharedProps} />
  ) : (
    <HomeHubListItem {...sharedProps} />
  );
}

export default function Projects() {
  const { t } = useTranslation();
  const {
    viewMode,
    searchQuery,
    projects,
    projectsLoading,
    onProjectDelete,
    onProjectRename,
  } = useHomeHub();

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const fallbackName = t('layout.new-project');
    return projects.filter((project) =>
      matchesHubNameSearch(
        searchQuery,
        project.project_name?.trim() || fallbackName
      )
    );
  }, [projects, searchQuery, t]);

  if (projectsLoading) {
    return (
      <div className="min-w-0 flex w-full flex-col">
        <SectionHeader
          title={capitalizeLabel(t('layout.projects'))}
          searchPlaceholder={t('layout.search-projects')}
        />
        <div className="pb-12 text-body-sm text-ds-text-neutral-muted-default">
          {t('layout.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex w-full flex-col">
      <SectionHeader
        title={capitalizeLabel(t('layout.projects'))}
        searchPlaceholder={t('layout.search-projects')}
      />

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
        ) : viewMode === 'grid' ? (
          <div className="gap-4 sm:grid-cols-2 grid auto-rows-fr grid-cols-1">
            {filteredProjects.map((project) => (
              <ProjectRow
                key={project.project_id}
                project={project}
                viewMode={viewMode}
                onProjectDelete={onProjectDelete}
                onProjectRename={onProjectRename}
              />
            ))}
          </div>
        ) : (
          <div className="gap-3 flex flex-col">
            {filteredProjects.map((project) => (
              <ProjectRow
                key={project.project_id}
                project={project}
                viewMode={viewMode}
                onProjectDelete={onProjectDelete}
                onProjectRename={onProjectRename}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
