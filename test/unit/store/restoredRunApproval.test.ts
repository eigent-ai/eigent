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
 * A Session reloaded while its Run is still running is restored as a replay
 * that stays attached to the Run stream. A request raised after that must
 * reach both the Run projection and the restored task, projection first, so
 * the chat can offer the card. Only the HTTP/SSE boundary is replaced.
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
import {
  runDomainEventHub,
  runEventIngressRegistry,
  runProjectionStore,
} from '@/lib/runEvents';
import { settleTaskElapsedMs } from '@/lib/taskDuration';
import { takeControlOfTask } from '@/lib/taskRuntimeControl';
import { useAuthStore } from '@/store/authStore';
import { isChatEventTimelineEnabled } from '@/store/chatEventProjectionBridge';
import { closeSSEConnectionsForTasks } from '@/store/chatStore';
import { resetProjectEventStoresForTests } from '@/store/projectEventStore';
import { useProjectStore } from '@/store/projectStore';
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchGetMock, sseTransportMock } = vi.hoisted(() => ({
  fetchGetMock: vi.fn(),
  sseTransportMock: vi.fn(),
}));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/http')>()),
  fetchGet: fetchGetMock,
  fetchPost: vi.fn(async () => ({})),
  fetchPut: vi.fn(async () => ({})),
  proxyFetchGet: vi.fn(async () => []),
  proxyFetchPost: vi.fn(async () => ({ id: 'history-id' })),
  proxyFetchPut: vi.fn(async () => ({})),
  sseTransport: sseTransportMock,
  waitForBackendReady: vi.fn(async () => true),
  getBaseURL: vi.fn(async () => 'http://brain.invalid'),
}));

type Stream = SSETransportOptions & { signal: AbortSignal };

const SESSION = 'restored-session';
const RUN = 'restored-run';
const PROMPT = 'Write one.txt, run sleep 45, then write two.txt.';
const NOW = Date.now() / 1000;

let streams: Stream[] = [];
let sequence = 0;
let network: ReturnType<typeof vi.spyOn>;

const runEvent = (
  eventType: string,
  payload: Record<string, unknown>,
  legacyStep: string | null = null
) => {
  sequence += 1;
  return {
    id: String(sequence),
    event: 'run_event',
    data: JSON.stringify({
      schema_version: 1,
      event_id: `${RUN}-${sequence}`,
      project_id: SESSION,
      run_id: RUN,
      run_sequence: sequence,
      run_version: sequence,
      event_type: eventType,
      legacy_step: legacyStep,
      payload,
      created_at: NOW - 100 + sequence,
    }),
  };
};
const legacyStep = (step: string, data: Record<string, unknown>) =>
  runEvent(`legacy.${step}`, data, step);
const approvalRequested = (callId: string) =>
  runEvent('approval.requested', {
    approval_id: `approval:${callId}`,
    version: 0,
    expires_at: NOW + 86_400,
  });
const approvalAsk = (callId: string) =>
  legacyStep('ask', {
    interaction_id: `approval:${callId}`,
    interaction_type: 'approval',
    approval_id: `approval:${callId}`,
    run_id: RUN,
    version: 0,
    expires_at: NOW + 86_400,
    question: 'The agent wants to write a file.',
    title: 'Allow write_to_file?',
    agent: 'single_agent',
    action_digest: `digest-${callId}`,
    allowed_scopes: ['once'],
    target_resources: [],
  });
const approvalDecided = (callId: string) =>
  runEvent('approval.decided', {
    approval_id: `approval:${callId}`,
    interaction_id: `approval:${callId}`,
    decision: 'approved',
    continued_attempt: true,
  });

const taskOf = () => {
  const project = useProjectStore.getState().projects[SESSION];
  return project?.chatStores[project.activeChatId]?.getState().tasks[RUN];
};

describe('Run restored while it runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streams = [];
    sequence = 0;
    runDomainEventHub.clear();
    runEventIngressRegistry.clear();
    runProjectionStore.clear();
    resetProjectEventStoresForTests();
    network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Real network is forbidden'));
    sseTransportMock.mockImplementation(async (options: Stream) => {
      streams.push(options);
      await options.onopen?.(
        new Response('', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      );
      await new Promise<void>((resolve) => {
        if (options.signal.aborted) resolve();
        options.signal.addEventListener('abort', () => resolve(), {
          once: true,
        });
      });
    });
    fetchGetMock.mockImplementation(async (url: string) =>
      url === '/runs'
        ? {
            project_id: SESSION,
            runs: [
              {
                project_id: SESSION,
                run_id: RUN,
                status: 'running',
                // The five events below; Brain bumps it with each later one.
                version: 5,
                origin: 'local',
                created_at: NOW - 100,
                updated_at: NOW - 10,
                total_attempt_elapsed_ms: 45_000,
              },
            ],
          }
        : undefined
    );
    useAuthStore.setState({
      email: 'fixture@example.test',
      user_id: 7,
      token: 'synthetic-token',
    });
    useProjectStore.setState({
      activeProjectId: null,
      projects: {},
      navLeadByProjectId: {},
      historyLoadingProjectIds: {},
      historyLoadIncompleteProjectIds: {},
    });
  });

  afterEach(() => {
    const task = taskOf();
    if (task) closeSSEConnectionsForTasks([RUN]);
    runEventIngressRegistry.clear();
    runDomainEventHub.clear();
    runProjectionStore.clear();
    network.mockRestore();
  });

  it('projects a later request before the restored task receives it', async () => {
    const load = useProjectStore
      .getState()
      .loadProjectFromHistory(
        [RUN],
        PROMPT,
        SESSION,
        'history-restored',
        'Restored',
        'space-restored',
        { [RUN]: PROMPT },
        200
      );
    await vi.waitFor(() =>
      expect(
        streams.some((stream) => stream.url.includes(`/runs/${RUN}`))
      ).toBe(true)
    );
    const stream = streams.find((item) => item.url.includes(`/runs/${RUN}`))!;

    // Events recorded before the reload: one approval already answered.
    for (const frame of [
      runEvent('run.attempt_started', { attempt_number: 1 }),
      legacyStep('confirmed', { question: PROMPT }),
      approvalRequested('call-one'),
      approvalAsk('call-one'),
      approvalDecided('call-one'),
    ])
      await stream.onmessage?.(frame as never);
    await stream.onmessage?.({
      id: '',
      event: 'replay_caught_up',
      data: JSON.stringify({ run_id: RUN, after_sequence: sequence }),
    } as never);
    await load;

    expect(stream.signal.aborted).toBe(false);
    expect(taskOf()).toMatchObject({
      type: 'replay',
      durableRunStatus: 'running',
    });

    // Record the projected status at the moment the request reaches the task.
    let projectedWhenAsked: string | undefined;
    const project = useProjectStore.getState().projects[SESSION];
    const unsubscribe = project.chatStores[project.activeChatId].subscribe(
      (state) => {
        const asked = state.tasks[RUN]?.messages.some(
          (message) =>
            message.step === AgentStep.ASK &&
            message.interaction?.interaction_id === 'approval:call-two'
        );
        if (asked && projectedWhenAsked === undefined)
          projectedWhenAsked = runProjectionStore.getRun(SESSION, RUN)?.status;
      }
    );
    await stream.onmessage?.(approvalRequested('call-two') as never);
    await stream.onmessage?.(approvalAsk('call-two') as never);
    unsubscribe();

    await vi.waitFor(() => expect(projectedWhenAsked).toBe('waiting_for_user'));
    expect(taskOf()).toMatchObject({
      type: 'replay',
      // The restored snapshot never moves; the chat reads the projection.
      durableRunStatus: 'running',
      activeAsk: 'single_agent',
    });
  });

  describe('task timer', () => {
    const startedAt = Date.parse('2026-10-01T10:00:00.000Z');

    beforeEach(() => {
      // Installed builds render the legacy chat view.
      vi.stubEnv('VITE_CHATBOX_EVENT_BUS', '');
      vi.useFakeTimers({ toFake: ['Date'] });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);
    // `vi.waitFor` would move the faked clock while it polls.
    const until = async (condition: () => boolean) => {
      for (let attempt = 0; !condition(); attempt++) {
        if (attempt > 200) throw new Error('Condition not reached');
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    /** What the legacy work log shows for the restored task right now. */
    const shownMs = () => settleTaskElapsedMs(taskOf()!, Date.now());
    const timedEvent = (
      eventType: string,
      payload: Record<string, unknown>,
      offsetMs: number,
      step: string | null = null
    ) => {
      sequence += 1;
      return {
        id: String(sequence),
        event: 'run_event',
        data: JSON.stringify({
          schema_version: 1,
          event_id: `${RUN}-${sequence}`,
          project_id: SESSION,
          run_id: RUN,
          run_sequence: sequence,
          run_version: sequence,
          event_type: eventType,
          legacy_step: step,
          payload,
          created_at: (startedAt + offsetMs) / 1000,
        }),
      };
    };
    const now = () => Date.now() - startedAt;
    const started = () =>
      timedEvent('run.attempt_started', { attempt_number: 1 }, 0);
    const todo = (offsetMs: number) =>
      timedEvent(
        'legacy.todo_state',
        {
          agent_id: 'single-1',
          todos: [{ id: 'sub-1', content: 'Write', status: 'in_progress' }],
        },
        offsetMs,
        'todo_state'
      );
    const requested = (callId: string, offsetMs: number) =>
      timedEvent(
        'approval.requested',
        { approval_id: `approval:${callId}`, version: 0 },
        offsetMs
      );
    const ask = (callId: string, offsetMs: number) =>
      timedEvent(
        'legacy.ask',
        {
          interaction_id: `approval:${callId}`,
          interaction_type: 'approval',
          approval_id: `approval:${callId}`,
          run_id: RUN,
          version: 0,
          question: 'The agent wants to write a file.',
          agent: 'single_agent',
        },
        offsetMs,
        'ask'
      );
    const decided = (callId: string, offsetMs: number) =>
      timedEvent(
        'approval.decided',
        {
          approval_id: `approval:${callId}`,
          interaction_id: `approval:${callId}`,
          decision: 'approved',
          continued_attempt: true,
          remaining_interaction_count: 0,
        },
        offsetMs
      );

    /** Reload the Session from a run listing and the Run's stored events. */
    const reload = async ({
      status,
      totalMs,
      history,
    }: {
      status: 'running' | 'waiting_for_user';
      totalMs: number;
      history: ReturnType<typeof timedEvent>[];
    }) => {
      expect(isChatEventTimelineEnabled()).toBe(false);
      const version = sequence;
      fetchGetMock.mockImplementation(async (url: string) =>
        url === '/runs'
          ? {
              project_id: SESSION,
              runs: [
                {
                  project_id: SESSION,
                  run_id: RUN,
                  status,
                  version,
                  origin: 'local',
                  created_at: startedAt / 1000,
                  updated_at: Date.now() / 1000,
                  total_attempt_elapsed_ms: totalMs,
                },
              ],
            }
          : undefined
      );
      const load = useProjectStore
        .getState()
        .loadProjectFromHistory(
          [RUN],
          PROMPT,
          SESSION,
          'history-restored',
          'Restored',
          'space-restored',
          { [RUN]: PROMPT },
          200
        );
      await until(() =>
        streams.some((stream) => stream.url.includes(`/runs/${RUN}`))
      );
      const stream = streams.find((item) => item.url.includes(`/runs/${RUN}`))!;
      for (const frame of history) await stream.onmessage?.(frame as never);
      await stream.onmessage?.({
        id: '',
        event: 'replay_caught_up',
        data: JSON.stringify({ run_id: RUN, after_sequence: sequence }),
      } as never);
      await load;
      expect(stream.signal.aborted).toBe(false);
      return (frame: ReturnType<typeof timedEvent>) =>
        stream.onmessage?.(frame as never);
    };
    /** Finish the Run; the timer settles on the time worked, then stays. */
    const finish = async (
      deliver: (frame: ReturnType<typeof timedEvent>) => unknown,
      workedMs: number,
      outcome: 'completed' | 'failed' = 'completed'
    ) => {
      await deliver(
        outcome === 'completed'
          ? timedEvent('legacy.end', { content: 'Done' }, now(), 'end')
          : timedEvent(
              'legacy.error',
              { message: 'The write failed.' },
              now(),
              'error'
            )
      );
      expect(taskOf()).toMatchObject({
        status: ChatTaskStatus.FINISHED,
        taskTime: 0,
        elapsed: workedMs,
      });
      await deliver(
        timedEvent(
          `run.${outcome}`,
          outcome === 'failed' ? { message: 'The write failed.' } : {},
          now()
        )
      );
      expect(taskOf()).toMatchObject({ taskTime: 0, elapsed: workedMs });
      // The Run total from the backend leaves the waits out as well.
      expect(
        runProjectionStore.getRun(SESSION, RUN)?.totalAttemptElapsedMs
      ).toBe(workedMs);
    };

    it.each(['completed', 'failed'] as const)(
      'holds the time worked when restored during an approval and continues until the Run %s',
      async (outcome) => {
        // Worked 2s, then asked for approval; reopened 30s into the wait.
        const history = [
          started(),
          todo(0),
          requested('call-one', 2_000),
          ask('call-one', 2_000),
        ];
        vi.setSystemTime(startedAt + 32_000);
        const deliver = await reload({
          status: 'waiting_for_user',
          totalMs: 2_000,
          history,
        });

        expect(taskOf()).toMatchObject({
          status: ChatTaskStatus.RUNNING,
          taskTime: 0,
          elapsed: 2_000,
        });
        advance(30_000);
        expect(shownMs()).toBe(2_000);

        await deliver(decided('call-one', now()));
        expect(shownMs()).toBe(2_000);
        advance(3_000);
        expect(shownMs()).toBe(5_000);

        await finish(deliver, 5_000, outcome);
      }
    );

    it('continues from the time worked when restored after an approval, and holds a later one', async () => {
      // Worked 2s, waited 60s, worked 1s more; reopened then.
      const history = [
        started(),
        todo(0),
        requested('call-one', 2_000),
        ask('call-one', 2_000),
        decided('call-one', 62_000),
      ];
      vi.setSystemTime(startedAt + 63_000);
      const deliver = await reload({
        status: 'running',
        totalMs: 3_000,
        history,
      });

      expect(shownMs()).toBe(3_000);
      advance(2_000);
      expect(shownMs()).toBe(5_000);

      await deliver(requested('call-two', now()));
      await deliver(ask('call-two', now()));
      advance(40_000);
      expect(shownMs()).toBe(5_000);
      await deliver(decided('call-two', now()));
      advance(1_000);
      expect(shownMs()).toBe(6_000);

      await finish(deliver, 6_000);
    });

    it('keeps a pause during a restored wait off the time shown', async () => {
      const history = [
        started(),
        todo(0),
        requested('call-one', 2_000),
        ask('call-one', 2_000),
      ];
      vi.setSystemTime(startedAt + 32_000);
      const deliver = await reload({
        status: 'waiting_for_user',
        totalMs: 2_000,
        history,
      });
      const project = useProjectStore.getState().projects[SESSION];
      const chatStore = project.chatStores[project.activeChatId];
      const control = (action: 'pause' | 'resume') =>
        takeControlOfTask({
          chatStore: chatStore.getState(),
          action,
          projectId: SESSION,
          taskId: RUN,
          request: vi.fn().mockResolvedValue(undefined),
        });

      await control('pause');
      advance(10_000);
      await control('resume');
      advance(10_000);
      expect(shownMs()).toBe(2_000);
      await deliver(decided('call-one', now()));
      advance(3_000);
      expect(shownMs()).toBe(5_000);
    });
  });
});
