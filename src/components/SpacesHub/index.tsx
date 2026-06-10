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

import { proxyFetchGet } from '@/api/http';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import {
  buildTaskQuestionsById,
  computeProjectFreshnessAnchor,
} from '@/lib/replay';
import {
  canCreateProjectInSpace,
  isLegacySpace,
  isLocalWorkspaceSpace,
} from '@/lib/spaceLabel';
import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  getVisibleProjectMetasForSpace,
  isDisposableBlankSpace,
  useSpaceStore,
  type Space,
  type SpaceProjectMeta,
} from '@/store/spaceStore';
import {
  ArrowRight,
  Folder,
  FolderKanban,
  History,
  Loader2,
  Plus,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const SPACE_CARD_CLASS =
  'flex min-h-[12rem] flex-col rounded-lg border border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default';

const pathBasename = (path?: string | null) => {
  const value = path?.trim();
  if (!value) return '';
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || value;
};

const projectTitle = (project: SpaceProjectMeta, fallback: string) => {
  const name = project.name?.trim();
  if (!name || name.toLowerCase() === 'new project') return fallback;
  return name;
};

export default function SpacesHub() {
  const { t } = useTranslation();
  const spacesById = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const setActiveSpace = useSpaceStore((state) => state.setActiveSpace);
  const setActiveWorkspaceTab = usePageTabStore(
    (state) => state.setActiveWorkspaceTab
  );
  const projectStore = useProjectRuntimeStore();
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [creatingInSpaceId, setCreatingInSpaceId] = useState<string | null>(
    null
  );

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
    // `spaceIdsKey` keeps this effect from re-running on every project metadata
    // update while still syncing newly visible Spaces.
  }, [spaceIdsKey]);

  const openSpace = useCallback(
    (spaceId: string) => {
      setActiveSpace(spaceId);
      projectStore.setActiveProject(null);
      setActiveWorkspaceTab('new-project');
    },
    [projectStore, setActiveSpace, setActiveWorkspaceTab]
  );

  const openProject = useCallback(
    async (spaceId: string, project: SpaceProjectMeta) => {
      setLoadingProjectId(project.id);
      try {
        setActiveSpace(spaceId);
        projectStore.setActiveProject(project.id);
        setActiveWorkspaceTab('project');

        if (projectStore.peekActiveChatStore(project.id)) {
          return;
        }

        const historyProject = await proxyFetchGet(
          `/api/v1/chat/histories/grouped/${project.id}`,
          { include_tasks: true }
        );
        const taskIdsList = (historyProject?.tasks ?? [])
          .map((task: { task_id?: string | null }) => task.task_id)
          .filter((taskId: string | null | undefined): taskId is string =>
            Boolean(taskId)
          );

        if (taskIdsList.length === 0) {
          projectStore.appendInitChatStore(project.id);
          setActiveWorkspaceTab('new-project');
          return;
        }

        const firstTask = historyProject.tasks[0];
        const taskQuestionsById = buildTaskQuestionsById(historyProject?.tasks);
        await projectStore.loadProjectFromHistory(
          taskIdsList,
          firstTask?.question || historyProject.last_prompt || '',
          project.id,
          firstTask?.id != null ? String(firstTask.id) : undefined,
          historyProject.project_name || project.name,
          spaceId,
          taskQuestionsById,
          computeProjectFreshnessAnchor(historyProject)
        );
        setActiveWorkspaceTab('project');
      } catch (error) {
        console.error(`Failed to open Project ${project.id}:`, error);
        if (!projectStore.peekActiveChatStore(project.id)) {
          projectStore.appendInitChatStore(project.id);
        }
        setActiveWorkspaceTab('new-project');
      } finally {
        setLoadingProjectId(null);
      }
    },
    [projectStore, setActiveSpace, setActiveWorkspaceTab]
  );

  const createProject = useCallback(
    async (space: Space) => {
      if (!canCreateProjectInSpace(space)) return;
      setCreatingInSpaceId(space.id);
      try {
        const result = await createSyncedProjectInSpace({
          projectStore,
          spaceId: space.id,
          workdirMode: isLocalWorkspaceSpace(space)
            ? 'direct-write'
            : 'artifact-only',
          metadata: {
            createdFrom: 'spaces_hub',
          },
        });
        setActiveSpace(result.spaceId);
        setActiveWorkspaceTab('new-project');
      } catch (error) {
        console.error('Failed to create Project from Spaces Hub:', error);
        toast.error(t('layout.spaces-create-project-failed'), {
          closeButton: true,
        });
      } finally {
        setCreatingInSpaceId(null);
      }
    },
    [projectStore, setActiveSpace, setActiveWorkspaceTab, t]
  );

  if (spaceSections.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <FolderKanban
            className="h-10 w-10 text-ds-icon-neutral-muted-default"
            aria-hidden
          />
          <div className="text-heading-lg font-semibold text-ds-text-neutral-default-default">
            {t('layout.spaces-hub-empty-title')}
          </div>
          <p className="text-body-sm text-ds-text-neutral-muted-default">
            {t('layout.spaces-hub-empty-description')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-end justify-between gap-4 border-0 border-b border-solid border-ds-border-neutral-subtle-default px-8 py-6">
        <div className="min-w-0">
          <h1 className="text-heading-2xl m-0 font-semibold text-ds-text-neutral-default-default">
            {t('layout.spaces-hub-title')}
          </h1>
          <p className="m-0 mt-1 text-body-sm text-ds-text-neutral-muted-default">
            {t('layout.spaces-hub-description')}
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-2 text-body-sm text-ds-text-neutral-subtle-default md:flex">
          <FolderKanban className="h-4 w-4" aria-hidden />
          <span>
            {t('layout.spaces-hub-space-count', {
              count: spaceSections.length,
            })}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {spaceSections.map(({ space, projects }) => {
            const isActive = space.id === activeSpaceId;
            const canCreate = canCreateProjectInSpace(space);
            const subtitle = isLocalWorkspaceSpace(space)
              ? pathBasename(space.rootPath) || space.rootPath
              : isLegacySpace(space)
                ? t('layout.spaces-hub-legacy-description')
                : t('layout.spaces-hub-blank-description');
            return (
              <section
                key={space.id}
                className={cn(
                  SPACE_CARD_CLASS,
                  isActive && 'border-ds-border-brand-default-default'
                )}
              >
                <div className="flex shrink-0 items-start justify-between gap-3 border-0 border-b border-solid border-ds-border-neutral-subtle-default p-4">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ds-border-brand-default-focus"
                    onClick={() => openSpace(space.id)}
                  >
                    <span className="flex min-w-0 max-w-full items-center gap-2">
                      <Folder className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default" />
                      <span className="truncate text-body-md font-semibold text-ds-text-neutral-default-default">
                        {space.name?.trim() || t('layout.spaces-untitled')}
                      </span>
                      {isLegacySpace(space) ? (
                        <Tag
                          size="xs"
                          tone="default"
                          variant="secondary"
                          text={t('layout.spaces-hub-legacy-tag')}
                        />
                      ) : null}
                    </span>
                    <span className="max-w-full truncate text-body-xs text-ds-text-neutral-muted-default">
                      {subtitle}
                    </span>
                  </button>
                  {canCreate ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      buttonContent="icon-only"
                      aria-label={t('layout.spaces-hub-new-project')}
                      disabled={creatingInSpaceId === space.id}
                      onClick={() => void createProject(space)}
                    >
                      {creatingInSpaceId === space.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  ) : null}
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
                  {projects.length === 0 ? (
                    canCreate ? (
                      <button
                        type="button"
                        className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ds-border-neutral-subtle-default px-4 py-5 text-center text-body-sm text-ds-text-neutral-muted-default transition-colors hover:bg-ds-bg-neutral-subtle-default"
                        onClick={() => void createProject(space)}
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        <span>
                          {t('layout.spaces-hub-create-first-project')}
                        </span>
                      </button>
                    ) : (
                      <div className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ds-border-neutral-subtle-default px-4 py-5 text-center text-body-sm text-ds-text-neutral-muted-default">
                        <span>
                          {t('layout.spaces-legacy-readonly-hint', {
                            defaultValue:
                              'Legacy Spaces are read-only. Create a new Space to start a Project.',
                          })}
                        </span>
                      </div>
                    )
                  ) : (
                    projects.map((project) => {
                      const isProjectLoading = loadingProjectId === project.id;
                      const isActiveProject =
                        projectStore.activeProjectId === project.id;
                      return (
                        <button
                          key={project.id}
                          type="button"
                          className={cn(
                            'group flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                            'hover:bg-ds-bg-neutral-subtle-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-border-brand-default-focus',
                            isActiveProject &&
                              'bg-ds-bg-neutral-subtle-default text-ds-text-neutral-default-default'
                          )}
                          onClick={() => void openProject(space.id, project)}
                        >
                          {isProjectLoading ? (
                            <Loader2
                              className="h-4 w-4 shrink-0 animate-spin text-ds-icon-neutral-muted-default"
                              aria-hidden
                            />
                          ) : (
                            <History
                              className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default"
                              aria-hidden
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate text-body-sm text-ds-text-neutral-default-default">
                            {projectTitle(
                              project,
                              t('layout.sessions-start-new')
                            )}
                          </span>
                          <ArrowRight
                            className="h-4 w-4 shrink-0 text-ds-icon-neutral-subtle-default opacity-0 transition-opacity group-hover:opacity-100"
                            aria-hidden
                          />
                        </button>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
