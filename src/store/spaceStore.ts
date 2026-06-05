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
import { generateUniqueId } from '@/lib';
import {
  getSessionNavLeadFromHistoryProject,
  type SessionNavLeadPresentation,
} from '@/lib/sessionNavLead';
import {
  isLocalWorkspaceSpace,
  isPlaceholderProjectName,
  isPlaceholderSpaceNameStatic,
} from '@/lib/spaceLabel';
import type { ServerProject } from '@/service/spaceApi';
import type { ProjectGroup } from '@/types/history';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ProjectMetadata,
  ProjectMode,
  ProjectRuntimeStore,
  ProjectWorkdirMode,
} from './projectRuntimeStore';

export const SPACE_SCHEMA_VERSION = 2;
export const DEFAULT_LOCAL_USER_ID = 'local';
const PROJECT_SYNC_TTL_MS = 5 * 60 * 1000;
const PROJECT_PLACEHOLDER_RESYNC_MS = 10 * 1000;
const PROJECT_DISPLAY_NAME_MAX = 80;

export type SpaceSourceType = 'blank' | 'folder' | 'legacy';
export type SpaceStatus = 'active' | 'disconnected' | 'archived';

export interface Space {
  id: string;
  name: string;
  description?: string;
  userId?: string;
  sourceType: SpaceSourceType;
  rootPath?: string | null;
  rootFingerprint?: Record<string, unknown> | null;
  status: SpaceStatus;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  metadata?: {
    legacy?: boolean;
    sharedMemoryEnabled?: boolean;
    preferredWorkdirMode?: 'worktree' | 'copy' | 'direct-write';
    [key: string]: unknown;
  };
}

export interface CreateSpaceInput {
  id?: string;
  name: string;
  description?: string;
  userId?: string | number | null;
  sourceType?: SpaceSourceType;
  rootPath?: string | null;
  rootFingerprint?: Record<string, unknown> | null;
  metadata?: Space['metadata'];
  setActive?: boolean;
}

export interface SpaceProjectMeta {
  id: string;
  userId?: string;
  spaceId: string;
  name: string;
  description?: string;
  mode?: ProjectMode | null;
  workdirMode?: ProjectWorkdirMode | null;
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
  metadata?: ProjectMetadata;
}

interface UpsertProjectMetaOptions {
  syncedSpaceId?: string;
  replaceSpace?: boolean;
  syncedAt?: number;
}

interface SpaceStore {
  activeSpaceId: string | null;
  spaces: Record<string, Space>;
  lastVisitedProjectBySpace: Record<string, string>;
  projectsBySpaceId: Record<string, Record<string, SpaceProjectMeta>>;
  projectIdIndex: Record<string, string>;
  projectsSyncedAt: Record<string, number>;
  ensureLegacySpace: (userId?: string | number | null) => string;
  hydrateFromServer: (userId?: string | number | null) => Promise<void>;
  syncProjectsFromServer: (spaceId: string) => Promise<void>;
  upsertProjectMetas: (
    projects: SpaceProjectMeta[],
    options?: UpsertProjectMetaOptions
  ) => void;
  updateProjectMeta: (
    projectId: string,
    updates: Partial<Omit<SpaceProjectMeta, 'id' | 'createdAt'>>
  ) => void;
  removeProjectMeta: (projectId: string) => void;
  moveProjectMeta: (projectId: string, spaceId: string) => void;
  getProjectsForSpace: (spaceId?: string | null) => SpaceProjectMeta[];
  getProjectMeta: (projectId?: string | null) => SpaceProjectMeta | null;
  shouldSyncProjects: (spaceId: string, ttlMs?: number) => boolean;
  upsertSpaces: (spaces: Space[], activeSpaceId?: string | null) => void;
  createSpace: (input: CreateSpaceInput) => string;
  createSpaceOnServer: (input: CreateSpaceInput) => Promise<string>;
  deleteSpace: (spaceId: string) => void;
  deleteSpaceOnServer: (spaceId: string) => Promise<void>;
  cleanupInactiveEmptySpacesOnServer: () => Promise<void>;
  updateSpace: (
    spaceId: string,
    updates: Partial<Omit<Space, 'id' | 'createdAt'>>
  ) => void;
  renameSpaceOnServer: (spaceId: string, name: string) => Promise<void>;
  setActiveSpace: (spaceId: string) => void;
  setLastVisitedProject: (spaceId: string, projectId: string) => void;
  archiveSpace: (spaceId: string) => void;
  archiveSpaceOnServer: (spaceId: string) => Promise<void>;
  unarchiveSpaceOnServer: (spaceId: string) => Promise<void>;
  promoteProjectOnServer: (spaceId: string, projectId: string) => Promise<void>;
  refreshProjectOnServer: (
    spaceId: string,
    projectId: string,
    force?: boolean
  ) => Promise<void>;
  relocateSpace: (
    spaceId: string,
    rootPath: string,
    rootFingerprint?: Record<string, unknown> | null
  ) => void;
  relocateSpaceOnServer: (
    spaceId: string,
    rootPath: string,
    force?: boolean
  ) => Promise<void>;
  getActiveSpace: () => Space | null;
  getAllSpaces: () => Space[];
  getSpaceById: (spaceId: string | null | undefined) => Space | null;
}

const canonicalUserId = (userId?: string | number | null) =>
  userId === undefined || userId === null || userId === ''
    ? DEFAULT_LOCAL_USER_ID
    : String(userId);

export const legacySpaceIdForUser = (userId?: string | number | null) =>
  `legacy_${canonicalUserId(userId)}`;

const timestampFromServer = (value?: string | null, fallback = Date.now()) => {
  if (!value) return fallback;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
};

export const projectMetaFromServer = (
  project: ServerProject
): SpaceProjectMeta => {
  const createdAt = timestampFromServer(project.created_at);
  const updatedAt = timestampFromServer(project.updated_at, createdAt);
  return {
    id: project.id,
    userId: project.user_id,
    spaceId: project.space_id,
    name: project.name || 'Project',
    description: project.description ?? undefined,
    mode: project.mode ?? null,
    workdirMode: project.workdir_mode ?? null,
    status: project.status,
    createdAt,
    updatedAt: Math.max(createdAt, updatedAt),
    metadata: (project.metadata ?? undefined) as ProjectMetadata | undefined,
  };
};

const normalizedProjectName = (name?: string | null) =>
  (name ?? '').trim().toLowerCase();

const isAutoCreatedProjectMeta = (project: SpaceProjectMeta) =>
  project.metadata?.serverSynced !== true &&
  (project.metadata?.autoCreatedPlaceholder === true ||
    (normalizedProjectName(project.name) === 'new project' &&
      normalizedProjectName(project.description) === 'auto-created project'));

const projectMetaWithDisplayName = (project: SpaceProjectMeta) => {
  const historyDisplayName =
    typeof project.metadata?.historyDisplayName === 'string'
      ? project.metadata.historyDisplayName.trim()
      : '';
  if (
    historyDisplayName &&
    isPlaceholderProjectName(project.name, project.id)
  ) {
    return {
      ...project,
      name: historyDisplayName,
    };
  }
  return project;
};

export const getVisibleProjectMetasForSpace = (
  projectsBySpaceId: Record<string, Record<string, SpaceProjectMeta>> = {},
  spaceId?: string | null
) =>
  Object.values(spaceId ? (projectsBySpaceId[spaceId] ?? {}) : {})
    .filter(
      (project) =>
        project.status !== 'archived' && !isAutoCreatedProjectMeta(project)
    )
    .map(projectMetaWithDisplayName)
    .sort((a, b) => b.createdAt - a.createdAt);

const hasVisibleProjectsForSpace = (
  projectsBySpaceId: Record<string, Record<string, SpaceProjectMeta>> = {},
  spaceId: string
) => getVisibleProjectMetasForSpace(projectsBySpaceId, spaceId).length > 0;

const DISPOSABLE_BLANK_SPACE_CREATED_FROM = new Set([
  'home_hub_toolbar',
  'top_bar',
  'project_sidebar_space_selector',
  'workspace_space_picker',
]);

export const isDisposableBlankSpace = (
  space: Space | null | undefined,
  projectsBySpaceId: Record<string, Record<string, SpaceProjectMeta>> = {}
) => {
  if (!space || space.metadata?.legacy === true) return false;
  if (space.status !== 'active') return false;
  if (space.sourceType !== 'blank') return false;
  if (space.rootPath) return false;
  if (hasVisibleProjectsForSpace(projectsBySpaceId, space.id)) return false;
  if (space.metadata?.autoCreatedPlaceholder !== true) return false;

  const createdFrom =
    typeof space.metadata?.createdFrom === 'string'
      ? space.metadata.createdFrom
      : '';
  return (
    DISPOSABLE_BLANK_SPACE_CREATED_FROM.has(createdFrom) &&
    isPlaceholderSpaceNameStatic(space.name)
  );
};

const pruneInactiveDisposableBlankSpaces = (
  spaces: Record<string, Space> = {},
  projectsBySpaceId: Record<string, Record<string, SpaceProjectMeta>> = {},
  lastVisitedProjectBySpace: Record<string, string> = {},
  preserveSpaceId?: string | null
) => {
  const nextSpaces = { ...spaces };
  const nextLastVisitedProjectBySpace = { ...lastVisitedProjectBySpace };
  const removedIds: string[] = [];
  const canonicalLegacyId =
    Object.values(spaces).find(
      (space) =>
        space.id !== 'legacy_local' &&
        (space.metadata?.legacy === true || space.sourceType === 'legacy')
    )?.id ?? null;

  for (const [spaceId, space] of Object.entries(spaces)) {
    if (spaceId === preserveSpaceId) continue;
    const isEmptyLegacyLocalDrift =
      spaceId === 'legacy_local' &&
      Boolean(canonicalLegacyId) &&
      !hasVisibleProjectsForSpace(projectsBySpaceId, spaceId);
    if (
      !isEmptyLegacyLocalDrift &&
      !isDisposableBlankSpace(space, projectsBySpaceId)
    ) {
      continue;
    }
    delete nextSpaces[spaceId];
    delete nextLastVisitedProjectBySpace[spaceId];
    removedIds.push(spaceId);
  }

  return {
    spaces: nextSpaces,
    lastVisitedProjectBySpace: nextLastVisitedProjectBySpace,
    removedIds,
  };
};

const pruneAutoCreatedProjectMetas = (
  projectsBySpaceId: Record<string, Record<string, SpaceProjectMeta>> = {},
  projectIdIndex: Record<string, string> = {}
) => {
  const nextBySpaceId: Record<string, Record<string, SpaceProjectMeta>> = {};
  const nextIndex = { ...projectIdIndex };
  let removedCount = 0;

  for (const [spaceId, projects] of Object.entries(projectsBySpaceId)) {
    const nextProjects: Record<string, SpaceProjectMeta> = {};
    for (const [projectId, project] of Object.entries(projects)) {
      if (isAutoCreatedProjectMeta(project)) {
        delete nextIndex[projectId];
        removedCount += 1;
        continue;
      }
      nextProjects[projectId] = project;
    }
    nextBySpaceId[spaceId] = nextProjects;
  }

  return {
    projectsBySpaceId: nextBySpaceId,
    projectIdIndex: nextIndex,
    removedCount,
  };
};

const truncateProjectDisplayName = (name: string) =>
  name.length > PROJECT_DISPLAY_NAME_MAX
    ? `${name.slice(0, PROJECT_DISPLAY_NAME_MAX - 3)}...`
    : name;

const projectDisplayNameFromHistory = (project: ProjectGroup) => {
  const historyName = project.project_name?.trim();
  if (
    historyName &&
    !isPlaceholderProjectName(historyName, project.project_id)
  ) {
    return truncateProjectDisplayName(historyName);
  }
  const prompt = project.last_prompt?.trim();
  return prompt ? truncateProjectDisplayName(prompt) : null;
};

const fetchHistoryProjectSidebarMetaMap = async (spaceId: string) => {
  const params = new URLSearchParams({
    include_tasks: 'true',
    space_id: spaceId,
  });
  const response = (await proxyFetchGet(
    `/api/v1/chat/histories/grouped?${params.toString()}`
  )) as { projects?: ProjectGroup[] } | null;
  const metaByProjectId = new Map<
    string,
    { displayName?: string; navLead: SessionNavLeadPresentation }
  >();
  for (const project of response?.projects ?? []) {
    const displayName = projectDisplayNameFromHistory(project) ?? undefined;
    metaByProjectId.set(project.project_id, {
      displayName,
      navLead: getSessionNavLeadFromHistoryProject(project),
    });
  }
  return metaByProjectId;
};

const withHistoryProjectNames = (
  projects: ServerProject[],
  historyMetaByProjectId: Map<
    string,
    { displayName?: string; navLead: SessionNavLeadPresentation }
  >
): ServerProject[] =>
  projects.map((project) => {
    const historyMeta = historyMetaByProjectId.get(project.id);
    const historyName = historyMeta?.displayName;
    if (!historyName || !isPlaceholderProjectName(project.name, project.id)) {
      return project;
    }
    return {
      ...project,
      name: historyName,
      metadata: {
        ...(project.metadata ?? {}),
        historyDisplayName: historyName,
      },
    };
  });

const rehomeLegacyRuntimeProjects = (
  projectStore: ProjectRuntimeStore,
  fromLegacySpaceId: string,
  toLegacySpaceId: string
) => {
  Object.values(projectStore.projects).forEach((project) => {
    if (
      !project.spaceId ||
      project.spaceId === fromLegacySpaceId ||
      project.spaceId.startsWith('legacy_')
    ) {
      projectStore.setProjectSpace(project.id, toLegacySpaceId);
    }
  });
};

let workspaceReconcileFailureCount = 0;

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const unbindBrainWorkspaceMirror = async (spaceId: string) => {
  const [{ unbindWorkspaceFromBrain }, { getAuthStore }] = await Promise.all([
    import('@/service/workspaceApi'),
    import('@/store/authStore'),
  ]);
  const email = getAuthStore().email;
  const userId = getAuthStore().user_id;
  if (!email) {
    console.warn(
      `[spaceStore] No email available; skipped Brain workspace unbind for ${spaceId}.`
    );
    return;
  }
  await unbindWorkspaceFromBrain(spaceId, email, userId);
};

export const useSpaceStore = create<SpaceStore>()(
  persist(
    (set, get) => ({
      activeSpaceId: null,
      spaces: {},
      lastVisitedProjectBySpace: {},
      projectsBySpaceId: {},
      projectIdIndex: {},
      projectsSyncedAt: {},

      hydrateFromServer: async (userId) => {
        try {
          const [{ proxyEnsureLegacySpace, proxyFetchSpaces }, projectModule] =
            await Promise.all([
              import('@/service/spaceApi'),
              import('./projectRuntimeStore'),
            ]);
          const [legacySpace, serverSpaces] = await Promise.all([
            proxyEnsureLegacySpace(),
            proxyFetchSpaces(),
          ]);
          const spaces = serverSpaces.some(
            (space) => space.id === legacySpace.id
          )
            ? serverSpaces
            : [legacySpace, ...serverSpaces];
          void Promise.all([
            import('@/service/workspaceApi'),
            import('@/store/authStore'),
          ])
            .then(([workspaceModule, authModule]) => {
              const email = authModule.getAuthStore().email;
              const userId = authModule.getAuthStore().user_id;
              if (!email) return;
              const bindingSpaceIds = spaces
                .filter((space) => space.status !== 'archived')
                .map((space) => space.id);
              return workspaceModule
                .reconcileWorkspaceBindings(email, bindingSpaceIds, userId)
                .catch(async (firstError) => {
                  console.warn(
                    '[spaceStore] Brain workspace reconcile failed; retrying once:',
                    firstError
                  );
                  await wait(500);
                  try {
                    return await workspaceModule.reconcileWorkspaceBindings(
                      email,
                      bindingSpaceIds,
                      userId
                    );
                  } catch (retryError) {
                    workspaceReconcileFailureCount += 1;
                    console.warn(
                      '[spaceStore] Failed to reconcile Brain workspace bindings after retry:',
                      {
                        failureCount: workspaceReconcileFailureCount,
                        error: retryError,
                      }
                    );
                    return undefined;
                  }
                });
            })
            .catch((error) => {
              console.warn(
                '[spaceStore] Failed to reconcile Brain workspace bindings:',
                error
              );
            });
          const localLegacyId = legacySpaceIdForUser(DEFAULT_LOCAL_USER_ID);
          const serverLegacyId = legacySpace.id;
          const ownerId = canonicalUserId(userId ?? legacySpace.userId);

          set((state) => {
            const nextSpaces: Record<string, Space> = {};
            for (const space of spaces) {
              if (!space.userId || String(space.userId) === ownerId) {
                nextSpaces[space.id] = space;
              }
            }
            if (!nextSpaces[serverLegacyId]) {
              nextSpaces[serverLegacyId] = legacySpace;
            }
            const shouldAdoptServerLegacy =
              !state.activeSpaceId ||
              state.activeSpaceId === localLegacyId ||
              !nextSpaces[state.activeSpaceId];
            return {
              spaces: nextSpaces,
              activeSpaceId: shouldAdoptServerLegacy
                ? serverLegacyId
                : state.activeSpaceId,
            };
          });

          const projectStore = projectModule.useProjectRuntimeStore.getState();
          projectStore.cleanupAutoCreatedEmptyProjects();
          set((state) => {
            const pruned = pruneAutoCreatedProjectMetas(
              state.projectsBySpaceId,
              state.projectIdIndex
            );
            if (pruned.removedCount === 0) return state;
            console.warn(
              `[spaceStore] Removed ${pruned.removedCount} auto-created Project metadata entr${
                pruned.removedCount === 1 ? 'y' : 'ies'
              }.`
            );
            return {
              projectsBySpaceId: pruned.projectsBySpaceId,
              projectIdIndex: pruned.projectIdIndex,
            };
          });
          rehomeLegacyRuntimeProjects(
            projectStore,
            localLegacyId,
            serverLegacyId
          );

          const activeSpaceId = get().activeSpaceId;
          if (activeSpaceId && get().shouldSyncProjects(activeSpaceId)) {
            // TODO(space-hub): Spaces Hub should fan out and sync visible Spaces,
            // not just the active Space.
            void get().syncProjectsFromServer(activeSpaceId);
          }
          void get().cleanupInactiveEmptySpacesOnServer();
        } catch (error) {
          console.warn(
            '[spaceStore] Failed to hydrate spaces from server:',
            error
          );
          get().ensureLegacySpace(userId);
        }
      },

      upsertSpaces: (spaces, activeSpaceId) =>
        set((state) => {
          const nextSpaces = { ...state.spaces };
          for (const space of spaces) {
            nextSpaces[space.id] = space;
          }
          return {
            spaces: nextSpaces,
            activeSpaceId:
              activeSpaceId === undefined ? state.activeSpaceId : activeSpaceId,
          };
        }),

      ensureLegacySpace: (userId) => {
        const ownerId = canonicalUserId(userId);
        const spaceId = legacySpaceIdForUser(ownerId);
        const existing = get().spaces[spaceId];
        if (existing) {
          if (!get().activeSpaceId) {
            set({ activeSpaceId: spaceId });
          }
          return spaceId;
        }

        const now = Date.now();
        const legacySpace: Space = {
          id: spaceId,
          name: 'Legacy Space',
          description: 'Projects created before the Space layer migration.',
          userId: ownerId,
          sourceType: 'legacy',
          rootPath: null,
          rootFingerprint: null,
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now,
          metadata: {
            legacy: true,
          },
        };

        set((state) => ({
          spaces: {
            ...state.spaces,
            [spaceId]: legacySpace,
          },
          activeSpaceId: state.activeSpaceId ?? spaceId,
        }));
        return spaceId;
      },

      syncProjectsFromServer: async (spaceId) => {
        if (!spaceId) return;

        try {
          const [
            { proxyEnsureLegacySpace, proxyFetchSpaceProjects },
            projectModule,
          ] = await Promise.all([
            import('@/service/spaceApi'),
            import('./projectRuntimeStore'),
          ]);
          let targetSpaceId = spaceId;

          if (spaceId.startsWith('legacy_')) {
            const legacySpace = await proxyEnsureLegacySpace();
            targetSpaceId = legacySpace.id;
            get().upsertSpaces(
              [legacySpace],
              get().activeSpaceId === spaceId ? legacySpace.id : undefined
            );

            if (legacySpace.id !== spaceId) {
              const projectStore =
                projectModule.useProjectRuntimeStore.getState();
              rehomeLegacyRuntimeProjects(
                projectStore,
                spaceId,
                legacySpace.id
              );

              set((state) => {
                const nextSpaces = { ...state.spaces };
                delete nextSpaces[spaceId];
                return {
                  spaces: nextSpaces,
                  activeSpaceId:
                    state.activeSpaceId === spaceId
                      ? legacySpace.id
                      : state.activeSpaceId,
                };
              });
            }
          }

          const [serverProjects, historyMetaByProjectId] = await Promise.all([
            proxyFetchSpaceProjects(targetSpaceId),
            fetchHistoryProjectSidebarMetaMap(targetSpaceId).catch((error) => {
              console.warn(
                `[spaceStore] Failed to fetch history sidebar meta for Space ${targetSpaceId}:`,
                error
              );
              return new Map<
                string,
                { displayName?: string; navLead: SessionNavLeadPresentation }
              >();
            }),
          ]);
          const namedProjects = withHistoryProjectNames(
            serverProjects,
            historyMetaByProjectId
          );
          const activeNamedProjects = namedProjects.filter(
            (project) => project.status !== 'archived'
          );
          get().upsertProjectMetas(
            activeNamedProjects.map(projectMetaFromServer),
            {
              syncedSpaceId: targetSpaceId,
              replaceSpace: true,
              syncedAt: Date.now(),
            }
          );
          const projectStore = projectModule.useProjectRuntimeStore.getState();
          projectStore.upsertProjectsFromServer(activeNamedProjects);
          if (historyMetaByProjectId.size > 0) {
            const navLeads: Record<string, SessionNavLeadPresentation> = {};
            for (const [projectId, meta] of historyMetaByProjectId) {
              navLeads[projectId] = meta.navLead;
            }
            projectStore.setProjectNavLeads(navLeads);
          }
        } catch (error) {
          console.warn(
            `[spaceStore] Failed to sync projects for Space ${spaceId}:`,
            error
          );
        }
      },

      upsertProjectMetas: (projects, options) =>
        set((state) => {
          const nextBySpaceId: Record<
            string,
            Record<string, SpaceProjectMeta>
          > = { ...state.projectsBySpaceId };
          const nextIndex = { ...state.projectIdIndex };
          const nextSyncedAt = { ...state.projectsSyncedAt };

          if (options?.syncedSpaceId && options.replaceSpace) {
            const existingProjectIds = Object.keys(
              nextBySpaceId[options.syncedSpaceId] ?? {}
            );
            for (const projectId of existingProjectIds) {
              delete nextIndex[projectId];
            }
            nextBySpaceId[options.syncedSpaceId] = {};
          }

          for (const project of projects) {
            const previousSpaceId = nextIndex[project.id];
            const previousProject =
              (previousSpaceId
                ? nextBySpaceId[previousSpaceId]?.[project.id]
                : undefined) ?? nextBySpaceId[project.spaceId]?.[project.id];
            if (
              previousSpaceId &&
              previousSpaceId !== project.spaceId &&
              nextBySpaceId[previousSpaceId]
            ) {
              nextBySpaceId[previousSpaceId] = {
                ...nextBySpaceId[previousSpaceId],
              };
              delete nextBySpaceId[previousSpaceId][project.id];
            }

            const shouldKeepPreviousDisplayName =
              previousProject &&
              isPlaceholderProjectName(project.name, project.id) &&
              !isPlaceholderProjectName(previousProject.name, project.id);
            const historyDisplayName =
              typeof project.metadata?.historyDisplayName === 'string'
                ? project.metadata.historyDisplayName.trim()
                : '';
            const shouldUseHistoryDisplayName =
              !shouldKeepPreviousDisplayName &&
              historyDisplayName &&
              isPlaceholderProjectName(project.name, project.id);

            nextBySpaceId[project.spaceId] = {
              ...(nextBySpaceId[project.spaceId] ?? {}),
              [project.id]: {
                ...previousProject,
                ...project,
                name: shouldKeepPreviousDisplayName
                  ? previousProject.name
                  : shouldUseHistoryDisplayName
                    ? historyDisplayName
                    : project.name,
                metadata:
                  project.metadata === undefined
                    ? previousProject?.metadata
                    : {
                        ...previousProject?.metadata,
                        ...project.metadata,
                      },
              },
            };
            nextIndex[project.id] = project.spaceId;
          }

          if (options?.syncedSpaceId) {
            nextSyncedAt[options.syncedSpaceId] =
              options.syncedAt ?? Date.now();
          }

          return {
            projectsBySpaceId: nextBySpaceId,
            projectIdIndex: nextIndex,
            projectsSyncedAt: nextSyncedAt,
          };
        }),

      updateProjectMeta: (projectId, updates) => {
        const existing = get().getProjectMeta(projectId);
        if (!existing) return;
        get().upsertProjectMetas([
          {
            ...existing,
            ...updates,
            metadata:
              updates.metadata === undefined
                ? existing.metadata
                : {
                    ...existing.metadata,
                    ...updates.metadata,
                  },
            updatedAt: Date.now(),
          },
        ]);
      },

      removeProjectMeta: (projectId) =>
        set((state) => {
          const spaceId = state.projectIdIndex[projectId];
          if (!spaceId) return state;
          const nextBySpaceId = { ...state.projectsBySpaceId };
          const nextSpaceProjects = { ...(nextBySpaceId[spaceId] ?? {}) };
          delete nextSpaceProjects[projectId];
          nextBySpaceId[spaceId] = nextSpaceProjects;
          const nextIndex = { ...state.projectIdIndex };
          delete nextIndex[projectId];
          const nextLastVisitedProjectBySpace = {
            ...state.lastVisitedProjectBySpace,
          };
          if (nextLastVisitedProjectBySpace[spaceId] === projectId) {
            delete nextLastVisitedProjectBySpace[spaceId];
          }
          return {
            projectsBySpaceId: nextBySpaceId,
            projectIdIndex: nextIndex,
            lastVisitedProjectBySpace: nextLastVisitedProjectBySpace,
          };
        }),

      moveProjectMeta: (projectId, spaceId) => {
        const existing = get().getProjectMeta(projectId);
        if (!existing) return;
        get().upsertProjectMetas([
          {
            ...existing,
            spaceId,
            updatedAt: Date.now(),
          },
        ]);
      },

      getProjectsForSpace: (spaceId) => {
        const { projectsBySpaceId } = get();
        if (spaceId) {
          return getVisibleProjectMetasForSpace(projectsBySpaceId, spaceId);
        }
        return Object.values(projectsBySpaceId)
          .flatMap((projects) => Object.values(projects))
          .filter(
            (project) =>
              project.status !== 'archived' &&
              !isAutoCreatedProjectMeta(project)
          )
          .sort((a, b) => b.createdAt - a.createdAt);
      },

      getProjectMeta: (projectId) => {
        if (!projectId) return null;
        const { projectIdIndex, projectsBySpaceId } = get();
        const spaceId = projectIdIndex[projectId];
        return spaceId ? projectsBySpaceId[spaceId]?.[projectId] || null : null;
      },

      shouldSyncProjects: (spaceId, ttlMs = PROJECT_SYNC_TTL_MS) => {
        const lastSyncedAt = get().projectsSyncedAt[spaceId];
        const hasPlaceholderProjects = Object.values(
          get().projectsBySpaceId[spaceId] ?? {}
        ).some(
          (project) =>
            project.status !== 'archived' &&
            !isAutoCreatedProjectMeta(project) &&
            isPlaceholderProjectName(project.name, project.id)
        );
        if (
          hasPlaceholderProjects &&
          (!lastSyncedAt ||
            Date.now() - lastSyncedAt > PROJECT_PLACEHOLDER_RESYNC_MS)
        ) {
          return true;
        }
        return !lastSyncedAt || Date.now() - lastSyncedAt > ttlMs;
      },

      createSpace: (input) => {
        const now = Date.now();
        const id = input.id ?? `space_${generateUniqueId()}`;
        const ownerId = canonicalUserId(input.userId);
        const space: Space = {
          id,
          name: input.name,
          description: input.description,
          userId: ownerId,
          sourceType: input.sourceType ?? 'blank',
          rootPath: input.rootPath ?? null,
          rootFingerprint: input.rootFingerprint ?? null,
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now,
          metadata: input.metadata,
        };

        set((state) => ({
          spaces: {
            ...state.spaces,
            [id]: space,
          },
          ...(input.setActive !== false ? { activeSpaceId: id } : {}),
        }));

        return id;
      },

      createSpaceOnServer: async (input) => {
        const { proxyCreateSpace } = await import('@/service/spaceApi');
        const space = await proxyCreateSpace({
          id: input.id,
          name: input.name,
          description: input.description,
          source_type: input.sourceType,
          root_path: input.rootPath,
          root_fingerprint: input.rootFingerprint,
          metadata: input.metadata,
        });
        get().upsertSpaces(
          [space],
          input.setActive === false ? undefined : space.id
        );
        return space.id;
      },

      deleteSpace: (spaceId) =>
        set((state) => {
          if (!state.spaces[spaceId]) return state;
          const nextSpaces = { ...state.spaces };
          delete nextSpaces[spaceId];
          const nextProjectsBySpaceId = { ...state.projectsBySpaceId };
          const removedProjects = Object.keys(
            nextProjectsBySpaceId[spaceId] ?? {}
          );
          delete nextProjectsBySpaceId[spaceId];
          const nextProjectIdIndex = { ...state.projectIdIndex };
          for (const projectId of removedProjects) {
            delete nextProjectIdIndex[projectId];
          }
          const nextProjectsSyncedAt = { ...state.projectsSyncedAt };
          delete nextProjectsSyncedAt[spaceId];
          const nextLastVisitedProjectBySpace = {
            ...state.lastVisitedProjectBySpace,
          };
          delete nextLastVisitedProjectBySpace[spaceId];
          const nextActiveSpaceId =
            state.activeSpaceId === spaceId
              ? Object.keys(nextSpaces)[0] || null
              : state.activeSpaceId;
          return {
            spaces: nextSpaces,
            activeSpaceId: nextActiveSpaceId,
            projectsBySpaceId: nextProjectsBySpaceId,
            projectIdIndex: nextProjectIdIndex,
            projectsSyncedAt: nextProjectsSyncedAt,
            lastVisitedProjectBySpace: nextLastVisitedProjectBySpace,
          };
        }),

      deleteSpaceOnServer: async (spaceId) => {
        const { proxyDeleteSpace } = await import('@/service/spaceApi');
        try {
          await proxyDeleteSpace(spaceId);
        } catch (error) {
          if ((error as { status?: number })?.status !== 404) {
            throw error;
          }
          console.warn(
            `[spaceStore] Space ${spaceId} was already absent on server; continuing Brain unbind.`
          );
        }
        await unbindBrainWorkspaceMirror(spaceId);
        get().deleteSpace(spaceId);
      },

      cleanupInactiveEmptySpacesOnServer: async () => {
        const { proxyFetchSpaceProjects } = await import('@/service/spaceApi');
        const projectModule = await import('./projectRuntimeStore');
        const { activeSpaceId, spaces, projectsBySpaceId } = get();
        const candidates = Object.values(spaces).filter(
          (space) =>
            space.id !== activeSpaceId &&
            isDisposableBlankSpace(space, projectsBySpaceId)
        );

        for (const space of candidates) {
          try {
            const projects = await proxyFetchSpaceProjects(space.id);
            const activeProjects = projects.filter(
              (project) => project.status !== 'archived'
            );
            if (activeProjects.length > 0) {
              get().upsertProjectMetas(
                activeProjects.map(projectMetaFromServer),
                {
                  syncedSpaceId: space.id,
                  replaceSpace: true,
                  syncedAt: Date.now(),
                }
              );
              projectModule.useProjectRuntimeStore
                .getState()
                .upsertProjectsFromServer(activeProjects);
              continue;
            }
            await get().deleteSpaceOnServer(space.id);
          } catch (error) {
            if ((error as { status?: number })?.status === 404) {
              get().deleteSpace(space.id);
              continue;
            }
            console.warn(
              `[spaceStore] Failed to clean up empty placeholder Space ${space.id}:`,
              error
            );
          }
        }
      },

      updateSpace: (spaceId, updates) =>
        set((state) => {
          const space = state.spaces[spaceId];
          if (!space) return state;
          return {
            spaces: {
              ...state.spaces,
              [spaceId]: {
                ...space,
                ...updates,
                metadata: {
                  ...space.metadata,
                  ...updates.metadata,
                },
                updatedAt: Date.now(),
              },
            },
          };
        }),

      renameSpaceOnServer: async (spaceId, name) => {
        const nextName = name.trim();
        if (!nextName) return;
        const { proxyUpdateSpace } = await import('@/service/spaceApi');
        const space = await proxyUpdateSpace(spaceId, { name: nextName });
        get().upsertSpaces([space], undefined);
      },

      setActiveSpace: (spaceId) => {
        if (!get().spaces[spaceId]) {
          console.warn(`Space ${spaceId} not found`);
          return;
        }
        set((state) => {
          const pruned = pruneInactiveDisposableBlankSpaces(
            state.spaces,
            state.projectsBySpaceId,
            state.lastVisitedProjectBySpace,
            spaceId
          );
          return {
            activeSpaceId: spaceId,
            spaces: pruned.spaces,
            lastVisitedProjectBySpace: pruned.lastVisitedProjectBySpace,
          };
        });
        if (
          spaceId.startsWith('legacy_') ||
          get().shouldSyncProjects(spaceId)
        ) {
          void get().syncProjectsFromServer(spaceId);
        }
      },

      setLastVisitedProject: (spaceId, projectId) =>
        set((state) => ({
          lastVisitedProjectBySpace: {
            ...state.lastVisitedProjectBySpace,
            [spaceId]: projectId,
          },
        })),

      archiveSpace: (spaceId) => {
        get().updateSpace(spaceId, { status: 'archived' });
        void unbindBrainWorkspaceMirror(spaceId).catch((error) => {
          console.warn(
            `[spaceStore] Failed to unbind archived Space ${spaceId} from Brain:`,
            error
          );
        });
      },

      archiveSpaceOnServer: async (spaceId) => {
        const { proxyArchiveSpace } = await import('@/service/spaceApi');
        const space = await proxyArchiveSpace(spaceId);
        get().upsertSpaces([space], undefined);
        await unbindBrainWorkspaceMirror(spaceId);
      },

      unarchiveSpaceOnServer: async (spaceId) => {
        const { proxyUnarchiveSpace } = await import('@/service/spaceApi');
        const space = await proxyUnarchiveSpace(spaceId);
        get().upsertSpaces([space], space.id);
      },

      promoteProjectOnServer: async (spaceId, projectId) => {
        const [{ proxyPromoteSpaceProject }, projectModule] = await Promise.all(
          [import('@/service/spaceApi'), import('./projectRuntimeStore')]
        );
        const project = await proxyPromoteSpaceProject(spaceId, projectId);
        get().upsertProjectMetas([projectMetaFromServer(project)]);
        // PR-X3 bridge: keep existing runtime shells in sync until Project
        // metadata fields are fully removed from projectRuntimeStore.
        projectModule.useProjectRuntimeStore
          .getState()
          .updateProject(project.id, {
            spaceId: project.space_id,
            workdirMode: project.workdir_mode,
            metadata: project.metadata ?? undefined,
          });
      },

      refreshProjectOnServer: async (spaceId, projectId, force = false) => {
        const project = get().getProjectMeta(projectId);
        const space = get().getSpaceById(spaceId);
        const workdirMode = project?.workdirMode ?? null;
        const isDirectWrite =
          workdirMode === 'direct-write' ||
          (!workdirMode && isLocalWorkspaceSpace(space));
        if (isDirectWrite) {
          return;
        }
        const [
          { proxyRefreshSpaceProject },
          { refreshWorkspaceProject },
          { getAuthStore },
          projectModule,
        ] = await Promise.all([
          import('@/service/spaceApi'),
          import('@/service/workspaceApi'),
          import('@/store/authStore'),
          import('./projectRuntimeStore'),
        ]);
        const refreshed = await proxyRefreshSpaceProject(spaceId, projectId, {
          force,
        });
        const { email, user_id: userId } = getAuthStore();
        let baseSnapshotId = refreshed.base_snapshot_id;
        if (email) {
          const brainRefresh = await refreshWorkspaceProject(
            spaceId,
            projectId,
            {
              email,
              userId,
              force,
              serverRefreshConfirmed: true,
            }
          ).catch((error) => {
            console.warn(
              `[spaceStore] Failed to refresh Brain project workdir ${projectId}:`,
              error
            );
            return null;
          });
          baseSnapshotId = brainRefresh?.base_snapshot_id || baseSnapshotId;
        }
        get().updateProjectMeta(projectId, {
          metadata: {
            baseSnapshotId,
          },
        });
        // PR-X3 bridge: keep existing runtime shells in sync until Project
        // metadata fields are fully removed from projectRuntimeStore.
        projectModule.useProjectRuntimeStore
          .getState()
          .updateProject(projectId, {
            metadata: {
              baseSnapshotId,
            },
          });
      },

      relocateSpace: (spaceId, rootPath, rootFingerprint) =>
        get().updateSpace(spaceId, {
          rootPath,
          rootFingerprint: rootFingerprint ?? null,
          status: 'active',
        }),

      relocateSpaceOnServer: async (spaceId, rootPath, force = false) => {
        const { proxyRelocateSpace } = await import('@/service/spaceApi');
        const space = await proxyRelocateSpace(spaceId, {
          root_path: rootPath,
          force,
        });
        get().upsertSpaces([space], space.id);
        await unbindBrainWorkspaceMirror(spaceId).catch((error) => {
          console.warn(
            `[spaceStore] Failed to clear old Brain workspace binding for relocated Space ${spaceId}:`,
            error
          );
        });
        if (isLocalWorkspaceSpace(space) && space.rootPath) {
          const [{ bindWorkspaceToSpace }, { getAuthStore }] =
            await Promise.all([
              import('@/service/workspaceApi'),
              import('@/store/authStore'),
            ]);
          const { email, user_id: userId } = getAuthStore();
          if (email) {
            await bindWorkspaceToSpace({
              space_id: space.id,
              email,
              user_id: userId,
              path: space.rootPath,
            }).catch((error) => {
              console.warn(
                `[spaceStore] Failed to bind relocated Space ${spaceId} in Brain mirror:`,
                error
              );
            });
          }
        }
      },

      getActiveSpace: () => {
        const { activeSpaceId, spaces } = get();
        return activeSpaceId ? spaces[activeSpaceId] || null : null;
      },

      getAllSpaces: () =>
        Object.values(get().spaces).sort((a, b) => b.updatedAt - a.updatedAt),

      getSpaceById: (spaceId) => {
        if (!spaceId) return null;
        return get().spaces[spaceId] || null;
      },
    }),
    {
      name: 'eigent-space-store',
      version: SPACE_SCHEMA_VERSION,
      migrate: (persistedState) => {
        const state = persistedState as Partial<SpaceStore> | undefined;
        if (!state) return persistedState as SpaceStore;
        const pruned = pruneAutoCreatedProjectMetas(
          state.projectsBySpaceId,
          state.projectIdIndex
        );
        const prunedSpaces = pruneInactiveDisposableBlankSpaces(
          state.spaces ?? {},
          pruned.projectsBySpaceId,
          state.lastVisitedProjectBySpace ?? {},
          state.activeSpaceId ?? null
        );
        return {
          ...state,
          activeSpaceId: state.activeSpaceId ?? null,
          spaces: prunedSpaces.spaces,
          lastVisitedProjectBySpace: prunedSpaces.lastVisitedProjectBySpace,
          projectsBySpaceId: pruned.projectsBySpaceId,
          projectIdIndex: pruned.projectIdIndex,
          projectsSyncedAt: {},
        } as SpaceStore;
      },
      partialize: (state) => ({
        activeSpaceId: state.activeSpaceId,
        spaces: state.spaces,
        lastVisitedProjectBySpace: state.lastVisitedProjectBySpace,
        projectsBySpaceId: state.projectsBySpaceId,
        projectIdIndex: state.projectIdIndex,
      }),
    }
  )
);

if (typeof queueMicrotask === 'function') {
  queueMicrotask(() => {
    const state = useSpaceStore.getState();
    const pruned = pruneAutoCreatedProjectMetas(
      state.projectsBySpaceId,
      state.projectIdIndex
    );
    const prunedSpaces = pruneInactiveDisposableBlankSpaces(
      state.spaces,
      pruned.projectsBySpaceId,
      state.lastVisitedProjectBySpace,
      state.activeSpaceId
    );
    if (pruned.removedCount === 0 && prunedSpaces.removedIds.length === 0) {
      return;
    }
    useSpaceStore.setState({
      spaces: prunedSpaces.spaces,
      lastVisitedProjectBySpace: prunedSpaces.lastVisitedProjectBySpace,
      projectsBySpaceId: pruned.projectsBySpaceId,
      projectIdIndex: pruned.projectIdIndex,
    });
    if (pruned.removedCount > 0) {
      console.warn(
        `[spaceStore] Removed ${pruned.removedCount} auto-created Project metadata entr${
          pruned.removedCount === 1 ? 'y' : 'ies'
        }.`
      );
    }
    if (prunedSpaces.removedIds.length > 0) {
      console.warn(
        `[spaceStore] Removed ${prunedSpaces.removedIds.length} empty placeholder Space entr${
          prunedSpaces.removedIds.length === 1 ? 'y' : 'ies'
        }.`
      );
    }
  });
}

export type { SpaceStore };
