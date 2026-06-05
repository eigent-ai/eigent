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

import {
  isProjectAchieved,
  setProjectAchievedState,
} from '@/lib/projectAchievement';
import {
  getSessionNavLeadFromHistoryTask,
  resolveProjectNavLeadPresentation,
} from '@/lib/sessionNavLead';
import { proxyUpdateSpaceProject } from '@/service/spaceApi';
import { useProjectStore } from '@/store/projectStore';
import { useSpaceStore } from '@/store/spaceStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/service/spaceApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/spaceApi')>();
  return {
    ...actual,
    proxyUpdateSpaceProject: vi.fn(),
  };
});

const mockProxyUpdateSpaceProject = vi.mocked(proxyUpdateSpaceProject);

describe('project achievement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({
      activeProjectId: null,
      projects: {},
      navLeadByProjectId: {},
      historyLoadingProjectIds: {},
    });
    useSpaceStore.setState({
      activeSpaceId: 'space-1',
      spaces: {},
      lastVisitedProjectBySpace: {},
      projectsBySpaceId: {},
      projectIdIndex: {},
      projectsSyncedAt: {},
    });

    useProjectStore
      .getState()
      .createProject(
        'Existing Project',
        undefined,
        'project-1',
        undefined,
        undefined,
        true,
        {
          spaceId: 'space-1',
          metadata: { serverSynced: true },
        }
      );
    mockProxyUpdateSpaceProject.mockResolvedValue({
      id: 'project-1',
      user_id: 'user-1',
      space_id: 'space-1',
      name: 'Existing Project',
      status: 'active',
      metadata: {},
    });
  });

  it('persists achieved metadata without archiving or removing the project', async () => {
    await setProjectAchievedState({
      projectStore: useProjectStore.getState(),
      projectId: 'project-1',
      achieved: true,
      achievedAt: 1234,
    });

    expect(mockProxyUpdateSpaceProject).toHaveBeenCalledWith(
      'space-1',
      'project-1',
      {
        metadata: {
          status: 'completed',
          achievedAt: 1234,
        },
      }
    );
    expect(
      useSpaceStore.getState().getProjectMeta('project-1')?.metadata
    ).toMatchObject({
      status: 'completed',
      achievedAt: 1234,
    });
    expect(
      useProjectStore.getState().getProjectById('project-1')?.metadata
    ).toMatchObject({
      status: 'completed',
      achievedAt: 1234,
    });
  });

  it('clears achieved metadata when the project resumes', async () => {
    useSpaceStore.getState().updateProjectMeta('project-1', {
      metadata: { status: 'completed', achievedAt: 1234 },
    });
    useProjectStore.getState().updateProject('project-1', {
      metadata: { status: 'completed', achievedAt: 1234 },
    });

    await setProjectAchievedState({
      projectStore: useProjectStore.getState(),
      projectId: 'project-1',
      achieved: false,
    });

    expect(mockProxyUpdateSpaceProject).toHaveBeenCalledWith(
      'space-1',
      'project-1',
      {
        metadata: {
          status: 'active',
          achievedAt: null,
        },
      }
    );
    expect(
      useSpaceStore.getState().getProjectMeta('project-1')?.metadata
    ).toMatchObject({
      status: 'active',
      achievedAt: null,
    });
    expect(isProjectAchieved({ status: 'active' })).toBe(false);
  });

  it('updates the resumed state locally before the server responds', async () => {
    let resolveUpdate!: (value: any) => void;
    mockProxyUpdateSpaceProject.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      })
    );
    useSpaceStore.getState().updateProjectMeta('project-1', {
      metadata: { status: 'completed', achievedAt: 1234 },
    });
    useProjectStore.getState().updateProject('project-1', {
      metadata: { status: 'completed', achievedAt: 1234 },
    });

    const updatePromise = setProjectAchievedState({
      projectStore: useProjectStore.getState(),
      projectId: 'project-1',
      achieved: false,
    });

    expect(
      useSpaceStore.getState().getProjectMeta('project-1')?.metadata
    ).toMatchObject({
      status: 'active',
      achievedAt: null,
    });
    expect(
      useProjectStore.getState().getProjectById('project-1')?.metadata
    ).toMatchObject({
      status: 'active',
      achievedAt: null,
    });

    resolveUpdate({
      id: 'project-1',
      status: 'active',
    });
    await updatePromise;
  });

  it('restores achieved metadata when the server update fails', async () => {
    useSpaceStore.getState().updateProjectMeta('project-1', {
      metadata: { status: 'completed', achievedAt: 1234 },
    });
    useProjectStore.getState().updateProject('project-1', {
      metadata: { status: 'completed', achievedAt: 1234 },
    });
    mockProxyUpdateSpaceProject.mockRejectedValueOnce(
      new Error('update failed')
    );

    await expect(
      setProjectAchievedState({
        projectStore: useProjectStore.getState(),
        projectId: 'project-1',
        achieved: false,
      })
    ).rejects.toThrow('update failed');

    expect(
      useSpaceStore.getState().getProjectMeta('project-1')?.metadata
    ).toMatchObject({
      status: 'completed',
      achievedAt: 1234,
    });
    expect(
      useProjectStore.getState().getProjectById('project-1')?.metadata
    ).toMatchObject({
      status: 'completed',
      achievedAt: 1234,
    });
  });

  it('uses the neutral message lead for achieved projects', () => {
    const finishedLead = getSessionNavLeadFromHistoryTask({
      status: 2,
      summary: '',
    });

    expect(finishedLead.kind).toBe('finished');
    expect(
      resolveProjectNavLeadPresentation({
        cachedLead: finishedLead,
        isAchieved: true,
      }).kind
    ).toBe('idle');
  });
});
