import {
  createProjectViewState,
  deriveLiveEffects,
  importIndexedDbV1,
  importLegacyChatSteps,
  importLocalMemoryV1,
  normalizeEvent,
  projectRawEvents,
  projectSnapshot,
  reduceProjectView,
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
  it('deduplicates by event ID without changing object identity', () => {
    const normalized = normalizeEvent(event());
    const initial = createProjectViewState('project-1', 'live');
    const first = reduceProjectView(initial, normalized);
    const duplicate = reduceProjectView(first, normalized);

    expect(duplicate).toBe(first);
    expect(first.legacySteps).toHaveLength(1);
    expect(first.currentCursor).toBe(1);
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

  it('derives effects only in live mode', () => {
    const normalized = normalizeEvent(
      event({ event_type: 'run.completed', legacy_step: 'end' })
    );
    const initial = createProjectViewState('project-1', 'live');
    const next = reduceProjectView(initial, normalized);
    expect(deriveLiveEffects(initial, next, normalized, 'live')).toEqual([
      { type: 'scroll_to_latest', eventId: 'event-1' },
      {
        type: 'notify_terminal',
        eventId: 'event-1',
        runId: 'run-1',
        status: 'completed',
      },
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
    expect(snapshot.mode).toBe('rehydrate');
    expect(snapshot.needsResync).toBe(false);
    expect(snapshot.runs['run-1'].lastSequence).toBe(1);
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
