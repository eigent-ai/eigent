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
 * How a manual ("Run now") execution travels from the execution websocket to
 * the durable follow-up queue, compared with a scheduled one.
 */

const sessionEntryGuard = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined)
);
vi.mock('@/store/sessionExecutionStore', () => ({
  requireLegacyExecution: sessionEntryGuard,
}));

vi.mock('@/api/http', () => ({
  proxyFetchGet: vi.fn(() => Promise.resolve({ tasks: [] })),
  proxyFetchPost: vi.fn(() => Promise.resolve({})),
  fetchPost: vi.fn((url: string, body: Record<string, unknown> = {}) =>
    Promise.resolve({
      request_id: body.request_id,
      project_id: url.split('/')[2],
      content: body.content,
      attachment_paths: [],
      delivery_mode: 'wait',
      status: 'pending',
      source: body.source,
      created_at: 0,
      updated_at: 0,
    })
  ),
}));

vi.mock('@/service/triggerApi', () => ({
  proxyFetchTriggerConfig: vi.fn(() => Promise.resolve({})),
  proxyUpdateTriggerExecution: vi.fn(() => Promise.resolve()),
}));

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { fetchPost } from '@/api/http';
import { useExecutionSubscription } from '@/hooks/useExecutionSubscription';
import { useTriggerTaskExecutor } from '@/hooks/useTriggerTaskExecutor';
import { useAuthStore } from '@/store/authStore';
import { useProjectStore } from '@/store/projectStore';
import { useTriggerStore } from '@/store/triggerStore';
import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000, reason = '') {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  serverOpen(sessionId?: string) {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
    this.serverSend({
      type: 'connected',
      session_id: sessionId ?? this.sent[0]?.session_id,
      timestamp: new Date().toISOString(),
    });
  }

  serverSend(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** The network drops without a close frame, e.g. sleep or Wi-Fi change. */
  drop() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1006, reason: '' });
  }
}

const latestSocket = () =>
  FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

/** Exact payload `TriggerCrudService.create_execution` publishes for Run now. */
const manualCreated = (executionId: string) => ({
  type: 'execution_created',
  execution_id: executionId,
  trigger_id: 838,
  trigger_type: 'schedule',
  task_prompt: 'Summarise my inbox',
  status: 'pending',
  input_data: {},
  execution_type: 'manual',
  user_id: '42',
  timestamp: new Date().toISOString(),
  project_id: 'proj-run-now',
});

/** Exact payload the schedule poller publishes. */
const scheduledCreated = (executionId: string) => ({
  type: 'execution_created',
  execution_id: executionId,
  trigger_id: 838,
  trigger_type: 'schedule',
  status: 'pending',
  input_data: { scheduled_at: new Date().toISOString() },
  task_prompt: 'Summarise my inbox',
  execution_type: 'schedule',
  user_id: '42',
  project_id: 'proj-run-now',
});

/** What BackgroundWork mounts in the window that owns background work. */
function useBackgroundWorkHooks() {
  useExecutionSubscription(true);
  useTriggerTaskExecutor();
}

async function mountConnected() {
  const view = renderHook(() => useBackgroundWorkHooks());
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  const socket = latestSocket();
  await act(async () => {
    socket.serverOpen();
  });
  return { view, socket };
}

const followUpPosts = () =>
  vi
    .mocked(fetchPost)
    .mock.calls.filter(([url]) => String(url).includes('/follow-ups'))
    .map(([, body]) => body as Record<string, unknown>);

describe('Run now delivery through the execution websocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_PROXY_URL', 'https://dev.eigent.ai');
    vi.stubEnv('VITE_BASE_URL', 'https://dev.eigent.ai');
    vi.stubGlobal('WebSocket', FakeWebSocket);
    FakeWebSocket.instances = [];
    vi.mocked(fetchPost).mockClear();
    vi.mocked(toast.info).mockClear();
    useAuthStore.setState({ token: 'token' } as any);
    useTriggerStore.setState({ webSocketEvent: null, triggers: [] } as any);
    useProjectStore
      .getState()
      .createProject('Automation', 'Run now', 'proj-run-now');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    const store = useProjectStore.getState();
    for (const project of store.getAllProjects())
      store.removeProject(project.id);
  });

  it('acks a manual execution before any admission step runs', async () => {
    sessionEntryGuard.mockRejectedValueOnce(
      new Error('managed_execution_required')
    );
    const { view, socket } = await mountConnected();

    await act(async () => {
      socket.serverSend(manualCreated('e14c84b5'));
    });

    // The ack is the only thing that moves the server row out of `pending`.
    // A row the server later marks `missed` ("Not started") therefore never
    // reached this handler, whatever the executor or Brain did afterwards.
    expect(socket.sent.map((m) => m.type)).toEqual(['subscribe', 'ack']);
    expect(socket.sent[1]).toEqual({ type: 'ack', execution_id: 'e14c84b5' });
    expect(followUpPosts()).toHaveLength(0);
    view.unmount();
  });

  it('queues a manual execution exactly like a scheduled one', async () => {
    const { view, socket } = await mountConnected();

    await act(async () => {
      socket.serverSend(manualCreated('manual-1'));
    });
    await act(async () => {
      socket.serverSend(scheduledCreated('scheduled-1'));
    });

    expect(followUpPosts()).toEqual([
      expect.objectContaining({
        request_id: 'scheduled:manual-1',
        source: 'scheduled',
        content: 'Summarise my inbox',
      }),
      expect.objectContaining({
        request_id: 'scheduled:scheduled-1',
        source: 'scheduled',
        content: 'Summarise my inbox',
      }),
    ]);
    expect(toast.info).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('keeps only the last of two executions that arrive in one tick', async () => {
    const { view, socket } = await mountConnected();

    await act(async () => {
      socket.serverSend(manualCreated('first'));
      socket.serverSend(manualCreated('second'));
    });

    // Both were acked (the server shows them running), but triggerStore holds
    // a single event slot, so only one reaches executeTask.
    expect(
      socket.sent.filter((m) => m.type === 'ack').map((m) => m.execution_id)
    ).toEqual(['first', 'second']);
    expect(followUpPosts().map((body) => body.request_id)).toEqual([
      'scheduled:second',
    ]);
    view.unmount();
  });

  it('subscribes again with the same session id after the network drops', async () => {
    const { view, socket } = await mountConnected();
    const sessionId = socket.sent[0].session_id;

    await act(async () => {
      socket.drop();
    });
    // 5 s debounce, then 1 s backoff for the first attempt.
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    const reconnected = latestSocket();
    expect(reconnected).not.toBe(socket);
    await act(async () => {
      reconnected.serverOpen();
    });

    // The server keys its session registry by this id. If the old socket's
    // cleanup runs after this subscribe, it removes the new registration too.
    expect(reconnected.sent[0]).toMatchObject({
      type: 'subscribe',
      session_id: sessionId,
    });
    view.unmount();
  });

  it('subscribes with a new session id when BackgroundWork mounts again', async () => {
    const first = await mountConnected();
    const firstSession = first.socket.sent[0].session_id;
    first.view.unmount();
    expect(first.socket.readyState).toBe(FakeWebSocket.CLOSED);

    const second = await mountConnected();
    expect(second.socket.sent[0].session_id).not.toBe(firstSession);
    second.view.unmount();
  });

  it('reports connected again after a missing pong without reconnecting', async () => {
    const { view, socket } = await mountConnected();

    // Ping every 2 minutes; the server routes pong through the same session
    // registry as execution events. No pong arrives here.
    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000 + 10 * 1000);
    });
    expect(useTriggerStore.getState().wsConnectionStatus).toBe('unhealthy');

    // The heartbeat is sent straight down the socket, not through the registry.
    await act(async () => {
      socket.serverSend({ type: 'heartbeat', timestamp: 'now' });
    });
    expect(useTriggerStore.getState().wsConnectionStatus).toBe('connected');
    expect(FakeWebSocket.instances).toHaveLength(1);
    view.unmount();
  });
});
