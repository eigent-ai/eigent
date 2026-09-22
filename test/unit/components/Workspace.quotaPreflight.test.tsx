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

import Workspace from '@/components/Workspace';
import { notifyError } from '@/lib/notifyError';
import { errorCopy } from '@/lib/usageErrors';
import { useChatStore } from '@/store/chatStore';
import { useCloudModelStore } from '@/store/cloudModelStore';
import { useUsageNoticeStore } from '@/store/usageNoticeStore';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {} as any,
  projectStore: {} as any,
  spaceStore: {} as any,
  pageStore: {} as any,
  input: null as any,
  network: vi.fn(),
  get: vi.fn(),
  localGet: vi.fn(),
  proxyPost: vi.fn(),
  post: vi.fn(),
  sse: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  fetchGet: mocks.localGet,
  proxyFetchGet: mocks.get,
  fetchPost: mocks.post,
  proxyFetchPost: mocks.proxyPost,
  fetchPut: vi.fn(),
  fetchDelete: vi.fn(),
  proxyFetchPut: vi.fn(),
  proxyFetchPatch: vi.fn(),
  proxyFetchDelete: vi.fn(),
  getBaseURL: vi.fn(async () => 'http://fixture.invalid'),
  waitForBackendReady: vi.fn(async () => true),
  uploadFile: vi.fn(),
  sseTransport: mocks.sse,
}));
vi.mock('@/store/authStore', () => ({
  getAuthStore: () => mocks.auth,
  getWorkerList: () => [],
  useAuthStore: Object.assign(
    (selector?: (state: any) => unknown) =>
      selector ? selector(mocks.auth) : mocks.auth,
    { getState: () => mocks.auth }
  ),
  useWorkerList: () => [],
}));
vi.mock('@/store/projectStore', () => ({
  useProjectStore: { getState: () => mocks.projectStore },
  useProjectRuntimeStore: { getState: () => mocks.projectStore },
}));
vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: { getState: () => mocks.projectStore },
}));
vi.mock('@/store/spaceStore', () => ({
  legacySpaceIdForUser: () => 'legacy-local',
  useSpaceStore: Object.assign(
    (selector: (state: any) => unknown) => selector(mocks.spaceStore),
    { getState: () => mocks.spaceStore }
  ),
}));
vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: Object.assign(
    (selector: (state: any) => unknown) => selector(mocks.pageStore),
    { getState: () => mocks.pageStore }
  ),
}));
vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({ chatStore: null, projectStore: mocks.projectStore }),
}));
// Isolate unrelated global-provider discovery; quota preview, Space creation,
// model binding, and ChatStore.startTask all retain their real implementations.
vi.mock('@/hooks/useModelConfigCheck', () => ({
  useModelConfigCheck: () => ({ hasModel: true }),
}));
vi.mock('@/host', () => ({ useHost: () => ({ electronAPI: {} }) }));
vi.mock('@/store/settingsStore', () => ({ openSettings: vi.fn() }));
vi.mock('@/lib/notifyError', () => ({ notifyError: vi.fn() }));
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
vi.mock('@/components/AddWorker', () => ({ AddWorker: () => null }));
vi.mock('@/components/Workspace/SingleAgentList', () => ({
  SingleAgentList: () => null,
}));
vi.mock('@/components/Workspace/WorkforceAgentList', () => ({
  WorkforceAgentList: () => null,
}));

const attachment = {
  fileName: 'fixture.txt',
  filePath: '/synthetic/fixture.txt',
};
vi.mock('@/components/ChatBox/BottomBox', () => ({
  default: ({
    inputProps,
    usageLimitBanner,
    modelSelectDisabled,
    onSelectModel,
  }: any) => {
    mocks.input = inputProps;
    return (
      <div>
        <input
          aria-label="Session message"
          value={inputProps.value}
          disabled={inputProps.disabled}
          onChange={(event) => inputProps.onChange(event.target.value)}
        />
        <button onClick={() => inputProps.onFilesChange([attachment])}>
          Attach file
        </button>
        <output aria-label="Draft attachments">
          {inputProps.files
            .map((file: typeof attachment) => file.fileName)
            .join(', ')}
        </output>
        <button disabled={inputProps.disabled} onClick={inputProps.onSend}>
          Send
        </button>
        <button disabled={modelSelectDisabled} onClick={onSelectModel}>
          Select model
        </button>
        {usageLimitBanner && (
          <div role="alert">
            {usageLimitBanner.message}
            <button onClick={usageLimitBanner.onAction}>
              {usageLimitBanner.actionLabel}
            </button>
          </div>
        )}
      </div>
    );
  },
}));

const cloud = (id: string) => ({
  id,
  display_name: id,
  model_type: 'gpt-6-astra',
  model_platform: 'azure',
  provider_family: 'openai',
  kind: 'chat',
  sort_order: 0,
  capabilities: {},
});
const question = 'Start from this Space';
const variants = ['workspace', 'new-project'] as const;
const quotaReasons = [
  'credits',
  'trial-daily',
  'trial-total',
  'free-credits',
] as const;

describe('Workspace quota preview through real Space creation and Chat startup', () => {
  let chat: ReturnType<typeof useChatStore>;
  let installed: any;
  let provider: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.input = null;
    mocks.network.mockImplementation(async () => {
      throw new Error('Unexpected network in the synthetic fixture');
    });
    vi.stubGlobal('fetch', mocks.network);
    mocks.auth = {
      token: 'synthetic-token',
      email: 'fixture@example.test',
      user_id: 'account-a',
      language: 'en',
      modelType: 'cloud',
      cloud_model_type: 'global',
      setCloudModelType: vi.fn(),
      setWorkerList: vi.fn(),
    };
    useUsageNoticeStore.setState({
      account: 'account-a',
      modelType: 'cloud',
      incidents: [{ reason: 'credits' }],
      refreshing: false,
      refreshError: null,
    });
    useCloudModelStore.setState({
      models: [cloud('global'), cloud('space-model')],
      retired: [],
      defaultModelId: 'global',
      status: 'ready',
    });
    installed = {
      materialization_id: 'installed-1',
      revision_id: 'bundle@1',
      model_profile: 'default',
      model_ref: 'provider://custom/azure/deployment',
      thinking_effort: 'high',
    };
    provider = {
      id: 42,
      provider_name: 'azure',
      model_type: 'deployment',
      api_key: 'synthetic-custom-key',
      endpoint_url: 'https://custom.example.test',
      is_valid: 2,
      encrypted_config: { api_mode: 'responses' },
    };
    const space = {
      id: 'space-1',
      userId: 'account-a',
      sourceType: 'blank',
      status: 'active',
    };
    mocks.spaceStore = {
      activeSpaceId: space.id,
      spaces: { [space.id]: space },
      getSpaceById: (id: string) => (id === space.id ? space : null),
      getActiveSpace: () => space,
      getProjectMeta: () => null,
      updateProjectMeta: vi.fn(),
      setActiveSpace: vi.fn(),
    };
    mocks.pageStore = {
      activeWorkspaceTab: 'workforce',
      workspaceChatFocusRequestId: 0,
      setActiveWorkspaceTab: vi.fn(),
    };
    chat = useChatStore();
    mocks.projectStore = {
      activeProjectId: null,
      projects: {},
      getComposerThinkingEffort: () => undefined,
      // The permitted Project-container boundary reproduces new local Session
      // eligibility; server creation itself goes through the real helper/API.
      createProject: vi.fn(
        (name, _description, id, _history, _type, setActive, options) => {
          mocks.projectStore.projects[id] = {
            id,
            name,
            spaceId: options.spaceId,
            mode: options.mode,
            workdirMode: options.workdirMode,
            metadata: { spaceModelDefaultPending: true, ...options.metadata },
          };
          if (setActive) mocks.projectStore.activeProjectId = id;
          chat.getState().setActiveTaskId(chat.getState().create());
          return id;
        }
      ),
      getProjectById: (id: string) => mocks.projectStore.projects[id],
      getActiveChatStore: () => chat,
      getChatStore: () => chat,
      getHistoryId: () => null,
      setHistoryId: vi.fn(),
      getProjectModel: (id: string) =>
        mocks.projectStore.projects[id]?.metadata.modelSelection ?? null,
      setProjectModel: vi.fn((id, selection) => {
        Object.assign(mocks.projectStore.projects[id].metadata, {
          modelSelection: selection,
          spaceModelDefaultPending: false,
          spaceModelAdmissionRunId: null,
        });
      }),
      setProjectModelAdmission: vi.fn(async (id, runId) => {
        mocks.projectStore.projects[id].metadata.spaceModelAdmissionRunId =
          runId;
      }),
      appendInitChatStore: () => {
        const taskId = chat.getState().create();
        chat.getState().setActiveTaskId(taskId);
        return { taskId, chatStore: chat };
      },
      getAllChatStores: () => [],
      setActiveChatStore: vi.fn(),
      setProjectSpace: vi.fn(),
      getProjectThinkingEffortOverride: () => undefined,
    };
    mocks.localGet.mockImplementation(async (url) => {
      if (url.endsWith('/model-selection'))
        return {
          space_id: 'space-1',
          selection: installed ? { ...installed } : null,
        };
      if (url.endsWith('/session-model'))
        return {
          space_id: 'space-1',
          project_id: mocks.projectStore.activeProjectId,
          accepted: null,
          restore_pending: false,
        };
      throw new Error(`Unexpected local request: ${url}`);
    });
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/v1/providers') return { items: [provider], pages: 1 };
      if (url === '/api/v1/cloud-models')
        return { models: [cloud('global'), cloud('space-model')] };
      if (url === '/api/v1/user/key')
        return {
          value: 'synthetic-cloud-key',
          api_url: 'https://cloud.example.test',
        };
      throw new Error(`Unexpected proxy request: ${url}`);
    });
    mocks.proxyPost.mockImplementation(async (url, body) => {
      if (url === '/api/v1/spaces/space-1/projects') return body;
      if (url === '/api/v1/chat/history') return { id: 'synthetic-history' };
      throw new Error(`Unexpected proxy write: ${url}`);
    });
    mocks.post.mockResolvedValue({});
    mocks.sse.mockImplementation(async (options) =>
      options.onopen(
        new Response('', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      )
    );
  });

  afterEach(() => {
    cleanup();
    expect(mocks.network).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  function mount(variant: (typeof variants)[number] = 'workspace') {
    mocks.pageStore.activeWorkspaceTab =
      variant === 'new-project' ? variant : 'workforce';
    // Enter a real draft before the cached incident reaches this composer;
    // disabled inputs must not be bypassed to seed text in the blocked state.
    const incidents = useUsageNoticeStore.getState().incidents;
    useUsageNoticeStore.setState({ incidents: [] });
    const rendered = render(
      <MemoryRouter>
        <Workspace variant={variant} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Session message'), {
      target: { value: question },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }));
    act(() => useUsageNoticeStore.setState({ incidents }));
    return rendered;
  }
  function expectMetadataOnlyPreview() {
    expect(mocks.localGet).toHaveBeenCalledWith(
      '/spaces/space-1/workspace-configuration/model-selection',
      { email: 'fixture@example.test', user_id: 'account-a' }
    );
    expect(
      mocks.localGet.mock.calls.every(([url]) =>
        url.endsWith('/model-selection')
      )
    ).toBe(true);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.proxyPost).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.sse).not.toHaveBeenCalled();
  }
  function expectDraftRetained() {
    expect(screen.getByLabelText('Session message')).toHaveValue(question);
    expect(screen.getByLabelText('Draft attachments')).toHaveTextContent(
      'fixture.txt'
    );
    expect(mocks.pageStore.setActiveWorkspaceTab).not.toHaveBeenCalled();
  }
  const createdProject = () =>
    mocks.projectStore.projects[mocks.projectStore.activeProjectId];

  it.each(
    variants.flatMap((variant) =>
      (['custom', 'local'] as const).map((category) => ({ variant, category }))
    )
  )(
    'starts actual $category from $variant despite cached global Cloud quota',
    async ({ variant, category }) => {
      const platform = category === 'local' ? 'ollama' : 'azure';
      installed.model_ref = `provider://${category}/${platform}/deployment`;
      provider.provider_name = platform;
      mount(variant);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
      );
      expectMetadataOnlyPreview();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Select model' })
      ).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() =>
        expect(mocks.pageStore.setActiveWorkspaceTab).toHaveBeenCalledWith(
          'project'
        )
      );
      expect(mocks.projectStore.createProject).toHaveBeenCalledOnce();
      expect(mocks.proxyPost).toHaveBeenCalledWith(
        '/api/v1/spaces/space-1/projects',
        expect.objectContaining({ name: question })
      );
      expect(mocks.sse).toHaveBeenCalledOnce();
      expect(mocks.sse.mock.calls[0][0].body).toMatchObject({
        model_type: 'deployment',
        model_platform: platform,
        api_key: 'synthetic-custom-key',
        workspace_model_selection: installed,
      });
      expect(createdProject().metadata.modelSelection).toMatchObject({
        modelType: category,
        provider_id: 42,
      });
      expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
      expect(screen.getByLabelText('Session message')).toHaveValue('');
      expect(screen.getByLabelText('Draft attachments')).toBeEmptyDOMElement();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(notifyError).not.toHaveBeenCalled();
    }
  );

  it.each(
    (['cloud', 'default', 'absent'] as const).flatMap((binding) =>
      quotaReasons.map((reason) => ({ binding, reason }))
    )
  )(
    'blocks $binding Cloud with $reason before any Session creation',
    async ({ binding, reason }) => {
      installed =
        binding === 'absent'
          ? null
          : {
              ...installed,
              model_ref:
                binding === 'cloud'
                  ? 'provider://cloud/space-model'
                  : 'provider://default',
            };
      if (binding === 'cloud') mocks.auth.modelType = 'custom';
      useUsageNoticeStore.setState({ incidents: [{ reason }] });
      mount();
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(errorCopy(reason))
      );
      expectMetadataOnlyPreview();
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
      expect(screen.getByLabelText('Session message')).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Select model' })
      ).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(mocks.projectStore.createProject).not.toHaveBeenCalled();
      expect(mocks.proxyPost).not.toHaveBeenCalled();
      expectDraftRetained();
    }
  );

  it.each(['default', 'absent'] as const)(
    'recovers a quota-blocked %s fallback when the user selects global custom',
    async (binding) => {
      installed =
        binding === 'absent'
          ? null
          : { ...installed, model_ref: 'provider://default' };
      const mounted = mount();
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          errorCopy('credits')
        )
      );
      expect(screen.getByLabelText('Session message')).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Select model' })
      ).toBeEnabled();
      expectMetadataOnlyPreview();
      const initialMetadataReads = mocks.localGet.mock.calls.length;

      mocks.auth.modelType = 'custom';
      mounted.rerender(
        <MemoryRouter>
          <Workspace />
        </MemoryRouter>
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
      );
      expect(mocks.localGet.mock.calls.length).toBeGreaterThan(
        initialMetadataReads
      );
      expect(screen.getByLabelText('Session message')).toBeEnabled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expectMetadataOnlyPreview();
      expectDraftRetained();
      expect(useUsageNoticeStore.getState().incidents).toEqual([
        { reason: 'credits' },
      ]);

      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() =>
        expect(mocks.pageStore.setActiveWorkspaceTab).toHaveBeenCalledWith(
          'project'
        )
      );
      expect(mocks.projectStore.createProject).toHaveBeenCalledOnce();
      expect(mocks.sse).toHaveBeenCalledOnce();
      expect(mocks.sse.mock.calls[0][0].body).toMatchObject({
        model_type: 'deployment',
        model_platform: 'azure',
        api_key: 'synthetic-custom-key',
      });
      expect(createdProject().metadata.modelSelection).toMatchObject({
        modelType: 'custom',
        provider_id: 42,
      });
      expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
      expect(useUsageNoticeStore.getState().incidents).toEqual([
        { reason: 'credits' },
      ]);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  );

  it('creates only one Session when Send repeats during its metadata preflight', async () => {
    mount();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    );
    expectMetadataOnlyPreview();
    const localGet = mocks.localGet.getMockImplementation()!;
    let releasePreflight!: () => void;
    const pendingPreflight = new Promise<void>((resolve) => {
      releasePreflight = resolve;
    });
    mocks.localGet.mockImplementationOnce(async (...args) => {
      await pendingPreflight;
      return localGet(...args);
    });
    // Retain the enabled render's handler so the second call does not depend
    // on the browser suppressing clicks on a subsequently disabled button.
    const sendAgain = mocks.input.onSend;
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.localGet).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByLabelText('Session message')).toBeDisabled();
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await sendAgain();
    });
    expect(mocks.localGet).toHaveBeenCalledTimes(2);
    expect(mocks.projectStore.createProject).not.toHaveBeenCalled();
    expect(mocks.proxyPost).not.toHaveBeenCalled();
    expectDraftRetained();

    await act(async () => {
      releasePreflight();
    });
    await waitFor(() =>
      expect(mocks.pageStore.setActiveWorkspaceTab).toHaveBeenCalledWith(
        'project'
      )
    );
    expect(mocks.projectStore.createProject).toHaveBeenCalledOnce();
    expect(
      mocks.proxyPost.mock.calls.filter(
        ([url]) => url === '/api/v1/spaces/space-1/projects'
      )
    ).toHaveLength(1);
    expect(mocks.sse).toHaveBeenCalledOnce();
    expect(mocks.pageStore.setActiveWorkspaceTab).toHaveBeenCalledTimes(1);
  });

  it('refreshes unavailable metadata into a usable custom preview without losing the draft', async () => {
    mocks.localGet.mockRejectedValueOnce(
      new Error('Synthetic metadata unavailable')
    );
    mount();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByLabelText('Session message')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select model' })).toBeEnabled();
    expectMetadataOnlyPreview();
    expectDraftRetained();

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    );
    expect(mocks.localGet).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Session message')).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expectMetadataOnlyPreview();
    expect(mocks.projectStore.createProject).not.toHaveBeenCalled();
    expect(useUsageNoticeStore.getState().incidents).toEqual([
      { reason: 'credits' },
    ]);
    expectDraftRetained();
  });

  it.each(variants)(
    'rechecks actual Cloud after custom preflight in %s without discarding the draft',
    async (variant) => {
      mount(variant);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
      );
      expectMetadataOnlyPreview();
      const proxyPost = mocks.proxyPost.getMockImplementation()!;
      mocks.proxyPost.mockImplementation(async (...args) => {
        const response = await proxyPost(...args);
        if (args[0] === '/api/v1/spaces/space-1/projects')
          installed = {
            ...installed,
            model_ref: 'provider://cloud/space-model',
          };
        return response;
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(notifyError).toHaveBeenCalled());
      expect(mocks.projectStore.createProject).toHaveBeenCalledOnce();
      expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
      expect(mocks.post).not.toHaveBeenCalled();
      expect(mocks.sse).not.toHaveBeenCalled();
      expect(mocks.proxyPost).toHaveBeenCalledTimes(1);
      expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
      expect(
        mocks.projectStore.setProjectModelAdmission
      ).not.toHaveBeenCalled();
      expect(createdProject().metadata.modelSelection).toBeUndefined();
      expectDraftRetained();
    }
  );

  it.each(variants)(
    'keeps the draft and model unpinned after materialization admission rejection in %s',
    async (variant) => {
      mount(variant);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
      );
      expectMetadataOnlyPreview();
      const launchSelection = { ...installed };
      mocks.sse.mockImplementation(async (options) => {
        installed = {
          ...installed,
          materialization_id: 'installed-2',
          revision_id: 'bundle@2',
        };
        expect(options.body.workspace_model_selection).toEqual(launchSelection);
        await options.onopen(
          new Response(
            JSON.stringify({
              detail: {
                code: 'space_model_changed',
                message: 'Synthetic materialization changed',
              },
            }),
            {
              status: 409,
              headers: { 'content-type': 'application/json' },
            }
          )
        );
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(notifyError).toHaveBeenCalled());
      expect(mocks.sse).toHaveBeenCalledOnce();
      expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
      expect(createdProject().metadata.modelSelection).toBeUndefined();
      expect(createdProject().metadata.spaceModelDefaultPending).toBe(true);
      expect(createdProject().metadata.spaceModelAdmissionRunId).toBeNull();
      expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
      expectDraftRetained();
    }
  );
});
