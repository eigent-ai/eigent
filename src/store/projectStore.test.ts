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
import { useProjectStore } from './projectStore';
import { SPACE_SCHEMA_VERSION, useSpaceStore } from './spaceStore';

const { hasActiveSSEConnectionMock } = vi.hoisted(() => ({
  hasActiveSSEConnectionMock: vi.fn(),
}));

vi.mock('@/service/spaceApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/spaceApi')>();
  return {
    ...actual,
    proxyUpdateSpaceProject: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('./chatStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./chatStore')>();
  return {
    ...actual,
    hasActiveSSEConnection: hasActiveSSEConnectionMock,
  };
});

describe('projectStore runtime shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasActiveSSEConnectionMock.mockReturnValue(false);
    useProjectStore.setState({
      activeProjectId: null,
      projects: {},
      navLeadByProjectId: {},
      historyLoadingProjectIds: {},
      staleProjectIds: new Set(),
    });
    useSpaceStore.setState({
      activeSpaceId: 'space_test',
      spaces: {
        space_test: {
          id: 'space_test',
          name: 'Test Space',
          sourceType: 'blank',
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      lastVisitedProjectBySpace: {},
      projectsBySpaceId: {},
      projectIdIndex: {},
      projectsSyncedAt: {},
    });
  });

  it('appends project runs into the same primary chat store', () => {
    const projectId = useProjectStore
      .getState()
      .createProject('Test Project', undefined, 'project_test');
    const initialProject = useProjectStore.getState().projects[projectId];
    const initialChatId = initialProject.activeChatId;

    const firstRun = useProjectStore
      .getState()
      .appendInitChatStore(projectId, 'task_a');
    const secondRun = useProjectStore
      .getState()
      .appendInitChatStore(projectId, 'task_b');

    const project = useProjectStore.getState().projects[projectId];
    expect(Object.keys(project.chatStores)).toEqual([initialChatId]);
    expect(project.activeChatId).toBe(initialChatId);
    expect(firstRun?.chatStore).toBe(secondRun?.chatStore);

    const tasks = firstRun?.chatStore.getState().tasks ?? {};
    expect(tasks.task_a).toBeDefined();
    expect(tasks.task_b).toBeDefined();
    expect(firstRun?.chatStore.getState().activeTaskId).toBe('task_b');
  });

  it('stores and returns the per-project model selection', () => {
    const projectId = useProjectStore
      .getState()
      .createProject('Test Project', undefined, 'project_model_test');

    expect(useProjectStore.getState().getProjectModel(projectId)).toBeNull();

    useProjectStore.getState().setProjectModel(projectId, {
      modelType: 'cloud',
      cloud_model_type: 'model_a',
      model_platform: 'platform_a',
      model_type: 'model_a',
    });

    const selection = useProjectStore.getState().getProjectModel(projectId);
    expect(selection).toEqual({
      modelType: 'cloud',
      cloud_model_type: 'model_a',
      model_platform: 'platform_a',
      model_type: 'model_a',
    });

    // The pin must also reach the persisted space meta so it survives an
    // app restart (the runtime project store is not persisted).
    const meta = useSpaceStore.getState().getProjectMeta(projectId);
    expect(meta?.metadata?.modelSelection).toEqual(selection);
  });

  it('falls back to the space meta when the runtime project is gone', () => {
    const projectId = useProjectStore
      .getState()
      .createProject('Test Project', undefined, 'project_meta_fallback');

    useProjectStore.getState().setProjectModel(projectId, {
      modelType: 'custom',
      provider_id: 7,
      model_platform: 'platform_b',
      model_type: 'model_b',
    });

    // Simulate a restart: runtime projects are wiped, space meta persists.
    useProjectStore.setState({ activeProjectId: null, projects: {} });

    const selection = useProjectStore.getState().getProjectModel(projectId);
    expect(selection).toEqual({
      modelType: 'custom',
      provider_id: 7,
      model_platform: 'platform_b',
      model_type: 'model_b',
    });
  });

  it('keeps stale project runtime while one of its tasks has an active SSE stream', () => {
    const projectId = useProjectStore
      .getState()
      .createProject('Stale Project', undefined, 'project_stale_live');

    useProjectStore.getState().appendInitChatStore(projectId, 'task_live');
    useProjectStore.setState({
      staleProjectIds: new Set([projectId]),
    });
    hasActiveSSEConnectionMock.mockImplementation((taskIds: string[]) =>
      taskIds.includes('task_live')
    );

    useProjectStore.getState()._evictStaleOnTransition('project_next');

    expect(useProjectStore.getState().projects[projectId]).toBeDefined();
    expect(useProjectStore.getState().staleProjectIds.has(projectId)).toBe(
      true
    );
    expect(hasActiveSSEConnectionMock).toHaveBeenCalledWith(
      expect.arrayContaining(['task_live'])
    );
  });

  it('evicts a stale project runtime on a later transition after active SSE is gone', () => {
    const projectId = useProjectStore
      .getState()
      .createProject('Stale Project', undefined, 'project_stale_safe');

    useProjectStore.getState().appendInitChatStore(projectId, 'task_finished');
    useProjectStore.setState({
      staleProjectIds: new Set([projectId]),
    });
    hasActiveSSEConnectionMock.mockReturnValue(false);

    useProjectStore.getState()._evictStaleOnTransition('project_next');

    expect(useProjectStore.getState().projects[projectId]).toBeUndefined();
    expect(useProjectStore.getState().staleProjectIds.has(projectId)).toBe(
      false
    );
    expect(useSpaceStore.getState().getProjectMeta(projectId)).toBeDefined();
    expect(hasActiveSSEConnectionMock).toHaveBeenCalledWith(
      expect.arrayContaining(['task_finished'])
    );
  });
});
