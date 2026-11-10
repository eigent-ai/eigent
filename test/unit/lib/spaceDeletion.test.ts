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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  stopSessionForDeletion: vi.fn(),
  deleteSessionTaskData: vi.fn(),
  assertSessionCleanupIdentity: vi.fn(),
  proxyFetchSpaceProjects: vi.fn(),
  proxyUpdateSpaceProject: vi.fn(),
  listOwnedWorkspaceBundles: vi.fn(),
  deleteSpaceOnServer: vi.fn(),
  removeProject: vi.fn(),
  projectsBySpaceId: {} as Record<
    string,
    Record<string, { id: string; status: 'active' | 'archived' }>
  >,
}));

// The real module pulls in the whole Run client; only its contract matters.
vi.mock('@/lib/sessionStop', () => ({
  SessionStopError: class SessionStopError extends Error {},
  stopSessionForDeletion: mocks.stopSessionForDeletion,
}));
vi.mock('@/lib/sessionFileCleanup', () => ({
  assertSessionCleanupIdentity: mocks.assertSessionCleanupIdentity,
  deleteSessionTaskData: mocks.deleteSessionTaskData,
}));
vi.mock('@/service/spaceApi', () => ({
  proxyFetchSpaceProjects: mocks.proxyFetchSpaceProjects,
  proxyUpdateSpaceProject: mocks.proxyUpdateSpaceProject,
}));
vi.mock('@/service/workspaceBundleAuthoringApi', () => ({
  listOwnedWorkspaceBundles: mocks.listOwnedWorkspaceBundles,
}));
vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: {
    getState: () => ({
      projectsBySpaceId: mocks.projectsBySpaceId,
      deleteSpaceOnServer: mocks.deleteSpaceOnServer,
    }),
  },
}));
vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: {
    getState: () => ({
      peekActiveChatStore: (projectId: string) =>
        projectId === 'session-open'
          ? { getState: () => ({ tasks: { 'task-open': {} } }) }
          : null,
      removeProject: mocks.removeProject,
    }),
  },
}));

import { SessionStopError } from '@/lib/sessionStop';
import {
  classifyDeleteSpaceFailure,
  deleteSpaceAndSessions,
  SpaceHasBundlesError,
} from '@/lib/spaceDeletion';

const identity = { email: 'person@example.test', userId: 7 };

function project(id: string, status: 'active' | 'archived' = 'active') {
  return { id, status, space_id: 'space-a', user_id: '7', name: id };
}

function httpError(status: number, code?: string) {
  return Object.assign(new Error(`HTTP ${status}`), {
    status,
    response: { data: { detail: code ? { code } : undefined } },
  });
}

describe('deleteSpaceAndSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls = [];
    mocks.projectsBySpaceId = {};
    mocks.listOwnedWorkspaceBundles.mockResolvedValue([
      { id: 'bundle-other', workspace_id: 'space-b' },
    ]);
    mocks.proxyFetchSpaceProjects.mockResolvedValue([
      project('session-open'),
      project('session-idle'),
      project('session-deleted', 'archived'),
    ]);
    mocks.stopSessionForDeletion.mockImplementation(async (id: string) => {
      mocks.calls.push(`stop:${id}`);
      return false;
    });
    mocks.deleteSessionTaskData.mockImplementation(
      async ({ projectId }: { projectId: string }) => {
        mocks.calls.push(`clean:${projectId}`);
      }
    );
    mocks.proxyUpdateSpaceProject.mockImplementation(
      async (_spaceId: string, projectId: string) => {
        mocks.calls.push(`archive:${projectId}`);
      }
    );
    mocks.deleteSpaceOnServer.mockImplementation(async (spaceId: string) => {
      mocks.calls.push(`delete-space:${spaceId}`);
    });
  });

  it('stops every Session, deletes each one, then deletes the Space', async () => {
    const phases: string[] = [];
    await deleteSpaceAndSessions('space-a', {
      identity,
      onPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(['stopping', 'deleting']);
    expect(mocks.calls).toEqual([
      'stop:session-open',
      'stop:session-idle',
      'clean:session-open',
      'archive:session-open',
      'clean:session-idle',
      'archive:session-idle',
      'delete-space:space-a',
    ]);
    expect(mocks.proxyUpdateSpaceProject).toHaveBeenCalledWith(
      'space-a',
      'session-open',
      { status: 'archived' }
    );
    expect(mocks.deleteSessionTaskData).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'session-open',
        spaceId: 'space-a',
        email: identity.email,
        userId: identity.userId,
        knownTasks: [{ task_id: 'task-open', project_id: 'session-open' }],
        deferLocalCleanup: false,
      })
    );
    // Session working directories and the Space folder are never removed.
    for (const [args] of mocks.deleteSessionTaskData.mock.calls) {
      expect(args.deleteWorkdir).toBeUndefined();
    }
    expect(mocks.removeProject.mock.calls).toEqual([
      ['session-open'],
      ['session-idle'],
    ]);
  });

  it('deletes nothing when a Session cannot be stopped', async () => {
    mocks.stopSessionForDeletion.mockImplementation(async (id: string) => {
      if (id === 'session-idle') throw new SessionStopError();
      return false;
    });

    const failure = await deleteSpaceAndSessions('space-a', { identity }).then(
      () => null,
      (error: unknown) => classifyDeleteSpaceFailure(error)
    );

    expect(failure).toBe('stop');
    expect(mocks.deleteSessionTaskData).not.toHaveBeenCalled();
    expect(mocks.proxyUpdateSpaceProject).not.toHaveBeenCalled();
    expect(mocks.deleteSpaceOnServer).not.toHaveBeenCalled();
  });

  it('does not delete the Space when a Session cannot be marked deleted', async () => {
    mocks.proxyUpdateSpaceProject.mockRejectedValue(httpError(500));

    await expect(
      deleteSpaceAndSessions('space-a', { identity })
    ).rejects.toMatchObject({ status: 500 });
    expect(mocks.deleteSpaceOnServer).not.toHaveBeenCalled();
    expect(mocks.removeProject).not.toHaveBeenCalled();
  });

  it('includes local Sessions and tolerates ones the server no longer has', async () => {
    mocks.proxyFetchSpaceProjects.mockResolvedValue([]);
    mocks.projectsBySpaceId = {
      'space-a': {
        'session-local': { id: 'session-local', status: 'active' },
        'session-gone': { id: 'session-gone', status: 'archived' },
      },
    };
    mocks.proxyUpdateSpaceProject.mockRejectedValue(httpError(404));

    await deleteSpaceAndSessions('space-a', { identity });

    expect(mocks.stopSessionForDeletion).toHaveBeenCalledTimes(1);
    expect(mocks.stopSessionForDeletion).toHaveBeenCalledWith('session-local');
    expect(mocks.deleteSpaceOnServer).toHaveBeenCalledWith('space-a');
  });

  it('still clears local Sessions when the Space is already gone on the server', async () => {
    mocks.proxyFetchSpaceProjects.mockRejectedValue(httpError(404));

    await deleteSpaceAndSessions('space-a', { identity });

    expect(mocks.stopSessionForDeletion).not.toHaveBeenCalled();
    expect(mocks.deleteSpaceOnServer).toHaveBeenCalledWith('space-a');
  });

  it('refuses a Space that is the source of a Workspace Bundle before touching anything', async () => {
    mocks.listOwnedWorkspaceBundles.mockResolvedValue([
      { id: 'bundle-other', workspace_id: 'space-b' },
      { id: 'bundle-own', workspace_id: 'space-a' },
    ]);

    const failure = await deleteSpaceAndSessions('space-a', { identity }).then(
      () => null,
      (error: unknown) => classifyDeleteSpaceFailure(error)
    );

    expect(failure).toBe('has-bundles');
    expect(mocks.stopSessionForDeletion).not.toHaveBeenCalled();
    expect(mocks.deleteSessionTaskData).not.toHaveBeenCalled();
    expect(mocks.proxyUpdateSpaceProject).not.toHaveBeenCalled();
    expect(mocks.deleteSpaceOnServer).not.toHaveBeenCalled();
  });

  it('skips the Workspace Bundle check on a server without Bundles', async () => {
    mocks.listOwnedWorkspaceBundles.mockRejectedValue(httpError(404));

    await deleteSpaceAndSessions('space-a', { identity });

    expect(mocks.deleteSpaceOnServer).toHaveBeenCalledWith('space-a');
  });

  it('deletes nothing when the Workspace Bundle check fails', async () => {
    mocks.listOwnedWorkspaceBundles.mockRejectedValue(httpError(503));

    await expect(
      deleteSpaceAndSessions('space-a', { identity })
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.stopSessionForDeletion).not.toHaveBeenCalled();
    expect(mocks.deleteSpaceOnServer).not.toHaveBeenCalled();
  });

  it('keeps local files of Sessions whose backend could not be reached', async () => {
    mocks.stopSessionForDeletion.mockResolvedValue(true);

    await deleteSpaceAndSessions('space-a', { identity });

    for (const [args] of mocks.deleteSessionTaskData.mock.calls) {
      expect(args.deferLocalCleanup).toBe(true);
    }
  });
});

describe('classifyDeleteSpaceFailure', () => {
  it('names the server refusals the user can act on', () => {
    expect(
      classifyDeleteSpaceFailure(httpError(409, 'space_has_projects'))
    ).toBe('has-sessions');
    expect(
      classifyDeleteSpaceFailure(httpError(409, 'space_has_bundles'))
    ).toBe('has-bundles');
    expect(classifyDeleteSpaceFailure(httpError(409))).toBe('cleanup');
    expect(classifyDeleteSpaceFailure(new Error('offline'))).toBe('cleanup');
    expect(classifyDeleteSpaceFailure(new SessionStopError())).toBe('stop');
    expect(classifyDeleteSpaceFailure(new SpaceHasBundlesError())).toBe(
      'has-bundles'
    );
  });
});
