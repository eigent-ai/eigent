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

import { useChatStore } from '@/store/chatStore';
import { useCloudModelStore } from '@/store/cloudModelStore';
import { useUsageNoticeStore } from '@/store/usageNoticeStore';
import { ChatTaskStatus } from '@/types/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: {} as any,
  projectStore: {} as any,
  get: vi.fn(),
  localGet: vi.fn(),
  sse: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/api/http', () => ({
  fetchGet: mocks.localGet,
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
vi.mock('@/lib/runEvents', () => ({
  runEventIngressRegistry: { ensureLocal: vi.fn() },
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

describe('Space default through the real Chat start path', () => {
  let chat: ReturnType<typeof useChatStore>;
  let project: any;
  let installed: any;
  let providers: any[];
  beforeEach(() => {
    vi.clearAllMocks();
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
      setProjectModelAdmission: vi.fn(async (_id, runId) => {
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
    mocks.post.mockResolvedValue({});
    mocks.sse.mockImplementation(async (options) => {
      await options.onopen(
        new Response('', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      );
    });
  });
  const start = (resume = false) =>
    chat
      .getState()
      .startTask(
        chat.getState().create(),
        undefined,
        undefined,
        undefined,
        'fixture question',
        [],
        undefined,
        'session-1',
        'single-agent',
        {
          skipHistoryCreate: true,
          awaitAdmission: true,
          ...(resume ? { resumeRequestId: 'resume-1' } : {}),
        }
      );
  const request = () => mocks.sse.mock.calls.at(-1)![0].body;
  const acceptedSelection = {
    modelType: 'cloud',
    cloud_model_type: 'space-model',
    model_platform: 'azure',
    model_type: 'gpt-6-astra',
    model_ref: 'provider://cloud/space-model',
  };
  const restoreAdmissionReceipt = () => {
    project.metadata = {
      serverSynced: true,
      historyId: 'history-accepted',
      spaceModelAdmissionRunId: 'accepted-run-1',
    };
    mocks.projectStore.getHistoryId = () => 'history-accepted';
  };
  const acceptedResponse = () => ({
    space_id: 'space-1',
    project_id: 'session-1',
    accepted: { run_id: 'accepted-run-1', selection: acceptedSelection },
    restore_pending: false,
  });

  it.each(
    (['cloud', 'custom'] as const).flatMap((globalModel) =>
      (['credits', 'trial-daily', 'trial-total', 'free-credits'] as const).map(
        (reason) => ({ globalModel, reason })
      )
    )
  )(
    'blocks fresh actual Cloud with current-account $reason before key or admission when global is $globalModel',
    async ({ globalModel, reason }) => {
      mocks.auth.modelType = globalModel;
      useUsageNoticeStore.setState({ incidents: [{ reason }] });

      await expect(start()).rejects.toMatchObject({ usageReason: reason });

      expect(mocks.localGet).toHaveBeenCalledWith(
        '/spaces/space-1/workspace-configuration/model-selection',
        { email: 'a@example.test', user_id: 'account-a' }
      );
      expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
      expect(mocks.post).not.toHaveBeenCalled();
      expect(mocks.sse).not.toHaveBeenCalled();
      expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
      expect(
        mocks.projectStore.setProjectModelAdmission
      ).not.toHaveBeenCalled();
      expect(project.metadata.spaceModelDefaultPending).toBe(true);
      expect(
        chat.getState().tasks[chat.getState().activeTaskId!]
      ).toMatchObject({ isPending: false, status: ChatTaskStatus.FINISHED });
    }
  );

  it.each(['default', 'absent'] as const)(
    'blocks fresh %s Space selection when it falls back to quota-limited Cloud',
    async (selection) => {
      if (selection === 'absent') installed = null;
      else installed.model_ref = 'provider://default';
      useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });

      await expect(start()).rejects.toMatchObject({ usageReason: 'credits' });

      expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
      expect(mocks.post).not.toHaveBeenCalled();
      expect(mocks.sse).not.toHaveBeenCalled();
      expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
      expect(
        mocks.projectStore.setProjectModelAdmission
      ).not.toHaveBeenCalled();
      expect(project.metadata.spaceModelDefaultPending).toBe(true);
    }
  );

  it.each(['custom', 'local'] as const)(
    'starts fresh actual %s despite the global Cloud credit incident',
    async (category) => {
      const platform = category === 'local' ? 'ollama' : 'azure';
      installed.model_ref = `provider://${category}/${platform}/deployment`;
      providers = [{ ...provider, provider_name: platform }];
      useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });

      await start();

      expect(request()).toMatchObject({
        model_type: 'deployment',
        model_platform: platform,
        workspace_model_selection: installed,
      });
      expect(project.metadata.modelSelection).toMatchObject({
        modelType: category,
        model_ref: installed.model_ref,
      });
      expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
      expect(mocks.sse).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['service', 'model-access'] as const)(
    'does not turn %s into a fresh Cloud account quota block',
    async (reason) => {
      useUsageNoticeStore.setState({
        incidents: [{ reason, modelId: 'space-model' }],
      });

      await start();

      expect(mocks.get).toHaveBeenCalledWith('/api/v1/user/key');
      expect(mocks.sse).toHaveBeenCalledTimes(1);
      expect(request().model_type).toBe('gpt-6-astra');
    }
  );

  it.each(['account-b', null])(
    'ignores fresh Cloud quota incidents associated with usage account %s',
    async (account) => {
      useUsageNoticeStore.setState({
        account,
        incidents: [{ reason: 'credits' }],
      });

      await start();

      expect(mocks.get).toHaveBeenCalledWith('/api/v1/user/key');
      expect(mocks.sse).toHaveBeenCalledTimes(1);
      expect(request().model_type).toBe('gpt-6-astra');
    }
  );

  it('checks the current quota after fresh Cloud binding resolution', async () => {
    const originalGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (url, params) => {
      const result = await originalGet(url, params);
      if (url === '/api/v1/cloud-models')
        useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
      return result;
    });

    await expect(start()).rejects.toMatchObject({ usageReason: 'credits' });

    expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
    expect(mocks.sse).not.toHaveBeenCalled();
    expect(mocks.projectStore.setProjectModelAdmission).not.toHaveBeenCalled();
  });

  it('rechecks fresh default Cloud quota after the catalog fetch before requesting a key', async () => {
    installed.model_ref = 'provider://default';
    useCloudModelStore.setState({
      models: [],
      defaultModelId: '',
      status: 'idle',
    });
    const originalGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (url, params) => {
      const result = await originalGet(url, params);
      if (url === '/api/v1/cloud-models')
        useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
      return result;
    });

    await expect(start()).rejects.toMatchObject({ usageReason: 'credits' });

    expect(
      mocks.get.mock.calls.some(([url]) => url === '/api/v1/cloud-models')
    ).toBe(true);
    expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.sse).not.toHaveBeenCalled();
    expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
    expect(mocks.projectStore.setProjectModelAdmission).not.toHaveBeenCalled();
    expect(project.metadata.spaceModelDefaultPending).toBe(true);
  });

  it('clears the fresh receipt without admitting or pinning when quota arrives after the key request', async () => {
    const originalGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (url, params) => {
      const result = await originalGet(url, params);
      if (url === '/api/v1/user/key')
        useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
      return result;
    });

    await expect(start()).rejects.toMatchObject({ usageReason: 'credits' });

    expect(mocks.get).toHaveBeenCalledWith('/api/v1/user/key');
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.sse).not.toHaveBeenCalled();
    expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
    expect(mocks.projectStore.setProjectModelAdmission).toHaveBeenCalledTimes(
      2
    );
    expect(mocks.projectStore.setProjectModelAdmission).toHaveBeenNthCalledWith(
      1,
      'session-1',
      expect.any(String)
    );
    expect(mocks.projectStore.setProjectModelAdmission).toHaveBeenNthCalledWith(
      2,
      'session-1',
      null
    );
    expect(project.metadata.spaceModelAdmissionRunId).toBeNull();
    expect(project.metadata.spaceModelDefaultPending).toBe(true);
    expect(chat.getState().tasks[chat.getState().activeTaskId!]).toMatchObject({
      isPending: false,
      status: ChatTaskStatus.FINISHED,
    });
  });

  it('keeps an existing manual pin outside the fresh guard even with a stale pending marker', async () => {
    project.metadata.modelSelection = {
      modelType: 'cloud',
      cloud_model_type: 'manual',
    };
    useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });

    await start();

    expect(mocks.localGet).not.toHaveBeenCalled();
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/user/key');
    expect(request().workspace_model_selection).toBeUndefined();
    expect(project.metadata.modelSelection.cloud_model_type).toBe('manual');
  });

  it('keeps established Session starts outside the fresh quota guard', async () => {
    delete project.metadata.spaceModelDefaultPending;
    useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });

    await start();

    expect(mocks.localGet).not.toHaveBeenCalled();
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/user/key');
    expect(mocks.sse).toHaveBeenCalledTimes(1);
    expect(request().workspace_model_selection).toBeUndefined();
  });

  it('keeps a non-Resume accepted receipt retry outside the fresh quota guard', async () => {
    restoreAdmissionReceipt();
    mocks.localGet.mockResolvedValue(acceptedResponse());
    useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });

    await start();

    expect(mocks.get).toHaveBeenCalledWith('/api/v1/user/key');
    expect(mocks.sse).toHaveBeenCalledTimes(1);
    expect(request().workspace_model_selection).toBeUndefined();
    expect(project.metadata.modelSelection).toMatchObject(acceptedSelection);
  });

  it('preserves the existing recovered Cloud cold Resume quota guard', async () => {
    restoreAdmissionReceipt();
    mocks.localGet.mockResolvedValue(acceptedResponse());
    useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });

    await expect(start(true)).rejects.toMatchObject({ usageReason: 'credits' });

    expect(project.metadata.modelSelection).toMatchObject(acceptedSelection);
    expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.sse).not.toHaveBeenCalled();
  });

  it.each(['custom', 'local'] as const)(
    'preserves recovered %s cold Resume under a global Cloud credit incident',
    async (category) => {
      const platform = category === 'local' ? 'ollama' : 'azure';
      const selection = {
        modelType: category,
        provider_id: provider.id,
        model_platform: platform,
        model_type: 'deployment',
        model_ref: `provider://${category}/${platform}/deployment`,
      };
      providers = [{ ...provider, provider_name: platform }];
      restoreAdmissionReceipt();
      mocks.localGet.mockResolvedValue({
        ...acceptedResponse(),
        accepted: { run_id: 'accepted-run-1', selection },
      });
      useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });

      await start(true);

      expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
      expect(mocks.sse).toHaveBeenCalledTimes(1);
      expect(request()).toMatchObject({
        model_type: 'deployment',
        model_platform: platform,
        resume_request_id: 'resume-1',
      });
      expect(request().workspace_model_selection).toBeUndefined();
    }
  );

  it.each(['cloud', 'custom', 'local'])(
    'launches the Space %s model when there is no global preferred provider',
    async (category) => {
      mocks.auth.modelType = 'custom';
      mocks.auth.hasModelConfigured = false;
      const platform = category === 'local' ? 'ollama' : 'azure';
      providers =
        category === 'cloud'
          ? []
          : [{ ...provider, provider_name: platform, prefer: false }];
      if (category !== 'cloud')
        installed.model_ref = `provider://${category}/${platform}/deployment`;
      const originalGet = mocks.get.getMockImplementation()!;
      mocks.get.mockImplementation(async (url, params) =>
        url === '/api/v1/providers' && params?.prefer
          ? { items: [], pages: 1 }
          : originalGet(url, params)
      );
      await start();
      expect(request()).toMatchObject({
        model_type: category === 'cloud' ? 'gpt-6-astra' : 'deployment',
        model_platform: platform,
        workspace_model_selection: installed,
      });
      expect(project.metadata.modelSelection).toMatchObject({
        modelType: category,
        model_ref: installed.model_ref,
      });
      expect(mocks.auth.hasModelConfigured).toBe(false);
      expect(
        mocks.get.mock.calls.some(
          ([url, params]) => url === '/api/v1/providers' && params?.prefer
        )
      ).toBe(false);
    }
  );

  it.each(['missing-cloud', 'default'])(
    'still rejects an unavailable %s selection at launch when the global provider is absent',
    async (selection) => {
      mocks.auth.modelType = 'custom';
      mocks.auth.hasModelConfigured = false;
      providers = [];
      installed.model_ref =
        selection === 'default'
          ? 'provider://default'
          : 'provider://cloud/missing-cloud';
      await expect(start()).rejects.toThrow();
      expect(mocks.sse).not.toHaveBeenCalled();
      expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
      expect(project.metadata.spaceModelDefaultPending).toBe(true);
    }
  );

  it.each([false, true])(
    'recovers a server-restored receipt without local eligibility before retry or Resume (%s)',
    async (resume) => {
      restoreAdmissionReceipt();
      mocks.localGet.mockResolvedValue(acceptedResponse());
      await start(resume);
      expect(mocks.localGet).toHaveBeenCalledWith(
        '/spaces/space-1/workspace-configuration/session-model',
        {
          project_id: 'session-1',
          email: 'a@example.test',
          user_id: 'account-a',
        }
      );
      expect(request().model_type).toBe('gpt-6-astra');
      expect(request().workspace_model_selection).toBeUndefined();
      expect(project.metadata.modelSelection).toMatchObject(acceptedSelection);
      expect(project.metadata.spaceModelAdmissionRunId).toBeNull();
      expect(project.metadata.spaceModelDefaultPending).toBe(false);
      expect(
        mocks.localGet.mock.calls.some(([url]) =>
          url.includes('/model-selection')
        )
      ).toBe(false);
    }
  );

  it.each(['missing', 'restoring', 'rejected'])(
    'does not send or adopt a default for a restored receipt with %s recovery',
    async (result) => {
      restoreAdmissionReceipt();
      mocks.localGet.mockImplementation(async () => {
        if (result === 'rejected') throw new Error('Recovery unavailable');
        return {
          ...acceptedResponse(),
          accepted: null,
          restore_pending: result === 'restoring',
        };
      });
      await expect(start()).rejects.toThrow();
      expect(
        mocks.localGet.mock.calls.every(([url]) =>
          url.includes('/session-model')
        )
      ).toBe(true);
      expect(mocks.sse).not.toHaveBeenCalled();
      expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
      expect(project.metadata.spaceModelAdmissionRunId).toBe('accepted-run-1');
      expect(project.metadata.spaceModelDefaultPending).toBeUndefined();
    }
  );

  it('keeps a manual model ahead of a restored receipt', async () => {
    restoreAdmissionReceipt();
    project.metadata.modelSelection = {
      modelType: 'cloud',
      cloud_model_type: 'manual',
    };
    await start();
    expect(
      mocks.localGet.mock.calls.some(([url]) => url.includes('/session-model'))
    ).toBe(false);
    expect(project.metadata.modelSelection.cloud_model_type).toBe('manual');
    expect(request().workspace_model_selection).toBeUndefined();
  });

  it.each(['manual', 'account', 'space', 'missing-space'])(
    'does not commit a restored receipt recovery after %s changes',
    async (change) => {
      restoreAdmissionReceipt();
      mocks.localGet.mockImplementation(async () => {
        if (change === 'manual')
          project.metadata.modelSelection = {
            modelType: 'cloud',
            cloud_model_type: 'manual',
          };
        if (change === 'account')
          mocks.auth = {
            ...mocks.auth,
            user_id: 'account-b',
            token: 'changed-token',
          };
        if (change === 'space') project.spaceId = 'space-2';
        if (change === 'missing-space') project.spaceId = undefined;
        return acceptedResponse();
      });
      await expect(start()).rejects.toThrow('changed');
      expect(mocks.sse).not.toHaveBeenCalled();
      expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
      expect(project.metadata.modelSelection?.cloud_model_type).toBe(
        change === 'manual' ? 'manual' : undefined
      );
    }
  );

  it.each(
    [false, true].flatMap((resume) =>
      ['account', 'missing', 'unknown'].map((scope) => ({ resume, scope }))
    )
  )(
    'rejects a restored receipt with $scope scope before retry or Resume ($resume)',
    async ({ resume, scope }) => {
      restoreAdmissionReceipt();
      if (scope === 'account')
        mocks.auth = { ...mocks.auth, user_id: 'account-b' };
      if (scope === 'missing') project.spaceId = undefined;
      if (scope === 'unknown') project.spaceId = 'space-2';
      await expect(start(resume)).rejects.toThrow('unavailable');
      expect(mocks.localGet).not.toHaveBeenCalled();
      expect(mocks.sse).not.toHaveBeenCalled();
      expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
    }
  );

  it.each(['cloud', 'custom', 'local'] as const)(
    'sends and pins the complete %s binding for a new Session',
    async (category) => {
      if (category === 'custom')
        installed.model_ref = 'provider://custom/azure/deployment';
      if (category === 'local') {
        installed.model_ref = 'provider://local/ollama/org%2Fmodel%3A8b';
        providers = [
          {
            ...provider,
            provider_name: 'ollama',
            model_type: 'wrapper',
            api_key: '',
            endpoint_url: 'http://localhost:11434/v1',
            encrypted_config: {
              ...provider.encrypted_config,
              model_platform: 'ollama',
              model_type: 'org/model:8b',
            },
          },
        ];
      }
      await start();
      const body = request();
      if (category === 'cloud')
        expect(body).toMatchObject({
          model_type: 'gpt-6-astra',
          model_platform: 'azure',
          api_key: 'synthetic-cloud-key',
          api_url: 'https://cloud.example.test',
          model_config_dict: {},
          extra_params: { api_mode: 'responses' },
        });
      else
        expect(body).toMatchObject({
          model_type: category === 'local' ? 'org/model:8b' : 'deployment',
          model_platform: category === 'local' ? 'ollama' : 'azure',
          api_key: category === 'local' ? '' : 'synthetic-custom-key',
          api_url:
            category === 'local'
              ? 'http://localhost:11434/v1'
              : 'https://custom.example.test',
          model_config_dict: { temperature: 0.2 },
          extra_params: {
            api_mode: 'responses',
            api_version: 'fixture-version',
            model_capability: { fixture: 'custom' },
          },
        });
      expect(body.workspace_model_selection).toEqual(installed);
      expect(body.thinking_effort).toBe('high');
      expect(project.metadata.modelSelection).toMatchObject({
        modelType: category,
        model_ref: installed.model_ref,
        model_type: body.model_type,
      });
      expect(JSON.stringify(project.metadata.modelSelection)).not.toMatch(
        /synthetic|api_key|api_url|model_capability/
      );
      expect(mocks.auth.setCloudModelType).not.toHaveBeenCalled();
    }
  );
  it('gives an explicit manual Session model precedence without reading the Space default', async () => {
    project.metadata.modelSelection = {
      modelType: 'cloud',
      cloud_model_type: 'manual',
    };
    await start();
    expect(request().model_type).toBe('gpt-5.5');
    expect(request().workspace_model_selection).toBeUndefined();
    expect(
      mocks.localGet.mock.calls.some(([url]) =>
        url.includes('/model-selection')
      )
    ).toBe(false);
    expect(project.metadata.modelSelection.cloud_model_type).toBe('manual');
  });
  it('keeps provider://default on the existing user default path', async () => {
    installed.model_ref = 'provider://default';
    await start();
    expect(request().model_type).toBe('gpt-5.5');
    expect(project.metadata.modelSelection.cloud_model_type).toBe('global');
    expect(request().workspace_model_selection).toEqual(installed);
  });
  it('does not adopt Space defaults for legacy/restored Sessions without a new-container marker', async () => {
    delete project.metadata.spaceModelDefaultPending;
    await start();
    expect(request().model_type).toBe('gpt-5.5');
    expect(
      mocks.localGet.mock.calls.some(
        ([url]) =>
          url.includes('/model-selection') || url.includes('/session-model')
      )
    ).toBe(false);
  });
  it('retains the original model for subsequent starts and Resume after the Space default changes', async () => {
    await start();
    const original = request();
    installed = {
      ...installed,
      revision_id: 'bundle@2',
      model_ref: 'provider://custom/azure/deployment',
    };
    await start();
    expect(request()).toMatchObject({
      model_type: original.model_type,
      model_platform: original.model_platform,
      extra_params: original.extra_params,
    });
    expect(request().workspace_model_selection).toBeUndefined();
    await start(true);
    expect(request()).toMatchObject({
      model_type: original.model_type,
      model_platform: original.model_platform,
      resume_request_id: 'resume-1',
    });
    expect(
      mocks.localGet.mock.calls.filter(([url]) =>
        url.includes('/model-selection')
      )
    ).toHaveLength(1);
  });
  it('rejects an account change before a fetched key can be committed or dispatched', async () => {
    const original = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (url, params) => {
      const result = await original(url, params);
      if (url === '/api/v1/user/key')
        mocks.auth = {
          ...mocks.auth,
          user_id: 'account-b',
          token: 'another-token',
        };
      return result;
    });
    await expect(start()).rejects.toThrow('changed');
    expect(mocks.sse).not.toHaveBeenCalled();
    expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
  });
  it('does not silently use a global model when the new Session belongs to another account', async () => {
    mocks.auth = { ...mocks.auth, user_id: 'account-b' };
    await expect(start()).rejects.toThrow('unavailable');
    expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
    expect(mocks.sse).not.toHaveBeenCalled();
    expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
  });
  it('preserves a manual selection made while the Space policy is loading', async () => {
    mocks.localGet.mockImplementation(async () => {
      project.metadata.modelSelection = {
        modelType: 'cloud',
        cloud_model_type: 'manual',
      };
      return { space_id: 'space-1', selection: installed };
    });
    await expect(start()).rejects.toThrow('changed');
    expect(project.metadata.modelSelection.cloud_model_type).toBe('manual');
    expect(mocks.sse).not.toHaveBeenCalled();
  });
  it('does not pin a Space model when admission rejects a stale materialization', async () => {
    mocks.sse.mockImplementation(async (options) => {
      try {
        await options.onopen(
          new Response(
            JSON.stringify({
              detail: {
                code: 'workspace_model_selection_changed',
                message: 'Space model changed',
              },
            }),
            { status: 409, headers: { 'content-type': 'application/json' } }
          )
        );
      } catch (error) {
        options.onerror(error);
      }
    });
    await expect(start()).rejects.toThrow();
    expect(project.metadata.modelSelection).toBeUndefined();
  });

  it('preserves eligibility after an observed-absent first request is rejected', async () => {
    const configured = installed;
    installed = null;
    mocks.sse.mockImplementationOnce(async (options) => {
      try {
        await options.onopen(
          new Response('{}', {
            status: 409,
            headers: { 'content-type': 'application/json' },
          })
        );
      } catch (error) {
        options.onerror(error);
      }
    });
    await expect(start()).rejects.toThrow();
    expect(request().workspace_model_selection).toBeNull();
    expect(project.metadata.modelSelection).toBeUndefined();
    expect(project.metadata.spaceModelDefaultPending).toBe(true);
    expect(project.metadata.spaceModelAdmissionRunId).toBeNull();
    installed = configured;
    await start();
    expect(request().workspace_model_selection).toEqual(configured);
    expect(request().model_type).toBe('gpt-6-astra');
    expect(project.metadata.spaceModelDefaultPending).toBe(false);
  });

  it.each([false, true])(
    'recovers a lost accepted binding before retry or Resume (%s)',
    async (resume) => {
      mocks.sse.mockImplementationOnce(async (options) => {
        options.onerror(new Error('Synthetic delivery lost'));
      });
      await expect(start()).rejects.toThrow();
      const original = request();
      expect(project.metadata.spaceModelAdmissionRunId).toBe(original.task_id);
      expect(project.metadata.modelSelection).toBeUndefined();
      expect(project.metadata.spaceModelDefaultPending).toBe(true);
      installed = {
        ...installed,
        revision_id: 'bundle@2',
        model_ref: 'provider://custom/azure/deployment',
      };
      await expect(start()).rejects.toThrow('confirmed');
      expect(mocks.sse).toHaveBeenCalledTimes(1);
      expect(
        mocks.localGet.mock.calls.filter(([url]) =>
          url.includes('/model-selection')
        )
      ).toHaveLength(1);
      mocks.localGet.mockImplementation(async () => ({
        space_id: 'space-1',
        project_id: 'session-1',
        accepted: {
          run_id: original.task_id,
          selection: original.session_model_selection,
        },
        restore_pending: false,
      }));
      await start(resume);
      expect(request().model_type).toBe(original.model_type);
      expect(request().workspace_model_selection).toBeUndefined();
      expect(project.metadata.modelSelection).toMatchObject(
        original.session_model_selection
      );
      expect(project.metadata.spaceModelDefaultPending).toBe(false);
      expect(project.metadata.spaceModelAdmissionRunId).toBeNull();
    }
  );
});
