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

import {
  completeProjectViewResync,
  createProjectViewState,
  deriveLiveEffects,
  importIndexedDbV1,
  importLegacyChatSteps,
  importLocalMemoryV1,
  normalizeEvent,
  projectRawEvents,
  projectSnapshot,
  reduceProjectView,
  selectPendingLegacyAsk,
  selectRunArtifacts,
} from '@/lib/projector';
import { describe, expect, it } from 'vitest';

function event(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'event-1',
    project_id: 'project-1',
    run_id: 'run-1',
    run_sequence: 1,
    run_version: 1,
    cloud_cursor: 1,
    event_type: 'step.created',
    payload: { content: 'hello' },
    legacy_step: 'activate_agent',
    created_at: '2026-08-05T10:00:00Z',
    ...overrides,
  };
}

describe('projector pipeline', () => {
  it('keeps established Run origin immutable and fails closed on conflicts', () => {
    const cloud = reduceProjectView(
      createProjectViewState('project-1', 'live'),
      normalizeEvent(event({ origin: 'cloud_restore' }))
    );
    const conflicted = reduceProjectView(
      cloud,
      normalizeEvent(
        event({
          event_id: 'event-2',
          run_sequence: 2,
          run_version: 2,
          cloud_cursor: 2,
          origin: 'local',
        })
      )
    );

    expect(conflicted.runs['run-1']?.origin).toBe('cloud_restore');
    expect(conflicted.needsResync).toBe(true);
    expect(conflicted.resyncReason).toBe(
      'run_origin_conflict:run-1:cloud_restore:local'
    );
  });

  it('allows one authoritative origin to fill an initially unknown Run', () => {
    const unknown = reduceProjectView(
      createProjectViewState('project-1', 'live'),
      normalizeEvent(event())
    );
    const local = reduceProjectView(
      unknown,
      normalizeEvent(
        event({
          event_id: 'event-2',
          run_sequence: 2,
          run_version: 2,
          cloud_cursor: 2,
          origin: 'local',
        })
      )
    );

    expect(unknown.runs['run-1']?.origin).toBeNull();
    expect(local.runs['run-1']?.origin).toBe('local');
    expect(local.needsResync).toBe(false);
  });

  it('lets a snapshot aggregate correct newer buffered provenance', () => {
    const previous = projectRawEvents(
      'project-1',
      [
        event({
          event_id: 'local-2',
          run_sequence: 2,
          run_version: 2,
          cloud_cursor: 2,
          origin: 'local',
        }),
      ],
      'rehydrate'
    ).state;
    const snapshot = projectSnapshot(
      {
        project_id: 'project-1',
        current_cursor: 1,
        runs: [
          {
            run_id: 'run-1',
            status: 'running',
            expected_next_run_sequence: 2,
            run_version: 1,
            updated_at: '2026-08-05T10:00:00Z',
            origin: 'cloud_restore',
          },
        ],
        recent_events: [],
      },
      previous
    );

    expect(snapshot.runs['run-1']).toMatchObject({
      lastSequence: 2,
      origin: 'cloud_restore',
    });
  });

  it('treats an explicit unknown snapshot origin as fail-closed authority', () => {
    const previous = projectRawEvents(
      'project-1',
      [
        event({
          event_id: 'local-2',
          run_sequence: 2,
          run_version: 2,
          cloud_cursor: 2,
          origin: 'local',
        }),
      ],
      'rehydrate'
    ).state;
    const snapshot = projectSnapshot(
      {
        project_id: 'project-1',
        current_cursor: 1,
        runs: [
          {
            run_id: 'run-1',
            status: 'running',
            expected_next_run_sequence: 2,
            run_version: 1,
            updated_at: '2026-08-05T10:00:00Z',
            origin: null,
          },
        ],
        recent_events: [],
      },
      previous
    );

    expect(snapshot.runs['run-1']?.origin).toBeNull();
  });

  it('preserves established provenance when an older snapshot omits origin', () => {
    const previous = projectRawEvents(
      'project-1',
      [
        event({
          event_id: 'local-2',
          run_sequence: 2,
          run_version: 2,
          cloud_cursor: 2,
          origin: 'local',
        }),
      ],
      'rehydrate'
    ).state;
    const snapshot = projectSnapshot(
      {
        project_id: 'project-1',
        current_cursor: 1,
        runs: [
          {
            run_id: 'run-1',
            status: 'running',
            expected_next_run_sequence: 2,
            run_version: 1,
            updated_at: '2026-08-05T10:00:00Z',
          },
        ],
        recent_events: [],
      },
      previous
    );

    expect(snapshot.runs['run-1']?.origin).toBe('local');
  });

  it('deduplicates by event ID without changing object identity', () => {
    const normalized = normalizeEvent(event());
    const initial = createProjectViewState('project-1', 'live');
    const first = reduceProjectView(initial, normalized);
    const duplicate = reduceProjectView(first, normalized);

    expect(duplicate).toBe(first);
    expect(first.legacySteps).toHaveLength(1);
    expect(first.currentCursor).toBe(1);
  });

  it('restores durable Artifacts outside the bounded snapshot event tail', () => {
    const snapshot = projectSnapshot({
      project_id: 'project-1',
      current_cursor: 100,
      recent_events: [
        event({
          event_id: 'recent-100',
          cloud_cursor: 100,
          run_sequence: 100,
        }),
      ],
      artifact_events: [
        event({
          event_id: 'manifest-1',
          cloud_cursor: 1,
          event_type: 'artifact.manifest.finalized',
          legacy_step: null,
          payload: {
            artifacts: [
              {
                artifact_id: 'artifact-1',
                filename: 'report.csv',
                relativePath: 'reports/report.csv',
                changeType: 'generated',
                uploadPolicy: 'agent_generated',
                localPathAvailable: false,
              },
            ],
          },
        }),
        event({
          event_id: 'upload-1',
          cloud_cursor: 2,
          run_sequence: 2,
          event_type: 'artifact.uploaded',
          legacy_step: null,
          payload: {
            artifact_id: 'artifact-1',
            asset_ref: {
              chat_file_id: 7,
              bucket: 'assets',
              key: 'reports/report.csv',
            },
          },
        }),
      ],
      events_truncated: true,
    });

    expect(snapshot.needsResync).toBe(false);
    expect(selectRunArtifacts(snapshot, 'run-1')).toEqual([
      expect.objectContaining({
        artifactId: 'artifact-1',
        assetRef: expect.objectContaining({
          chatFileId: 7,
          key: 'reports/report.csv',
        }),
      }),
    ]);
  });

  it('detects both Project cursor and Run sequence gaps', () => {
    const first = reduceProjectView(
      createProjectViewState('project-1', 'live'),
      normalizeEvent(event())
    );
    const next = reduceProjectView(
      first,
      normalizeEvent(
        event({
          event_id: 'event-3',
          cloud_cursor: 3,
          run_sequence: 3,
          run_version: 3,
        })
      )
    );
    expect(next.needsResync).toBe(true);
    expect(next.resyncReason).toContain('run_sequence_gap');
    expect(next.currentCursor).toBe(1);
    expect(next.resyncTargetCursor).toBe(3);
    expect(next.seenEventIds['event-3']).toBeUndefined();
    expect(next.legacySteps).toHaveLength(1);
  });

  it('replays a cursor gap from the last contiguous cursor', () => {
    const initial = reduceProjectView(
      createProjectViewState('project-1', 'live'),
      normalizeEvent(event())
    );
    const gap = reduceProjectView(
      initial,
      normalizeEvent(
        event({ event_id: 'event-3', cloud_cursor: 3, run_sequence: 3 })
      )
    );
    const filled = reduceProjectView(
      gap,
      normalizeEvent(
        event({ event_id: 'event-2', cloud_cursor: 2, run_sequence: 2 })
      )
    );
    const replayed = reduceProjectView(
      filled,
      normalizeEvent(
        event({ event_id: 'event-3', cloud_cursor: 3, run_sequence: 3 })
      )
    );

    expect(filled.currentCursor).toBe(2);
    expect(replayed.currentCursor).toBe(3);
    expect(replayed.seenEventIds['event-3']).toBe(true);
    const recovered = completeProjectViewResync(replayed, 3);
    expect(recovered.needsResync).toBe(false);
    expect(recovered.resyncReason).toBeNull();
    expect(recovered.resyncTargetCursor).toBeNull();
  });

  it('keeps resync active until the authoritative cursor is contiguous', () => {
    const state = {
      ...createProjectViewState('project-1', 'live'),
      currentCursor: 3,
      needsResync: true,
      resyncReason: 'cloud_cursor_gap:4:5',
      resyncTargetCursor: 5,
    };

    expect(completeProjectViewResync(state, 5)).toBe(state);
  });

  it('does not clear a concurrently observed live gap after an older delta page', () => {
    const state = {
      ...createProjectViewState('project-1', 'live'),
      currentCursor: 10,
      needsResync: true,
      resyncReason: 'cloud_cursor_gap:11:12',
      resyncTargetCursor: 12,
    };

    expect(completeProjectViewResync(state, 10)).toBe(state);
  });

  it('does not clear a non-gap resync at a matching cursor', () => {
    const state = {
      ...createProjectViewState('project-1', 'live'),
      currentCursor: 3,
      needsResync: true,
      resyncReason: 'project_scope_mismatch:project-2',
      resyncTargetCursor: null,
    };

    expect(completeProjectViewResync(state, 3)).toBe(state);
  });

  it('detects a missing prefix when the first live event does not start at one', () => {
    const result = projectRawEvents(
      'project-1',
      [event({ cloud_cursor: 4, run_sequence: 3 })],
      'live'
    );
    expect(result.state.needsResync).toBe(true);
    expect(result.effects).toContainEqual({
      type: 'request_resync',
      reason: 'run_sequence_gap:run-1:1:3',
    });
  });

  it('requests another resync when a later gap extends the missing range', () => {
    const initial = reduceProjectView(
      createProjectViewState('project-1', 'live'),
      normalizeEvent(event())
    );
    const firstGapEvent = normalizeEvent(
      event({ event_id: 'event-3', cloud_cursor: 3, run_sequence: 3 })
    );
    const firstGap = reduceProjectView(initial, firstGapEvent);
    const laterGapEvent = normalizeEvent(
      event({ event_id: 'event-4', cloud_cursor: 4, run_sequence: 4 })
    );
    const laterGap = reduceProjectView(firstGap, laterGapEvent);

    expect(
      deriveLiveEffects(firstGap, laterGap, laterGapEvent, 'live')
    ).toEqual([
      {
        type: 'request_resync',
        reason: 'run_sequence_gap:run-1:2:4',
      },
    ]);
  });

  it('derives effects only in live mode', () => {
    const normalized = normalizeEvent(
      event({ event_type: 'run.completed', legacy_step: 'end' })
    );
    const initial = createProjectViewState('project-1', 'live');
    const next = reduceProjectView(initial, normalized);
    expect(deriveLiveEffects(initial, next, normalized, 'live')).toEqual([
      { type: 'scroll_to_latest', eventId: 'event-1' },
    ]);
    expect(deriveLiveEffects(initial, next, normalized, 'rehydrate')).toEqual(
      []
    );
    expect(deriveLiveEffects(initial, next, normalized, 'playback')).toEqual(
      []
    );
  });

  it('rehydrates a semantic snapshot atomically at its watermark', () => {
    const snapshot = projectSnapshot({
      project_id: 'project-1',
      current_cursor: 12,
      recent_events: [event()],
      events_truncated: true,
    });
    expect(snapshot.currentCursor).toBe(12);
    expect(snapshot.eventsTruncated).toBe(true);
    expect(snapshot.mode).toBe('rehydrate');
    expect(snapshot.needsResync).toBe(false);
    expect(snapshot.runs['run-1'].lastSequence).toBe(1);
  });

  it('preserves known local history when a replacement snapshot is truncated', () => {
    const previous = projectRawEvents(
      'project-1',
      [
        event(),
        event({
          event_id: 'event-2',
          cloud_cursor: 2,
          run_sequence: 2,
          payload: { content: 'older local history', __legacy_step_id: 2 },
        }),
      ],
      'rehydrate'
    ).state;
    const snapshot = projectSnapshot(
      {
        project_id: 'project-1',
        current_cursor: 12,
        recent_events: [
          event({
            event_id: 'event-12',
            cloud_cursor: 12,
            run_sequence: 12,
            payload: { content: 'recent', __legacy_step_id: 12 },
          }),
        ],
        events_truncated: true,
      },
      previous
    );

    expect(snapshot.eventsTruncated).toBe(true);
    expect(snapshot.legacySteps.map((step) => step.stepId)).toEqual([
      'event-1',
      2,
      12,
    ]);
  });

  it('does not regress live history or cursor when a snapshot response is stale', () => {
    const previous = projectRawEvents(
      'project-1',
      [
        event(),
        event({
          event_id: 'event-2',
          cloud_cursor: 2,
          run_sequence: 2,
          created_at: '2026-08-05T10:00:02Z',
          payload: { __legacy_step_id: 2 },
        }),
      ],
      'live'
    ).state;
    const staleSnapshot = projectSnapshot(
      {
        project_id: 'project-1',
        current_cursor: 1,
        recent_events: [event()],
        events_truncated: false,
      },
      previous
    );

    expect(staleSnapshot.currentCursor).toBe(2);
    expect(staleSnapshot.legacySteps.map((step) => step.stepId)).toEqual([
      'event-1',
      2,
    ]);
    expect(staleSnapshot.runs['run-1'].lastSequence).toBe(2);
  });

  it('does not let a stale snapshot clear a newer live gap', () => {
    const gap = reduceProjectView(
      reduceProjectView(
        createProjectViewState('project-1', 'live'),
        normalizeEvent(event({ cloud_cursor: 10, run_sequence: 1 }))
      ),
      normalizeEvent(
        event({ event_id: 'event-12', cloud_cursor: 12, run_sequence: 2 })
      )
    );
    const staleSnapshot = projectSnapshot(
      {
        project_id: 'project-1',
        current_cursor: 10,
        recent_events: [],
        events_truncated: true,
      },
      gap
    );

    expect(staleSnapshot.needsResync).toBe(true);
    expect(staleSnapshot.resyncTargetCursor).toBe(12);
  });

  it('orders cross-lane steps by time instead of comparing incompatible sequences', () => {
    const previous = projectRawEvents(
      'project-1',
      importLegacyChatSteps([
        {
          project_id: 'project-1',
          task_id: 'run-1',
          step_id: 100,
          step: 'ask',
          data: { content: 'Continue?' },
          timestamp: 200,
        },
      ]),
      'live'
    ).state;
    const snapshot = projectSnapshot(
      {
        project_id: 'project-1',
        current_cursor: 2,
        recent_events: [
          event({
            event_id: 'reply-2',
            cloud_cursor: 2,
            run_sequence: 2,
            legacy_step: 'human_reply',
            payload: { content: 'Yes' },
            created_at: '2026-08-05T10:00:01Z',
          }),
        ],
        events_truncated: true,
      },
      previous
    );

    expect(snapshot.legacySteps.map((step) => step.step)).toEqual([
      'ask',
      'human_reply',
    ]);
    expect(selectPendingLegacyAsk(snapshot, new Set())).toBeNull();
  });

  it('preserves legacy-only live history across a complete canonical snapshot', () => {
    const previous = projectRawEvents(
      'project-1',
      [
        importLegacyChatSteps([
          {
            project_id: 'project-1',
            task_id: 'run-1',
            step_id: 7,
            step: 'ask',
            data: { content: 'Continue?' },
          },
        ])[0],
      ],
      'live'
    ).state;
    const snapshot = projectSnapshot(
      {
        project_id: 'project-1',
        current_cursor: 1,
        recent_events: [event()],
        events_truncated: false,
      },
      previous
    );

    expect(snapshot.eventsTruncated).toBe(false);
    expect(snapshot.legacySteps.map((step) => step.step)).toEqual([
      'activate_agent',
      'ask',
    ]);
    expect(snapshot.legacySteps.at(-1)?.step).toBe('ask');
  });

  it('deduplicates canonical and legacy frames by stable step identity', () => {
    const canonical = normalizeEvent(
      event({ payload: { __legacy_step_id: 9, __legacy_data: { value: 1 } } })
    );
    const legacy = importLegacyChatSteps([
      {
        project_id: 'project-1',
        task_id: 'run-1',
        step_id: 9,
        step: 'activate_agent',
        data: { value: 1 },
      },
    ])[0];
    const initial = createProjectViewState('project-1', 'live');
    const first = reduceProjectView(initial, legacy);
    const second = reduceProjectView(first, canonical);

    expect(second.legacySteps).toHaveLength(1);
    expect(second.seenEventIds[legacy.eventId]).toBe(true);
    expect(second.seenEventIds[canonical.eventId]).toBe(true);
  });

  it('deduplicates the production canonical shape without a legacy step id', () => {
    const createdAt = '2026-08-05T10:00:00Z';
    const legacy = importLegacyChatSteps([
      {
        project_id: 'project-1',
        task_id: 'run-1',
        step_id: 9,
        step: 'activate_agent',
        data: { value: 1 },
        timestamp: Date.parse(createdAt) / 1000 + 0.01,
      },
    ])[0];
    const canonical = normalizeEvent(
      event({
        event_id: 'canonical-production-event',
        payload: { value: 1 },
        created_at: createdAt,
      })
    );
    const initial = createProjectViewState('project-1', 'live');
    const projected = reduceProjectView(
      reduceProjectView(initial, legacy),
      canonical
    );

    expect(projected.legacySteps).toHaveLength(1);
    expect(projected.legacySteps[0].stepId).toBe(9);
    expect(projected.legacySteps[0].crossLaneEventIds).toEqual([
      'canonical-production-event',
    ]);
  });

  it('pairs repeated identical steps one-for-one across the two lanes', () => {
    const createdAt = Date.parse('2026-08-05T10:00:00Z') / 1000;
    const legacy = importLegacyChatSteps([
      {
        project_id: 'project-1',
        task_id: 'run-1',
        step_id: 9,
        step: 'activate_agent',
        data: { value: 1 },
        timestamp: createdAt,
      },
      {
        project_id: 'project-1',
        task_id: 'run-1',
        step_id: 10,
        step: 'activate_agent',
        data: { value: 1 },
        timestamp: createdAt + 1,
      },
    ]);
    const canonical = [
      normalizeEvent(
        event({
          event_id: 'canonical-1',
          payload: { value: 1 },
          created_at: new Date(createdAt * 1000).toISOString(),
        })
      ),
      normalizeEvent(
        event({
          event_id: 'canonical-2',
          cloud_cursor: 2,
          run_sequence: 2,
          run_version: 2,
          payload: { value: 1 },
          created_at: new Date((createdAt + 1) * 1000).toISOString(),
        })
      ),
    ];
    const projected = [...legacy, ...canonical].reduce(
      reduceProjectView,
      createProjectViewState('project-1', 'live')
    );

    expect(projected.legacySteps).toHaveLength(2);
    expect(
      projected.legacySteps.map((step) => step.crossLaneEventIds?.length)
    ).toEqual([1, 1]);
  });

  it('deduplicates an ask across legacy and canonical lanes by content', () => {
    const legacyAsk = importLegacyChatSteps([
      {
        project_id: 'project-1',
        task_id: 'run-1',
        step_id: 9,
        step: 'ask',
        data: { content: 'Continue?', agent: 'browser' },
      },
    ])[0];
    const canonicalAsk = normalizeEvent(
      event({
        event_id: 'canonical-ask',
        legacy_step: 'ask',
        payload: { agent: 'browser', content: 'Continue?' },
      })
    );
    const first = reduceProjectView(
      createProjectViewState('project-1', 'live'),
      legacyAsk
    );
    const second = reduceProjectView(first, canonicalAsk);

    expect(second.legacySteps).toHaveLength(1);
    expect(second.legacySteps[0].stepId).toBe(9);
    expect(second.seenEventIds[canonicalAsk.eventId]).toBe(true);
  });

  it('keeps a legacy pending ask when a canonical frame arrives later', () => {
    const legacyAsk = importLegacyChatSteps([
      {
        project_id: 'project-1',
        task_id: 'run-1',
        step_id: 9,
        step: 'ask',
        data: { agent: 'browser', content: 'Continue?' },
      },
    ])[0];
    const withAsk = reduceProjectView(
      createProjectViewState('project-1', 'live'),
      legacyAsk
    );
    const afterCanonical = reduceProjectView(
      withAsk,
      normalizeEvent(
        event({
          event_id: 'canonical-2',
          cloud_cursor: 1,
          run_sequence: 1,
          legacy_step: 'notice',
        })
      )
    );

    expect(afterCanonical.legacySteps.map((step) => step.step)).toEqual([
      'ask',
      'notice',
    ]);
    expect(afterCanonical.runs['run-1'].lastSequence).toBe(1);
    expect(selectPendingLegacyAsk(afterCanonical, new Set())?.stepId).toBe(9);
  });

  it('closes a pending ask after a durable human reply', () => {
    const state = projectRawEvents(
      'project-1',
      importLegacyChatSteps([
        {
          project_id: 'project-1',
          task_id: 'run-1',
          step_id: 9,
          step: 'ask',
          data: { content: 'Continue?' },
        },
        {
          project_id: 'project-1',
          task_id: 'run-1',
          step_id: 10,
          step: 'human_reply',
          data: { content: 'Yes' },
        },
      ]),
      'live'
    ).state;

    expect(selectPendingLegacyAsk(state, new Set())).toBeNull();
  });

  it('allows the same question to be asked again after a human reply', () => {
    const state = projectRawEvents(
      'project-1',
      importLegacyChatSteps([
        {
          project_id: 'project-1',
          task_id: 'run-1',
          step_id: 9,
          step: 'ask',
          data: { content: 'Continue?' },
        },
        {
          project_id: 'project-1',
          task_id: 'run-1',
          step_id: 10,
          step: 'human_reply',
          data: { content: 'Yes' },
        },
        {
          project_id: 'project-1',
          task_id: 'run-1',
          step_id: 11,
          step: 'ask',
          data: { content: 'Continue?' },
        },
      ]),
      'live'
    ).state;

    expect(
      state.legacySteps.filter((step) => step.step === 'ask')
    ).toHaveLength(2);
    expect(selectPendingLegacyAsk(state, new Set())?.stepId).toBe(11);
  });

  it('uses snapshot run aggregates even when recent events are truncated', () => {
    const snapshot = projectSnapshot({
      project_id: 'project-1',
      current_cursor: 42,
      runs: [
        {
          run_id: 'run-older',
          status: 'completed',
          expected_next_run_sequence: 17,
          updated_at: '2026-08-05T09:00:00Z',
        },
      ],
      recent_events: [],
      events_truncated: true,
    });
    expect(snapshot.runs['run-older']).toEqual({
      runId: 'run-older',
      status: 'completed',
      lastSequence: 16,
      runVersion: 0,
      updatedAt: '2026-08-05T09:00:00Z',
      origin: null,
      resumeBlockedReason: null,
    });
    expect(snapshot.lastSyncedAt).toBeNull();
  });

  it('preserves legacy raw payload across all V1 importers', () => {
    const legacy = {
      step_id: 9,
      task_id: 'task-1',
      project_id: 'project-1',
      step: 'notice',
      data: { content: 'legacy' },
      timestamp: 123,
      vendor_extension: { keep: true },
    };
    const imported = [
      importLegacyChatSteps([legacy]),
      importIndexedDbV1({ messages: [legacy] }),
      importLocalMemoryV1({ steps: [legacy] }),
    ];
    for (const events of imported) {
      expect(events).toHaveLength(1);
      expect(events[0].raw).toEqual(legacy);
      expect(events[0].legacyStep).toBe('notice');
      expect(events[0].payload.__legacy_data).toEqual({ content: 'legacy' });
    }
  });

  it('projects playback without producing real effects', () => {
    const result = projectRawEvents(
      'project-1',
      [event({ event_type: 'run.completed', legacy_step: 'end' })],
      'playback'
    );
    expect(result.state.runs['run-1'].status).toBe('completed');
    expect(result.effects).toEqual([]);
  });

  it.each([
    ['run.deadline_reached', 'failed'],
    ['runtime.interrupted', 'interrupted'],
    ['approval.cancelled', 'interrupted'],
  ] as const)('projects %s as the terminal status %s', (eventType, status) => {
    const result = projectRawEvents(
      'project-1',
      [event({ event_type: eventType, legacy_step: null })],
      'rehydrate'
    );

    expect(result.state.runs['run-1'].status).toBe(status);
  });

  it('projects a new attempt as running after an interruption', () => {
    const result = projectRawEvents(
      'project-1',
      [
        event({
          event_id: 'interrupted-1',
          event_type: 'runtime.interrupted',
          legacy_step: null,
        }),
        event({
          event_id: 'attempt-2',
          event_type: 'run.attempt_started',
          legacy_step: null,
          cloud_cursor: 2,
          run_sequence: 2,
          run_version: 2,
        }),
      ],
      'rehydrate'
    );

    expect(result.state.runs['run-1'].status).toBe('running');
  });

  it('accepts already-normalized importer output without decoding it twice', () => {
    const imported = importLegacyChatSteps([
      {
        step_id: 1,
        task_id: 'run-1',
        project_id: 'project-1',
        step: 'notice',
        data: { content: 'hello' },
      },
    ]);
    const result = projectRawEvents(
      'project-1',
      imported,
      'rehydrate',
      createProjectViewState('project-1', 'rehydrate')
    );
    expect(result.state.legacySteps[0].data).toEqual({ content: 'hello' });
  });
});
