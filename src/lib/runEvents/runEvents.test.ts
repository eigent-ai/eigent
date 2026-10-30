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

import { describe, expect, it, vi } from 'vitest';
import { RunDomainEventHub } from './eventHub';
import { RunEventIngress } from './ingress';
import { RunProjectionStore } from './projectionStore';

function event(
  sequence: number,
  eventType = 'run.attempt_started',
  overrides: Record<string, unknown> = {}
) {
  return {
    schema_version: 1,
    event_id: `event-${sequence}-${eventType}`,
    project_id: 'project-1',
    run_id: 'run-1',
    sequence,
    run_sequence: sequence,
    run_version: sequence,
    event_type: eventType,
    legacy_step: null,
    payload: {},
    created_at: `2026-08-14T00:00:${String(sequence).padStart(2, '0')}Z`,
    origin: 'local',
    ...overrides,
  };
}

describe('RunDomainEventHub and RunProjectionStore', () => {
  it('updates the Store before filtered EventHub listeners run', () => {
    const store = new RunProjectionStore();
    const hub = new RunDomainEventHub();
    const ingress = new RunEventIngress('project-1', 'run-1', store, hub);
    const observed: string[] = [];
    hub.subscribe(
      { projectId: 'project-1', categories: ['lifecycle'] },
      (received) => {
        observed.push(
          `${received.eventType}:${store.getRun('project-1', 'run-1')?.status}`
        );
      }
    );
    hub.subscribe({ projectId: 'another-project' }, () => {
      observed.push('wrong-project');
    });

    expect(ingress.ingest(event(1, 'run.completed')).applied).toBe(true);
    expect(observed).toEqual(['run.completed:completed']);
  });

  it('deduplicates replay and isolates a failing listener', () => {
    const store = new RunProjectionStore();
    const hub = new RunDomainEventHub();
    const ingress = new RunEventIngress('project-1', 'run-1', store, hub);
    const delivered = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    hub.subscribe({}, () => {
      throw new Error('listener failed');
    });
    hub.subscribe({}, delivered);

    expect(ingress.ingest(event(1)).applied).toBe(true);
    expect(ingress.ingest(event(1)).applied).toBe(false);
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('does not advance or publish an out-of-order canonical event', () => {
    const store = new RunProjectionStore();
    const hub = new RunDomainEventHub();
    const ingress = new RunEventIngress('project-1', 'run-1', store, hub);
    const eventTypes: string[] = [];
    hub.subscribe({}, (received) => eventTypes.push(received.eventType));

    ingress.ingest(event(1));
    const gap = ingress.ingest(event(3, 'run.completed'));

    expect(gap).toEqual({ applied: false, gapDetected: true });
    expect(store.getRun('project-1', 'run-1')?.lastSequence).toBe(1);
    expect(store.getRun('project-1', 'run-1')?.status).toBe('running');
    expect(eventTypes).toEqual([
      'run.attempt_started',
      'run.sync.gap_detected',
    ]);
  });

  it('keeps terminal state when a later low-state event arrives', () => {
    const store = new RunProjectionStore();
    const ingress = new RunEventIngress(
      'project-1',
      'run-1',
      store,
      new RunDomainEventHub()
    );
    ingress.ingest(event(1, 'run.completed'));
    ingress.ingest(event(2, 'run.attempt_started'));
    expect(store.getRun('project-1', 'run-1')).toMatchObject({
      status: 'completed',
      lastSequence: 2,
    });
  });

  it('produces the same projection for live and historical delivery', () => {
    const live = new RunProjectionStore();
    const replay = new RunProjectionStore();
    const liveIngress = new RunEventIngress(
      'project-1',
      'run-1',
      live,
      new RunDomainEventHub()
    );
    const replayIngress = new RunEventIngress(
      'project-1',
      'run-1',
      replay,
      new RunDomainEventHub()
    );
    for (const raw of [event(1), event(2, 'run.completed')]) {
      liveIngress.ingest(raw, 'live');
      replayIngress.ingest(raw, 'historical_rehydrate');
    }
    expect(replay.getProject('project-1')).toEqual(
      live.getProject('project-1')
    );
  });

  it('rejects an event assigned to another Project or Run', () => {
    const ingress = new RunEventIngress('project-1', 'run-1');
    expect(() =>
      ingress.ingest(event(1, 'run.attempt_started', { run_id: 'run-2' }))
    ).toThrow(/scope mismatch/);
  });
});
