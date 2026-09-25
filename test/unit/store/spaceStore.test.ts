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
import { useInstallationStore } from '@/store/installationStore';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import {
  isDisposableBlankSpace,
  SPACE_SCHEMA_VERSION,
  useSpaceStore,
  type Space,
  type SpaceSourceType,
} from '@/store/spaceStore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/store/installationStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/installationStore')>()),
  ...backendReadinessMock,
}));

vi.mock('@/api/http', () => ({
  proxyFetchGet: vi.fn().mockResolvedValue({ projects: [] }),
}));

vi.mock('@/service/spaceApi', () => ({
  proxyCreateSpace: vi.fn(),
  proxyDeleteSpace: vi.fn(),
  proxyEnsureLegacySpace: vi.fn(),
  proxyFetchSpaceProjects: vi.fn(),
  proxyFetchSpaces: vi.fn(),
  proxyUpdateSpace: vi.fn(),
  proxyArchiveSpace: vi.fn(),
  proxyUnarchiveSpace: vi.fn(),
  proxyRelocateSpace: vi.fn(),
}));

vi.mock('@/service/workspaceApi', () => ({
  reconcileWorkspaceBindings: vi.fn().mockResolvedValue(undefined),
  unbindWorkspaceFromBrain: vi.fn(),
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

describe('spaceStore server deletion', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spaceApi = await import('@/service/spaceApi');
    const workspaceApi = await import('@/service/workspaceApi');
    vi.mocked(spaceApi.proxyDeleteSpace)
      .mockReset()
      .mockResolvedValue(undefined);
    vi.mocked(spaceApi.proxyFetchSpaces).mockResolvedValue([
      makeSpace('space_kept', 'Keep', 'folder'),
    ]);
    vi.mocked(spaceApi.proxyFetchSpaceProjects).mockResolvedValue([]);
    vi.mocked(workspaceApi.reconcileWorkspaceBindings)
      .mockReset()
      .mockResolvedValue({
        email: 'new@example.com',
        active_space_ids: ['space_kept'],
        removed_space_ids: [],
        removed_count: 0,
      });
    vi.mocked(workspaceApi.unbindWorkspaceFromBrain)
      .mockReset()
      .mockResolvedValue({
        space_id: 'space_deleted',
        email: 'new@example.com',
        user_id: 2,
        bound: false,
      });
    backendReadinessMock.waitForBackendReadiness.mockResolvedValue(undefined);
    useInstallationStore.setState({ isBackendReady: true });
    authStoreMock.state = { email: 'new@example.com', user_id: 2 };
    usePageTabStore.setState({
      sessionPreviewProjectId: null,
      sessionPreviewByProject: {},
    });
    useSpaceStore.setState({
      activeSpaceId: 'space_deleted',
      spaces: {
        space_deleted: makeSpace('space_deleted', 'Delete', 'folder'),
        space_kept: makeSpace('space_kept', 'Keep', 'folder'),
      },
      projectsBySpaceId: {
        space_deleted: {
          project_deleted: {
            id: 'project_deleted',
            userId: '2',
            spaceId: 'space_deleted',
            name: 'Session',
            status: 'archived',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      projectIdIndex: { project_deleted: 'space_deleted' },
      lastVisitedProjectBySpace: { space_deleted: 'project_deleted' },
      projectsSyncedAt: { space_deleted: 1, space_kept: Date.now() },
    });
  });

  afterEach(async () => {
    // Release any failed cleanup subscriptions without sending another request.
    authStoreMock.state = { email: 'signed-out@example.com', user_id: -1 };
    useInstallationStore.setState({ isBackendReady: false });
    useInstallationStore.setState({ isBackendReady: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.mocked(console.warn).mockRestore();
  });

  it.each([204, 404])(
    'removes local Space state after cloud %s even when Brain unbind fails',
    async (status) => {
      const spaceApi = await import('@/service/spaceApi');
      const workspaceApi = await import('@/service/workspaceApi');
      const unbindError = new TypeError('Failed to fetch');
      const warn = vi.mocked(console.warn);
      if (status === 404) {
        vi.mocked(spaceApi.proxyDeleteSpace).mockRejectedValueOnce({ status });
      }
      vi.mocked(workspaceApi.unbindWorkspaceFromBrain).mockRejectedValueOnce(
        unbindError
      );
      usePageTabStore.getState().setSessionPreviewProject('project_deleted');

      await expect(
        useSpaceStore.getState().deleteSpaceOnServer('space_deleted')
      ).resolves.toBeUndefined();

      const state = useSpaceStore.getState();
      expect(Object.keys(state.spaces)).toEqual(['space_kept']);
      expect(state.activeSpaceId).toBe('space_kept');
      expect(state.projectsBySpaceId.space_deleted).toBeUndefined();
      expect(state.projectIdIndex.project_deleted).toBeUndefined();
      expect(state.lastVisitedProjectBySpace.space_deleted).toBeUndefined();
      expect(state.projectsSyncedAt.space_deleted).toBeUndefined();
      expect(
        usePageTabStore.getState().sessionPreviewByProject.project_deleted
      ).toBeUndefined();
      await vi.waitFor(() => {
        expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledWith(
          'space_deleted',
          'new@example.com',
          2,
          expect.objectContaining({
            signal: expect.any(AbortSignal),
            expectedAccountKey: expect.any(String),
          })
        );
        expect(warn).toHaveBeenCalledWith(expect.any(String), unbindError);
      });
    }
  );

  it('waits for cloud confirmation before removing local state', async () => {
    const spaceApi = await import('@/service/spaceApi');
    const workspaceApi = await import('@/service/workspaceApi');
    let confirmDeletion!: () => void;
    vi.mocked(spaceApi.proxyDeleteSpace).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        confirmDeletion = resolve;
      })
    );

    const deletion = useSpaceStore
      .getState()
      .deleteSpaceOnServer('space_deleted');
    await vi.waitFor(() => {
      expect(spaceApi.proxyDeleteSpace).toHaveBeenCalledWith('space_deleted');
    });
    expect(useSpaceStore.getState().spaces.space_deleted).toBeDefined();
    expect(workspaceApi.unbindWorkspaceFromBrain).not.toHaveBeenCalled();

    confirmDeletion();
    await deletion;

    expect(useSpaceStore.getState().spaces.space_deleted).toBeUndefined();
    await vi.waitFor(() => {
      expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(1);
    });
  });

  it.each([403, 409, 500, undefined])(
    'preserves local state and reports cloud deletion failure %s',
    async (status) => {
      const spaceApi = await import('@/service/spaceApi');
      const workspaceApi = await import('@/service/workspaceApi');
      const error = Object.assign(new Error('Cloud deletion failed'), {
        status,
      });
      vi.mocked(spaceApi.proxyDeleteSpace).mockRejectedValueOnce(error);
      const before = useSpaceStore.getState();

      await expect(
        useSpaceStore.getState().deleteSpaceOnServer('space_deleted')
      ).rejects.toBe(error);

      expect(useSpaceStore.getState()).toBe(before);
      expect(workspaceApi.unbindWorkspaceFromBrain).not.toHaveBeenCalled();
    }
  );

  it('completes deletion without waiting for a stalled Brain unbind', async () => {
    const workspaceApi = await import('@/service/workspaceApi');
    let finishUnbind!: () => void;
    vi.mocked(workspaceApi.unbindWorkspaceFromBrain).mockReturnValueOnce(
      new Promise((resolve) => {
        finishUnbind = () =>
          resolve({
            space_id: 'space_deleted',
            email: 'new@example.com',
            bound: false,
          });
      })
    );
    let completed = false;
    const deletion = useSpaceStore
      .getState()
      .deleteSpaceOnServer('space_deleted')
      .then(() => {
        completed = true;
      });
    try {
      await vi.waitFor(() => {
        expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(1);
        expect(completed).toBe(true);
      });
      expect(useSpaceStore.getState().spaces.space_deleted).toBeUndefined();
    } finally {
      finishUnbind();
      await deletion;
    }
  });

  it('reconciles the orphaned binding on the next hydration after Brain recovers', async () => {
    const workspaceApi = await import('@/service/workspaceApi');
    vi.mocked(workspaceApi.unbindWorkspaceFromBrain).mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    );
    await useSpaceStore.getState().deleteSpaceOnServer('space_deleted');
    await vi.waitFor(() => {
      expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(1);
    });
    backendReadinessMock.waitForBackendReadiness.mockClear();
    let backendReady!: () => void;
    backendReadinessMock.waitForBackendReadiness.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        backendReady = resolve;
      })
    );

    await useSpaceStore.getState().hydrateFromServer(2);
    await vi.waitFor(() => {
      expect(
        backendReadinessMock.waitForBackendReadiness
      ).toHaveBeenCalledTimes(1);
    });
    expect(workspaceApi.reconcileWorkspaceBindings).not.toHaveBeenCalled();
    backendReady();

    await vi.waitFor(() => {
      expect(workspaceApi.reconcileWorkspaceBindings).toHaveBeenCalledWith(
        'new@example.com',
        ['space_kept'],
        2
      );
    });
    expect(useSpaceStore.getState().spaces.space_deleted).toBeUndefined();
  });

  it.each([204, 404])(
    'does not restore a Space from an older hydration after cloud deletion %s',
    async (status) => {
      const spaceApi = await import('@/service/spaceApi');
      let returnOldSnapshot!: () => void;
      vi.mocked(spaceApi.proxyFetchSpaces).mockReturnValueOnce(
        new Promise((resolve) => {
          returnOldSnapshot = () =>
            resolve([
              makeSpace('space_deleted', 'Delete', 'folder'),
              makeSpace('space_kept', 'Keep', 'folder'),
            ]);
        })
      );
      if (status === 404) {
        vi.mocked(spaceApi.proxyDeleteSpace).mockRejectedValueOnce({ status });
      }
      const hydration = useSpaceStore.getState().hydrateFromServer(2);
      await vi.waitFor(() =>
        expect(spaceApi.proxyFetchSpaces).toHaveBeenCalledTimes(1)
      );

      try {
        await useSpaceStore.getState().deleteSpaceOnServer('space_deleted');
      } finally {
        returnOldSnapshot();
        await hydration;
      }

      expect(Object.keys(useSpaceStore.getState().spaces)).toEqual([
        'space_kept',
      ]);
      expect(useSpaceStore.getState().activeSpaceId).toBe('space_kept');
    }
  );

  it('keeps a Space in a concurrent hydration when cloud deletion fails', async () => {
    const spaceApi = await import('@/service/spaceApi');
    let returnSnapshot!: () => void;
    vi.mocked(spaceApi.proxyFetchSpaces).mockReturnValueOnce(
      new Promise((resolve) => {
        returnSnapshot = () =>
          resolve([
            makeSpace('space_deleted', 'Still present', 'folder'),
            makeSpace('space_kept', 'Keep', 'folder'),
          ]);
      })
    );
    vi.mocked(spaceApi.proxyDeleteSpace).mockRejectedValueOnce({ status: 409 });
    const hydration = useSpaceStore.getState().hydrateFromServer(2);
    await vi.waitFor(() =>
      expect(spaceApi.proxyFetchSpaces).toHaveBeenCalledTimes(1)
    );
    try {
      await expect(
        useSpaceStore.getState().deleteSpaceOnServer('space_deleted')
      ).rejects.toEqual({ status: 409 });
    } finally {
      returnSnapshot();
      await hydration;
    }
    expect(useSpaceStore.getState().spaces.space_deleted.name).toBe(
      'Still present'
    );
  });

  it('uses current Spaces when an earlier hydration resumes reconciliation after backend readiness', async () => {
    const spaceApi = await import('@/service/spaceApi');
    const workspaceApi = await import('@/service/workspaceApi');
    vi.mocked(spaceApi.proxyFetchSpaces).mockResolvedValueOnce([
      makeSpace('space_deleted', 'Delete', 'folder'),
      makeSpace('space_kept', 'Keep', 'folder'),
    ]);
    let backendReady!: () => void;
    backendReadinessMock.waitForBackendReadiness.mockReturnValue(
      new Promise<void>((resolve) => {
        backendReady = resolve;
      })
    );
    await useSpaceStore.getState().hydrateFromServer(2);
    await vi.waitFor(() =>
      expect(backendReadinessMock.waitForBackendReadiness).toHaveBeenCalled()
    );
    try {
      await useSpaceStore.getState().deleteSpaceOnServer('space_deleted');
      useSpaceStore
        .getState()
        .upsertSpaces([makeSpace('space_new', 'New', 'folder')]);
      expect(workspaceApi.reconcileWorkspaceBindings).not.toHaveBeenCalled();
    } finally {
      backendReady();
    }
    await vi.waitFor(() =>
      expect(workspaceApi.reconcileWorkspaceBindings).toHaveBeenCalledWith(
        'new@example.com',
        ['space_kept', 'space_new'],
        2
      )
    );
  });

  it('refreshes the Space list before retrying a failed reconciliation', async () => {
    const spaceApi = await import('@/service/spaceApi');
    const workspaceApi = await import('@/service/workspaceApi');
    vi.mocked(spaceApi.proxyFetchSpaces).mockResolvedValueOnce([
      makeSpace('space_deleted', 'Delete', 'folder'),
      makeSpace('space_kept', 'Keep', 'folder'),
    ]);
    let failReconcile!: () => void;
    vi.mocked(workspaceApi.reconcileWorkspaceBindings).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failReconcile = () => reject(new TypeError('Failed to fetch'));
      })
    );
    await useSpaceStore.getState().hydrateFromServer(2);
    await vi.waitFor(() =>
      expect(workspaceApi.reconcileWorkspaceBindings).toHaveBeenCalledTimes(1)
    );
    try {
      await useSpaceStore.getState().deleteSpaceOnServer('space_deleted');
      useSpaceStore
        .getState()
        .upsertSpaces([makeSpace('space_new', 'New', 'folder')]);
    } finally {
      failReconcile();
    }
    await vi.waitFor(() =>
      expect(workspaceApi.reconcileWorkspaceBindings).toHaveBeenNthCalledWith(
        2,
        'new@example.com',
        ['space_kept', 'space_new'],
        2
      )
    );
  });

  it('completes deletion of the last Space while offline and unbinds it when Brain is ready', async () => {
    const workspaceApi = await import('@/service/workspaceApi');
    useSpaceStore.setState({
      spaces: { space_deleted: makeSpace('space_deleted', 'Delete', 'folder') },
    });
    useInstallationStore.setState({ isBackendReady: false });
    try {
      await useSpaceStore.getState().deleteSpaceOnServer('space_deleted');
      expect(useSpaceStore.getState().spaces).toEqual({});
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(workspaceApi.unbindWorkspaceFromBrain).not.toHaveBeenCalled();
    } finally {
      useInstallationStore.setState({ isBackendReady: true });
    }
    await vi.waitFor(() =>
      expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledWith(
        'space_deleted',
        'new@example.com',
        2,
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          expectedAccountKey: expect.any(String),
        })
      )
    );
  });

  it('does not restore a Space deleted while hydration is inspecting legacy projects', async () => {
    const spaceApi = await import('@/service/spaceApi');
    vi.mocked(spaceApi.proxyFetchSpaces).mockResolvedValueOnce([
      makeSpace('space_deleted', 'Delete', 'folder'),
      makeSpace('space_kept', 'Keep', 'folder'),
      makeSpace('legacy_2', 'Legacy Space', 'legacy'),
    ]);
    let finishLegacyInspection!: () => void;
    vi.mocked(spaceApi.proxyFetchSpaceProjects).mockReturnValueOnce(
      new Promise((resolve) => {
        finishLegacyInspection = () => resolve([]);
      })
    );
    const hydration = useSpaceStore.getState().hydrateFromServer(2);
    await vi.waitFor(() =>
      expect(spaceApi.proxyFetchSpaceProjects).toHaveBeenCalledWith('legacy_2')
    );
    try {
      await useSpaceStore.getState().deleteSpaceOnServer('space_deleted');
    } finally {
      finishLegacyInspection();
      await hydration;
    }
    expect(Object.keys(useSpaceStore.getState().spaces)).toEqual([
      'space_kept',
    ]);
  });

  it('skips deferred cleanup after the account changes', async () => {
    const workspaceApi = await import('@/service/workspaceApi');
    useInstallationStore.setState({ isBackendReady: false });
    let backendReady!: () => void;
    backendReadinessMock.waitForBackendReadiness.mockReturnValue(
      new Promise<void>((resolve) => {
        backendReady = resolve;
      })
    );
    await useSpaceStore.getState().hydrateFromServer(2);
    await useSpaceStore.getState().deleteSpaceOnServer('space_deleted');
    await vi.waitFor(() =>
      expect(
        backendReadinessMock.waitForBackendReadiness
      ).toHaveBeenCalledTimes(1)
    );
    authStoreMock.state = { email: 'other@example.com', user_id: 3 };
    useSpaceStore.getState().resetForUser(3);
    backendReady();
    useInstallationStore.setState({ isBackendReady: true });
    // Both readiness continuations and their async wrappers must finish before
    // asserting that neither cleanup request was issued for the old account.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workspaceApi.unbindWorkspaceFromBrain).not.toHaveBeenCalled();
    expect(workspaceApi.reconcileWorkspaceBindings).not.toHaveBeenCalled();
  });

  it('does not retry reconciliation after switching accounts', async () => {
    const workspaceApi = await import('@/service/workspaceApi');
    vi.mocked(workspaceApi.reconcileWorkspaceBindings).mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    );
    await useSpaceStore.getState().hydrateFromServer(2);
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        '[spaceStore] Brain workspace reconcile failed; retrying once:',
        expect.any(TypeError)
      )
    );
    authStoreMock.state = { email: 'other@example.com', user_id: 3 };
    useSpaceStore.getState().resetForUser(3);
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(workspaceApi.reconcileWorkspaceBindings).toHaveBeenCalledTimes(1);
  });

  it('scopes cloud deletion completion to the account that started it', async () => {
    const spaceApi = await import('@/service/spaceApi');
    const workspaceApi = await import('@/service/workspaceApi');
    let confirmDeletion!: () => void;
    vi.mocked(spaceApi.proxyDeleteSpace).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        confirmDeletion = resolve;
      })
    );
    const deletion = useSpaceStore
      .getState()
      .deleteSpaceOnServer('space_deleted');
    await vi.waitFor(() =>
      expect(spaceApi.proxyDeleteSpace).toHaveBeenCalled()
    );
    authStoreMock.state = { email: 'other@example.com', user_id: 3 };
    const otherAccountSpace = makeSpace(
      'space_deleted',
      'Other account',
      'folder',
      '3'
    );
    useSpaceStore.setState({ spaces: { space_deleted: otherAccountSpace } });
    confirmDeletion();
    await deletion;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useSpaceStore.getState().spaces.space_deleted).toEqual(
      otherAccountSpace
    );
    expect(workspaceApi.unbindWorkspaceFromBrain).not.toHaveBeenCalled();
  });

  it.each(['rename', 'archive', 'unarchive', 'relocate'] as const)(
    'does not restore a deleted Space from a late %s response',
    async (operation) => {
      const api = await import('@/service/spaceApi');
      const workspaceApi = await import('@/service/workspaceApi');
      const calls = {
        rename: () =>
          useSpaceStore
            .getState()
            .renameSpaceOnServer('space_deleted', 'Renamed'),
        archive: () =>
          useSpaceStore.getState().archiveSpaceOnServer('space_deleted'),
        unarchive: () =>
          useSpaceStore.getState().unarchiveSpaceOnServer('space_deleted'),
        relocate: () =>
          useSpaceStore
            .getState()
            .relocateSpaceOnServer('space_deleted', '/new-folder'),
      };
      const requests = {
        rename: api.proxyUpdateSpace,
        archive: api.proxyArchiveSpace,
        unarchive: api.proxyUnarchiveSpace,
        relocate: api.proxyRelocateSpace,
      };
      let finishUpdate!: () => void;
      vi.mocked(requests[operation]).mockReturnValueOnce(
        new Promise((resolve) => {
          finishUpdate = () =>
            resolve(makeSpace('space_deleted', 'Updated', 'folder'));
        })
      );
      const update = calls[operation]();
      await vi.waitFor(() =>
        expect(requests[operation]).toHaveBeenCalledTimes(1)
      );
      try {
        await useSpaceStore.getState().deleteSpaceOnServer('space_deleted');
      } finally {
        finishUpdate();
        await update;
      }
      await vi.waitFor(() =>
        expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(1)
      );
      expect(useSpaceStore.getState().spaces.space_deleted).toBeUndefined();
      expect(useSpaceStore.getState().activeSpaceId).toBe('space_kept');
    }
  );

  it('applies a pending rename when cloud deletion is rejected', async () => {
    const api = await import('@/service/spaceApi');
    let finishRename!: () => void;
    vi.mocked(api.proxyUpdateSpace).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRename = () =>
          resolve(makeSpace('space_deleted', 'Renamed', 'folder'));
      })
    );
    vi.mocked(api.proxyDeleteSpace).mockRejectedValueOnce({ status: 409 });
    const rename = useSpaceStore
      .getState()
      .renameSpaceOnServer('space_deleted', 'Renamed');
    await vi.waitFor(() =>
      expect(api.proxyUpdateSpace).toHaveBeenCalledTimes(1)
    );
    try {
      await expect(
        useSpaceStore.getState().deleteSpaceOnServer('space_deleted')
      ).rejects.toEqual({ status: 409 });
    } finally {
      finishRename();
      await rename;
    }
    expect(useSpaceStore.getState().spaces.space_deleted.name).toBe('Renamed');
  });

  it('does not apply a previous account rename to the current account', async () => {
    const api = await import('@/service/spaceApi');
    let finishRename!: () => void;
    vi.mocked(api.proxyUpdateSpace).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRename = () =>
          resolve(makeSpace('space_deleted', 'Renamed', 'folder'));
      })
    );
    const rename = useSpaceStore
      .getState()
      .renameSpaceOnServer('space_deleted', 'Renamed');
    await vi.waitFor(() =>
      expect(api.proxyUpdateSpace).toHaveBeenCalledTimes(1)
    );
    authStoreMock.state = { email: 'other@example.com', user_id: 3 };
    const other = makeSpace('space_deleted', 'Other account', 'folder', '3');
    useSpaceStore.setState({ spaces: { space_deleted: other } });
    finishRename();
    await rename;
    expect(useSpaceStore.getState().spaces.space_deleted).toEqual(other);
  });

  it('retains failed unbinds across backend recovery until cleanup succeeds', async () => {
    const workspaceApi = await import('@/service/workspaceApi');
    vi.mocked(workspaceApi.unbindWorkspaceFromBrain)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Still unavailable'));
    await useSpaceStore.getState().deleteSpaceOnServer('space_deleted');
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledTimes(1));
    expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(1);
    useInstallationStore.setState({ isBackendReady: false });
    useInstallationStore.setState({ isBackendReady: true });
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledTimes(2));
    expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(2);
    useInstallationStore.setState({ isBackendReady: false });
    useInstallationStore.setState({ isBackendReady: true });
    await vi.waitFor(() =>
      expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(3)
    );
    useInstallationStore.setState({ isBackendReady: false });
    useInstallationStore.setState({ isBackendReady: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(3);
    expect(useSpaceStore.getState().spaces.space_deleted).toBeUndefined();
  });

  it('retries after recovery that occurs while the previous unbind is settling', async () => {
    const workspaceApi = await import('@/service/workspaceApi');
    let failUnbind!: () => void;
    vi.mocked(workspaceApi.unbindWorkspaceFromBrain).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failUnbind = () => reject(new TypeError('Connection closed'));
      })
    );
    await useSpaceStore.getState().deleteSpaceOnServer('space_deleted');
    await vi.waitFor(() =>
      expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(1)
    );
    useInstallationStore.setState({ isBackendReady: false });
    useInstallationStore.setState({ isBackendReady: true });
    failUnbind();
    await vi.waitFor(() =>
      expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(2)
    );
    expect(
      vi.mocked(workspaceApi.unbindWorkspaceFromBrain).mock.calls[0][3]?.signal
        ?.aborted
    ).toBe(true);
  });

  it('drops failed cleanup when backend recovery belongs to a different account', async () => {
    const workspaceApi = await import('@/service/workspaceApi');
    vi.mocked(workspaceApi.unbindWorkspaceFromBrain).mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    );
    await useSpaceStore.getState().deleteSpaceOnServer('space_deleted');
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledTimes(1));
    authStoreMock.state = { email: 'other@example.com', user_id: 3 };
    useInstallationStore.setState({ isBackendReady: false });
    useInstallationStore.setState({ isBackendReady: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(1);
  });

  it('cancels a hung unbind after its deadline and retries on the next recovery', async () => {
    const workspaceApi = await import('@/service/workspaceApi');
    // Warm the scheduler imports before switching timers so this test controls
    // the request deadline without depending on dynamic-import timing.
    await import('@/lib/workspaceUnbind');
    vi.mocked(workspaceApi.unbindWorkspaceFromBrain).mockImplementationOnce(
      (_spaceId, _email, _userId, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        })
    );
    vi.useFakeTimers();
    try {
      await useSpaceStore.getState().deleteSpaceOnServer('space_deleted');
      await vi.waitFor(() =>
        expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(1)
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(console.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ name: 'AbortError' })
      );
      expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(1);
      useInstallationStore.setState({ isBackendReady: false });
      useInstallationStore.setState({ isBackendReady: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(workspaceApi.unbindWorkspaceFromBrain).toHaveBeenCalledTimes(2);
      expect(useSpaceStore.getState().spaces.space_deleted).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
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
