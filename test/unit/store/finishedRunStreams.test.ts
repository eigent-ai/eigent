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

/**
 * Connection lifetime of finished Runs across the real chat, Project and
 * Run-event stores. Only the HTTP/SSE boundary is replaced: Chromium allows
 * six connections per host, so finished Runs must not keep holding streams.
 */

const sessionEntryGuard = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined)
);
vi.mock('@/store/sessionExecutionStore', () => ({
  requireLegacyExecution: sessionEntryGuard,
  readSessionExecutionRoute: async (scope: { projectId: string }) => ({
    project_id: scope.projectId,
    route: 'legacy',
  }),
  getSessionExecutionState: (scope: { projectId: string }) => ({
    route: { project_id: scope.projectId, route: 'legacy' },
    managed: false,
  }),
}));

import type { SSETransportOptions } from '@/api/http';
import { prepareFollowUpAdmission } from '@/lib/legacyRuntimeAdmission';
import {
  runDomainEventHub,
  runEventIngressRegistry,
  runProjectionStore,
} from '@/lib/runEvents';
import { useAuthStore } from '@/store/authStore';
import {
  closeSSEConnectionsForTasks,
  getIdleSSETransportTaskId,
  hasActiveSSEConnection,
  hasSSETransportForTasks,
} from '@/store/chatStore';
import { useCloudModelStore } from '@/store/cloudModelStore';
import { resetProjectEventStoresForTests } from '@/store/projectEventStore';
import { useProjectStore } from '@/store/projectStore';
import { SPACE_SCHEMA_VERSION, useSpaceStore } from '@/store/spaceStore';
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchGetMock, fetchPostMock, proxyFetchGetMock, sseTransportMock } =
  vi.hoisted(() => ({
    fetchGetMock: vi.fn(),
    fetchPostMock: vi.fn(),
    proxyFetchGetMock: vi.fn(),
    sseTransportMock: vi.fn(),
  }));

// Responses that the desktop main process would have relayed.
const { relayedResponses } = vi.hoisted(() => ({
  relayedResponses: new WeakSet<Response>(),
}));
vi.mock('@/api/brainStreamRelay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/brainStreamRelay')>()),
  isRelayedEventStreamResponse: (response: Response) =>
    relayedResponses.has(response),
}));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/http')>()),
  fetchGet: fetchGetMock,
  fetchPost: fetchPostMock,
  fetchPut: vi.fn(async () => ({})),
  proxyFetchGet: proxyFetchGetMock,
  proxyFetchPost: vi.fn(async () => ({ id: 'history-id' })),
  proxyFetchPut: vi.fn(async () => ({})),
  sseTransport: sseTransportMock,
  waitForBackendReady: vi.fn(async () => true),
  getBaseURL: vi.fn(async () => 'http://brain.invalid'),
}));

vi.mock('@/service/spaceApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/spaceApi')>()),
  proxyCreateSpaceProject: vi.fn(),
  proxyFetchSpaceProjects: vi.fn(async () => []),
  proxyUpdateSpaceProject: vi.fn(async () => ({})),
}));

type Stream = SSETransportOptions & { signal: AbortSignal };

const SESSION = 'finished-session';
const OTHER_SESSION = 'other-session';

let streams: Stream[] = [];
let network: ReturnType<typeof vi.spyOn>;
const streamsFor = (path: string) =>
  streams.filter((stream) => stream.url.includes(path));
const opened = () =>
  new Response('', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
const legacyFrame = (step: string, data: Record<string, unknown>) => ({
  id: '',
  event: '',
  data: JSON.stringify({ step, data }),
});
const runEvent = (
  runId: string,
  sequence: number,
  eventType: string,
  payload: Record<string, unknown> = {}
) => ({
  id: String(sequence),
  event: 'run_event',
  data: JSON.stringify({
    schema_version: 1,
    event_id: `${runId}-${sequence}`,
    project_id: SESSION,
    run_id: runId,
    run_sequence: sequence,
    run_version: sequence,
    event_type: eventType,
    payload,
    created_at: sequence,
  }),
});
const runSummary = (
  runId: string,
  status: string,
  version: number,
  attempt = 1
) => ({
  project_id: SESSION,
  run_id: runId,
  status,
  version,
  origin: 'local',
  updated_at: version,
  latest_attempt: { attempt_number: attempt, status },
});
const caughtUp = (runId: string, afterSequence: number) => ({
  id: '',
  event: 'replay_caught_up',
  data: JSON.stringify({ run_id: runId, after_sequence: afterSequence }),
});

const startRun = async (runId: string, prompt: string) => {
  const chat = useProjectStore.getState().getChatStore(SESSION)!;
  await chat
    .getState()
    .startTask(
      runId,
      undefined,
      undefined,
      undefined,
      prompt,
      [],
      undefined,
      SESSION,
      'single-agent',
      { preserveTaskId: true, awaitAdmission: true, skipHistoryCreate: true }
    );
  const legacy = streamsFor('/chat').at(-1)!;
  expect(legacy.body).toMatchObject({ project_id: SESSION, task_id: runId });
  await vi.waitFor(() =>
    expect(streamsFor(`/runs/${runId}/stream`)).toHaveLength(1)
  );
  return { legacy, canonical: streamsFor(`/runs/${runId}/stream`)[0] };
};

const taskOf = (runId: string) =>
  useProjectStore
    .getState()
    .getAllChatStores(SESSION)
    .map(({ chatStore }) => chatStore.getState().tasks[runId])
    .find(Boolean);

describe('finished Run streams', () => {
  const originalAuth = useAuthStore.getState();
  const originalCatalog = useCloudModelStore.getState();

  beforeEach(() => {
    vi.clearAllMocks();
    streams = [];
    runDomainEventHub.clear();
    runEventIngressRegistry.clear();
    runProjectionStore.clear();
    resetProjectEventStoresForTests();
    network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(
        new Error('Real network is forbidden in this fixture')
      );
    sseTransportMock.mockImplementation(async (options: Stream) => {
      streams.push(options);
      await options.onopen?.(opened());
      await new Promise<void>((resolve) => {
        if (options.signal.aborted) resolve();
        options.signal.addEventListener('abort', () => resolve(), {
          once: true,
        });
      });
    });
    proxyFetchGetMock.mockImplementation(async (url: string) =>
      url === '/api/v1/user/key'
        ? { value: 'synthetic-cloud-key', api_url: 'https://cloud.invalid' }
        : []
    );
    fetchGetMock.mockResolvedValue(undefined);
    fetchPostMock.mockResolvedValue({});
    useAuthStore.setState({
      email: 'fixture@example.test',
      user_id: 7,
      token: 'synthetic-token',
      modelType: 'cloud',
      cloud_model_type: 'fixture-model',
    });
    useCloudModelStore.setState({
      models: [
        {
          id: 'fixture-model',
          display_name: 'Fixture model',
          model_type: 'gpt-5.5',
          model_platform: 'azure',
          provider_family: 'openai',
          kind: 'chat',
        },
      ],
      retired: [],
      defaultModelId: 'fixture-model',
      status: 'ready',
    });
    useSpaceStore.setState({
      activeSpaceId: 'space-fixture',
      spaces: {
        'space-fixture': {
          id: 'space-fixture',
          name: 'Fixture Space',
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
    useProjectStore.setState({
      activeProjectId: null,
      projects: {},
      navLeadByProjectId: {},
      historyLoadingProjectIds: {},
      historyLoadIncompleteProjectIds: {},
      staleProjectIds: new Set(),
    });
    const store = useProjectStore.getState();
    // An existing Session (not a new one adopting the Space default model).
    store.createProject(
      'Report',
      undefined,
      SESSION,
      undefined,
      undefined,
      true,
      {
        createdAt: 1,
      }
    );
    store.createProject(
      'Other',
      undefined,
      OTHER_SESSION,
      undefined,
      undefined,
      false,
      { createdAt: 1 }
    );
  });

  afterEach(() => {
    for (const { chatStore } of useProjectStore
      .getState()
      .getAllChatStores(SESSION)) {
      closeSSEConnectionsForTasks(Object.keys(chatStore.getState().tasks));
    }
    runEventIngressRegistry.clear();
    runDomainEventHub.clear();
    runProjectionStore.clear();
    useAuthStore.setState(originalAuth);
    useCloudModelStore.setState(originalCatalog);
    network.mockRestore();
  });

  it('releases a finished Session on switch and admits its follow-up cold', async () => {
    const first = await startRun('run-1', 'Build the report');
    fetchGetMock.mockImplementation(async (url: string) =>
      url === '/runs/run-1' ? runSummary('run-1', 'completed', 2) : undefined
    );
    await first.canonical.onmessage(caughtUp('run-1', 0));
    await first.canonical.onmessage(
      runEvent('run-1', 1, 'run.attempt_started')
    );
    await first.legacy.onmessage(
      legacyFrame(AgentStep.END, { message: 'Report ready' })
    );
    await first.canonical.onmessage(runEvent('run-1', 2, 'run.completed'));

    // The canonical stream closes after the terminal event; the idle legacy
    // stream stays while its Session is on screen for a warm follow-up.
    await vi.waitFor(() => expect(first.canonical.signal.aborted).toBe(true));
    expect(runEventIngressRegistry.has('run-1')).toBe(false);
    expect(taskOf('run-1')?.status).toBe(ChatTaskStatus.FINISHED);
    expect(first.legacy.signal.aborted).toBe(false);
    expect(getIdleSSETransportTaskId(['run-1'])).toBe('run-1');

    useProjectStore.getState().setActiveProject(OTHER_SESSION);

    await vi.waitFor(() => expect(first.legacy.signal.aborted).toBe(true));
    expect(hasSSETransportForTasks(['run-1'])).toBe(false);
    expect(useProjectStore.getState().projects[SESSION]).toBeDefined();

    // Brain still has the idle consumer, but nobody streams from it.
    useProjectStore.getState().setActiveProject(SESSION);
    fetchGetMock.mockImplementation(async (url: string) =>
      url === `/chat/${SESSION}/status`
        ? {
            has_lock: true,
            status: 'done',
            run_id: 'run-1',
            consumer_alive: true,
            subscriber_count: 0,
          }
        : undefined
    );
    fetchPostMock.mockImplementation(async (url: string) =>
      url === `/chat/${SESSION}/runtime/retire-idle`
        ? { retired: true, consumer_alive: false }
        : {}
    );
    await expect(
      prepareFollowUpAdmission(
        SESSION,
        useProjectStore.getState().getProjectById(SESSION)
      )
    ).resolves.toBe('cold');
    expect(fetchPostMock).toHaveBeenCalledWith(
      `/chat/${SESSION}/runtime/retire-idle`,
      { run_id: 'run-1' },
      undefined,
      { signal: undefined }
    );

    const followUp = await startRun('run-2', 'Summarize it');
    expect(streamsFor('/chat')).toHaveLength(2);
    expect(hasActiveSSEConnection(['run-2'])).toBe(true);
    await followUp.legacy.onmessage(
      legacyFrame(AgentStep.END, { message: 'Summary ready' })
    );

    expect(taskOf('run-2')).toMatchObject({
      status: ChatTaskStatus.FINISHED,
      isPending: false,
    });
    expect(
      taskOf('run-2')?.messages.some(
        (message) =>
          message.role === 'agent' && message.content.includes('Summary ready')
      )
    ).toBe(true);
    expect(fetchPostMock).not.toHaveBeenCalledWith(
      `/chat/${SESSION}`,
      expect.anything()
    );
  });

  it('keeps a relayed idle stream on switch so the follow-up stays warm', async () => {
    sseTransportMock.mockImplementation(async (options: Stream) => {
      streams.push(options);
      const response = opened();
      if (options.url === '/chat') relayedResponses.add(response);
      await options.onopen?.(response);
      await new Promise<void>((resolve) => {
        if (options.signal.aborted) resolve();
        options.signal.addEventListener('abort', () => resolve(), {
          once: true,
        });
      });
    });
    const first = await startRun('run-1', 'Build the report');
    fetchGetMock.mockImplementation(async (url: string) =>
      url === '/runs/run-1' ? runSummary('run-1', 'completed', 2) : undefined
    );
    await first.canonical.onmessage(caughtUp('run-1', 0));
    await first.canonical.onmessage(
      runEvent('run-1', 1, 'run.attempt_started')
    );
    await first.legacy.onmessage(
      legacyFrame(AgentStep.END, { message: 'Report ready' })
    );
    await first.canonical.onmessage(runEvent('run-1', 2, 'run.completed'));
    await vi.waitFor(() => expect(first.canonical.signal.aborted).toBe(true));

    // The relayed stream holds no renderer connection, so leaving the
    // Session does not release it.
    useProjectStore.getState().setActiveProject(OTHER_SESSION);
    for (let index = 0; index < 5; index += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first.legacy.signal.aborted).toBe(false);
    expect(getIdleSSETransportTaskId(['run-1'])).toBe('run-1');

    useProjectStore.getState().setActiveProject(SESSION);
    fetchGetMock.mockImplementation(async (url: string) =>
      url === `/chat/${SESSION}/status`
        ? {
            has_lock: true,
            status: 'done',
            run_id: 'run-1',
            consumer_alive: true,
            subscriber_count: 1,
          }
        : undefined
    );
    await expect(
      prepareFollowUpAdmission(
        SESSION,
        useProjectStore.getState().getProjectById(SESSION)
      )
    ).resolves.toBe('warm');
    expect(fetchPostMock).not.toHaveBeenCalledWith(
      `/chat/${SESSION}/runtime/retire-idle`,
      expect.anything(),
      undefined,
      expect.anything()
    );
  });

  it('reopens the Run stream when an interrupted Run is resumed', async () => {
    const run = await startRun('run-1', 'Build the report');
    fetchGetMock.mockImplementation(async (url: string) =>
      url === '/runs/run-1' ? runSummary('run-1', 'interrupted', 2) : undefined
    );
    await run.canonical.onmessage(caughtUp('run-1', 0));
    await run.canonical.onmessage(runEvent('run-1', 1, 'run.attempt_started'));
    await run.canonical.onmessage(runEvent('run-1', 2, 'run.interrupted'));

    await vi.waitFor(() => expect(run.canonical.signal.aborted).toBe(true));
    expect(runEventIngressRegistry.has('run-1')).toBe(false);
    expect(taskOf('run-1')).toMatchObject({
      status: ChatTaskStatus.FINISHED,
      durableRunStatus: 'interrupted',
    });

    fetchPostMock.mockImplementation(async (url: string) =>
      url === '/runs/run-1/resume'
        ? { run_id: 'run-1', attempt: { attempt_number: 2, status: 'pending' } }
        : {}
    );
    const chat = useProjectStore.getState().getChatStore(SESSION)!;
    await chat
      .getState()
      .startTask(
        'run-1',
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        SESSION,
        'single-agent',
        {
          resumeRequestId: 'resume-1',
          preserveTaskId: true,
          skipHistoryCreate: true,
          awaitAdmission: true,
        }
      );

    // The resumed Attempt's observer gets a fresh stream from the last
    // projected sequence instead of the one closed after the interruption.
    await vi.waitFor(() =>
      expect(streamsFor('/runs/run-1/stream')).toHaveLength(2)
    );
    const resumed = streamsFor('/runs/run-1/stream')[1];
    expect(resumed.url).toBe('/runs/run-1/stream?after_sequence=2');
    await resumed.onmessage(
      runEvent('run-1', 3, 'run.attempt_created', { attempt_number: 2 })
    );
    await resumed.onmessage(caughtUp('run-1', 3));
    await resumed.onmessage(
      runEvent('run-1', 4, 'run.attempt_started', { attempt_number: 2 })
    );
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(resumed.signal.aborted).toBe(false);
    expect(runEventIngressRegistry.has('run-1')).toBe(true);

    fetchGetMock.mockImplementation(async (url: string) =>
      url === '/runs/run-1' ? runSummary('run-1', 'failed', 5, 2) : undefined
    );
    await resumed.onmessage(runEvent('run-1', 5, 'run.failed'));

    await vi.waitFor(() => expect(resumed.signal.aborted).toBe(true));
    expect(taskOf('run-1')).toMatchObject({
      status: ChatTaskStatus.FINISHED,
      durableRunStatus: 'failed',
    });
  });

  it('keeps a background Run stream until that Run finishes', async () => {
    const run = await startRun('run-1', 'Build the report');
    useProjectStore.getState().setActiveProject(OTHER_SESSION);
    await vi.waitFor(() =>
      expect(useProjectStore.getState().activeProjectId).toBe(OTHER_SESSION)
    );
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(run.legacy.signal.aborted).toBe(false);
    expect(run.canonical.signal.aborted).toBe(false);

    await run.legacy.onmessage(
      legacyFrame(AgentStep.END, { message: 'Report ready' })
    );

    // Nothing is left to render for the background Session.
    await vi.waitFor(() => expect(run.legacy.signal.aborted).toBe(true));
    expect(taskOf('run-1')?.status).toBe(ChatTaskStatus.FINISHED);
  });
});
