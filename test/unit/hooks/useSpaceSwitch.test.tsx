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

import { useSpaceSwitch } from '@/hooks/useSpaceSwitch';
import { WorkspaceTab } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore, type SpaceProjectMeta } from '@/store/spaceStore';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureProjectRuntimeLoaded: vi.fn(),
  sync: vi.fn(),
}));

vi.mock('@/lib/projectRuntimeHydration', () => ({
  ensureProjectRuntimeLoaded: mocks.ensureProjectRuntimeLoaded,
}));
vi.mock('@/lib/spaceProject', () => ({
  resolveServerBackedSpaceId: async (_: unknown, spaceId: string) => spaceId,
}));

const session = (id: string): SpaceProjectMeta =>
  ({
    id,
    spaceId: 'space-a',
    name: id,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  }) as SpaceProjectMeta;

function renderSwitch() {
  return renderHook(() => useSpaceSwitch(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter>{children}</MemoryRouter>
    ),
  }).result;
}

describe('useSpaceSwitch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A sync that never answers: nothing below may wait for it.
    mocks.sync.mockReturnValue(new Promise(() => undefined));
    useSpaceStore.setState({
      activeSpaceId: 'space-b',
      projectsBySpaceId: { 'space-a': { 's-1': session('s-1') } },
      projectIdIndex: { 's-1': 'space-a' },
      projectsSyncedAt: {},
      shouldSyncProjects: () => true,
      syncProjectsFromServer: mocks.sync,
      setActiveSpace: (spaceId: string) =>
        useSpaceStore.setState({ activeSpaceId: spaceId }),
    } as never);
    useProjectRuntimeStore.setState({ setActiveProject: vi.fn() } as never);
  });

  it('switches without waiting for the Session list when none is chosen', async () => {
    const result = renderSwitch();

    let switched: boolean | undefined;
    await act(async () => {
      switched = await result.current.switchToSpace('space-a', {
        project: null,
        tab: WorkspaceTab.NewProject,
      });
    });

    expect(switched).toBe(true);
    expect(useSpaceStore.getState().activeSpaceId).toBe('space-a');
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('skips the sync for a Session it already knows, and can leave loading to the caller', async () => {
    const result = renderSwitch();

    await act(async () => {
      await result.current.switchToSpace('space-a', {
        project: 's-1',
        tab: null,
        hydrate: false,
      });
    });

    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.ensureProjectRuntimeLoaded).not.toHaveBeenCalled();
  });

  it('waits for the list when it has to pick the last Session', async () => {
    mocks.sync.mockResolvedValue(undefined);
    const result = renderSwitch();

    await act(async () => {
      await result.current.switchToSpace('space-a', { project: 'last' });
    });

    expect(mocks.sync).toHaveBeenCalledWith('space-a');
  });
});
