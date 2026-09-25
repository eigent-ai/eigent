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

import ChatBox from '@/components/ChatBox';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { notifyError } from '@/lib/notifyError';
import {
  runDomainEventHub,
  runEventIngressRegistry,
  runProjectionStore,
} from '@/lib/runEvents';
import {
  beginResumeRequest,
  finishResumeRequest,
} from '@/lib/runResumeRequest';
import { closeSSEConnectionsForTasks, useChatStore } from '@/store/chatStore';
import { useCloudModelStore } from '@/store/cloudModelStore';
import { setConnectionConfig } from '@/store/connectionStore';
import { openSettings } from '@/store/settingsStore';
import { useUsageNoticeStore } from '@/store/usageNoticeStore';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep ChatBox, useModelConfigCheck, ChatStore startup, and binding resolution
// real. Only isolate account/Space containers, HTTP/SSE, and unrelated UI.
const mocks = vi.hoisted(() => ({
  input: null as any,
  space: null as any,
  interrupted: null as any,
  refreshInterrupted: vi.fn(),
  setInterrupted: vi.fn(),
  notifyError: vi.fn(),
  cloudAvailable: true,
  chat: null as any,
  auth: {} as any,
  projectStore: {} as any,
  projectMeta: null as any,
  get: vi.fn(),
  localGet: vi.fn(),
  sse: vi.fn(),
  post: vi.fn(),
  realInterrupted: false,
  realTransport: false,
  durableRun: null as any,
}));
vi.mock('@/api/http', () => ({
  fetchGet: (url: string, ...args: unknown[]) => {
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
vi.mock('@/host/createHost', () => ({
  createHost: () => ({
    electronAPI: {
      getLocalControlCapability: async () => 'synthetic-capability',
    },
    ipcRenderer: null,
  }),
}));
vi.mock('@/store/authStore', () => ({
  getAuthStore: () => mocks.auth,
  getWorkerList: () => [],
  useAuthStore: Object.assign(
    (selector: any) =>
      typeof selector === 'function' ? selector(mocks.auth) : mocks.auth,
    { getState: () => mocks.auth }
  ),
  useWorkerList: () => [],
}));
vi.mock('@/store/projectStore', () => ({
  useProjectStore: { getState: () => mocks.projectStore },
  useProjectRuntimeStore: { getState: () => mocks.projectStore },
  waitForPendingStaleRuntimeEviction: vi.fn(async () => undefined),
}));
vi.mock('@/store/spaceStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/spaceStore')>();
  const state = {
    getActiveSpace: () => mocks.space,
    getSpaceById: (id: string) => (id === mocks.space?.id ? mocks.space : null),
    get spaces() {
      return mocks.space ? { [mocks.space.id]: mocks.space } : {};
    },
    getProjectMeta: () => mocks.projectMeta,
    updateProjectMeta: vi.fn(),
  };
  return {
    ...actual,
    legacySpaceIdForUser: () => 'legacy-local',
    useSpaceStore: Object.assign((selector: any) => selector(state), {
      getState: () => state,
    }),
  };
});
vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: mocks.chat.getState(),
    projectStore: mocks.projectStore,
  }),
}));
// This suite exercises model admission within the legacy Session surface.
// Managed-route observation has separate execution and integration coverage.
vi.mock('@/hooks/useSessionExecution', () => ({
  useSessionExecution: (projectId: string) => ({
    scope: { projectId, accountKey: 'legacy-test' },
    state: {
      route: { route: 'legacy', project_id: projectId },
      managed: false,
      error: null,
    },
  }),
}));
vi.mock('@/hooks/useProjectEventRuntime', () => ({
  useProjectEventRuntime: () => ({
    hydration: { status: 'ready' },
    projectId: 'session-1',
    snapshot: null,
  }),
}));
vi.mock('@/hooks/useInterruptedRunStatus', async (load) => {
  const actual = await load<typeof import('@/hooks/useInterruptedRunStatus')>();
  return {
    useInterruptedRunStatus: (projectId: string) =>
      mocks.realInterrupted
        ? actual.useInterruptedRunStatus(projectId)
        : {
            run: mocks.interrupted,
            setRun: mocks.setInterrupted,
            refresh: mocks.refreshInterrupted,
          },
  };
});
vi.mock('@/lib/notifyError', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifyError')>()),
  notifyError: mocks.notifyError,
}));
vi.mock('@/store/usageNoticeStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/usageNoticeStore')>()),
  refreshUsage: vi.fn(),
}));
vi.mock('@/store/chatEventProjectionBridge', () => ({
  isChatEventTimelineEnabled: () => false,
}));
vi.mock('@/components/ChatBox/BottomBox/useEventNativeHumanControl', () => ({
  useEventNativeHumanControl: () => ({
    interaction: null,
    variant: null,
    pendingCount: 0,
    phase: 'idle',
    submitError: null,
  }),
}));
vi.mock('@/components/ChatBox/ProjectChatContainer', () => ({
  ProjectChatContainer: () => null,
}));
vi.mock('@/components/ChatBox/EventNativeProjectTimeline', () => ({
  EventNativeProjectTimeline: () => null,
}));
vi.mock('@/components/ChatBox/BottomBox', () => ({
  default: ({ inputProps, noModelOverlay }: any) => {
    mocks.input = inputProps;
    if (!inputProps) return null;
    return (
      <div
        data-testid="chat-composer"
        data-no-model-overlay={String(Boolean(noModelOverlay))}
      >
        <input
          aria-label="Follow-up"
          value={inputProps.value}
          onChange={(e) => inputProps.onChange(e.target.value)}
        />
        <button
          disabled={inputProps.disabled}
          onClick={() => inputProps.onSend()}
        >
          Follow up
        </button>
      </div>
    );
  },
}));
vi.mock('@/store/settingsStore', () => ({ openSettings: vi.fn() }));
vi.mock('@/host', () => ({
  useHost: () => ({
    electronAPI: {},
    ipcRenderer: { on: vi.fn(), off: vi.fn() },
  }),
}));
vi.mock('@/lib/events/appEvents', () => ({
  recordTaskSubmitted: vi.fn(),
  recordTaskFailed: vi.fn(),
  recordTaskCompleted: vi.fn(),
  recordFeatureUsed: vi.fn(),
  recordTaskStopped: vi.fn(),
}));
vi.mock('@/lib/runEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/runEvents')>();
  vi.spyOn(actual.runEventIngressRegistry, 'ensureLocal').mockImplementation(
    () => undefined
  );
  return {
    ...actual,
    runEventIngressRegistry: actual.runEventIngressRegistry,
  };
});

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
describe('ChatBox after an accepted Space model selection', () => {
  let chat: ReturnType<typeof useChatStore>;
  let project: any;
  let installed: any;
  let canonicalRecovery: any;
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    runProjectionStore.clear();
    runDomainEventHub.clear();
    mocks.realInterrupted = false;
    mocks.realTransport = false;
    mocks.durableRun = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Error('Network forbidden');
      })
    );
    mocks.space = {
      id: 'space-1',
      userId: 'account-a',
      kind: 'cloud',
      sourceType: 'blank',
    };
    mocks.interrupted = null;
    mocks.cloudAvailable = true;
    mocks.setInterrupted.mockImplementation((value) => {
      mocks.interrupted = value;
    });
    useUsageNoticeStore.setState({
      account: 'account-a',
      incidents: [],
      credits: null,
      subscription: null,
    });
    mocks.auth = {
      token: 'synthetic-token',
      email: 'a@example.test',
      user_id: 'account-a',
      language: 'en',
      modelType: 'custom',
      cloud_model_type: 'global',
      setCloudModelType: vi.fn(),
      hasModelConfigured: false,
      setHasModelConfigured: vi.fn((value) => {
        mocks.auth.hasModelConfigured = value;
      }),
    };
    useCloudModelStore.setState({
      models: [cloud('global'), cloud('manual')],
      retired: [],
      defaultModelId: 'global',
      status: 'ready',
    });
    chat = useChatStore();
    mocks.chat = chat;
    project = {
      id: 'session-1',
      spaceId: 'space-1',
      mode: 'single-agent',
      metadata: { spaceModelDefaultPending: true },
      createdAt: 1,
      queuedMessages: [],
    };
    mocks.projectMeta = project;
    installed = {
      materialization_id: 'installed-1',
      revision_id: 'bundle@1',
      model_profile: 'default',
      model_ref: 'provider://cloud/space-model',
      thinking_effort: 'high',
    };
    canonicalRecovery = {
      space_id: 'space-1',
      project_id: 'session-1',
      accepted: null,
      restore_pending: false,
    };
    mocks.projectStore = {
      activeProjectId: 'session-1',
      projects: { 'session-1': project },
      getActiveChatStore: () => chat,
      getProjectById: () => project,
      getHistoryId: () => null,
      getProjectModel: () =>
        project.metadata.modelSelection ??
        mocks.projectMeta?.metadata.modelSelection ??
        null,
      setProjectModel: vi.fn((_id, selection) => {
        project.metadata.modelSelection = selection;
        project.metadata.spaceModelDefaultPending = false;
        project.metadata.spaceModelAdmissionRunId = null;
      }),
      setProjectModelAdmission: vi.fn(async (_id, runId) => {
        project.metadata.spaceModelAdmissionRunId = runId;
      }),
      appendInitChatStore: (_projectId: string, requestedTaskId?: string) => {
        const taskId = chat.getState().create(requestedTaskId);
        chat.getState().setActiveTaskId(taskId);
        return { taskId, chatStore: chat };
      },
      getAllChatStores: () => [],
      getChatStore: () => chat,
      setActiveChatStore: vi.fn(),
      setHistoryId: vi.fn(),
      setProjectSpace: vi.fn(),
      getProjectThinkingEffortOverride: () => undefined,
      setQueuedMessageProcessing: vi.fn((_projectId, taskId, processing) => {
        const queued = project.queuedMessages.find(
          (item: any) => item.task_id === taskId
        );
        if (queued) queued.processing = processing;
      }),
      removeQueuedMessage: vi.fn((_projectId, taskId) => {
        project.queuedMessages = project.queuedMessages.filter(
          (item: any) => item.task_id !== taskId
        );
      }),
    };
    mocks.localGet.mockImplementation(async (url) =>
      url.includes('/session-model')
        ? canonicalRecovery
        : url.includes('/model-selection')
          ? { space_id: 'space-1', selection: installed }
          : url.endsWith('/status')
            ? { has_lock: true, consumer_alive: true }
            : url === '/runs'
              ? { runs: mocks.durableRun ? [mocks.durableRun] : [] }
              : {}
    );
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/v1/cloud-models')
        return {
          models: mocks.cloudAvailable
            ? [
                cloud('space-model', 'gpt-6-astra'),
                cloud('global'),
                cloud('manual'),
              ]
            : [],
        };
      if (url === '/api/v1/user/key')
        return {
          value: 'synthetic-cloud-key',
          api_url: 'https://cloud.example.test',
        };
      if (url === '/api/v1/providers') return { items: [], pages: 1 };
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

  afterEach(() => {
    cleanup();
    if (mocks.realTransport) {
      closeSSEConnectionsForTasks(Object.keys(chat.getState().tasks));
      vi.mocked(runEventIngressRegistry.reconcileRun).mockRestore();
    } else expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  async function acceptInitialSpaceRun() {
    expect(project.metadata.modelSelection).toBeUndefined();
    await start();
    const accepted = request();
    expect(accepted).toMatchObject({
      model_type: 'gpt-6-astra',
      api_key: 'synthetic-cloud-key',
      api_url: 'https://cloud.example.test',
      extra_params: { api_mode: 'responses' },
    });
    expect(accepted.workspace_model_selection).toEqual(installed);
    expect(project.metadata.modelSelection).toMatchObject({
      cloud_model_type: 'space-model',
      model_ref: 'provider://cloud/space-model',
    });
    expect(project.metadata.spaceModelDefaultPending).toBe(false);
    expect(mocks.auth.hasModelConfigured).toBe(false);
    // Simulate completion after the real admission handler has persisted its pin.
    const taskId = chat.getState().activeTaskId!;
    chat.getState().setStatus(taskId, 'finished');
    chat.getState().setIsPending(taskId, false);
    chat.getState().setHasMessages(taskId, true);
    chat.getState().setHasWaitComfirm(taskId, true);
    chat.getState().addMessages(taskId, {
      id: 'synthetic-terminal',
      role: 'agent',
      content: 'First run complete',
      step: 'end',
    });
    return accepted;
  }
  async function renderChat(hasModelConfigured = false) {
    const view = render(
      <MemoryRouter>
        <ChatBox />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(mocks.auth.setHasModelConfigured).toHaveBeenCalledWith(
        hasModelConfigured
      )
    );
    return view;
  }
  async function sendFollowup() {
    fireEvent.change(screen.getByLabelText('Follow-up'), {
      target: { value: 'Continue the same Session' },
    });
    await act(async () => mocks.input.onSend());
  }
  function interruptRun(runId: string) {
    mocks.interrupted = {
      run_id: runId,
      project_id: 'session-1',
      status: 'interrupted',
      updated_at: 1,
      origin: 'local',
      latest_attempt: { attempt_number: 1, status: 'interrupted' },
    };
  }
  async function resumeInterruptedRun() {
    fireEvent.click(screen.getByRole('button', { name: /^Resume$/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /resuming/i })
      ).not.toBeInTheDocument()
    );
  }
  async function acceptInitialRunWithoutAck() {
    mocks.sse.mockImplementationOnce(async (options) => {
      options.beforeRequest?.(); // The request was sent; only its ACK is lost.
      throw new Error('Synthetic ACK lost after canonical acceptance');
    });
    await expect(start()).rejects.toThrow('Synthetic ACK lost');
    const acceptedRequest = request();
    expect(acceptedRequest.session_model_selection).toMatchObject({
      model_ref: installed.model_ref,
      model_type: acceptedRequest.model_type,
      model_platform: acceptedRequest.model_platform,
    });
    expect(project.metadata.spaceModelAdmissionRunId).toBe(
      acceptedRequest.run_id
    );
    expect(project.metadata.modelSelection).toBeUndefined();
    expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
    expect(mocks.sse).toHaveBeenCalledOnce();
    // The synthetic canonical fact comes from the actual first request. The
    // renderer never receives onopen, so no initial pin is manually removed.
    canonicalRecovery.accepted = {
      run_id: acceptedRequest.run_id,
      selection: acceptedRequest.session_model_selection,
    };
    interruptRun(acceptedRequest.run_id);
    installed = {
      ...installed,
      revision_id: 'bundle@2',
      model_ref: 'provider://cloud/different',
    };
    mocks.localGet.mockClear();
    mocks.get.mockClear();
    return acceptedRequest;
  }

  it.each([
    'account',
    'manual',
    'space',
    'quota',
    'lost-ack',
    'delivery-quota',
  ] as const)(
    'retries the same pending Resume through real ChatBox and canonical projection after %s changes',
    async (change) => {
      const accepted = await acceptInitialRunWithoutAck();
      mocks.projectStore.getAllChatStores = () => [
        { chatId: 'chat-1', chatStore: chat },
      ];
      mocks.realInterrupted = true;
      mocks.durableRun = { ...mocks.interrupted, version: 1 };
      // Keep a distinct account/Run's retry identity throughout both actions.
      const otherOwner = {
        accountKey: 'other-account',
        projectId: 'other-session',
        runId: 'other-run',
      };
      const otherRun = {
        ...mocks.durableRun,
        run_id: 'other-run',
        project_id: 'other-session',
      };
      const otherId = beginResumeRequest(otherOwner, otherRun);
      finishResumeRequest(otherOwner, otherId, false);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const requestIds: string[] = [];
      mocks.post.mockImplementation(
        async (url: string, body: any, _headers: any, options: any) => {
          if (!url.endsWith('/resume')) return {};
          options?.beforeRequest?.();
          requestIds.push(body.request_id);
          // Synthetic I/O obeys the actual idempotent coordinator contract.
          if (requestIds.length === 1) {
            mocks.durableRun = {
              ...mocks.durableRun,
              status: 'pending',
              version: 2,
              updated_at: 2,
              latest_attempt: {
                attempt_number: 2,
                status: 'pending',
                resume_request_id: body.request_id,
              },
            };
            await gate;
            if (change === 'lost-ack')
              throw new Error('Synthetic Resume ACK lost');
          } else {
            expect(body.request_id).toBe(requestIds[0]);
          }
          return {
            run_id: accepted.run_id,
            attempt: mocks.durableRun.latest_attempt,
          };
        }
      );
      const view = await renderChat();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Resume$/i })).toBeEnabled()
      );
      fireEvent.change(screen.getByLabelText('Follow-up'), {
        target: { value: 'Keep this draft' },
      });
      const attachments = [
        { fileName: 'retained.txt', filePath: '/synthetic/retained.txt' },
      ];
      chat.getState().setAttaches(accepted.run_id, attachments as any);
      fireEvent.click(screen.getByRole('button', { name: /^Resume$/i }));
      await waitFor(() => expect(requestIds).toHaveLength(1));
      const originalAuth = { ...mocks.auth };
      const originalSelection = { ...project.metadata.modelSelection };
      let rejectedDelivery = false;
      if (change === 'delivery-quota') {
        const send = mocks.sse.getMockImplementation()!;
        mocks.sse.mockImplementationOnce(async (options) => {
          useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
          try {
            options.beforeRequest();
          } catch (error) {
            rejectedDelivery = true;
            throw error;
          }
          return send(options);
        });
      }
      await act(async () => {
        if (change === 'account')
          mocks.auth = {
            ...mocks.auth,
            token: 'other-token',
            user_id: 'account-b',
            email: 'b@example.test',
          };
        if (change === 'manual')
          project.metadata.modelSelection = {
            ...originalSelection,
            cloud_model_type: 'manual',
            model_ref: 'provider://cloud/manual',
            model_type: 'gpt-5.5',
          };
        if (change === 'space') project.spaceId = 'different-space';
        if (change === 'quota')
          useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
        release();
      });
      await waitFor(() => expect(notifyError).toHaveBeenCalled());
      if (change === 'delivery-quota') expect(rejectedDelivery).toBe(true);
      else expect(mocks.sse).toHaveBeenCalledTimes(1); // only the initial ACK-loss request
      expect(mocks.durableRun.latest_attempt.attempt_number).toBe(2);
      expect(chat.getState().tasks[accepted.run_id].isPending).toBe(false);
      expect(chat.getState().tasks[accepted.run_id].attaches).toEqual(
        attachments
      );
      expect(screen.getByLabelText('Follow-up')).toHaveValue('Keep this draft');
      // Restore the owner/context and retry in place; ACK loss also exercises
      // remount recovery. No mocked interrupted banner is inserted for retry.
      mocks.auth = originalAuth;
      project.spaceId = 'space-1';
      project.metadata.modelSelection = originalSelection;
      act(() =>
        useUsageNoticeStore.setState({ account: 'account-a', incidents: [] })
      );
      if (change === 'lost-ack') {
        cleanup();
        await renderChat();
      } else {
        view.rerender(
          <MemoryRouter>
            <ChatBox />
          </MemoryRouter>
        );
      }
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Resume$/i })).toBeEnabled()
      );
      expect(
        runProjectionStore.getRun('session-1', accepted.run_id)?.status
      ).toBe('pending');
      await resumeInterruptedRun();
      await waitFor(() => expect(requestIds).toHaveLength(2));
      expect(requestIds[1]).toBe(requestIds[0]);
      expect(request().resume_request_id).toBe(requestIds[0]);
      expect(request().run_id).toBe(accepted.run_id);
      expect(
        mocks.post.mock.calls.some(([url]) => url.endsWith('/cancel'))
      ).toBe(false);
      expect(beginResumeRequest(otherOwner, otherRun)).toBe(otherId);
      finishResumeRequest(otherOwner, otherId, true);
      const owner = {
        accountKey: getAccountEnvironmentKey(mocks.auth),
        projectId: 'session-1',
        runId: accepted.run_id,
      };
      // A successful stream releases only this ticket.
      const newId = beginResumeRequest(owner, {
        ...mocks.durableRun,
        status: 'interrupted',
        latest_attempt: {
          ...mocks.durableRun.latest_attempt,
          status: 'interrupted',
        },
      });
      expect(newId).not.toBe(requestIds[0]);
      finishResumeRequest(owner, newId, true);
    }
  );
  async function prepareRealResumeTransport() {
    const accepted = await acceptInitialRunWithoutAck();
    mocks.projectStore.getAllChatStores = () => [
      { chatId: 'chat-1', chatStore: chat },
    ];
    mocks.realInterrupted = true;
    mocks.realTransport = true;
    mocks.durableRun = { ...mocks.interrupted, version: 1 };
    const requestIds: string[] = [];
    mocks.post.mockImplementation(async (url, body, _headers, options) => {
      if (!url.endsWith('/resume')) return {};
      options.beforeRequest();
      requestIds.push(body.request_id);
      if (requestIds.length === 1)
        mocks.durableRun = {
          ...mocks.durableRun,
          status: 'pending',
          version: 2,
          updated_at: 2,
          latest_attempt: {
            attempt_number: 2,
            status: 'pending',
            resume_request_id: body.request_id,
          },
        };
      else expect(body.request_id).toBe(requestIds[0]);
      return {
        run_id: accepted.run_id,
        attempt: mocks.durableRun.latest_attempt,
      };
    });
    const http =
      await vi.importActual<typeof import('@/api/http')>('@/api/http');
    setConnectionConfig({
      brainEndpoint: 'http://brain.fixture.invalid',
      channel: 'web',
    });
    mocks.sse.mockImplementation(http.sseTransport);
    vi.spyOn(runEventIngressRegistry, 'reconcileRun').mockResolvedValue(
      undefined
    );
    return { accepted, requestIds };
  }

  it.each([false, true])(
    'uses the actual SSE library for Resume network retry and recovered user retry (late quota=%s)',
    async (lateQuota) => {
      const { accepted, requestIds } = await prepareRealResumeTransport();
      const delivered: any[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url, init) => {
          expect(String(url)).toBe('http://brain.fixture.invalid/chat');
          delivered.push(JSON.parse(init.body));
          if (delivered.length === 1) {
            if (lateQuota)
              useUsageNoticeStore.setState({
                incidents: [{ reason: 'credits' }],
              });
            throw new TypeError('Synthetic NetworkError before stream ACK');
          }
          return new Response(
            new ReadableStream({ start: (controller) => controller.close() }),
            { headers: { 'content-type': 'text/event-stream' } }
          );
        })
      );
      await renderChat();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Resume$/i })).toBeEnabled()
      );
      fireEvent.change(screen.getByLabelText('Follow-up'), {
        target: { value: 'Retain this retry draft' },
      });
      const files = [
        { fileName: 'retry.txt', filePath: '/synthetic/retry.txt' },
      ];
      chat.getState().setAttaches(accepted.run_id, files as any);
      fireEvent.click(screen.getByRole('button', { name: /^Resume$/i }));
      if (lateQuota) {
        await waitFor(() => expect(notifyError).toHaveBeenCalledOnce(), {
          timeout: 2500,
        });
        expect(delivered).toHaveLength(1);
        expect(requestIds).toHaveLength(1);
        expect(chat.getState().tasks[accepted.run_id].isPending).toBe(false);
        expect(
          runProjectionStore.getRun('session-1', accepted.run_id)?.status
        ).toBe('pending');
        expect(screen.getByLabelText('Follow-up')).toHaveValue(
          'Retain this retry draft'
        );
        expect(chat.getState().tasks[accepted.run_id].attaches).toEqual(files);
        act(() => useUsageNoticeStore.setState({ incidents: [] }));
        await waitFor(() =>
          expect(
            screen.getByRole('button', { name: /^Resume$/i })
          ).toBeEnabled()
        );
        fireEvent.click(screen.getByRole('button', { name: /^Resume$/i }));
      }
      await waitFor(() => expect(delivered).toHaveLength(2), { timeout: 2500 });
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: /resuming/i })
        ).not.toBeInTheDocument()
      );
      expect(requestIds).toHaveLength(lateQuota ? 2 : 1);
      expect(new Set(requestIds).size).toBe(1);
      expect(delivered[1]).toMatchObject({
        run_id: accepted.run_id,
        resume_request_id: requestIds[0],
      });
      expect(mocks.durableRun.latest_attempt.attempt_number).toBe(2);
      expect(chat.getState().tasks[accepted.run_id].attaches).toEqual(files);
      expect(screen.getByLabelText('Follow-up')).toHaveValue(
        'Retain this retry draft'
      );
      if (!lateQuota) expect(notifyError).not.toHaveBeenCalled();
    }
  );

  it.each(['manual', 'quota', 'account'] as const)(
    'reconnects an accepted Attempt with its frozen request after a later %s change',
    async (change) => {
      const { accepted, requestIds } = await prepareRealResumeTransport();
      let stream!: ReadableStreamDefaultController<Uint8Array>;
      const deliveries: RequestInit[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url, init) => {
          expect(String(url)).toBe('http://brain.fixture.invalid/chat');
          deliveries.push({ ...init, headers: { ...init.headers } });
          return new Response(
            deliveries.length === 1
              ? new ReadableStream<Uint8Array>({
                  start(controller) {
                    stream = controller;
                  },
                })
              : new ReadableStream({
                  start(controller) {
                    controller.close();
                  },
                }),
            { headers: { 'content-type': 'text/event-stream' } }
          );
        })
      );
      await renderChat();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Resume$/i })).toBeEnabled()
      );
      await resumeInterruptedRun();
      expect(deliveries).toHaveLength(1);
      const laterSelection = { modelType: 'cloud', cloud_model_type: 'manual' };
      await act(async () => {
        if (change === 'manual')
          project.metadata.modelSelection = laterSelection;
        if (change === 'quota')
          useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
        if (change === 'account')
          mocks.auth = {
            ...mocks.auth,
            user_id: 'account-b',
            token: 'synthetic-b',
          };
        stream.error(
          new TypeError('Synthetic NetworkError after accepted stream')
        );
      });
      await waitFor(() => expect(deliveries).toHaveLength(2), {
        timeout: 2500,
      });
      expect(deliveries[1].body).toBe(deliveries[0].body);
      expect(deliveries[1].headers).toEqual(deliveries[0].headers);
      expect(JSON.parse(deliveries[1].body as string)).toMatchObject({
        run_id: accepted.run_id,
        resume_request_id: requestIds[0],
        model_type: 'gpt-6-astra',
      });
      expect(requestIds).toHaveLength(1);
      expect(notifyError).not.toHaveBeenCalled();
      if (change === 'manual')
        expect(project.metadata.modelSelection).toBe(laterSelection);
    }
  );

  it('does not reconnect a completed Run after the accepted stream loses its connection', async () => {
    const { accepted, requestIds } = await prepareRealResumeTransport();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let signal!: AbortSignal;
    const fetch = vi.fn(async (url, init) => {
      expect(String(url)).toBe('http://brain.fixture.invalid/chat');
      signal = init.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    });
    vi.stubGlobal('fetch', fetch);
    await renderChat();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Resume$/i })).toBeEnabled()
    );
    await resumeInterruptedRun();
    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => {
      mocks.durableRun = {
        ...mocks.durableRun,
        status: 'completed',
        version: 3,
        updated_at: 3,
        latest_attempt: {
          ...mocks.durableRun.latest_attempt,
          status: 'completed',
        },
      };
      runProjectionStore.upsertRunSummaries('session-1', [mocks.durableRun]);
    });
    await waitFor(() =>
      expect(chat.getState().tasks[accepted.run_id].status).toBe('finished')
    );
    await act(async () => {
      stream.error(new TypeError('Synthetic NetworkError after completion'));
    });
    await waitFor(() => expect(signal.aborted).toBe(true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(requestIds).toHaveLength(1);
    expect(chat.getState().tasks[accepted.run_id].status).toBe('finished');
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('recovers an accepted receipt through actual cold Resume after its initial ACK was lost', async () => {
    const acceptedRequest = await acceptInitialRunWithoutAck();
    await renderChat();
    expect(screen.getByRole('button', { name: 'Follow up' })).toBeDisabled();
    await resumeInterruptedRun();
    await waitFor(() => expect(mocks.sse).toHaveBeenCalledTimes(2));
    expect(mocks.localGet).toHaveBeenCalledWith(
      '/spaces/space-1/workspace-configuration/session-model',
      expect.objectContaining({
        project_id: 'session-1',
        user_id: 'account-a',
        email: 'a@example.test',
      })
    );
    expect(
      mocks.localGet.mock.calls.filter(([url]) =>
        url.includes('/model-selection')
      )
    ).toHaveLength(0);
    expect(mocks.post).toHaveBeenCalledWith(
      `/runs/${acceptedRequest.run_id}/resume`,
      expect.objectContaining({
        request_id: expect.any(String),
        reason: 'explicit_resume',
      }),
      undefined,
      expect.objectContaining({
        beforeRequest: expect.any(Function),
        expectedAccountKey: getAccountEnvironmentKey(mocks.auth),
      })
    );
    expect(request()).toMatchObject({
      run_id: acceptedRequest.run_id,
      task_id: acceptedRequest.run_id,
      model_type: 'gpt-6-astra',
      model_platform: 'azure',
      api_key: acceptedRequest.api_key,
      api_url: acceptedRequest.api_url,
      extra_params: acceptedRequest.extra_params,
    });
    expect(JSON.parse(JSON.stringify(request()))).not.toHaveProperty(
      'workspace_model_selection'
    );
    expect(project.metadata.modelSelection).toEqual(
      acceptedRequest.session_model_selection
    );
    expect(project.metadata.spaceModelAdmissionRunId).toBeNull();
    expect(mocks.auth).toMatchObject({
      modelType: 'custom',
      hasModelConfigured: false,
    });
    expect(notifyError).not.toHaveBeenCalled();
  });
  it('allows cold receipt recovery when server sync omitted the pending marker', async () => {
    const acceptedRequest = await acceptInitialRunWithoutAck();
    delete project.metadata.spaceModelDefaultPending;
    await renderChat();
    await resumeInterruptedRun();
    await waitFor(() => expect(mocks.sse).toHaveBeenCalledTimes(2));
    expect(request().run_id).toBe(acceptedRequest.run_id);
    expect(project.metadata.modelSelection).toEqual(
      acceptedRequest.session_model_selection
    );
  });
  it('allows pending-only cold recovery only through the canonical accepted selection', async () => {
    const acceptedRequest = await acceptInitialRunWithoutAck();
    delete project.metadata.spaceModelAdmissionRunId;
    await renderChat();
    await resumeInterruptedRun();
    await waitFor(() => expect(mocks.sse).toHaveBeenCalledTimes(2));
    expect(project.metadata.modelSelection).toEqual(
      acceptedRequest.session_model_selection
    );
    expect(
      mocks.localGet.mock.calls.filter(([url]) =>
        url.includes('/model-selection')
      )
    ).toHaveLength(0);
  });
  it.each([
    'unconfirmed receipt',
    'restore pending',
    'unconfirmed pending marker',
    'revoked access',
    'foreign canonical Space',
    'foreign canonical Session',
  ])('fails cold recovery closed for %s', async (reason) => {
    await acceptInitialRunWithoutAck();
    if (
      reason === 'unconfirmed receipt' ||
      reason === 'restore pending' ||
      reason === 'unconfirmed pending marker'
    )
      canonicalRecovery.accepted = null;
    if (reason === 'restore pending') canonicalRecovery.restore_pending = true;
    if (reason === 'unconfirmed pending marker')
      delete project.metadata.spaceModelAdmissionRunId;
    if (reason === 'foreign canonical Space')
      canonicalRecovery.space_id = 'foreign-space';
    if (reason === 'foreign canonical Session')
      canonicalRecovery.project_id = 'foreign-session';
    if (reason === 'revoked access') {
      const localGet = mocks.localGet.getMockImplementation()!;
      mocks.localGet.mockImplementation(async (...args) => {
        if (args[0].includes('/session-model'))
          throw Object.assign(new Error('Synthetic access revoked'), {
            response: { status: 403 },
          });
        return localGet(...args);
      });
    }
    await renderChat();
    await resumeInterruptedRun();
    await waitFor(() =>
      expect(mocks.refreshInterrupted).toHaveBeenCalledOnce()
    );
    expect(
      mocks.localGet.mock.calls.filter(([url]) =>
        url.includes('/session-model')
      )
    ).toHaveLength(1);
    expect(
      mocks.localGet.mock.calls.filter(([url]) =>
        url.includes('/model-selection')
      )
    ).toHaveLength(0);
    expect(mocks.sse).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(project.metadata.modelSelection).toBeUndefined();
    expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalled();
  });
  const coldReceiptRefusals: Array<[string, () => void]> = [
    [
      'missing token',
      () => {
        mocks.auth.token = null;
      },
    ],
    [
      'unresolved account',
      () => {
        mocks.auth.user_id = null;
      },
    ],
    [
      'foreign Space account',
      () => {
        mocks.space.userId = 'account-b';
      },
    ],
    [
      'missing Session Space',
      () => {
        project.spaceId = undefined;
      },
    ],
    [
      'legacy Space',
      () => {
        mocks.space.sourceType = 'legacy';
      },
    ],
    [
      'receipt for a different Run despite pending marker',
      () => {
        project.metadata.spaceModelAdmissionRunId = 'another-run';
      },
    ],
    [
      'interrupted Run from a different Session',
      () => {
        mocks.interrupted.project_id = 'another-session';
      },
    ],
    [
      'missing initial Attempt',
      () => {
        mocks.interrupted.latest_attempt = null;
      },
    ],
    [
      'Run that is no longer interrupted',
      () => {
        mocks.interrupted.status = 'finished';
      },
    ],
    [
      'missing recovery markers',
      () => {
        delete project.metadata.spaceModelAdmissionRunId;
        delete project.metadata.spaceModelDefaultPending;
      },
    ],
    [
      'ordinary manual selection',
      () => {
        project.metadata.modelSelection = { modelType: 'custom' };
      },
    ],
  ];
  it.each(coldReceiptRefusals)(
    'does not enter cold receipt recovery for %s',
    async (_name, change) => {
      await acceptInitialRunWithoutAck();
      change();
      await renderChat();
      await resumeInterruptedRun();
      expect(
        mocks.localGet.mock.calls.filter(([url]) =>
          url.includes('/session-model')
        )
      ).toHaveLength(0);
      expect(mocks.sse).toHaveBeenCalledTimes(1);
      expect(mocks.post).not.toHaveBeenCalled();
      expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
      expect(mocks.setInterrupted).not.toHaveBeenCalled();
      expect(notifyError).toHaveBeenCalled();
    }
  );
  it('does not offer cold receipt Resume for a cloud-restored Run', async () => {
    await acceptInitialRunWithoutAck();
    mocks.interrupted.origin = 'cloud_restore';
    await renderChat();
    expect(
      screen.queryByRole('button', { name: /^Resume$/i })
    ).not.toBeInTheDocument();
    expect(mocks.sse).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
  });
  it('rejects cold receipt admission when its recovered model is unavailable', async () => {
    const acceptedRequest = await acceptInitialRunWithoutAck();
    mocks.cloudAvailable = false;
    await renderChat();
    await resumeInterruptedRun();
    await waitFor(() =>
      expect(mocks.refreshInterrupted).toHaveBeenCalledOnce()
    );
    expect(project.metadata.modelSelection).toEqual(
      acceptedRequest.session_model_selection
    );
    expect(mocks.sse).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(
      mocks.localGet.mock.calls.filter(([url]) =>
        url.includes('/model-selection')
      )
    ).toHaveLength(0);
    expect(notifyError).toHaveBeenCalled();
  });
  it.each([
    {
      cachedIncident: false,
      globalModelType: 'custom',
      name: 'fresh Cloud key quota rejection',
    },
    {
      cachedIncident: true,
      globalModelType: 'custom',
      name: 'cached Cloud quota despite an otherwise usable key',
    },
    {
      cachedIncident: true,
      globalModelType: 'cloud',
      name: 'canonical Cloud quota after global Cloud preference defers classification',
    },
  ])(
    'blocks cold receipt admission for $name',
    async ({ cachedIncident, globalModelType }) => {
      mocks.auth.modelType = globalModelType;
      const acceptedRequest = await acceptInitialRunWithoutAck();
      if (cachedIncident)
        useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
      const get = mocks.get.getMockImplementation()!;
      if (!cachedIncident)
        mocks.get.mockImplementation(async (...args) =>
          args[0] === '/api/v1/user/key'
            ? { code: '20', text: 'Synthetic credits exhausted' }
            : get(...args)
        );
      await renderChat(globalModelType === 'cloud');
      await resumeInterruptedRun();
      await waitFor(() =>
        expect(mocks.refreshInterrupted).toHaveBeenCalledOnce()
      );
      if (cachedIncident)
        expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
      else expect(mocks.get).toHaveBeenCalledWith('/api/v1/user/key');
      expect(project.metadata.modelSelection).toEqual(
        acceptedRequest.session_model_selection
      );
      expect(mocks.sse).toHaveBeenCalledTimes(1);
      expect(mocks.post).not.toHaveBeenCalled();
      expect(
        mocks.localGet.mock.calls.filter(([url]) =>
          url.includes('/session-model')
        )
      ).toHaveLength(1);
      expect(
        mocks.localGet.mock.calls.filter(([url]) =>
          url.includes('/model-selection')
        )
      ).toHaveLength(0);
      expect(notifyError).toHaveBeenCalled();
    }
  );
  function configureSpaceProvider(category: 'custom' | 'local') {
    const platform = category === 'local' ? 'ollama' : 'azure';
    installed.model_ref = `provider://${category}/${platform}/deployment`;
    const provider = {
      id: 42,
      provider_name: platform,
      model_type: 'deployment',
      api_key: 'synthetic-custom-key',
      endpoint_url: 'https://custom.example.test',
      is_valid: 2,
      encrypted_config: {
        api_mode: 'responses',
        model_config_dict: { temperature: 0.2 },
      },
    };
    const get = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (...args) =>
      args[0] === '/api/v1/providers'
        ? { items: args[1]?.prefer ? [] : [provider], pages: 1 }
        : get(...args)
    );
  }
  it.each([
    { globalModelType: 'cloud', category: 'custom' },
    { globalModelType: 'cloud', category: 'local' },
    { globalModelType: 'custom', category: 'custom' },
    { globalModelType: 'custom', category: 'local' },
  ] as const)(
    'recovers $category receipt with cached Cloud quota and global $globalModelType preference',
    async ({ globalModelType, category }) => {
      configureSpaceProvider(category);
      mocks.auth.modelType = globalModelType;
      const acceptedRequest = await acceptInitialRunWithoutAck();
      expect(acceptedRequest.session_model_selection).toMatchObject({
        modelType: category,
        provider_id: 42,
        model_type: 'deployment',
      });
      useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
      await renderChat(globalModelType === 'cloud');
      await resumeInterruptedRun();
      await waitFor(() => expect(mocks.sse).toHaveBeenCalledTimes(2));
      expect(
        mocks.localGet.mock.calls.filter(([url]) =>
          url.includes('/session-model')
        )
      ).toHaveLength(1);
      expect(
        mocks.localGet.mock.calls.filter(([url]) =>
          url.includes('/model-selection')
        )
      ).toHaveLength(0);
      expect(request()).toMatchObject({
        run_id: acceptedRequest.run_id,
        model_type: 'deployment',
        model_platform: acceptedRequest.model_platform,
        api_key: 'synthetic-custom-key',
        api_url: 'https://custom.example.test',
        extra_params: { api_mode: 'responses' },
      });
      expect(project.metadata.modelSelection).toEqual(
        acceptedRequest.session_model_selection
      );
      expect(mocks.post).toHaveBeenCalledWith(
        `/runs/${acceptedRequest.run_id}/resume`,
        expect.any(Object),
        undefined,
        expect.objectContaining({
          beforeRequest: expect.any(Function),
          expectedAccountKey: getAccountEnvironmentKey(mocks.auth),
        })
      );
      expect(mocks.auth.hasModelConfigured).toBe(globalModelType === 'cloud');
      expect(mocks.get).not.toHaveBeenCalledWith('/api/v1/user/key');
      expect(request().workspace_model_selection).toBeUndefined();
      expect(notifyError).not.toHaveBeenCalled();
    }
  );
  it('rejects an account change while recovering custom under a global Cloud quota incident', async () => {
    configureSpaceProvider('custom');
    mocks.auth.modelType = 'cloud';
    await acceptInitialRunWithoutAck();
    useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
    const localGet = mocks.localGet.getMockImplementation()!;
    mocks.localGet.mockImplementation(async (...args) => {
      const response = await localGet(...args);
      if (args[0].includes('/session-model')) {
        mocks.auth.token = 'different-synthetic-token';
        mocks.auth.user_id = 'account-b';
      }
      return response;
    });
    await renderChat(true);
    await resumeInterruptedRun();
    await waitFor(() =>
      expect(mocks.refreshInterrupted).toHaveBeenCalledOnce()
    );
    expect(
      mocks.localGet.mock.calls.filter(([url]) =>
        url.includes('/session-model')
      )
    ).toHaveLength(1);
    expect(
      mocks.localGet.mock.calls.filter(([url]) =>
        url.includes('/model-selection')
      )
    ).toHaveLength(0);
    expect(mocks.sse).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.projectStore.setProjectModel).not.toHaveBeenCalled();
    expect(project.metadata.modelSelection).toBeUndefined();
    expect(notifyError).toHaveBeenCalled();
  });
  it.each([
    { globalModelType: 'custom', category: 'cloud' },
    { globalModelType: 'cloud', category: 'custom' },
    { globalModelType: 'cloud', category: 'local' },
  ] as const)(
    'keeps $category receipt warm-send and queue blocked before recovery with global $globalModelType',
    async ({ globalModelType, category }) => {
      if (category !== 'cloud') configureSpaceProvider(category);
      mocks.auth.modelType = globalModelType;
      await acceptInitialRunWithoutAck();
      if (globalModelType === 'cloud')
        useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
      // Remove the Interrupted banner to exercise the ordinary send/queue gates
      // independently of their interrupted-Run barrier.
      mocks.interrupted = null;
      const taskId = chat.getState().activeTaskId!;
      chat.getState().setStatus(taskId, 'finished');
      chat.getState().setIsPending(taskId, false);
      project.queuedMessages = [
        {
          task_id: 'queued-with-receipt',
          content: 'Queued while unconfirmed',
          attaches: [],
          timestamp: 1,
          processing: false,
        },
      ];
      await renderChat(globalModelType === 'cloud');
      expect(screen.getByRole('button', { name: 'Follow up' })).toBeDisabled();
      expect(screen.getByTestId('chat-composer')).toHaveAttribute(
        'data-no-model-overlay',
        globalModelType === 'cloud' ? 'false' : 'true'
      );
      await sendFollowup();
      expect(mocks.sse).toHaveBeenCalledTimes(1);
      expect(mocks.post).not.toHaveBeenCalled();
      expect(
        mocks.localGet.mock.calls.filter(([url]) =>
          url.includes('/session-model')
        )
      ).toHaveLength(0);
      expect(
        mocks.projectStore.setQueuedMessageProcessing
      ).not.toHaveBeenCalled();
      expect(mocks.projectStore.removeQueuedMessage).not.toHaveBeenCalled();
      expect(project.metadata.modelSelection).toBeUndefined();
    }
  );
  it('keeps the automatically pinned Space model usable for a real ChatBox follow-up', async () => {
    await acceptInitialSpaceRun();
    const pin = { ...project.metadata.modelSelection };
    installed = {
      ...installed,
      revision_id: 'bundle@2',
      model_ref: 'provider://cloud/different',
    };
    const initialSelectionReads = mocks.localGet.mock.calls.filter(([url]) =>
      url.includes('/model-selection')
    ).length;
    await renderChat();
    expect(screen.getByTestId('chat-composer')).toHaveAttribute(
      'data-no-model-overlay',
      'false'
    );
    expect(screen.getByRole('button', { name: 'Follow up' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Follow-up'), {
      target: { value: 'Continue the same Session' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Follow up' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/chat/session-1',
        expect.objectContaining({ question: 'Continue the same Session' })
      )
    );
    expect(mocks.sse).toHaveBeenCalledTimes(1);
    expect(project.metadata.modelSelection).toEqual(pin);
    expect(
      mocks.localGet.mock.calls.filter(([url]) =>
        url.includes('/model-selection')
      )
    ).toHaveLength(initialSelectionReads);
    expect(openSettings).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
    expect(mocks.auth).toMatchObject({
      modelType: 'custom',
      hasModelConfigured: false,
    });
  });
  it('resolves the accepted pin again through real startup when resuming an interrupted Run', async () => {
    const firstRequest = await acceptInitialSpaceRun();
    const pin = { ...project.metadata.modelSelection };
    const runId = chat.getState().activeTaskId!;
    interruptRun(runId);
    installed = {
      ...installed,
      revision_id: 'bundle@2',
      model_ref: 'provider://cloud/different',
    };
    const selectionReads = mocks.localGet.mock.calls.filter(([url]) =>
      url.includes('/model-selection')
    ).length;
    await renderChat();
    await resumeInterruptedRun();
    await waitFor(() => expect(mocks.sse).toHaveBeenCalledTimes(2));
    expect(mocks.post).toHaveBeenCalledWith(
      `/runs/${runId}/resume`,
      expect.objectContaining({
        reason: 'explicit_resume',
        request_id: expect.any(String),
      }),
      undefined,
      expect.objectContaining({
        beforeRequest: expect.any(Function),
        expectedAccountKey: getAccountEnvironmentKey(mocks.auth),
      })
    );
    expect(request()).toMatchObject({
      model_type: firstRequest.model_type,
      api_key: firstRequest.api_key,
      api_url: firstRequest.api_url,
      extra_params: firstRequest.extra_params,
    });
    expect(JSON.parse(JSON.stringify(request()))).not.toHaveProperty(
      'workspace_model_selection'
    );
    expect(project.metadata.modelSelection).toEqual(pin);
    expect(
      mocks.localGet.mock.calls.filter(([url]) =>
        url.includes('/model-selection')
      )
    ).toHaveLength(selectionReads);
    expect(notifyError).not.toHaveBeenCalled();
    expect(mocks.auth.hasModelConfigured).toBe(false);
  });
  it('surfaces cold Resume binding failure without falling back to the changed Space default', async () => {
    await acceptInitialSpaceRun();
    const pin = { ...project.metadata.modelSelection };
    interruptRun(chat.getState().activeTaskId!);
    mocks.cloudAvailable = false;
    const initialSelectionReads = mocks.localGet.mock.calls.filter(([url]) =>
      url.includes('/model-selection')
    ).length;
    await renderChat();
    await resumeInterruptedRun();
    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(mocks.refreshInterrupted).toHaveBeenCalledOnce();
    expect(mocks.sse).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(project.metadata.modelSelection).toEqual(pin);
    expect(
      mocks.localGet.mock.calls.filter(([url]) =>
        url.includes('/model-selection')
      )
    ).toHaveLength(initialSelectionReads);
  });
  const refusals: Array<[string, () => void]> = [
    [
      'missing authentication',
      () => {
        mocks.auth.token = null;
      },
    ],
    [
      'unresolved account',
      () => {
        mocks.auth.user_id = null;
      },
    ],
    [
      'foreign Space account',
      () => {
        mocks.space.userId = 'account-b';
      },
    ],
    [
      'missing Session Space despite an active Space',
      () => {
        project.spaceId = undefined;
      },
    ],
    [
      'unresolved Session Space',
      () => {
        project.spaceId = 'missing-space';
      },
    ],
    [
      'legacy source Space',
      () => {
        mocks.space.sourceType = 'legacy';
      },
    ],
    [
      'legacy id Space',
      () => {
        mocks.space.id = 'legacy_account-a';
        project.spaceId = mocks.space.id;
      },
    ],
    [
      'pending default without a pin',
      () => {
        delete project.metadata.modelSelection;
        project.metadata.spaceModelDefaultPending = true;
      },
    ],
    [
      'admission receipt without a pin',
      () => {
        delete project.metadata.modelSelection;
        project.metadata.spaceModelAdmissionRunId = 'accepted-run';
      },
    ],
    [
      'ordinary manual pin without portable identity',
      () => {
        delete project.metadata.modelSelection.model_ref;
      },
    ],
    [
      'default reference without a concrete identity',
      () => {
        project.metadata.modelSelection.model_ref = 'provider://default';
      },
    ],
    [
      'malformed reference',
      () => {
        project.metadata.modelSelection.model_ref = 'invalid-ref';
      },
    ],
    [
      'reference category differing from the pin',
      () => {
        project.metadata.modelSelection.model_ref =
          'provider://custom/provider/model';
      },
    ],
  ];
  it.each(refusals)('retains the global gate for %s', async (_name, change) => {
    await acceptInitialSpaceRun();
    change();
    await renderChat();
    expect(screen.getByTestId('chat-composer')).toHaveAttribute(
      'data-no-model-overlay',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Follow up' })).toBeDisabled();
    await sendFollowup();
    expect(notifyError).toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalledWith('models');
    expect(mocks.sse).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each(
    refusals
      .slice(0, 9)
      .filter(([name]) => name !== 'pending default without a pin')
  )('does not admit Resume for %s', async (_name, change) => {
    await acceptInitialSpaceRun();
    interruptRun(chat.getState().activeTaskId!);
    change();
    await renderChat();
    await resumeInterruptedRun();
    expect(notifyError).toHaveBeenCalled();
    expect(mocks.sse).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.setInterrupted).not.toHaveBeenCalled();
  });
  it.each(['follow-up', 'Resume'])(
    'retains independent cloud usage rejection for %s',
    async (action) => {
      await acceptInitialSpaceRun();
      const pin = { ...project.metadata.modelSelection };
      if (action === 'Resume') interruptRun(chat.getState().activeTaskId!);
      mocks.localGet.mockClear();
      useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
      await renderChat();
      expect(screen.getByRole('button', { name: 'Follow up' })).toBeDisabled();
      if (action === 'Resume') await resumeInterruptedRun();
      else await sendFollowup();
      expect(notifyError).toHaveBeenCalled();
      expect(openSettings).not.toHaveBeenCalled();
      expect(mocks.sse).toHaveBeenCalledTimes(1);
      expect(mocks.post).not.toHaveBeenCalled();
      expect(
        mocks.localGet.mock.calls.filter(([url]) =>
          url.includes('/session-model')
        )
      ).toHaveLength(0);
      expect(mocks.refreshInterrupted).not.toHaveBeenCalled();
      expect(project.metadata.modelSelection).toEqual(pin);
    }
  );
  it('accepts a Space with no account owner while retaining the accepted Session pin', async () => {
    await acceptInitialSpaceRun();
    delete mocks.space.userId;
    await renderChat();
    await sendFollowup();
    expect(mocks.post).toHaveBeenCalledWith(
      '/chat/session-1',
      expect.objectContaining({ question: 'Continue the same Session' })
    );
  });
  it('uses the persisted metadata pin when runtime metadata has none', async () => {
    await acceptInitialSpaceRun();
    mocks.projectMeta = { ...project, metadata: { ...project.metadata } };
    delete project.metadata.modelSelection;
    await renderChat();
    await sendFollowup();
    expect(mocks.post).toHaveBeenCalledWith(
      '/chat/session-1',
      expect.objectContaining({ question: 'Continue the same Session' })
    );
    expect(notifyError).not.toHaveBeenCalled();
  });
  it('keeps runtime pin precedence over conflicting persisted metadata', async () => {
    await acceptInitialSpaceRun();
    mocks.projectMeta = {
      ...project,
      metadata: {
        ...project.metadata,
        modelSelection: { modelType: 'custom' },
      },
    };
    await renderChat();
    await sendFollowup();
    expect(mocks.post).toHaveBeenCalledWith(
      '/chat/session-1',
      expect.objectContaining({ question: 'Continue the same Session' })
    );
    expect(notifyError).not.toHaveBeenCalled();
  });
  it('does not borrow a persisted portable pin when the runtime pin is ordinary manual selection', async () => {
    await acceptInitialSpaceRun();
    mocks.projectMeta = { ...project, metadata: { ...project.metadata } };
    project.metadata.modelSelection = { modelType: 'custom' };
    await renderChat();
    expect(screen.getByRole('button', { name: 'Follow up' })).toBeDisabled();
    await sendFollowup();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('automatically admits a queued follow-up using the accepted Session pin', async () => {
    await acceptInitialSpaceRun();
    const pin = { ...project.metadata.modelSelection };
    project.queuedMessages = [
      {
        task_id: 'queued-1',
        content: 'Queued follow-up',
        attaches: [],
        timestamp: 1,
        processing: false,
      },
    ];
    await renderChat();
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/chat/session-1',
        expect.objectContaining({
          question: 'Queued follow-up',
          task_id: 'queued-1',
        })
      )
    );
    await waitFor(() =>
      expect(mocks.projectStore.removeQueuedMessage).toHaveBeenCalledWith(
        'session-1',
        'queued-1'
      )
    );
    expect(mocks.sse).toHaveBeenCalledTimes(1);
    expect(project.metadata.modelSelection).toEqual(pin);
    expect(notifyError).not.toHaveBeenCalled();
  });
  it('keeps an active human reply available when cloud usage is exhausted', async () => {
    await acceptInitialSpaceRun();
    const taskId = chat.getState().activeTaskId!;
    chat.getState().setActiveAsk(taskId, 'synthetic-agent');
    useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
    await renderChat();
    expect(screen.getByRole('button', { name: 'Follow up' })).toBeEnabled();
    await sendFollowup();
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.post).toHaveBeenCalledWith(
      '/chat/session-1/human-reply',
      expect.objectContaining({
        agent: 'synthetic-agent',
        reply: 'Continue the same Session',
      })
    );
    expect(mocks.sse).toHaveBeenCalledTimes(1);
    expect(chat.getState().activeTaskId).toBe(taskId);
    expect(notifyError).not.toHaveBeenCalled();
  });
});
