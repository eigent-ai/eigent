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

import { runDomainEventHub, runProjectionStore } from '@/lib/runEvents';
import {
  forgetRejectedTriggerRun,
  trackTriggerExecutionRun,
} from '@/service/triggerApi';
import { closeSSEConnectionsForTasks, useChatStore } from '@/store/chatStore';
import { useCloudModelStore } from '@/store/cloudModelStore';
import { setConnectionConfig } from '@/store/connectionStore';
import { useUsageNoticeStore } from '@/store/usageNoticeStore';
import { ChatTaskStatus } from '@/types/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: {} as any,
  projectStore: {} as any,
  get: vi.fn(),
  localGet: vi.fn(),
  sse: vi.fn(),
  post: vi.fn(),
  capabilities: vi.fn(),
  lateHeader: vi.fn(),
  lateURL: vi.fn(),
}));
vi.mock('@/host/createHost', () => ({
  createHost: () => ({
    electronAPI: {
      getLocalControlCapability: async () => {
        await mocks.lateHeader();
        return '';
      },
    },
    ipcRenderer: {
      invoke: async (channel: string) => {
        if (channel === 'get-backend-port') {
          await mocks.lateURL();
          return 7777;
        }
      },
    },
  }),
}));
vi.mock('@/api/http', () => ({
  fetchGet: (url: string, ...args: unknown[]) => {
    if (url === '/executions/capabilities')
      return Promise.resolve({ local_single_session: false });
    if (url.endsWith('/execution-route'))
      return Promise.resolve({
        project_id: decodeURIComponent(url.split('/')[2]),
        route: 'legacy',
      });
    return mocks.localGet(url, ...args);
  },
  proxyFetchGet: mocks.get,
  fetchPost: mocks.post,
  fetchPut: vi.fn(),
  fetchDelete: vi.fn(),
  proxyFetchPost: vi.fn(async () => ({ id: 'history' })),
  proxyFetchPut: vi.fn(),
  getBaseURL: vi.fn(async () => 'http://fixture.invalid'),
  waitForBackendReady: vi.fn(async () => true),
  uploadFile: vi.fn(),
  sseTransport: mocks.sse,
}));
vi.mock('@/store/authStore', () => ({
  getAuthStore: () => mocks.auth,
  getWorkerList: () => [],
  useAuthStore: Object.assign(() => mocks.auth, { getState: () => mocks.auth }),
  useWorkerList: () => [],
}));
vi.mock('@/store/projectStore', () => ({
  useProjectStore: { getState: () => mocks.projectStore },
  useProjectRuntimeStore: { getState: () => mocks.projectStore },
}));
vi.mock('@/store/spaceStore', () => ({
  legacySpaceIdForUser: () => 'legacy-local',
  useSpaceStore: {
    getState: () => ({
      getActiveSpace: () => ({ id: 'space-1', userId: 'account-a' }),
      getSpaceById: (id: string) =>
        id === 'space-1' ? { id, userId: 'account-a', kind: 'cloud' } : null,
      updateProjectMeta: vi.fn(),
    }),
  },
}));
vi.mock('@/lib/events/appEvents', () => ({
  recordTaskSubmitted: vi.fn(),
  recordTaskFailed: vi.fn(),
  recordTaskCompleted: vi.fn(),
  recordFeatureUsed: vi.fn(),
  recordTaskStopped: vi.fn(),
}));
vi.mock('@/lib/runEvents', async (load) => ({
  ...(await load<any>()),
  runEventIngressRegistry: {
    ensureLocal: vi.fn(),
    reconcileRun: vi.fn(async () => undefined),
  },
}));
vi.mock('@/store/serverCapabilityStore', () => ({
  getServerCapabilityStore: () => ({ fetchCapabilities: mocks.capabilities }),
}));

const cloud = (id: string, type = 'gpt-5.5') => ({
  id,
  display_name: id,
  model_type: type,
  model_platform: 'azure',
  provider_family: 'openai',
  kind: 'chat',
  sort_order: 0,
  capabilities: { request_compatibility: { preferred_transport: 'responses' } },
});
const provider = {
  id: 42,
  provider_name: 'azure',
  model_type: 'deployment',
  api_key: 'synthetic-custom-key',
  endpoint_url: 'https://custom.example.test',
  is_valid: 2,
  encrypted_config: {
    model_config_dict: { temperature: 0.2 },
    api_mode: 'responses',
    api_version: 'fixture-version',
    model_capability: { fixture: 'custom' },
  },
};

describe('Fresh Space admission at actual HTTP delivery', () => {
  let chat: ReturnType<typeof useChatStore>;
  let project: any;
  let installed: any;
  let providers: any[];
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lateHeader.mockReset();
    mocks.lateURL.mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Real network forbidden');
      })
    );
    runDomainEventHub.clear();
    runProjectionStore.clear();
    mocks.capabilities.mockResolvedValue({
      features: { connector_gateway: { enabled: false } },
    });
    useUsageNoticeStore.setState({ account: 'account-a', incidents: [] });
    mocks.auth = {
      token: 'synthetic-token',
      email: 'a@example.test',
      user_id: 'account-a',
      language: 'en',
      modelType: 'cloud',
      cloud_model_type: 'global',
      setCloudModelType: vi.fn(),
    };
    useCloudModelStore.setState({
      models: [cloud('global'), cloud('manual')],
      retired: [],
      defaultModelId: 'global',
      status: 'ready',
    });
    chat = useChatStore();
    project = {
      id: 'session-1',
      spaceId: 'space-1',
      mode: 'single-agent',
      metadata: { spaceModelDefaultPending: true },
      createdAt: 1,
    };
    installed = {
      materialization_id: 'installed-1',
      revision_id: 'bundle@1',
      model_profile: 'default',
      model_ref: 'provider://cloud/space-model',
      thinking_effort: 'high',
    };
    providers = [provider];
    mocks.projectStore = {
      activeProjectId: 'session-1',
      getProjectById: () => project,
      getHistoryId: () => null,
      getProjectModel: () => project.metadata.modelSelection ?? null,
      setProjectModel: vi.fn((_id, selection) => {
        project.metadata.modelSelection = selection;
        project.metadata.spaceModelDefaultPending = false;
        project.metadata.spaceModelAdmissionRunId = null;
      }),
      setProjectModelAdmission: vi.fn(async (_id, runId, beforeRequest) => {
        beforeRequest?.();
        project.metadata.spaceModelAdmissionRunId = runId;
      }),
      appendInitChatStore: () => {
        const taskId = chat.getState().create();
        chat.getState().setActiveTaskId(taskId);
        return { taskId, chatStore: chat };
      },
      getAllChatStores: () => [],
      getChatStore: () => chat,
      setActiveChatStore: vi.fn(),
      setHistoryId: vi.fn(),
      setProjectSpace: vi.fn(),
      getProjectThinkingEffortOverride: () => undefined,
    };
    mocks.localGet.mockImplementation(async (url) =>
      url.includes('/session-model')
        ? {
            space_id: 'space-1',
            project_id: 'session-1',
            accepted: null,
            restore_pending: false,
          }
        : url.includes('/model-selection')
          ? { space_id: 'space-1', selection: installed }
          : {}
    );
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/v1/cloud-models')
        return {
          models: [
            cloud('space-model', 'gpt-6-astra'),
            cloud('global'),
            cloud('manual'),
          ],
        };
      if (url === '/api/v1/user/key')
        return {
          value: 'synthetic-cloud-key',
          api_url: 'https://cloud.example.test',
        };
      if (url === '/api/v1/providers') return { items: providers, pages: 1 };
      return [];
    });
    mocks.post.mockImplementation(async (url: string) =>
      url.endsWith('/resume') ? { attempt: { attempt_number: 2 } } : {}
    );
    mocks.sse.mockImplementation(async (options) => {
      await options.onopen(
        new Response('', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      );
    });
  });
  const start = (executionId?: string) =>
    chat
      .getState()
      .startTask(
        chat.getState().create(),
        undefined,
        undefined,
        undefined,
        'fixture question',
        [],
        executionId,
        'session-1',
        'single-agent',
        {
          skipHistoryCreate: true,
          awaitAdmission: true,
        }
      );
  const request = () => mocks.sse.mock.calls.at(-1)![0].body;
  afterEach(() => {
    closeSSEConnectionsForTasks(Object.keys(chat.getState().tasks));
    runDomainEventHub.clear();
    runProjectionStore.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const closedStream = () =>
    new Response(
      new ReadableStream({ start: (controller) => controller.close() }),
      { headers: { 'content-type': 'text/event-stream' } }
    );
  async function useActualTransport() {
    setConnectionConfig({
      brainEndpoint: 'http://brain.fixture.invalid',
      channel: 'web',
    });
    const http =
      await vi.importActual<typeof import('@/api/http')>('@/api/http');
    mocks.sse.mockImplementation(http.sseTransport);
    const delivery = vi.fn(async () => closedStream());
    vi.stubGlobal('fetch', delivery);
    return delivery;
  }

  it.each([
    'quota',
    'account',
    'token',
    'Space',
    'manual model',
    'newer receipt',
    'newer revision',
  ] as const)(
    'rejects %s changes before first fetch without clearing a different owner',
    async (change) => {
      const delivery = await useActualTransport();
      const auth = { ...mocks.auth };
      const model = { modelType: 'cloud', cloud_model_type: 'manual' };
      mocks.lateHeader.mockImplementationOnce(() => {
        expect(delivery).not.toHaveBeenCalled();
        if (change === 'quota')
          useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
        if (change === 'account')
          mocks.auth = { ...auth, user_id: 'account-b', token: 'synthetic-b' };
        if (change === 'token')
          mocks.auth = { ...auth, token: 'synthetic-renewed' };
        if (change === 'Space') project.spaceId = 'space-2';
        if (change === 'manual model')
          mocks.projectStore.setProjectModel('session-1', model);
        if (change === 'newer receipt')
          project.metadata.spaceModelAdmissionRunId = 'new-owner-run';
        if (change === 'newer revision')
          project.metadata.spaceModelAdmissionRevision = 'new-owner-version';
      });
      await expect(start()).rejects.toThrow();
      expect(delivery).not.toHaveBeenCalled();
      expect(chat.getState().tasks[request().run_id]).toMatchObject({
        isPending: false,
        status: ChatTaskStatus.FINISHED,
      });
      if (change === 'manual model') {
        expect(project.metadata.modelSelection).toBe(model);
        expect(project.metadata.spaceModelDefaultPending).toBe(false);
      } else if (change === 'newer receipt') {
        expect(project.metadata.spaceModelAdmissionRunId).toBe('new-owner-run');
      } else if (change === 'newer revision') {
        expect(project.metadata.spaceModelAdmissionRunId).toBe(
          request().run_id
        );
        expect(project.metadata.spaceModelAdmissionRevision).toBe(
          'new-owner-version'
        );
      } else {
        expect(project.metadata.modelSelection).toBeUndefined();
        expect(project.metadata.spaceModelDefaultPending).toBe(true);
        // Restore this owner and retry the same Session. A known-unsent
        // receipt must not strand it as an unknown ACK after account/token
        // or Space restoration, or consume the default eligibility.
        mocks.auth =
          change === 'token' ? { ...auth, token: 'synthetic-renewed' } : auth;
        project.spaceId = 'space-1';
        useUsageNoticeStore.setState({ incidents: [] });
        await start();
        expect(delivery).toHaveBeenCalledOnce();
        if (change === 'token')
          expect(delivery).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
              headers: expect.objectContaining({
                Authorization: 'Bearer synthetic-renewed',
              }),
            })
          );
        expect(project.metadata.modelSelection).toMatchObject({
          cloud_model_type: 'space-model',
        });
        expect(project.metadata.spaceModelAdmissionRunId).toBeNull();
        expect(project.metadata.spaceModelDefaultPending).toBe(false);
      }
    }
  );

  it.each(['quota', 'lookup failure'] as const)(
    'cleans an unsent receipt after async base URL %s',
    async (change) => {
      const delivery = await useActualTransport();
      setConnectionConfig({ brainEndpoint: '' });
      mocks.lateURL.mockImplementationOnce(() => {
        expect(delivery).not.toHaveBeenCalled();
        if (change === 'lookup failure')
          throw new Error('Synthetic endpoint lookup failure');
        useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
      });
      await expect(start()).rejects.toThrow();
      expect(delivery).not.toHaveBeenCalled();
      expect(project.metadata.spaceModelAdmissionRunId).toBeNull();
      expect(project.metadata.spaceModelDefaultPending).toBe(true);
      expect(chat.getState().tasks[request().run_id].isPending).toBe(false);
    }
  );

  it.each([null, 'unknown-generation'])(
    'does not release an unchanged merged receipt after assignment rejects (revision=%s)',
    async (revision) => {
      const taskId = chat.getState().create();
      const originalGet = mocks.get.getMockImplementation()!;
      mocks.get.mockImplementation(async (url, params) => {
        const result = await originalGet(url, params);
        if (url === '/api/v1/user/key') {
          project.metadata.spaceModelAdmissionRunId = taskId;
          project.metadata.spaceModelAdmissionRevision = revision;
        }
        return result;
      });
      // The real getter merges Space metadata into a newly allocated shell.
      mocks.projectStore.getProjectById = () => ({
        ...project,
        metadata: { ...project.metadata },
      });
      const rejected = new Error('Unknown receipt generation');
      mocks.projectStore.setProjectModelAdmission.mockRejectedValue(rejected);
      await expect(
        chat
          .getState()
          .startTask(
            taskId,
            undefined,
            undefined,
            undefined,
            'Retained draft',
            [],
            undefined,
            'session-1',
            'single-agent',
            {
              skipHistoryCreate: true,
              awaitAdmission: true,
              preserveTaskId: true,
            }
          )
      ).rejects.toBe(rejected);
      expect(
        mocks.projectStore.setProjectModelAdmission
      ).toHaveBeenCalledOnce();
      expect(mocks.sse).not.toHaveBeenCalled();
      expect(project.metadata).toMatchObject({
        spaceModelAdmissionRunId: taskId,
        spaceModelAdmissionRevision: revision,
      });
      expect(chat.getState().tasks[taskId].isPending).toBe(false);
    }
  );

  it('keeps local eligibility and the original error when receipt cleanup persistence fails', async () => {
    const delivery = await useActualTransport();
    mocks.projectStore.setProjectModelAdmission.mockImplementation(
      async (_id: string, runId: string | null, guard: () => void) => {
        guard();
        project.metadata.spaceModelAdmissionRunId = runId;
        if (runId === null)
          throw new Error('Synthetic cleanup persistence failure');
      }
    );
    mocks.lateHeader.mockImplementationOnce(() =>
      useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] })
    );
    await expect(start()).rejects.toMatchObject({ usageReason: 'credits' });
    expect(delivery).not.toHaveBeenCalled();
    expect(project.metadata.spaceModelAdmissionRunId).toBeNull();
    expect(project.metadata.spaceModelDefaultPending).toBe(true);
    expect(chat.getState().tasks[request().run_id].isPending).toBe(false);
    useUsageNoticeStore.setState({ incidents: [] });
    await start();
    expect(delivery).toHaveBeenCalledOnce();
    expect(project.metadata.modelSelection).toMatchObject({
      cloud_model_type: 'space-model',
    });
  });

  it.each(['unchanged', 'quota', 'manual', 'account'] as const)(
    'keeps the same possibly-delivered Run and frozen request through a %s retry',
    async (change) => {
      await useActualTransport();
      const requests: RequestInit[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url, init: RequestInit) => {
          requests.push({ ...init, headers: { ...init.headers } });
          if (requests.length === 1) {
            expect(project.metadata.spaceModelAdmissionRunId).toBe(
              JSON.parse(init.body as string).run_id
            );
            if (change === 'quota')
              useUsageNoticeStore.setState({
                incidents: [{ reason: 'credits' }],
              });
            if (change === 'manual')
              mocks.projectStore.setProjectModel('session-1', {
                modelType: 'cloud',
                cloud_model_type: 'manual',
              });
            if (change === 'account')
              mocks.auth = {
                ...mocks.auth,
                user_id: 'account-b',
                token: 'synthetic-b',
              };
            throw new TypeError(
              'Synthetic connection loss with unknown server receipt'
            );
          }
          return closedStream();
        })
      );
      await start();
      expect(requests).toHaveLength(2);
      expect(requests[1].body).toBe(requests[0].body);
      expect(requests[1].headers).toEqual(requests[0].headers);
      expect(JSON.parse(requests[1].body as string)).toMatchObject({
        model_type: 'gpt-6-astra',
        user_id: 'account-a',
      });
      expect(mocks.sse).toHaveBeenCalledOnce();
      if (change === 'manual')
        expect(project.metadata.modelSelection.cloud_model_type).toBe('manual');
    }
  );

  it('returns the unsent failure and allows retry while receipt cleanup is still pending', async () => {
    const delivery = await useActualTransport();
    let rejectCleanup!: (error: Error) => void;
    const cleanup = new Promise<void>((_resolve, reject) => {
      rejectCleanup = reject;
    });
    mocks.projectStore.setProjectModelAdmission.mockImplementation(
      async (_id: string, runId: string | null, guard: () => void) => {
        guard();
        project.metadata.spaceModelAdmissionRunId = runId;
        if (runId === null) await cleanup;
      }
    );
    mocks.lateHeader.mockImplementationOnce(() =>
      useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] })
    );
    await expect(start()).rejects.toMatchObject({ usageReason: 'credits' });
    expect(delivery).not.toHaveBeenCalled();
    expect(project.metadata.spaceModelAdmissionRunId).toBeNull();
    expect(chat.getState().tasks[request().run_id].isPending).toBe(false);
    useUsageNoticeStore.setState({ incidents: [] });
    await start();
    const selection = project.metadata.modelSelection;
    expect(delivery).toHaveBeenCalledOnce();
    rejectCleanup(new Error('Synthetic late cleanup failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(project.metadata.modelSelection).toBe(selection);
    expect(project.metadata.spaceModelAdmissionRunId).toBeNull();
    expect(project.metadata.spaceModelDefaultPending).toBe(false);
  });

  it('retains an unknown-ACK receipt and refuses to blindly create another Run', async () => {
    await useActualTransport();
    const delivery = vi.fn(async () => {
      throw new Error('Synthetic fatal transport after delivery');
    });
    vi.stubGlobal('fetch', delivery);
    await expect(start()).rejects.toThrow('Synthetic fatal transport');
    const runId = request().run_id;
    expect(project.metadata.spaceModelAdmissionRunId).toBe(runId);
    expect(project.metadata.modelSelection).toBeUndefined();
    await expect(start()).rejects.toThrow('confirmed');
    expect(delivery).toHaveBeenCalledOnce();
    expect(project.metadata.spaceModelAdmissionRunId).toBe(runId);
  });

  it.each(['new', 'existing', 'cleanup failure', 'account switch'] as const)(
    'settles an unsent Trigger candidate with a %s binding without deleting another Run',
    async (kind) => {
      const delivery = await useActualTransport();
      const ownerAuth = { ...mocks.auth };
      const executionId = `fresh-${kind}`;
      const otherExecutionId = `other-${kind}`;
      trackTriggerExecutionRun(otherExecutionId, 'other-session', 'other-run');
      const originalGet = mocks.get.getMockImplementation()!;
      if (kind === 'existing')
        mocks.get.mockImplementation(async (...args) => {
          if (args[0] === '/api/v1/user/key')
            trackTriggerExecutionRun(
              executionId,
              'session-1',
              chat.getState().activeTaskId!
            );
          return originalGet(...args);
        });
      let restoreStorage: (() => void) | undefined;
      mocks.lateHeader.mockImplementationOnce(() => {
        expect(delivery).not.toHaveBeenCalled();
        if (kind === 'account switch')
          mocks.auth = {
            ...mocks.auth,
            user_id: 'account-b',
            token: 'synthetic-b',
          };
        if (kind === 'cleanup failure') {
          const setItem = vi
            .mocked(localStorage.setItem)
            .getMockImplementation()!;
          const spy = vi
            .spyOn(localStorage, 'setItem')
            .mockImplementation(function (key, value) {
              if (key === 'eigent.trigger-run-bindings.v1')
                throw new Error(
                  'Synthetic binding cleanup persistence failure'
                );
              return setItem.call(this, key, value);
            });
          restoreStorage = () => spy.mockRestore();
        }
        useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
      });
      try {
        const result = start(executionId);
        if (kind === 'account switch')
          await expect(result).rejects.toThrow('changed');
        else
          await expect(result).rejects.toMatchObject({
            usageReason: 'credits',
          });
        expect(delivery).not.toHaveBeenCalled();
        if (kind !== 'account switch')
          expect(project.metadata.spaceModelAdmissionRunId).toBeNull();
        expect(chat.getState().tasks[request().run_id]).toMatchObject({
          isPending: false,
          status: ChatTaskStatus.FINISHED,
        });
        const records = JSON.parse(
          localStorage.getItem('eigent.trigger-run-bindings.v1') || '[]'
        );
        expect(records).toContainEqual(
          expect.objectContaining({
            executionId: otherExecutionId,
            projectId: 'other-session',
            runId: 'other-run',
          })
        );
        const own = records.find(
          (record: any) => record.executionId === executionId
        );
        if (kind === 'new' || kind === 'account switch')
          expect(own).toBeUndefined();
        else
          expect(own).toMatchObject({
            projectId: 'session-1',
            runId: request().run_id,
          });
        if (kind === 'account switch') {
          mocks.auth = ownerAuth;
          useUsageNoticeStore.setState({ incidents: [] });
          await start(executionId);
          expect(delivery).toHaveBeenCalledOnce();
          expect(project.metadata.spaceModelAdmissionRunId).toBeNull();
        }
      } finally {
        restoreStorage?.();
        mocks.auth = ownerAuth;
        forgetRejectedTriggerRun(executionId, 'session-1', request().run_id);
        forgetRejectedTriggerRun(
          otherExecutionId,
          'other-session',
          'other-run'
        );
      }
    }
  );

  it.each(['custom', 'local'] as const)(
    'keeps %s Space models independent of late Cloud quota',
    async (category) => {
      const delivery = await useActualTransport();
      installed.model_ref = 'provider://custom/azure/deployment';
      if (category === 'local') {
        installed.model_ref = 'provider://local/ollama/deployment';
        providers = [
          {
            ...provider,
            provider_name: 'ollama',
            prefer: true,
            endpoint_url: 'http://localhost:11434/v1',
          },
        ];
      }
      mocks.lateHeader.mockImplementationOnce(() =>
        useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] })
      );
      await start();
      expect(delivery).toHaveBeenCalledOnce();
      expect(project.metadata.modelSelection.modelType).toBe(category);
    }
  );
});
