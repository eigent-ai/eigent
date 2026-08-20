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
});
