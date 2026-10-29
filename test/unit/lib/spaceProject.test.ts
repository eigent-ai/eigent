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

import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import type { ProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerProject: vi.fn(),
}));

vi.mock('@/service/spaceApi', () => ({
  proxyCreateSpaceProject: mocks.createServerProject,
  proxyEnsureLegacySpace: vi.fn(),
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({ token: 'fixture', user_id: 1 }),
}));

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: { getState: () => ({ getSpaceById: () => null }) },
}));

const createProjectStore = () => {
  const order: string[] = [];
  const store = {
    createProject: vi.fn((_name: string, _description, id: string) => {
      order.push('local');
      return id;
    }),
    removeProject: vi.fn(),
  };
  mocks.createServerProject.mockImplementation(async () => {
    order.push('server');
  });
  return {
    order,
    store,
    projectStore: store as unknown as ProjectRuntimeStore,
  };
};

describe('createSyncedProjectInSpace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the local Project after the server accepts it by default', async () => {
    const { order, projectStore } = createProjectStore();

    await createSyncedProjectInSpace({
      projectId: 'project-1',
      projectStore,
      spaceId: 'space-1',
    });

    expect(order).toEqual(['server', 'local']);
  });

  it('opens the local Project before the server request when asked', async () => {
    const { order, store, projectStore } = createProjectStore();
    const onLocalProjectCreated = vi.fn(() => order.push('opened'));

    const result = await createSyncedProjectInSpace({
      projectId: 'project-1',
      projectStore,
      spaceId: 'space-1',
      onLocalProjectCreated,
    });

    expect(order).toEqual(['local', 'opened', 'server']);
    expect(onLocalProjectCreated).toHaveBeenCalledWith({
      projectId: 'project-1',
      spaceId: 'space-1',
    });
    expect(result).toEqual({ projectId: 'project-1', spaceId: 'space-1' });
    expect(store.removeProject).not.toHaveBeenCalled();
  });

  it('removes the opened local Project when the server rejects it', async () => {
    const { store, projectStore } = createProjectStore();
    mocks.createServerProject.mockRejectedValue(new Error('rejected'));

    await expect(
      createSyncedProjectInSpace({
        projectId: 'project-1',
        projectStore,
        spaceId: 'space-1',
        onLocalProjectCreated: vi.fn(),
      })
    ).rejects.toThrow('rejected');

    expect(store.removeProject).toHaveBeenCalledWith('project-1');
  });
});
