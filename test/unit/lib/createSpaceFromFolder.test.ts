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
// Licensed under the Apache License, Version 2.0 (the "License");

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bindWorkspace: vi.fn(),
  createProject: vi.fn(),
  createSpace: vi.fn(),
  deleteSpace: vi.fn(),
  fetchCapabilities: vi.fn(),
  setActiveSpace: vi.fn(),
  unbindWorkspace: vi.fn(),
  updateSpace: vi.fn(),
}));

vi.mock('@/store/spaceStore', () => {
  const placeholder = {
    id: 'empty-space',
    name: 'Untitled Space',
    sourceType: 'blank',
    rootPath: null,
    rootFingerprint: null,
    status: 'active',
    schemaVersion: 2,
    createdAt: 1,
    updatedAt: 1,
    metadata: {
      createdFrom: 'initial_hydrate',
      autoCreatedPlaceholder: true,
    },
  };
  const state = {
    spaces: { 'empty-space': placeholder },
    projectsBySpaceId: { 'empty-space': {} },
    createSpaceOnServer: mocks.createSpace,
    updateSpaceOnServer: mocks.updateSpace,
    deleteSpaceOnServer: mocks.deleteSpace,
    setActiveSpace: mocks.setActiveSpace,
  };
  return {
    isDisposableBlankSpace: (space: typeof placeholder | null) =>
      Boolean(
        space &&
        space.name === 'Untitled Space' &&
        space.sourceType === 'blank' &&
        space.metadata.autoCreatedPlaceholder
      ),
    useSpaceStore: { getState: () => state },
  };
});

vi.mock('@/service/workspaceApi', () => ({
  bindWorkspaceToSpace: mocks.bindWorkspace,
  fetchWorkspaceCapabilities: mocks.fetchCapabilities,
  unbindWorkspaceFromBrain: mocks.unbindWorkspace,
}));

vi.mock('@/lib/spaceProject', () => ({
  createSyncedProjectInSpace: mocks.createProject,
}));

import { createSpaceFromFolderPicker } from '@/lib/createSpaceFromFolder';

describe('createSpaceFromFolderPicker', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.fetchCapabilities.mockResolvedValue({ binding_enabled: true });
    mocks.bindWorkspace.mockResolvedValue(undefined);
    mocks.updateSpace.mockResolvedValue(undefined);
    mocks.createProject.mockResolvedValue({ spaceId: 'empty-space' });
  });

  it('converts the selected Untitled Space instead of creating a new Space', async () => {
    const selectFile = vi.fn().mockResolvedValue({
      success: true,
      files: [{ filePath: '/Users/test/project-folder' }],
    });

    const result = await createSpaceFromFolderPicker({
      host: { electronAPI: { selectFile } } as never,
      email: 'owner@example.com',
      userId: 'user-1',
      activeSpaceId: 'empty-space',
      projectStore: {} as never,
      createdFrom: 'space_detail_empty_state',
    });

    expect(result).toBe('empty-space');
    expect(mocks.createSpace).not.toHaveBeenCalled();
    expect(mocks.bindWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        space_id: 'empty-space',
        path: '/Users/test/project-folder',
      })
    );
    expect(mocks.updateSpace).toHaveBeenCalledWith(
      'empty-space',
      expect.objectContaining({
        name: 'project-folder',
        sourceType: 'folder',
        rootPath: '/Users/test/project-folder',
      })
    );
    expect(mocks.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'empty-space' })
    );
    expect(mocks.deleteSpace).not.toHaveBeenCalled();
    expect(mocks.setActiveSpace).toHaveBeenCalledWith('empty-space');
  });
});
