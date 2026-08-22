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

import type { ServerProject } from '@/service/spaceApi';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import {
  isDisposableBlankSpace,
  SPACE_SCHEMA_VERSION,
  useSpaceStore,
  type Space,
  type SpaceSourceType,
} from '@/store/spaceStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authStoreMock = vi.hoisted(() => ({
  state: {
    user_id: 2,
    email: 'new@example.com',
  },
}));

const backendReadinessMock = vi.hoisted(() => ({
  waitForBackendReadiness: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => authStoreMock.state,
}));

vi.mock('@/store/installationStore', () => backendReadinessMock);

vi.mock('@/api/http', () => ({
  proxyFetchGet: vi.fn().mockResolvedValue({ projects: [] }),
}));

vi.mock('@/service/spaceApi', () => ({
  proxyCreateSpace: vi.fn(),
  proxyEnsureLegacySpace: vi.fn(),
  proxyFetchSpaceProjects: vi.fn(),
  proxyFetchSpaces: vi.fn(),
  proxyUpdateSpace: vi.fn(),
}));

vi.mock('@/service/workspaceApi', () => ({
  reconcileWorkspaceBindings: vi.fn().mockResolvedValue(undefined),
}));

const makeSpace = (
  id: string,
  name: string,
  sourceType: SpaceSourceType,
  userId = '2',
  metadata?: Space['metadata']
): Space => ({
  id,
  name,
  userId,
  sourceType,
  rootPath: null,
  rootFingerprint: null,
  status: 'active',
  schemaVersion: SPACE_SCHEMA_VERSION,
  createdAt: 1,
  updatedAt: 1,
  metadata,
});

const makeServerProject = (
  id: string,
  spaceId: string,
  status: ServerProject['status'] = 'active'
): ServerProject => ({
  id,
  user_id: '2',
  space_id: spaceId,
  name: `Project ${id}`,
  status,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

describe('spaceStore user scoping', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    backendReadinessMock.waitForBackendReadiness.mockResolvedValue(undefined);
    const spaceApi = await import('@/service/spaceApi');
    vi.mocked(spaceApi.proxyFetchSpaces).mockResolvedValue([]);
    vi.mocked(spaceApi.proxyFetchSpaceProjects).mockResolvedValue([]);
    vi.mocked(spaceApi.proxyCreateSpace).mockResolvedValue(
      makeSpace('space_created', 'Untitled Space', 'blank')
    );
    vi.mocked(spaceApi.proxyEnsureLegacySpace).mockResolvedValue(
      makeSpace('legacy_2', 'Legacy Space', 'legacy', '2', { legacy: true })
    );
    authStoreMock.state = {
      email: 'new@example.com',
      user_id: 2,
    };
    globalThis.electronAPI = {
      ...globalThis.electronAPI,
      terminalDispose: vi.fn().mockResolvedValue({ success: true }),
    };
    usePageTabStore.setState({
      sessionPreviewProjectId: null,
      sessionPreviewByProject: {},
    });
    useSpaceStore.setState({
      activeSpaceId: 'space_old_blank',
      spaces: {
        space_old_blank: {
          id: 'space_old_blank',
          name: 'Untitled Space',
          userId: '1',
          sourceType: 'blank',
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: 1,
          updatedAt: 3,
        },
        legacy_1: {
          id: 'legacy_1',
          name: 'Legacy Space',
          userId: '1',
          sourceType: 'legacy',
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: 1,
          updatedAt: 2,
          metadata: { legacy: true },
        },
        space_new_blank: {
          id: 'space_new_blank',
          name: 'Untitled Space',
          userId: '2',
          sourceType: 'blank',
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: 1,
          updatedAt: 4,
        },
      },
      lastVisitedProjectBySpace: {
        space_old_blank: 'project_old',
        space_new_blank: 'project_new',
      },
      projectsBySpaceId: {
        space_old_blank: {
          project_old: {
            id: 'project_old',
            userId: '1',
            spaceId: 'space_old_blank',
            name: 'Old project',
            status: 'active',
            createdAt: 1,
            updatedAt: 1,
          },
        },
        space_new_blank: {
          project_new: {
            id: 'project_new',
            userId: '2',
            spaceId: 'space_new_blank',
            name: 'New project',
            status: 'active',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      projectIdIndex: {
        project_old: 'space_old_blank',
        project_new: 'space_new_blank',
      },
      projectsSyncedAt: {
        space_old_blank: 100,
        legacy_1: 100,
        space_new_blank: 200,
      },
    });
  });

  it('treats a new Space from the detail sidebar as a disposable placeholder', () => {
    const space = makeSpace(
      'space-detail-new',
      'Untitled Space',
      'blank',
      '2',
      {
        createdFrom: 'space_detail_sidebar',
        autoCreatedPlaceholder: true,
      }
    );

    expect(isDisposableBlankSpace(space, {})).toBe(true);
  });

  it('updates a Space on the server without changing its id', async () => {
    const spaceApi = await import('@/service/spaceApi');
    const updated = {
      ...makeSpace('space_old_blank', 'project-folder', 'folder', '1'),
      rootPath: '/Users/test/project-folder',
      metadata: {
        createdFrom: 'space_detail_empty_state',
        autoCreatedPlaceholder: false,
        bindingSource: 'space_local_brain',
      },
    };
    vi.mocked(spaceApi.proxyUpdateSpace).mockResolvedValue(updated);

    await useSpaceStore.getState().updateSpaceOnServer('space_old_blank', {
      name: 'project-folder',
      sourceType: 'folder',
      rootPath: '/Users/test/project-folder',
      metadata: updated.metadata,
    });

    expect(spaceApi.proxyUpdateSpace).toHaveBeenCalledWith(
      'space_old_blank',
      expect.objectContaining({
        name: 'project-folder',
        source_type: 'folder',
        root_path: '/Users/test/project-folder',
      })
    );
    expect(useSpaceStore.getState().spaces.space_old_blank).toEqual(updated);
  });

  it('disposes project preview shells when their Space is deleted', () => {
    const pageTabs = usePageTabStore.getState();
    pageTabs.setSessionPreviewProject('project_old');
    pageTabs.toggleSessionPreview();
    pageTabs.choosePreviewTabType(
      getSessionPreviewSlice(usePageTabStore.getState()).activeTabId!,
      'terminal'
    );
    const terminal = getSessionPreviewSlice(usePageTabStore.getState()).tabs[0];
    const shellId = terminal.type === 'terminal' ? terminal.shellId : undefined;

    useSpaceStore.getState().deleteSpace('space_old_blank');

    expect(globalThis.electronAPI.terminalDispose).toHaveBeenCalledWith(
      shellId
    );
    expect(
      usePageTabStore.getState().sessionPreviewByProject.project_old
    ).toBeUndefined();
  });

  it('removes spaces and project metadata from the previous signed-in user', () => {
    useSpaceStore.getState().resetForUser(2);

    const state = useSpaceStore.getState();
    expect(Object.keys(state.spaces)).toEqual(['space_new_blank']);
    expect(state.activeSpaceId).toBe('space_new_blank');
    expect(Object.keys(state.projectsBySpaceId)).toEqual(['space_new_blank']);
    expect(state.projectIdIndex).toEqual({ project_new: 'space_new_blank' });
    expect(state.lastVisitedProjectBySpace).toEqual({
      space_new_blank: 'project_new',
    });
    expect(state.projectsSyncedAt).toEqual({ space_new_blank: 200 });
  });

  it('hydrates new accounts with one blank space and hides empty legacy rows', async () => {
    const spaceApi = await import('@/service/spaceApi');
    vi.mocked(spaceApi.proxyFetchSpaces).mockResolvedValue([
      makeSpace('legacy_2', 'Legacy Space', 'legacy', '2', { legacy: true }),
    ]);
    vi.mocked(spaceApi.proxyCreateSpace).mockResolvedValue(
      makeSpace('space_new_blank', 'Untitled Space', 'blank')
    );

    await useSpaceStore.getState().hydrateFromServer(2);

    const state = useSpaceStore.getState();
    expect(spaceApi.proxyFetchSpaceProjects).toHaveBeenCalledWith('legacy_2');
    expect(spaceApi.proxyCreateSpace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Untitled Space',
        source_type: 'blank',
      })
    );
    expect(Object.keys(state.spaces)).toEqual(['space_new_blank']);
    expect(state.activeSpaceId).toBe('space_new_blank');
  });

  it('defers local workspace reconciliation until the backend is ready', async () => {
    const spaceApi = await import('@/service/spaceApi');
    const workspaceApi = await import('@/service/workspaceApi');
    let resolveBackendReady: (() => void) | undefined;
    backendReadinessMock.waitForBackendReadiness.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveBackendReady = resolve;
      })
    );
    vi.mocked(spaceApi.proxyFetchSpaces).mockResolvedValue([
      makeSpace('space_ready_later', 'Ready later', 'folder', '2'),
    ]);

    await useSpaceStore.getState().hydrateFromServer(2);

    await vi.waitFor(() => {
      expect(
        backendReadinessMock.waitForBackendReadiness
      ).toHaveBeenCalledTimes(1);
    });
    expect(workspaceApi.reconcileWorkspaceBindings).not.toHaveBeenCalled();

    resolveBackendReady?.();

    await vi.waitFor(() => {
      expect(workspaceApi.reconcileWorkspaceBindings).toHaveBeenCalledWith(
        'new@example.com',
        ['space_ready_later'],
        2
      );
    });
  });

  it('keeps the previously selected active space when hydrating existing spaces', async () => {
    const spaceApi = await import('@/service/spaceApi');
    vi.mocked(spaceApi.proxyFetchSpaces).mockResolvedValue([
      makeSpace('space_recent', 'Recent Space', 'blank', '2'),
      makeSpace('space_selected', 'Selected Space', 'blank', '2'),
    ]);
    useSpaceStore.setState({
      activeSpaceId: 'space_selected',
      projectsSyncedAt: {
        space_selected: Date.now(),
      },
    });

    await useSpaceStore.getState().hydrateFromServer(2);

    const state = useSpaceStore.getState();
    expect(spaceApi.proxyCreateSpace).not.toHaveBeenCalled();
    expect(Object.keys(state.spaces).sort()).toEqual([
      'space_recent',
      'space_selected',
    ]);
    expect(state.activeSpaceId).toBe('space_selected');
  });

  it('keeps an existing Legacy Space with projects instead of creating Untitled Space', async () => {
    const spaceApi = await import('@/service/spaceApi');
    vi.mocked(spaceApi.proxyFetchSpaces).mockResolvedValue([
      makeSpace('legacy_2', 'Legacy Space', 'legacy', '2', { legacy: true }),
    ]);
    vi.mocked(spaceApi.proxyFetchSpaceProjects).mockImplementation(
      async (spaceId) =>
        spaceId === 'legacy_2'
          ? [makeServerProject('project_legacy', 'legacy_2')]
          : []
    );
    vi.mocked(spaceApi.proxyCreateSpace).mockResolvedValue(
      makeSpace('space_migration_blank', 'Untitled Space', 'blank')
    );
    useSpaceStore.setState({
      activeSpaceId: 'legacy_2',
    });

    await useSpaceStore.getState().hydrateFromServer(2);

    const state = useSpaceStore.getState();
    expect(spaceApi.proxyCreateSpace).not.toHaveBeenCalled();
    expect(Object.keys(state.spaces)).toEqual(['legacy_2']);
    expect(state.activeSpaceId).toBe('legacy_2');
  });

  it('coalesces concurrent hydration so an empty account creates one Space', async () => {
    const spaceApi = await import('@/service/spaceApi');
    let resolveSpaces: ((spaces: Space[]) => void) | undefined;
    vi.mocked(spaceApi.proxyFetchSpaces).mockReturnValue(
      new Promise<Space[]>((resolve) => {
        resolveSpaces = resolve;
      })
    );

    const firstHydration = useSpaceStore.getState().hydrateFromServer(2);
    const secondHydration = useSpaceStore.getState().hydrateFromServer(2);

    await vi.waitFor(() => {
      expect(spaceApi.proxyFetchSpaces).toHaveBeenCalledTimes(1);
    });
    resolveSpaces?.([]);
    await Promise.all([firstHydration, secondHydration]);

    expect(spaceApi.proxyCreateSpace).toHaveBeenCalledTimes(1);
    expect(useSpaceStore.getState().activeSpaceId).toBe('space_created');
  });

  it('uses the authenticated owner when hydration omits userId', async () => {
    const spaceApi = await import('@/service/spaceApi');
    vi.mocked(spaceApi.proxyFetchSpaces).mockResolvedValue([
      makeSpace('space_selected', 'Selected Space', 'folder', '2'),
    ]);
    useSpaceStore.setState({
      activeSpaceId: 'space_selected',
      spaces: {
        space_selected: makeSpace(
          'space_selected',
          'Selected Space',
          'folder',
          '2'
        ),
      },
    });

    await useSpaceStore.getState().hydrateFromServer();

    expect(spaceApi.proxyCreateSpace).not.toHaveBeenCalled();
    expect(useSpaceStore.getState().activeSpaceId).toBe('space_selected');
  });

  it('coalesces concurrent project syncs for the same Space', async () => {
    const spaceApi = await import('@/service/spaceApi');
    const { proxyFetchGet } = await import('@/api/http');
    let resolveProjects: ((projects: ServerProject[]) => void) | undefined;
    vi.mocked(spaceApi.proxyFetchSpaceProjects).mockReturnValue(
      new Promise<ServerProject[]>((resolve) => {
        resolveProjects = resolve;
      })
    );

    const firstSync = useSpaceStore
      .getState()
      .syncProjectsFromServer('space_new_blank');
    const secondSync = useSpaceStore
      .getState()
      .syncProjectsFromServer('space_new_blank');

    await vi.waitFor(() => {
      expect(spaceApi.proxyFetchSpaceProjects).toHaveBeenCalledTimes(1);
      expect(proxyFetchGet).toHaveBeenCalledTimes(1);
    });
    resolveProjects?.([]);
    await Promise.all([firstSync, secondSync]);

    expect(spaceApi.proxyFetchSpaceProjects).toHaveBeenCalledTimes(1);
    expect(proxyFetchGet).toHaveBeenCalledTimes(1);
  });

  it('bounds background Space syncs and shares one lightweight history read', async () => {
    const spaceApi = await import('@/service/spaceApi');
    const { proxyFetchGet } = await import('@/api/http');
    const pendingResolvers: Array<() => void> = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;

    vi.mocked(spaceApi.proxyFetchSpaceProjects).mockImplementation(
      () =>
        new Promise<ServerProject[]>((resolve) => {
          activeRequests += 1;
          maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
          pendingResolvers.push(() => {
            activeRequests -= 1;
            resolve([]);
          });
        })
    );
    useSpaceStore.setState({ projectsSyncedAt: {} });

    const sync = useSpaceStore
      .getState()
      .syncProjectsForSpaces([
        'queued_space_1',
        'queued_space_2',
        'queued_space_3',
        'queued_space_4',
      ]);

    await vi.waitFor(() => {
      expect(spaceApi.proxyFetchSpaceProjects).toHaveBeenCalledTimes(2);
    });
    expect(maxActiveRequests).toBe(2);
    expect(proxyFetchGet).toHaveBeenCalledTimes(1);
    expect(proxyFetchGet).toHaveBeenCalledWith(
      '/api/v1/chat/histories/grouped?include_tasks=false'
    );

    pendingResolvers.splice(0, 2).forEach((resolve) => resolve());
    await vi.waitFor(() => {
      expect(spaceApi.proxyFetchSpaceProjects).toHaveBeenCalledTimes(4);
    });
    expect(maxActiveRequests).toBe(2);

    pendingResolvers.splice(0).forEach((resolve) => resolve());
    await sync;
  });
});
