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
// Licensed under the Apache License, Version 2.0 (the "License");

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchGetMock, sseTransportMock } = vi.hoisted(() => ({
  fetchGetMock: vi.fn(),
  sseTransportMock: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  fetchGet: fetchGetMock,
  sseTransport: sseTransportMock,
}));

import {
  getProjectEventStore,
  resetProjectEventStoresForTests,
} from '@/store/projectEventStore';
import { runDomainEventHub } from './eventHub';
import { runProjectionStore } from './projectionStore';
import { RunEventIngressRegistry } from './registry';

describe('RunEventIngressRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runDomainEventHub.clear();
    runProjectionStore.clear();
    resetProjectEventStoresForTests();
    sseTransportMock.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        })
    );
  });

  it('owns at most one local SSE for a Run regardless of consumers', () => {
    const registry = new RunEventIngressRegistry();
    const first = registry.ensureLocal('project-1', 'run-1');
    const second = registry.ensureLocal('project-1', 'run-1');

    expect(second).toBe(first);
    expect(registry.activeCount()).toBe(1);
    expect(sseTransportMock).toHaveBeenCalledTimes(1);
    registry.clear();
  });

  it('coalesces reconciliation and connects only running Runs', async () => {
    let resolveFetch!: (value: unknown) => void;
    fetchGetMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    const registry = new RunEventIngressRegistry();
    const first = registry.reconcileProject('project-1');
    const second = registry.reconcileProject('project-1');
    expect(second).toBe(first);
    expect(fetchGetMock).toHaveBeenCalledTimes(1);

    resolveFetch({
      runs: [
        {
          run_id: 'run-live',
          project_id: 'project-1',
          status: 'running',
          version: 1,
          updated_at: 1,
          origin: 'local',
        },
        {
          run_id: 'run-finished',
          project_id: 'project-1',
          status: 'completed',
          version: 2,
          updated_at: 2,
          origin: 'local',
        },
      ],
    });
    await first;

    expect(registry.has('run-live')).toBe(true);
    expect(registry.has('run-finished')).toBe(false);
    expect(runProjectionStore.getRun('project-1', 'run-finished')?.status).toBe(
      'completed'
    );
    registry.clear();
  });

  it('marks replayed facts as catch-up and switches to live after the marker', async () => {
    let transportOptions!: {
      onopen: (response: Response) => Promise<void>;
      onmessage: (message: { event: string; data: string }) => Promise<void>;
      signal: AbortSignal;
    };
    sseTransportMock.mockImplementation((options) => {
      transportOptions = options;
      return new Promise<void>((resolve) => {
        options.signal.addEventListener('abort', () => resolve(), {
          once: true,
        });
      });
    });
    const deliveries: string[] = [];
    const unsubscribe = runDomainEventHub.subscribe(
      { projectId: 'project-1' },
      (event) => deliveries.push(event.deliveryMode)
    );
    const registry = new RunEventIngressRegistry();
    registry.ensureLocal('project-1', 'run-1', { reconnect: true });
    await transportOptions.onopen(
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );
    const event = (sequence: number) =>
      JSON.stringify({
        schema_version: 1,
        event_id: `event-${sequence}`,
        project_id: 'project-1',
        run_id: 'run-1',
        run_sequence: sequence,
        run_version: sequence,
        event_type: 'run.attempt_started',
        payload: {},
        created_at: sequence,
      });

    await transportOptions.onmessage({ event: 'run_event', data: event(1) });
    await transportOptions.onmessage({
      event: 'replay_caught_up',
      data: JSON.stringify({ run_id: 'run-1', after_sequence: 1 }),
    });
    await transportOptions.onmessage({ event: 'run_event', data: event(2) });

    await transportOptions.onopen(
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );
    await transportOptions.onmessage({ event: 'run_event', data: event(3) });
    await transportOptions.onmessage({
      event: 'replay_caught_up',
      data: JSON.stringify({ run_id: 'run-1', after_sequence: 3 }),
    });
    await transportOptions.onmessage({ event: 'run_event', data: event(4) });

    expect(deliveries).toEqual([
      'reconnect_catch_up',
      'live',
      'reconnect_catch_up',
      'live',
    ]);
    unsubscribe();
    registry.clear();
  });

  it('projects the owned canonical Run stream into the Chat timeline', async () => {
    let transportOptions!: {
      onmessage: (message: { event: string; data: string }) => Promise<void>;
      signal: AbortSignal;
    };
    sseTransportMock.mockImplementation((options) => {
      transportOptions = options;
      return new Promise<void>((resolve) => {
        options.signal.addEventListener('abort', () => resolve(), {
          once: true,
        });
      });
    });
    const registry = new RunEventIngressRegistry();
    registry.ensureLocal('project-chat', 'run-chat');

    await transportOptions.onmessage({
      event: 'run_event',
      data: JSON.stringify({
        schema_version: 1,
        event_id: 'tool-prepared-1',
        project_id: 'project-chat',
        run_id: 'run-chat',
        run_sequence: 1,
        run_version: 1,
        event_type: 'tool.prepared',
        payload: {
          status: 'prepared',
          tool_call_id: 'tool-call-1',
          tool_name: 'execute_action',
        },
        created_at: 1,
      }),
    });

    const projectEventStore = getProjectEventStore('project-chat');
    projectEventStore.flushNow();
    expect(projectEventStore.getSnapshot().chat.nodes).toEqual([
      expect.objectContaining({
        eventId: 'tool-prepared-1',
        kind: 'activity',
        toolCallId: 'tool-call-1',
      }),
    ]);
    expect(
      projectEventStore.getSnapshot().view.runs['run-chat']?.origin
    ).toBeNull();
    registry.clear();
  });

  it('does not let origin-less registry delivery overwrite snapshot provenance', async () => {
    let transportOptions!: {
      onmessage: (message: { event: string; data: string }) => Promise<void>;
      signal: AbortSignal;
    };
    sseTransportMock.mockImplementation((options) => {
      transportOptions = options;
      return new Promise<void>((resolve) => {
        options.signal.addEventListener('abort', () => resolve(), {
          once: true,
        });
      });
    });
    const projectEventStore = getProjectEventStore('project-cloud');
    projectEventStore.replaceSnapshot({
      project_id: 'project-cloud',
      current_cursor: 0,
      runs: [
        {
          run_id: 'run-cloud',
          status: 'running',
          expected_next_run_sequence: 1,
          run_version: 0,
          updated_at: '2026-08-20T00:00:00Z',
          origin: 'cloud_restore',
        },
      ],
      recent_events: [],
    });
    const registry = new RunEventIngressRegistry();
    registry.ensureLocal('project-cloud', 'run-cloud');

    await transportOptions.onmessage({
      event: 'run_event',
      data: JSON.stringify({
        schema_version: 1,
        event_id: 'cloud-event-1',
        project_id: 'project-cloud',
        run_id: 'run-cloud',
        run_sequence: 1,
        run_version: 1,
        event_type: 'run.attempt_started',
        payload: {},
        created_at: 1,
      }),
    });
    projectEventStore.flushNow();

    expect(projectEventStore.getSnapshot().view.runs['run-cloud']?.origin).toBe(
      'cloud_restore'
    );
    expect(projectEventStore.getSnapshot().view.needsResync).toBe(false);
    registry.clear();
  });

  it('clears a recoverable gap only after durable replay catches up', async () => {
    let transportOptions!: {
      onmessage: (message: { event: string; data: string }) => Promise<void>;
      signal: AbortSignal;
    };
    sseTransportMock.mockImplementation((options) => {
      transportOptions = options;
      return new Promise<void>((resolve) => {
        options.signal.addEventListener('abort', () => resolve(), {
          once: true,
        });
      });
    });
    const registry = new RunEventIngressRegistry();
    const event = (sequence: number) =>
      JSON.stringify({
        schema_version: 1,
        event_id: `gap-event-${sequence}`,
        project_id: 'project-gap',
        run_id: 'run-gap',
        run_sequence: sequence,
        run_version: sequence,
        event_type: 'run.attempt_started',
        payload: {},
        created_at: sequence,
      });

    registry.ingest('project-gap', 'run-gap', JSON.parse(event(2)), 'live');
    expect(runProjectionStore.getProject('project-gap')?.needsResync).toBe(
      true
    );

    registry.ensureLocal('project-gap', 'run-gap', { reconnect: true });
    await transportOptions.onmessage({ event: 'run_event', data: event(1) });
    await transportOptions.onmessage({ event: 'run_event', data: event(2) });
    expect(runProjectionStore.getProject('project-gap')?.needsResync).toBe(
      true
    );
    await transportOptions.onmessage({
      event: 'replay_caught_up',
      data: JSON.stringify({ run_id: 'run-gap', after_sequence: 2 }),
    });

    expect(runProjectionStore.getProject('project-gap')?.needsResync).toBe(
      false
    );
    registry.clear();
  });

  describe('stopped Run streams', () => {
    type CapturedStream = {
      url: string;
      signal: AbortSignal;
      onopen: (response: Response) => Promise<void>;
      onmessage: (message: { event: string; data: string }) => Promise<void>;
    };

    const captureStreams = () => {
      const streams: CapturedStream[] = [];
      sseTransportMock.mockImplementation((options: CapturedStream) => {
        streams.push(options);
        return new Promise<void>((resolve) => {
          options.signal.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
      });
      return streams;
    };
    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const opened = () =>
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    const caughtUp = (afterSequence: number) => ({
      event: 'replay_caught_up',
      data: JSON.stringify({ run_id: 'run-1', after_sequence: afterSequence }),
    });
    const runEvent = (
      sequence: number,
      eventType: string,
      payload: Record<string, unknown> = {}
    ) => ({
      event: 'run_event',
      data: JSON.stringify({
        schema_version: 1,
        event_id: `stopped-run-event-${sequence}`,
        project_id: 'project-1',
        run_id: 'run-1',
        run_sequence: sequence,
        run_version: sequence,
        event_type: eventType,
        payload,
        created_at: sequence,
      }),
    });
    const summary = (status: string, version: number, attempt = 1) => ({
      project_id: 'project-1',
      run_id: 'run-1',
      status,
      version,
      origin: 'local',
      updated_at: version,
      latest_attempt: { attempt_number: attempt, status },
    });
    const settle = async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
    };
    const interruptRun = async (
      registry: RunEventIngressRegistry,
      streams: CapturedStream[]
    ) => {
      registry.ensureLocal('project-1', 'run-1');
      const stream = streams.at(-1)!;
      await stream.onopen(opened());
      await stream.onmessage(caughtUp(0));
      await stream.onmessage(runEvent(1, 'run.attempt_started'));
      await stream.onmessage(runEvent(2, 'run.interrupted'));
      return stream;
    };

    it('closes the stream once the terminal event reached its subscribers', async () => {
      const streams = captureStreams();
      const finalRead = deferred<unknown>();
      fetchGetMock.mockReturnValue(finalRead.promise);
      const delivered: string[] = [];
      runDomainEventHub.subscribe({ runId: 'run-1' }, (event) =>
        delivered.push(event.eventType)
      );
      const registry = new RunEventIngressRegistry();
      registry.ensureLocal('project-1', 'run-1');
      const [stream] = streams;
      await stream.onopen(opened());
      await stream.onmessage(caughtUp(0));
      await stream.onmessage(runEvent(1, 'run.attempt_started'));
      await stream.onmessage(
        runEvent(2, 'approval.requested', {
          interaction_id: 'approval-1',
          interaction_type: 'approval',
        })
      );
      await settle();
      // Waiting for the user is not a stopped Run.
      expect(stream.signal.aborted).toBe(false);

      await stream.onmessage(runEvent(3, 'run.completed'));

      expect(delivered).toEqual([
        'run.attempt_started',
        'approval.requested',
        'run.completed',
      ]);
      expect(
        getProjectEventStore('project-1').getSnapshot().view.runs['run-1']
          ?.status
      ).toBe('completed');
      // The final read still owns the stream until elapsed facts arrive.
      expect(stream.signal.aborted).toBe(false);
      expect(registry.has('run-1')).toBe(true);
      expect(fetchGetMock).toHaveBeenCalledWith(
        '/runs/run-1',
        undefined,
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );

      finalRead.resolve(summary('completed', 3));
      await vi.waitFor(() => expect(stream.signal.aborted).toBe(true));
      expect(registry.has('run-1')).toBe(false);
      expect(registry.activeCount()).toBe(0);
      registry.clear();
    });

    it('closes a stream opened after its Run had already finished', async () => {
      const streams = captureStreams();
      fetchGetMock.mockResolvedValue(summary('completed', 2));
      runProjectionStore.upsertRunSummaries('project-1', [
        summary('completed', 2),
      ]);
      const registry = new RunEventIngressRegistry();
      registry.ensureLocal('project-1', 'run-1');
      const [stream] = streams;
      await stream.onopen(opened());
      await stream.onmessage(runEvent(1, 'run.attempt_started'));
      await stream.onmessage(runEvent(2, 'run.completed'));
      expect(stream.signal.aborted).toBe(false);

      await stream.onmessage(caughtUp(2));

      await vi.waitFor(() => expect(stream.signal.aborted).toBe(true));
      expect(registry.has('run-1')).toBe(false);
      registry.clear();
    });

    it('reopens the stream when an interrupted Run is resumed', async () => {
      const streams = captureStreams();
      fetchGetMock.mockResolvedValueOnce(summary('interrupted', 2));
      const registry = new RunEventIngressRegistry();
      const interrupted = await interruptRun(registry, streams);
      await vi.waitFor(() => expect(interrupted.signal.aborted).toBe(true));
      expect(registry.has('run-1')).toBe(false);

      // Resume admits a new Attempt and its observer asks for the Run again.
      fetchGetMock.mockResolvedValue(summary('running', 4, 2));
      registry.ensureLocal('project-1', 'run-1');

      expect(streams).toHaveLength(2);
      const resumed = streams[1];
      expect(resumed.url).toBe('/runs/run-1/stream?after_sequence=2');
      await resumed.onopen(opened());
      await resumed.onmessage(
        runEvent(3, 'run.attempt_created', { attempt_number: 2 })
      );
      await resumed.onmessage(caughtUp(3));
      await resumed.onmessage(
        runEvent(4, 'run.attempt_started', { attempt_number: 2 })
      );
      await settle();

      expect(resumed.signal.aborted).toBe(false);
      expect(registry.has('run-1')).toBe(true);
      expect(runProjectionStore.getRun('project-1', 'run-1')?.status).toBe(
        'running'
      );
      registry.clear();
    });

    it('gives a Resume during the final read a fresh stream', async () => {
      const streams = captureStreams();
      const finalRead = deferred<unknown>();
      fetchGetMock.mockReturnValueOnce(finalRead.promise);
      const registry = new RunEventIngressRegistry();
      const interrupted = await interruptRun(registry, streams);
      expect(interrupted.signal.aborted).toBe(false);

      const resumed = registry.ensureLocal('project-1', 'run-1');

      expect(interrupted.signal.aborted).toBe(true);
      expect(streams).toHaveLength(2);
      finalRead.resolve(summary('interrupted', 2));
      await settle();
      expect(streams[1].signal.aborted).toBe(false);
      expect(registry.has('run-1')).toBe(true);
      expect(registry.ensureLocal('project-1', 'run-1')).toBe(resumed);
      registry.clear();
    });

    it('keeps the stream when a new Attempt starts during the final read', async () => {
      const streams = captureStreams();
      const finalRead = deferred<unknown>();
      fetchGetMock.mockReturnValueOnce(finalRead.promise);
      const registry = new RunEventIngressRegistry();
      const stream = await interruptRun(registry, streams);

      await stream.onmessage(
        runEvent(3, 'run.attempt_created', { attempt_number: 2 })
      );
      finalRead.resolve(summary('pending', 3, 2));
      await settle();

      expect(stream.signal.aborted).toBe(false);
      expect(registry.has('run-1')).toBe(true);
      registry.clear();
    });

    it('keeps a reconnecting stream whose replay resumed the Run', async () => {
      const streams = captureStreams();
      fetchGetMock.mockResolvedValue(summary('running', 4, 2));
      const registry = new RunEventIngressRegistry();
      registry.ensureLocal('project-1', 'run-1', { reconnect: true });
      const [stream] = streams;
      await stream.onopen(opened());
      await stream.onmessage(runEvent(1, 'run.attempt_started'));
      await stream.onmessage(runEvent(2, 'run.interrupted'));
      await stream.onmessage(
        runEvent(3, 'run.attempt_created', { attempt_number: 2 })
      );
      await stream.onmessage(
        runEvent(4, 'run.attempt_started', { attempt_number: 2 })
      );
      await stream.onmessage(caughtUp(4));
      await settle();

      expect(stream.signal.aborted).toBe(false);
      expect(registry.has('run-1')).toBe(true);
      registry.clear();
    });
  });
});
