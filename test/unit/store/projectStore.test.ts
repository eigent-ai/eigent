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

import { PROJECT_CACHE_SCHEMA_VERSION } from '@/lib/projectCache';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import {
  getProjectEventStore,
  resetProjectEventStoresForTests,
} from '@/store/projectEventStore';
import { useProjectStore } from '@/store/projectStore';
import { SPACE_SCHEMA_VERSION, useSpaceStore } from '@/store/spaceStore';
import { normalizeThinkingEffort, ThinkingEffort } from '@/types/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  deleteCachedProjectMock,
  fetchGetMock,
  getCachedProjectMock,
  hasActiveSSEConnectionMock,
  putCachedProjectMock,
  proxyFetchGetMock,
  proxyUpdateSpaceProjectMock,
  replayMock,
} = vi.hoisted(() => ({
  deleteCachedProjectMock: vi.fn(),
  fetchGetMock: vi.fn(),
  getCachedProjectMock: vi.fn(),
  hasActiveSSEConnectionMock: vi.fn(),
  putCachedProjectMock: vi.fn(),
  proxyFetchGetMock: vi.fn(),
  proxyUpdateSpaceProjectMock: vi.fn().mockResolvedValue({}),
  replayMock: vi.fn(),
}));

vi.mock('@/api/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/http')>();
  return {
    ...actual,
    fetchGet: fetchGetMock,
    proxyFetchGet: proxyFetchGetMock,
  };
});

vi.mock('@/lib/projectCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/projectCache')>();
  return {
    ...actual,
    deleteCachedProject: deleteCachedProjectMock,
    getCachedProject: getCachedProjectMock,
    putCachedProject: putCachedProjectMock,
  };
});

vi.mock('@/service/spaceApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/spaceApi')>();
  return {
    ...actual,
    proxyUpdateSpaceProject: proxyUpdateSpaceProjectMock,
  };
});

vi.mock('@/store/chatStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/chatStore')>();
  return {
    ...actual,
    createChatStoreInstance: (
      ...args: Parameters<typeof actual.createChatStoreInstance>
    ) => {
      const store = actual.createChatStoreInstance(...args);
      store.setState({ replay: replayMock } as any);
      return store;
    },
    hasActiveSSEConnection: hasActiveSSEConnectionMock,
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('projectStore runtime shape', () => {
  it('uses the cache schema that rejects incomplete message projections', () => {
    expect(PROJECT_CACHE_SCHEMA_VERSION).toBe(9);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectEventStoresForTests();
    deleteCachedProjectMock.mockResolvedValue(undefined);
    getCachedProjectMock.mockResolvedValue(null);
    putCachedProjectMock.mockResolvedValue(undefined);
    hasActiveSSEConnectionMock.mockReturnValue(false);
    fetchGetMock.mockResolvedValue({ runs: [] });
    proxyFetchGetMock.mockResolvedValue({ tasks: [] });
    replayMock.mockResolvedValue(undefined);
    useProjectStore.setState({
      activeProjectId: null,
      projects: {},
      navLeadByProjectId: {},
      historyLoadingProjectIds: {},
      historyLoadIncompleteProjectIds: {},
      staleProjectIds: new Set(),
      composerThinkingEffort: undefined,
    });
    globalThis.electronAPI = {
      ...globalThis.electronAPI,
      terminalDispose: vi.fn().mockResolvedValue({ success: true }),
    };
    usePageTabStore.setState({
      sessionPreviewProjectId: null,
      sessionPreviewByProject: {},
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

  it('disposes the preview shell when its project is removed', () => {
    const projectId = useProjectStore
      .getState()
      .createProject('Terminal Project', undefined, 'project_terminal');
    const pageTabs = usePageTabStore.getState();
    pageTabs.setSessionPreviewProject(projectId);
    pageTabs.toggleSessionPreview();
    pageTabs.choosePreviewTabType(
      getSessionPreviewSlice(usePageTabStore.getState()).activeTabId!,
      'terminal'
    );
    const terminal = getSessionPreviewSlice(usePageTabStore.getState()).tabs[0];
    const shellId = terminal.type === 'terminal' ? terminal.shellId : undefined;

    useProjectStore.getState().removeProject(projectId);

    expect(globalThis.electronAPI.terminalDispose).toHaveBeenCalledWith(
      shellId
    );
    expect(
      usePageTabStore.getState().sessionPreviewByProject[projectId]
    ).toBeUndefined();
  });

  it('preserves the event-store instance when replay overwrites the same Project id', () => {
    const projectId = useProjectStore
      .getState()
      .createProject('Original', undefined, 'project_same_id');
    const eventStore = getProjectEventStore(projectId);
    const initialIncarnation = eventStore.getIncarnation();
    const listener = vi.fn();
    eventStore.subscribe(listener);

    useProjectStore
      .getState()
      .replayProject(['task-replay'], 'Replay', projectId);

    expect(getProjectEventStore(projectId)).toBe(eventStore);
    expect(eventStore.getIncarnation()).toBe(initialIncarnation + 1);
    expect(listener).toHaveBeenCalled();
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

  it('keeps Send now exclusive without changing trigger queue entries', () => {
    const projectId = useProjectStore
      .getState()
      .createProject('Queue Project', undefined, 'project_queue');
    const store = useProjectStore.getState();
    store.addQueuedMessage(projectId, 'First', [], 'follow-1');
    store.addQueuedMessage(projectId, 'Second', [], 'follow-2');
    store.addQueuedMessage(
      projectId,
      'Scheduled',
      [],
      'trigger-1',
      'execution-1'
    );

    store.prioritizeQueuedMessage(projectId, 'follow-1');
    store.prioritizeQueuedMessage(projectId, 'follow-2');

    const queued =
      useProjectStore.getState().projects[projectId].queuedMessages;
    expect(queued.map(({ task_id, sendNow }) => [task_id, sendNow])).toEqual([
      ['follow-1', false],
      ['follow-2', true],
      ['trigger-1', undefined],
    ]);
  });

  it('reuses an optimistically seeded follow-up run without erasing it', () => {
    const projectId = useProjectStore
      .getState()
      .createProject('Test Project', undefined, 'project_seeded_followup');
    const seeded = useProjectStore
      .getState()
      .appendInitChatStore(projectId, 'run_followup');
    expect(seeded).not.toBeNull();

    seeded?.chatStore.getState().addMessages('run_followup', {
      id: 'followup-message',
      role: 'user',
      content: 'Use the CSV format',
    });
    seeded?.chatStore.getState().setIsPending('run_followup', true);

    const confirmed = useProjectStore
      .getState()
      .appendInitChatStore(projectId, 'run_followup');

    expect(confirmed?.taskId).toBe('run_followup');
    expect(confirmed?.chatStore).toBe(seeded?.chatStore);
    expect(confirmed?.chatStore.getState().tasks.run_followup).toMatchObject({
      isPending: true,
      messages: [
        expect.objectContaining({
          id: 'followup-message',
          content: 'Use the CSV format',
        }),
      ],
    });
    expect(
      Object.keys(confirmed?.chatStore.getState().tasks ?? {}).filter(
        (taskId) => taskId === 'run_followup'
      )
    ).toHaveLength(1);
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

  it('persists the requested thinking effort per project', async () => {
    const projectId = useProjectStore
      .getState()
      .createProject('Effort Project', undefined, 'project_effort_test');

    expect(useProjectStore.getState().getProjectThinkingEffort(projectId)).toBe(
      ThinkingEffort.MEDIUM
    );
    expect(
      useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
    ).toBeUndefined();

    useProjectStore
      .getState()
      .setProjectThinkingEffort(projectId, ThinkingEffort.MAX);

    expect(useProjectStore.getState().getProjectThinkingEffort(projectId)).toBe(
      ThinkingEffort.MAX
    );
    expect(
      useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
    ).toBe(ThinkingEffort.MAX);
    expect(
      useSpaceStore.getState().getProjectMeta(projectId)?.metadata
        ?.thinkingEffort
    ).toBe(ThinkingEffort.MAX);

    useProjectStore.getState().setProjectThinkingEffort(projectId, undefined);

    expect(
      useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
    ).toBeUndefined();
    expect(
      useSpaceStore.getState().getProjectMeta(projectId)?.metadata
        ?.thinkingEffort
    ).toBeNull();
    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenLastCalledWith(
        'space_test',
        projectId,
        { metadata: { thinkingEffort: null } }
      );
    });

    // Runtime state is ephemeral; the persisted null sentinel must continue
    // to mean "inherit the Bundle" after a restart.
    useProjectStore.setState({ activeProjectId: null, projects: {} });
    expect(
      useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
    ).toBeUndefined();
  });

  it('serializes effort writes and rolls the latest failure back to the confirmed value', async () => {
    const projectId = useProjectStore
      .getState()
      .createProject(
        'Retry Effort',
        undefined,
        'project_effort_retry',
        undefined,
        undefined,
        true,
        { metadata: { thinkingEffort: ThinkingEffort.HIGH } }
      );
    const firstRequest = deferred<never>();
    const secondRequest = deferred<never>();
    const thirdRequest = deferred<never>();
    proxyUpdateSpaceProjectMock
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise)
      .mockImplementationOnce(() => thirdRequest.promise);

    useProjectStore.getState().setProjectThinkingEffort(projectId, undefined);
    useProjectStore
      .getState()
      .setProjectThinkingEffort(projectId, ThinkingEffort.MAX);
    useProjectStore.getState().setProjectThinkingEffort(projectId, undefined);

    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(1);
    });
    firstRequest.reject(new Error('first offline'));
    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(2);
    });
    secondRequest.reject(new Error('second offline'));
    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(3);
    });
    thirdRequest.reject(new Error('third offline'));

    await vi.waitFor(() => {
      expect(
        useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
      ).toBe(ThinkingEffort.HIGH);
    });
    expect(
      useSpaceStore.getState().getProjectMeta(projectId)?.metadata
        ?.thinkingEffort
    ).toBe(ThinkingEffort.HIGH);
    expect(
      proxyUpdateSpaceProjectMock.mock.calls.map((call) => call[2])
    ).toEqual([
      { metadata: { thinkingEffort: null } },
      { metadata: { thinkingEffort: ThinkingEffort.MAX } },
      { metadata: { thinkingEffort: null } },
    ]);

    useProjectStore.getState().setProjectThinkingEffort(projectId, undefined);

    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(4);
      expect(
        useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
      ).toBeUndefined();
    });
  });

  it('preserves the latest effort through server hydration and PATCH success', async () => {
    const projectId = useProjectStore
      .getState()
      .createProject(
        'Hydrated Effort',
        undefined,
        'project_effort_hydration_success',
        undefined,
        undefined,
        true,
        { metadata: { thinkingEffort: ThinkingEffort.HIGH } }
      );
    const request = deferred<Record<string, never>>();
    proxyUpdateSpaceProjectMock.mockImplementationOnce(() => request.promise);

    useProjectStore.getState().setProjectThinkingEffort(projectId, undefined);
    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(1);
    });

    useProjectStore.getState().upsertProjectsFromServer([
      {
        id: projectId,
        user_id: 'user_test',
        space_id: 'space_test',
        name: 'Hydrated Effort',
        status: 'active',
        metadata: { thinkingEffort: ThinkingEffort.HIGH },
      },
    ]);
    expect(
      useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
    ).toBeUndefined();

    request.resolve({});

    await vi.waitFor(() => {
      expect(
        useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
      ).toBeUndefined();
      expect(
        useSpaceStore.getState().getProjectMeta(projectId)?.metadata
          ?.thinkingEffort
      ).toBeNull();
    });
  });

  it('rejects a hydration snapshot older than an acknowledged effort write', async () => {
    const projectId = useProjectStore
      .getState()
      .createProject(
        'Acknowledged Effort',
        undefined,
        'project_effort_acknowledged',
        undefined,
        undefined,
        true,
        { metadata: { thinkingEffort: ThinkingEffort.HIGH } }
      );
    const request = deferred<{ updated_at: string }>();
    proxyUpdateSpaceProjectMock.mockImplementationOnce(() => request.promise);

    useProjectStore.getState().setProjectThinkingEffort(projectId, undefined);
    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(1);
    });
    request.resolve({ updated_at: '2026-08-27T14:00:02.000Z' });
    await vi.waitFor(() => {
      expect(
        useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
      ).toBeUndefined();
    });

    useProjectStore.getState().upsertProjectsFromServer([
      {
        id: projectId,
        user_id: 'user_test',
        space_id: 'space_test',
        name: 'Acknowledged Effort',
        status: 'active',
        metadata: { thinkingEffort: ThinkingEffort.HIGH },
        updated_at: '2026-08-27T14:00:01.000Z',
      },
    ]);

    expect(
      useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
    ).toBeUndefined();
    expect(
      useSpaceStore.getState().getProjectMeta(projectId)?.metadata
        ?.thinkingEffort
    ).toBeNull();

    useProjectStore.getState().upsertProjectsFromServer([
      {
        id: projectId,
        user_id: 'user_test',
        space_id: 'space_test',
        name: 'Acknowledged Effort',
        status: 'active',
        metadata: { thinkingEffort: null },
        updated_at: '2026-08-27T14:00:02.000Z',
      },
    ]);

    expect(
      useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
    ).toBeUndefined();
  });

  it('uses hydrated effort as the rollback baseline for queued failures', async () => {
    const projectId = useProjectStore
      .getState()
      .createProject(
        'Hydrated Rollback',
        undefined,
        'project_effort_hydration_failure',
        undefined,
        undefined,
        true,
        { metadata: { thinkingEffort: ThinkingEffort.HIGH } }
      );
    const firstRequest = deferred<never>();
    const secondRequest = deferred<never>();
    proxyUpdateSpaceProjectMock
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);

    useProjectStore.getState().setProjectThinkingEffort(projectId, undefined);
    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(1);
    });
    useProjectStore.getState().upsertProjectsFromServer([
      {
        id: projectId,
        user_id: 'user_test',
        space_id: 'space_test',
        name: 'Hydrated Rollback',
        status: 'active',
        metadata: { thinkingEffort: ThinkingEffort.MEDIUM },
      },
    ]);
    useProjectStore
      .getState()
      .setProjectThinkingEffort(projectId, ThinkingEffort.MAX);

    firstRequest.reject(new Error('first offline'));
    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(2);
    });
    secondRequest.reject(new Error('second offline'));

    await vi.waitFor(() => {
      expect(
        useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
      ).toBe(ThinkingEffort.MEDIUM);
      expect(
        useSpaceStore.getState().getProjectMeta(projectId)?.metadata
          ?.thinkingEffort
      ).toBe(ThinkingEffort.MEDIUM);
    });
  });

  it('rolls a failed effort write back through Space after runtime eviction', async () => {
    const projectId = useProjectStore
      .getState()
      .createProject(
        'Evicted Effort',
        undefined,
        'project_effort_evicted',
        undefined,
        undefined,
        true,
        { metadata: { thinkingEffort: ThinkingEffort.HIGH } }
      );
    const request = deferred<never>();
    proxyUpdateSpaceProjectMock.mockImplementationOnce(() => request.promise);

    useProjectStore.getState().setProjectThinkingEffort(projectId, undefined);
    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(1);
    });
    useProjectStore.getState()._evictProjectRuntime(projectId);
    expect(useProjectStore.getState().projects[projectId]).toBeUndefined();
    expect(
      useSpaceStore.getState().getProjectMeta(projectId)?.metadata
        ?.thinkingEffort
    ).toBeNull();

    request.reject(new Error('offline'));

    await vi.waitFor(() => {
      expect(
        useSpaceStore.getState().getProjectMeta(projectId)?.metadata
          ?.thinkingEffort
      ).toBe(ThinkingEffort.HIGH);
    });
    useProjectStore.getState().setActiveProject(projectId);
    expect(
      useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
    ).toBe(ThinkingEffort.HIGH);
  });

  it('reconciles a failed effort write after same-id runtime recreation', async () => {
    const projectId = useProjectStore
      .getState()
      .createProject(
        'Original Effort',
        undefined,
        'project_effort_recreated_failure',
        undefined,
        undefined,
        true,
        { metadata: { thinkingEffort: ThinkingEffort.HIGH } }
      );
    const request = deferred<never>();
    proxyUpdateSpaceProjectMock.mockImplementationOnce(() => request.promise);

    useProjectStore.getState().setProjectThinkingEffort(projectId, undefined);
    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(1);
    });
    useProjectStore
      .getState()
      .removeProject(projectId, { preserveEventStore: true });
    useProjectStore
      .getState()
      .createProject(
        'Recreated Effort',
        undefined,
        projectId,
        undefined,
        undefined,
        true,
        { metadata: { thinkingEffort: null } }
      );

    expect(
      useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
    ).toBeUndefined();

    request.reject(new Error('offline'));

    await vi.waitFor(() => {
      expect(
        useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
      ).toBe(ThinkingEffort.HIGH);
      expect(
        useSpaceStore.getState().getProjectMeta(projectId)?.metadata
          ?.thinkingEffort
      ).toBe(ThinkingEffort.HIGH);
    });
  });

  it('reconciles a failed effort write after server hydration restores the runtime', async () => {
    const projectId = useProjectStore
      .getState()
      .createProject(
        'Hydrated Recreation',
        undefined,
        'project_effort_hydrated_recreation',
        undefined,
        undefined,
        true,
        { metadata: { thinkingEffort: ThinkingEffort.HIGH } }
      );
    const request = deferred<never>();
    proxyUpdateSpaceProjectMock.mockImplementationOnce(() => request.promise);

    useProjectStore.getState().setProjectThinkingEffort(projectId, undefined);
    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(1);
    });
    useProjectStore
      .getState()
      .removeProject(projectId, { preserveEventStore: true });
    useProjectStore.getState().upsertProjectsFromServer([
      {
        id: projectId,
        user_id: 'user_test',
        space_id: 'space_test',
        name: 'Hydrated Recreation',
        status: 'active',
        metadata: { thinkingEffort: ThinkingEffort.HIGH },
      },
    ]);

    expect(
      useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
    ).toBeUndefined();

    request.reject(new Error('offline'));

    await vi.waitFor(() => {
      expect(
        useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
      ).toBe(ThinkingEffort.HIGH);
      expect(
        useSpaceStore.getState().getProjectMeta(projectId)?.metadata
          ?.thinkingEffort
      ).toBe(ThinkingEffort.HIGH);
    });
  });

  it('keeps remove-and-recreate effort writes on one serialized queue', async () => {
    const projectId = useProjectStore
      .getState()
      .createProject(
        'Original Effort',
        undefined,
        'project_effort_recreated',
        undefined,
        undefined,
        true,
        { metadata: { thinkingEffort: ThinkingEffort.HIGH } }
      );
    const firstRequest = deferred<Record<string, never>>();
    const secondRequest = deferred<Record<string, never>>();
    proxyUpdateSpaceProjectMock
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);

    useProjectStore.getState().setProjectThinkingEffort(projectId, undefined);
    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(1);
    });
    useProjectStore
      .getState()
      .removeProject(projectId, { preserveEventStore: true });
    useProjectStore
      .getState()
      .createProject(
        'Recreated Effort',
        undefined,
        projectId,
        undefined,
        undefined,
        true,
        { metadata: { thinkingEffort: null } }
      );
    useProjectStore
      .getState()
      .setProjectThinkingEffort(projectId, ThinkingEffort.MAX);
    expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(1);

    firstRequest.reject(new Error('default offline'));
    await vi.waitFor(() => {
      expect(proxyUpdateSpaceProjectMock).toHaveBeenCalledTimes(2);
    });
    secondRequest.reject(new Error('max offline'));

    await vi.waitFor(() => {
      expect(
        useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
      ).toBe(ThinkingEffort.HIGH);
      expect(
        useSpaceStore.getState().getProjectMeta(projectId)?.metadata
          ?.thinkingEffort
      ).toBe(ThinkingEffort.HIGH);
    });
  });

  it('keeps a composer thinking-effort draft for Workspace and New session', () => {
    expect(
      useProjectStore.getState().getComposerThinkingEffort()
    ).toBeUndefined();

    useProjectStore.getState().setComposerThinkingEffort(ThinkingEffort.MEDIUM);

    expect(useProjectStore.getState().getComposerThinkingEffort()).toBe(
      ThinkingEffort.MEDIUM
    );

    useProjectStore.getState().setComposerThinkingEffort(ThinkingEffort.HIGH);

    expect(useProjectStore.getState().getComposerThinkingEffort()).toBe(
      ThinkingEffort.HIGH
    );
    expect(useProjectStore.getState().composerThinkingEffort).toBe(
      ThinkingEffort.HIGH
    );

    useProjectStore.getState().setComposerThinkingEffort(undefined);

    expect(
      useProjectStore.getState().getComposerThinkingEffort()
    ).toBeUndefined();
  });

  it('normalizes persisted legacy thinking effort aliases', () => {
    expect(normalizeThinkingEffort('light')).toBe(ThinkingEffort.LOW);
    expect(normalizeThinkingEffort('extra_high')).toBe(ThinkingEffort.XHIGH);
    expect(normalizeThinkingEffort('ultra')).toBe(ThinkingEffort.MAX);
    expect(normalizeThinkingEffort('unsupported')).toBe(ThinkingEffort.MEDIUM);
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

  it('replays stale cached history during the same project open', async () => {
    const { useAuthStore } = await import('@/store/authStore');
    const previousUserId = useAuthStore.getState().user_id;
    useAuthStore.setState({ user_id: 10 });
    try {
      getCachedProjectMock.mockResolvedValue({
        schemaVersion: 1,
        cachedAt: 100,
        serverUpdatedAt: 100,
        taskIds: ['task_stale'],
        tasks: {
          task_stale: {
            taskState: {
              status: 'running',
              messages: [],
              taskInfo: [],
              taskRunning: [],
              taskAssigning: [],
            },
          },
        },
      });

      await useProjectStore
        .getState()
        .loadProjectFromHistory(
          ['task_stale'],
          'long-running prompt',
          'project_stale_cache',
          'history_stale',
          'Stale cache project',
          'space_test',
          { task_stale: 'long-running prompt' },
          200
        );

      expect(deleteCachedProjectMock).toHaveBeenCalledWith({
        userId: 10,
        projectId: 'project_stale_cache',
      });
      expect(replayMock).toHaveBeenCalledWith(
        'task_stale',
        'long-running prompt',
        0,
        'project_stale_cache'
      );
      expect(
        useProjectStore.getState().staleProjectIds.has('project_stale_cache')
      ).toBe(false);
    } finally {
      useAuthStore.setState({ user_id: previousUserId });
    }
  });

  it('does not let a stale sidebar history request steal the active Project', async () => {
    const activeProjectId = useProjectStore
      .getState()
      .createProject('Current Project', undefined, 'project_current');

    await useProjectStore
      .getState()
      .loadProjectFromHistory(
        ['task_old'],
        'old prompt',
        'project_old',
        'history_old',
        'Old Project',
        'space_test',
        { task_old: 'old prompt' },
        null,
        { requireActiveSelection: true }
      );

    expect(useProjectStore.getState().activeProjectId).toBe(activeProjectId);
    expect(useProjectStore.getState().projects.project_old).toBeUndefined();
    expect(fetchGetMock).not.toHaveBeenCalled();
    expect(replayMock).not.toHaveBeenCalled();
  });

  it('does not block cloud history on a busy local RunJournal read', async () => {
    vi.useFakeTimers();
    try {
      fetchGetMock.mockReturnValueOnce(new Promise(() => undefined));

      const load = useProjectStore
        .getState()
        .loadProjectFromHistory(
          ['task_cloud'],
          'restored cloud prompt',
          'project_cloud',
          'history_cloud',
          'Cloud history project',
          'space_test',
          { task_cloud: 'restored cloud prompt' },
          null
        );

      await vi.advanceTimersByTimeAsync(2_000);
      await load;

      expect(replayMock).toHaveBeenCalledWith(
        'task_cloud',
        'restored cloud prompt',
        0,
        'project_cloud'
      );
      expect(
        useProjectStore.getState().historyLoadingProjectIds.project_cloud
      ).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a cancelled history shell instead of treating it as loaded', async () => {
    let resolveRuns: ((value: { runs: never[] }) => void) | undefined;
    fetchGetMock.mockImplementationOnce(
      () =>
        new Promise<{ runs: never[] }>((resolve) => {
          resolveRuns = resolve;
        })
    );

    const firstLoad = useProjectStore
      .getState()
      .loadProjectFromHistory(
        ['task_retry'],
        'retry prompt',
        'project_retry',
        'history_retry',
        'Retry Project',
        'space_test'
      );
    await vi.waitFor(() => expect(resolveRuns).toBeDefined());

    await useProjectStore
      .getState()
      .loadProjectFromHistory(
        ['task_retry'],
        'retry prompt',
        'project_retry',
        'history_retry',
        'Retry Project',
        'space_test'
      );
    expect(fetchGetMock).toHaveBeenCalledTimes(1);

    useProjectStore
      .getState()
      .createProject('Other Project', undefined, 'project_other');
    resolveRuns?.({ runs: [] });
    await firstLoad;

    expect(
      useProjectStore.getState().historyLoadIncompleteProjectIds.project_retry
    ).toBe(true);
    expect(
      useProjectStore.getState().peekActiveChatStore('project_retry')
    ).toBeDefined();

    replayMock.mockImplementationOnce(async (taskId: string) => {
      const project = useProjectStore.getState().projects.project_retry;
      const chatStore = project.chatStores[project.activeChatId!];
      chatStore.getState().create(taskId, 'replay');
      chatStore.getState().addMessages(taskId, {
        id: 'retry-user-message',
        role: 'user',
        content: 'retry prompt',
      });
    });

    await useProjectStore
      .getState()
      .loadProjectFromHistory(
        ['task_retry'],
        'retry prompt',
        'project_retry',
        'history_retry',
        'Retry Project',
        'space_test'
      );

    expect(
      useProjectStore.getState().historyLoadIncompleteProjectIds.project_retry
    ).toBeUndefined();
    expect(replayMock).toHaveBeenCalledWith(
      'task_retry',
      'retry prompt',
      0,
      'project_retry'
    );
  });

  it('replays canonical local Run history when its cache anchor is stale', async () => {
    const { useAuthStore } = await import('@/store/authStore');
    const previousUserId = useAuthStore.getState().user_id;
    useAuthStore.setState({ user_id: 10 });
    try {
      fetchGetMock.mockResolvedValue({
        runs: [
          {
            run_id: 'task_local',
            status: 'completed',
            created_at: 100,
            updated_at: 300,
            total_attempt_elapsed_ms: 613_328,
          },
        ],
      });
      replayMock.mockImplementationOnce(async (taskId: string) => {
        const project = useProjectStore.getState().projects.project_local;
        const chatStore = project.chatStores[project.activeChatId];
        chatStore.getState().create(taskId, 'replay');
        chatStore.getState().addMessages(taskId, {
          id: 'user-1',
          role: 'user',
          content: 'long-running prompt',
        });
      });
      getCachedProjectMock.mockResolvedValue({
        schemaVersion: 2,
        cachedAt: 200,
        serverUpdatedAt: 200,
        localCanonicalUpdatedAt: 250,
        taskIds: ['task_local'],
        tasks: {
          task_local: {
            taskState: {
              status: 'running',
              messages: [],
              taskInfo: [],
              taskRunning: [],
              taskAssigning: [],
            },
          },
        },
      });

      await useProjectStore
        .getState()
        .loadProjectFromHistory(
          ['task_local'],
          'long-running prompt',
          'project_local',
          'history_local',
          'Local canonical project',
          'space_test',
          { task_local: 'long-running prompt' },
          200
        );

      expect(fetchGetMock).toHaveBeenCalledWith(
        '/runs',
        {
          project_id: 'project_local',
          limit: 100,
        },
        undefined,
        { signal: expect.any(AbortSignal) }
      );
      expect(getCachedProjectMock).toHaveBeenCalledWith({
        userId: 10,
        projectId: 'project_local',
      });
      expect(deleteCachedProjectMock).toHaveBeenCalledWith({
        userId: 10,
        projectId: 'project_local',
      });
      expect(replayMock).toHaveBeenCalledWith(
        'task_local',
        'long-running prompt',
        0,
        'project_local',
        'local_durable',
        { detachAfterCatchUp: false }
      );
      const project = useProjectStore.getState().projects.project_local;
      const task =
        project.chatStores[project.activeChatId].getState().tasks.task_local;
      expect(task.elapsed).toBe(613_328);
      expect(task.durableRunStatus).toBe('completed');
      expect(putCachedProjectMock).toHaveBeenCalledWith(
        { userId: 10, projectId: 'project_local' },
        expect.objectContaining({
          serverUpdatedAt: 200,
          localCanonicalUpdatedAt: 300,
          taskIds: ['task_local'],
        })
      );
    } finally {
      useAuthStore.setState({ user_id: previousUserId });
    }
  });

  it('continues a running durable replay from its canonical attempt duration', async () => {
    fetchGetMock.mockResolvedValue({
      runs: [
        {
          run_id: 'task_running',
          status: 'running',
          created_at: 100,
          updated_at: 300,
          total_attempt_elapsed_ms: 1_908_000,
        },
      ],
    });
    let releaseReplay: (() => void) | undefined;
    replayMock.mockImplementationOnce((taskId: string) => {
      const project = useProjectStore.getState().projects.project_running;
      const chatStore = project.chatStores[project.activeChatId];
      const chatState = chatStore.getState();
      chatState.create(taskId, 'replay');
      chatState.setStatus(taskId, 'running');
      // Mirror the replay TODO reducer that previously restarted the clock.
      chatState.setTaskTime(taskId, Date.now());
      return new Promise<void>((resolve) => {
        releaseReplay = resolve;
      });
    });

    const beforeLoad = Date.now();
    const loadPromise = useProjectStore
      .getState()
      .loadProjectFromHistory(
        ['task_running'],
        'long-running prompt',
        'project_running',
        'history_running',
        'Running project',
        'space_test',
        { task_running: 'long-running prompt' },
        200
      );

    await vi.waitFor(() => expect(releaseReplay).toBeDefined());
    const project = useProjectStore.getState().projects.project_running;
    const chatState = project.chatStores[project.activeChatId].getState();
    const task = chatState.tasks.task_running;
    expect(task.elapsed).toBe(1_908_000);
    expect(task.taskTime).toBeGreaterThanOrEqual(beforeLoad);
    expect(task.taskTime).toBeLessThanOrEqual(Date.now());
    const [hours, minutes, seconds] = chatState
      .getFormattedTaskTime('task_running')
      .split(':')
      .map(Number);
    expect(hours * 3600 + minutes * 60 + seconds).toBeGreaterThanOrEqual(1_908);
    expect(replayMock).toHaveBeenCalledWith(
      'task_running',
      'long-running prompt',
      0,
      'project_running',
      'local_durable',
      { detachAfterCatchUp: true }
    );

    releaseReplay?.();
    await loadPromise;
  });

  it('reanchors a cached running clock without counting the offline gap', async () => {
    const { useAuthStore } = await import('@/store/authStore');
    const previousUserId = useAuthStore.getState().user_id;
    useAuthStore.setState({ user_id: 10 });
    try {
      fetchGetMock.mockResolvedValue({
        runs: [
          {
            run_id: 'task_cached_running',
            status: 'running',
            updated_at: 300,
            total_attempt_elapsed_ms: 1_908_000,
          },
        ],
      });
      getCachedProjectMock.mockResolvedValue({
        schemaVersion: PROJECT_CACHE_SCHEMA_VERSION,
        cachedAt: 400,
        serverUpdatedAt: 200,
        localCanonicalUpdatedAt: 300,
        taskIds: ['task_cached_running'],
        tasks: {
          task_cached_running: {
            taskState: {
              status: 'running',
              durableRunStatus: 'running',
              elapsed: 12_000,
              taskTime: 100,
              messages: [
                { id: 'user-1', role: 'user', content: 'cached prompt' },
              ],
              taskInfo: [],
              taskRunning: [],
              taskAssigning: [],
            },
          },
        },
      });

      const beforeLoad = Date.now();
      await useProjectStore
        .getState()
        .loadProjectFromHistory(
          ['task_cached_running'],
          'cached prompt',
          'project_cached_running',
          'history_cached_running',
          'Cached running project',
          'space_test',
          { task_cached_running: 'cached prompt' },
          200
        );

      expect(replayMock).not.toHaveBeenCalled();
      const project =
        useProjectStore.getState().projects.project_cached_running;
      const task =
        project.chatStores[project.activeChatId].getState().tasks
          .task_cached_running;
      expect(task.elapsed).toBe(1_908_000);
      expect(task.taskTime).toBeGreaterThanOrEqual(beforeLoad);
      expect(task.taskTime).toBeLessThanOrEqual(Date.now());
      expect(putCachedProjectMock).toHaveBeenCalledWith(
        { userId: 10, projectId: 'project_cached_running' },
        expect.objectContaining({
          tasks: expect.objectContaining({
            task_cached_running: {
              taskState: expect.objectContaining({
                elapsed: 1_908_000,
                taskTime: 0,
                durableRunStatus: 'running',
              }),
            },
          }),
        })
      );
    } finally {
      useAuthStore.setState({ user_id: previousUserId });
    }
  });

  it('projects waiting_for_user before an attached durable replay stream settles', async () => {
    fetchGetMock.mockResolvedValue({
      runs: [
        {
          run_id: 'task_waiting_approval',
          status: 'waiting_for_user',
          created_at: 100,
          updated_at: 300,
          total_attempt_elapsed_ms: null,
        },
      ],
    });
    let releaseReplay: (() => void) | undefined;
    replayMock.mockImplementationOnce((taskId: string) => {
      const project = useProjectStore.getState().projects.project_waiting;
      const chatStore = project.chatStores[project.activeChatId];
      chatStore.getState().create(taskId, 'replay');
      chatStore.getState().setStatus(taskId, 'finished');
      return new Promise<void>((resolve) => {
        releaseReplay = resolve;
      });
    });

    const loadPromise = useProjectStore
      .getState()
      .loadProjectFromHistory(
        ['task_waiting_approval'],
        'approval prompt',
        'project_waiting',
        'history_waiting',
        'Waiting project',
        'space_test',
        { task_waiting_approval: 'approval prompt' },
        200
      );

    await vi.waitFor(() => expect(releaseReplay).toBeDefined());
    const project = useProjectStore.getState().projects.project_waiting;
    const task =
      project.chatStores[project.activeChatId].getState().tasks
        .task_waiting_approval;
    expect(task.type).toBe('replay');
    expect(task.status).toBe('finished');
    expect(task.durableRunStatus).toBe('waiting_for_user');

    releaseReplay?.();
    await loadPromise;
  });

  it('projects cloud-restored duration and interrupted status without attempt rows', async () => {
    fetchGetMock.mockResolvedValue({
      runs: [
        {
          run_id: 'task_cloud_interrupted',
          status: 'interrupted',
          origin: 'cloud_restore',
          created_at: 1_786_101_992.187,
          updated_at: 1_786_102_022.109,
          total_attempt_elapsed_ms: null,
        },
      ],
    });
    replayMock.mockImplementationOnce(async (taskId: string) => {
      const project = useProjectStore.getState().projects.project_cloud;
      const chatStore = project.chatStores[project.activeChatId];
      chatStore.getState().create(taskId, 'replay');
      chatStore.getState().setStatus(taskId, 'finished');
    });

    await useProjectStore
      .getState()
      .loadProjectFromHistory(
        ['task_cloud_interrupted'],
        'cloud prompt',
        'project_cloud',
        'history_cloud',
        'Cloud history',
        'space_test',
        { task_cloud_interrupted: 'cloud prompt' },
        200
      );

    const project = useProjectStore.getState().projects.project_cloud;
    const task =
      project.chatStores[project.activeChatId].getState().tasks
        .task_cloud_interrupted;
    expect(task.elapsed).toBeCloseTo(29_922, 0);
    expect(task.durableRunStatus).toBe('interrupted');
  });

  it('hydrates a canonical local snapshot when its SQLite anchor matches', async () => {
    const { useAuthStore } = await import('@/store/authStore');
    const previousUserId = useAuthStore.getState().user_id;
    useAuthStore.setState({ user_id: 10 });
    try {
      fetchGetMock.mockResolvedValue({
        runs: [
          {
            run_id: 'task_cached_local',
            status: 'completed',
            updated_at: 300,
            total_attempt_elapsed_ms: 613_328,
          },
        ],
      });
      getCachedProjectMock.mockResolvedValue({
        schemaVersion: 2,
        cachedAt: 400,
        serverUpdatedAt: 200,
        localCanonicalUpdatedAt: 300,
        taskIds: ['task_cached_local'],
        tasks: {
          task_cached_local: {
            taskState: {
              status: 'finished',
              elapsed: 613_328,
              taskTime: 0,
              hasMessages: true,
              messages: [
                { id: 'user-1', role: 'user', content: 'cached prompt' },
                {
                  id: 'agent-1',
                  role: 'agent',
                  content: 'Cached canonical result',
                },
              ],
              taskInfo: [],
              taskRunning: [],
              taskAssigning: [],
            },
          },
        },
      });

      await useProjectStore
        .getState()
        .loadProjectFromHistory(
          ['task_cached_local'],
          'cached prompt',
          'project_cached_local',
          'history_cached_local',
          'Cached local project',
          'space_test',
          { task_cached_local: 'cached prompt' },
          200
        );

      expect(deleteCachedProjectMock).not.toHaveBeenCalled();
      expect(replayMock).not.toHaveBeenCalled();
      const project = useProjectStore.getState().projects.project_cached_local;
      const task =
        project.chatStores[project.activeChatId].getState().tasks
          .task_cached_local;
      expect(task.elapsed).toBe(613_328);
      expect(task.messages).toHaveLength(2);
    } finally {
      useAuthStore.setState({ user_id: previousUserId });
    }
  });

  it('rejects a freshness-anchored cache whose task message projection is empty', async () => {
    const { useAuthStore } = await import('@/store/authStore');
    const previousUserId = useAuthStore.getState().user_id;
    useAuthStore.setState({ user_id: 10 });
    try {
      fetchGetMock.mockResolvedValue({
        runs: [
          {
            run_id: 'task_incomplete_cache',
            status: 'waiting_for_user',
            updated_at: 300,
          },
        ],
      });
      getCachedProjectMock.mockResolvedValue({
        schemaVersion: PROJECT_CACHE_SCHEMA_VERSION,
        cachedAt: 400,
        serverUpdatedAt: 200,
        localCanonicalUpdatedAt: 300,
        taskIds: ['task_incomplete_cache'],
        tasks: {
          task_incomplete_cache: {
            taskState: {
              status: 'running',
              durableRunStatus: 'waiting_for_user',
              hasMessages: true,
              messages: [],
              taskInfo: [],
              taskRunning: [],
              taskAssigning: [],
            },
          },
        },
      });

      await useProjectStore
        .getState()
        .loadProjectFromHistory(
          ['task_incomplete_cache'],
          'approval prompt',
          'project_incomplete_cache',
          'history_incomplete_cache',
          'Incomplete cache project',
          'space_test',
          { task_incomplete_cache: 'approval prompt' },
          200
        );

      expect(deleteCachedProjectMock).toHaveBeenCalledWith({
        userId: 10,
        projectId: 'project_incomplete_cache',
      });
      expect(replayMock).toHaveBeenCalledWith(
        'task_incomplete_cache',
        'approval prompt',
        0,
        'project_incomplete_cache',
        'local_durable',
        { detachAfterCatchUp: true }
      );
    } finally {
      useAuthStore.setState({ user_id: previousUserId });
    }
  });

  it('replays a completed local Run when its cache contains only the seeded user prompt', async () => {
    const { useAuthStore } = await import('@/store/authStore');
    const previousUserId = useAuthStore.getState().user_id;
    useAuthStore.setState({ user_id: 10 });
    try {
      fetchGetMock.mockResolvedValue({
        runs: [
          {
            run_id: 'task_partial_completed_cache',
            status: 'completed',
            updated_at: 300,
            total_attempt_elapsed_ms: 10_000,
          },
        ],
      });
      getCachedProjectMock.mockResolvedValue({
        schemaVersion: PROJECT_CACHE_SCHEMA_VERSION,
        cachedAt: 400,
        serverUpdatedAt: 200,
        localCanonicalUpdatedAt: 300,
        taskIds: ['task_partial_completed_cache'],
        tasks: {
          task_partial_completed_cache: {
            taskState: {
              status: 'finished',
              durableRunStatus: 'completed',
              messages: [
                { id: 'user-1', role: 'user', content: 'cached prompt' },
              ],
              taskInfo: [],
              taskRunning: [],
              taskAssigning: [],
            },
          },
        },
      });
      replayMock.mockImplementationOnce(async (taskId: string) => {
        const project =
          useProjectStore.getState().projects.project_partial_completed_cache;
        const chatStore = project.chatStores[project.activeChatId];
        chatStore.getState().create(taskId, 'replay');
        chatStore.getState().addMessages(taskId, {
          id: 'agent-final',
          role: 'agent',
          content: 'Replayed canonical result',
        });
      });

      await useProjectStore
        .getState()
        .loadProjectFromHistory(
          ['task_partial_completed_cache'],
          'cached prompt',
          'project_partial_completed_cache',
          'history_partial_completed_cache',
          'Partial completed cache',
          'space_test',
          { task_partial_completed_cache: 'cached prompt' },
          200
        );

      expect(deleteCachedProjectMock).toHaveBeenCalledWith({
        userId: 10,
        projectId: 'project_partial_completed_cache',
      });
      expect(replayMock).toHaveBeenCalledWith(
        'task_partial_completed_cache',
        'cached prompt',
        0,
        'project_partial_completed_cache',
        'local_durable',
        { detachAfterCatchUp: false }
      );
      const project =
        useProjectStore.getState().projects.project_partial_completed_cache;
      const task =
        project.chatStores[project.activeChatId].getState().tasks
          .task_partial_completed_cache;
      expect(task.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ content: 'Replayed canonical result' }),
        ])
      );
    } finally {
      useAuthStore.setState({ user_id: previousUserId });
    }
  });

  it('replays a failed local Run when its cache contains only the seeded user prompt', async () => {
    const { useAuthStore } = await import('@/store/authStore');
    const previousUserId = useAuthStore.getState().user_id;
    useAuthStore.setState({ user_id: 10 });
    try {
      fetchGetMock.mockResolvedValue({
        runs: [
          {
            run_id: 'task_partial_failed_cache',
            status: 'failed',
            updated_at: 300,
            total_attempt_elapsed_ms: 12_000,
          },
        ],
      });
      getCachedProjectMock.mockResolvedValue({
        schemaVersion: PROJECT_CACHE_SCHEMA_VERSION,
        cachedAt: 400,
        serverUpdatedAt: 200,
        localCanonicalUpdatedAt: 300,
        taskIds: ['task_partial_failed_cache'],
        tasks: {
          task_partial_failed_cache: {
            taskState: {
              status: 'finished',
              durableRunStatus: 'failed',
              messages: [
                { id: 'user-1', role: 'user', content: 'cached prompt' },
              ],
              taskInfo: [],
              taskRunning: [],
              taskAssigning: [],
            },
          },
        },
      });

      await useProjectStore
        .getState()
        .loadProjectFromHistory(
          ['task_partial_failed_cache'],
          'cached prompt',
          'project_partial_failed_cache',
          'history_partial_failed_cache',
          'Partial failed cache',
          'space_test',
          { task_partial_failed_cache: 'cached prompt' },
          200
        );

      expect(deleteCachedProjectMock).toHaveBeenCalledWith({
        userId: 10,
        projectId: 'project_partial_failed_cache',
      });
      expect(replayMock).toHaveBeenCalledWith(
        'task_partial_failed_cache',
        'cached prompt',
        0,
        'project_partial_failed_cache',
        'local_durable',
        { detachAfterCatchUp: false }
      );
    } finally {
      useAuthStore.setState({ user_id: previousUserId });
    }
  });

  it('repairs zero duration in a current cache from the canonical local Run', async () => {
    const { useAuthStore } = await import('@/store/authStore');
    const previousUserId = useAuthStore.getState().user_id;
    useAuthStore.setState({ user_id: 10 });
    try {
      fetchGetMock.mockResolvedValue({
        runs: [
          {
            run_id: 'task_cached_zero_duration',
            status: 'completed',
            created_at: 100,
            updated_at: 300,
            total_attempt_elapsed_ms: 570_577,
          },
        ],
      });
      getCachedProjectMock.mockResolvedValue({
        schemaVersion: 5,
        cachedAt: 400,
        serverUpdatedAt: 200,
        localCanonicalUpdatedAt: 300,
        taskIds: ['task_cached_zero_duration'],
        tasks: {
          task_cached_zero_duration: {
            taskState: {
              status: 'finished',
              elapsed: 0,
              taskTime: 123,
              messages: [
                { id: 'user-1', role: 'user', content: 'cached prompt' },
                {
                  id: 'agent-1',
                  role: 'agent',
                  content: 'Cached completed result',
                },
              ],
              taskInfo: [],
              taskRunning: [],
              taskAssigning: [],
            },
          },
        },
      });

      await useProjectStore
        .getState()
        .loadProjectFromHistory(
          ['task_cached_zero_duration'],
          'cached prompt',
          'project_cached_zero_duration',
          'history_cached_zero_duration',
          'Cached zero-duration project',
          'space_test',
          { task_cached_zero_duration: 'cached prompt' },
          200
        );

      expect(deleteCachedProjectMock).not.toHaveBeenCalled();
      expect(replayMock).not.toHaveBeenCalled();
      const project =
        useProjectStore.getState().projects.project_cached_zero_duration;
      const task =
        project.chatStores[project.activeChatId].getState().tasks
          .task_cached_zero_duration;
      expect(task.elapsed).toBe(570_577);
      expect(task.taskTime).toBe(0);
      expect(task.durableRunStatus).toBe('completed');
      expect(putCachedProjectMock).toHaveBeenCalledWith(
        { userId: 10, projectId: 'project_cached_zero_duration' },
        expect.objectContaining({
          serverUpdatedAt: 200,
          localCanonicalUpdatedAt: 300,
          tasks: expect.objectContaining({
            task_cached_zero_duration: {
              taskState: expect.objectContaining({
                elapsed: 570_577,
                taskTime: 0,
                durableRunStatus: 'completed',
              }),
            },
          }),
        })
      );
    } finally {
      useAuthStore.setState({ user_id: previousUserId });
    }
  });

  it('merges missing history into a background remote Project without stealing focus', async () => {
    const activeProjectId = useProjectStore
      .getState()
      .createProject('Active Project', undefined, 'project_active');
    const remoteProjectId = useProjectStore
      .getState()
      .createProject(
        'Remote Project',
        undefined,
        'project_remote',
        undefined,
        'history_remote',
        false,
        {
          spaceId: 'space_test',
          metadata: { remoteHistoryHydrationPending: true },
        }
      );
    const remoteRun = useProjectStore
      .getState()
      .appendInitChatStore(remoteProjectId, 'task_remote');
    const chatStore = remoteRun?.chatStore;
    expect(chatStore).toBeDefined();
    chatStore?.getState().addMessages('task_remote', {
      id: 'msg_remote',
      role: 'user',
      content: 'remote prompt',
    });

    const replay = vi.fn(async (taskId: string, question: string) => {
      const state = chatStore!.getState();
      state.create(taskId, 'replay');
      state.addMessages(taskId, {
        id: `msg_${taskId}`,
        role: 'user',
        content: question,
      });
      state.setActiveTaskId(taskId);
    });
    chatStore?.setState({ replay } as any);

    await useProjectStore.getState().mergeProjectHistory(
      remoteProjectId,
      [
        { task_id: 'task_old', question: 'old prompt' },
        { task_id: 'task_remote', question: 'remote prompt' },
      ],
      'fallback prompt'
    );

    expect(useProjectStore.getState().activeProjectId).toBe(activeProjectId);
    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledWith(
      'task_old',
      'old prompt',
      0,
      remoteProjectId
    );
    expect(chatStore?.getState().tasks.task_old).toBeDefined();
    expect(chatStore?.getState().tasks.task_remote).toBeDefined();
    expect(Object.keys(chatStore?.getState().tasks ?? {}).slice(0, 2)).toEqual([
      'task_old',
      'task_remote',
    ]);
    expect(chatStore?.getState().activeTaskId).toBe('task_remote');
    expect(
      useProjectStore.getState().projects[remoteProjectId].metadata
        ?.remoteHistoryHydrationPending
    ).toBe(false);
  });

  it('does not start a second remote history merge while one is already loading', async () => {
    const remoteProjectId = useProjectStore
      .getState()
      .createProject(
        'Remote Project',
        undefined,
        'project_remote_loading',
        undefined,
        'history_remote',
        false,
        {
          spaceId: 'space_test',
          metadata: { remoteHistoryHydrationPending: true },
        }
      );
    const chatStore = useProjectStore.getState().getChatStore(remoteProjectId);
    const replay = vi.fn(async () => undefined);
    chatStore?.setState({ replay } as any);
    useProjectStore.getState().setHistoryLoadingProject(remoteProjectId, true);

    await useProjectStore
      .getState()
      .mergeProjectHistory(
        remoteProjectId,
        [{ task_id: 'task_old', question: 'old prompt' }],
        'fallback prompt'
      );

    expect(replay).not.toHaveBeenCalled();
    expect(
      useProjectStore.getState().projects[remoteProjectId].metadata
        ?.remoteHistoryHydrationPending
    ).toBe(true);
    expect(
      useProjectStore.getState().historyLoadingProjectIds[remoteProjectId]
    ).toBe(true);
  });
});
