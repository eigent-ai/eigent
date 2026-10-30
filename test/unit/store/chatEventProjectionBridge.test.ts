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

import { presentChatSemanticEntities } from '@/components/ChatBox/EventTimeline/presentationPolicy';
import {
  normalizeLegacyChatStep,
  normalizeLocalRunEvent,
} from '@/lib/projector';
import { selectRenderableChatNodes } from '@/lib/projector/chat';
import { composeTimelineRuns } from '@/lib/projector/chat/presentation';
import {
  enqueueChatEventProjection,
  type ChatEventProjectionInput,
} from '@/store/chatEventProjectionBridge';
import {
  getProjectEventStore,
  releaseProjectEventStore,
  type ProjectEventStoreSnapshot,
} from '@/store/projectEventStore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const projectId = 'project-mixed-replay';
const runId = 'run-mixed-replay';
const startedAt = Date.parse('2026-08-18T00:00:00Z') / 1000;

function canonical(
  sequence: number,
  eventType: string,
  payload: Record<string, unknown>,
  legacyStep: string | null = null
): ChatEventProjectionInput {
  return {
    projectId,
    runId,
    sequence,
    sourceId: 'canonical-stream',
    transport: 'local_run',
    raw: {
      project_id: projectId,
      run_id: runId,
      event_id: `canonical:${sequence}`,
      sequence,
      run_version: sequence,
      event_type: eventType,
      legacy_step: legacyStep,
      created_at: startedAt + sequence,
      payload,
    },
  };
}

function narration(sequence: number, fragment: string) {
  return canonical(
    sequence,
    'activity.progress',
    {
      semantic_schema_version: 1,
      display_schema_version: 1,
      semantic: {
        kind: 'narration',
        subject: { type: 'activity_stream', id: `${runId}:narration` },
        actor: { type: 'agent' },
        lifecycle: { phase: 'progress', status: 'running' },
        completeness: { state: 'complete', missing_fields: [] },
        provenance: { source: 'legacy.decompose_text' },
        correlation: { run_id: runId, step_id: 'step-1' },
      },
      step_id: 'step-1',
      status: 'running',
      display_title: fragment,
      display_fragment_exact: true,
    },
    'decompose_text'
  );
}

function legacy(
  id: number,
  step: string,
  data: Record<string, unknown>,
  secondsAfterStart = 1
): ChatEventProjectionInput {
  return {
    projectId,
    runId,
    sequence: id,
    sourceId: 'cloud-history',
    transport: 'legacy_chat',
    historical: true,
    raw: {
      id,
      task_id: runId,
      step,
      data,
      timestamp: startedAt + secondsAfterStart,
    },
  };
}

function fileWrite(sequence: number, relativePath: string) {
  return canonical(
    sequence,
    'file.written',
    {
      semantic_schema_version: 1,
      display_schema_version: 1,
      semantic: {
        kind: 'file_change',
        subject: { type: 'file', id: relativePath },
        lifecycle: { phase: 'completed', status: 'completed' },
        completeness: { state: 'complete', missing_fields: [] },
        provenance: { source: 'legacy.write_file' },
        correlation: { task_id: 'subtask-1', step_id: 'step-1' },
      },
      relative_path: relativePath,
      name: relativePath.split('/').at(-1),
      process_task_id: 'subtask-1',
      step_id: 'step-1',
      operation: 'written',
      display_title: `Wrote ${relativePath}`,
    },
    'write_file'
  );
}

function mirrorPair(family: 'decompose_text' | 'write_file') {
  const relativePath = 'models/cathedral.glb';
  return family === 'decompose_text'
    ? {
        mirror: legacy(10_000, family, { content: 'Building ' }),
        owner: narration(1, 'Building '),
        tail: legacy(10_001, family, { content: 'Done.' }, 3),
        ownerMetadata: {
          eventId: 'canonical:1',
          eventType: 'activity.progress',
          runSequence: 1,
          title: 'Building ',
          activityId: `${runId}:narration`,
          stepId: 'step-1',
        },
        tailMetadata: { kind: 'activity', title: 'Done.' },
      }
    : {
        mirror: legacy(10_000, family, {
          relative_path: relativePath,
          file_path: `/workspace/${relativePath}`,
          process_task_id: 'subtask-1',
        }),
        owner: fileWrite(1, relativePath),
        tail: legacy(
          10_001,
          family,
          {
            relative_path: 'models/stained-glass.glb',
            process_task_id: 'subtask-2',
          },
          3
        ),
        ownerMetadata: {
          eventId: 'canonical:1',
          eventType: 'file.written',
          runSequence: 1,
          relativePath,
          stepId: 'step-1',
          semantic: { kind: 'file_change' },
        },
        tailMetadata: {
          kind: 'artifact',
          relativePath: 'models/stained-glass.glb',
        },
      };
}

function normalizeInput(input: ChatEventProjectionInput) {
  return input.transport === 'local_run'
    ? normalizeLocalRunEvent(input.raw, projectId)
    : normalizeLegacyChatStep(input.raw, {
        projectId,
        runId,
        sequence: input.sequence,
        sourceId: input.sourceId,
      });
}

function withCloudId(
  input: ChatEventProjectionInput,
  id: number
): ChatEventProjectionInput {
  return {
    ...input,
    sequence: id,
    raw: { ...(input.raw as Record<string, unknown>), id },
  };
}

function projectEvents(
  events: ChatEventProjectionInput[],
  flushMode: 'per-event' | 'batch'
) {
  const store = getProjectEventStore(projectId, {
    scheduleFlush: () => () => {},
  });
  for (const event of events) {
    expect(enqueueChatEventProjection(event, true, true)).toBe('accepted');
    if (flushMode === 'per-event') store.flushAll();
  }
  store.flushAll();
  const snapshot = store.getSnapshot();
  expectConsistentChatIndex(snapshot);
  const runs = composeTimelineRuns(
    presentChatSemanticEntities(selectRenderableChatNodes(snapshot.chat))
  );
  expect(runs).toHaveLength(1);
  return { run: runs[0], snapshot };
}

function expectConsistentChatIndex(snapshot: ProjectEventStoreSnapshot) {
  const { chat } = snapshot;
  const nodeIds = chat.nodes.map((node) => node.id).sort();
  expect(Object.keys(chat.nodeById).sort()).toEqual(nodeIds);
  expect(Object.keys(chat.nodeIndexById ?? {}).sort()).toEqual(nodeIds);
  for (const [index, node] of chat.nodes.entries()) {
    expect(chat.nodeById[node.id]).toBe(node);
    expect(chat.nodeIndexById?.[node.id]).toBe(index);
  }
  expect(chat.historyTruncated).toBeFalsy();
  expect(snapshot.view.eventsTruncated).toBe(false);
}

describe.each(['per-event', 'batch'] as const)(
  'mixed history presentation with %s flush',
  (flushMode) => {
    beforeEach(() => releaseProjectEventStore(projectId));
    afterEach(() => releaseProjectEventStore(projectId));

    it.each(['canonical-first', 'legacy-first'] as const)(
      'joins exact narration fragments using canonical order (%s)',
      (arrivalOrder) => {
        const first = narration(1, 'Building ');
        const mirror = legacy(10_000, 'decompose_text', {
          content: 'Building ',
        });
        const { run } = projectEvents(
          [
            ...(arrivalOrder === 'canonical-first'
              ? [first, mirror]
              : [mirror, first]),
            narration(2, 'the cathedral.'),
          ],
          flushMode
        );

        expect(run.traceRows).toHaveLength(1);
        expect(run.traceRows[0]).toMatchObject({
          kind: 'node',
          runSequence: 1,
          node: {
            eventId: 'canonical:1',
            kind: 'activity',
            title: 'Building the cathedral.',
            activityId: `${runId}:narration`,
            stepId: 'step-1',
          },
        });
        expect(run.nodes.map((node) => node.eventId)).toEqual([
          'canonical:1',
          'canonical:2',
        ]);
      }
    );

    it('keeps legacy-first narration before the following canonical tool', () => {
      const { run } = projectEvents(
        [
          legacy(10_000, 'decompose_text', { content: 'Building ' }),
          narration(1, 'Building '),
          canonical(2, 'tool.started', {
            tool_call_id: 'tool-1',
            tool_name: 'render_model',
            display_title: 'Render model',
          }),
        ],
        flushMode
      );

      expect(run.traceRows).toMatchObject([
        {
          kind: 'node',
          runSequence: 1,
          node: { eventId: 'canonical:1', title: 'Building ' },
        },
        { kind: 'tool', runSequence: 2, invocation: { toolCallId: 'tool-1' } },
      ]);
    });

    it('keeps a live tool in journal order when its /chat mirror arrives later', () => {
      const store = getProjectEventStore(projectId, {
        scheduleFlush: () => () => {},
      });
      const firstEvents = [
        canonical(1, 'user.message', { content: 'Inspect the workspace' }),
        canonical(2, 'step.started', {
          step: {
            step_id: 'step-1',
            status: 'running',
            title: 'Inspect the workspace',
          },
        }),
        canonical(3, 'tool.prepared', {
          tool_call_id: 'tool-1',
          toolkit_name: 'File Toolkit',
          tool_name: 'read_file',
          status: 'prepared',
        }),
      ];
      for (const event of firstEvents) {
        expect(enqueueChatEventProjection(event, true, true)).toBe('accepted');
        if (flushMode === 'per-event') store.flushAll();
      }
      store.flushAll();

      const trace = () =>
        composeTimelineRuns(
          presentChatSemanticEntities(
            selectRenderableChatNodes(store.getSnapshot().chat)
          )
        )[0]!.traceRows.map((row) =>
          row.kind === 'tool'
            ? `tool:${row.invocation.toolCallId}`
            : row.node.kind === 'step'
              ? `step:${row.node.stepId}`
              : row.node.kind
        );
      expect(trace()).toEqual(['message', 'step:step-1', 'tool:tool-1']);

      const liveMirror: ChatEventProjectionInput = {
        projectId,
        runId,
        sequence: 1,
        sourceId: 'live-chat',
        transport: 'legacy_chat',
        raw: {
          step: 'activate_toolkit',
          data: {
            tool_call_id: 'tool-1',
            toolkit_name: 'File Toolkit',
            method_name: 'read_file',
          },
        },
      };
      expect(enqueueChatEventProjection(liveMirror, true, true)).toBe(
        'filtered'
      );
      store.flushAll();
      expect(trace()).toEqual(['message', 'step:step-1', 'tool:tool-1']);

      // The same legacy fact may arrive inside the durable journal with its
      // real Run sequence. It can enrich the call without changing its slot.
      expect(
        enqueueChatEventProjection(
          canonical(
            4,
            'legacy.activate_toolkit',
            {
              tool_call_id: 'tool-1',
              toolkit_name: 'File Toolkit',
              method_name: 'read_file',
            },
            'activate_toolkit'
          ),
          true,
          true
        )
      ).toBe('accepted');
      store.flushAll();
      expect(trace()).toEqual(['message', 'step:step-1', 'tool:tool-1']);
    });

    it('pairs repeated equal fragments once and retains the legacy-only tail', () => {
      const { run, snapshot } = projectEvents(
        [
          legacy(10_000, 'decompose_text', { content: 'Again. ' }),
          narration(1, 'Again. '),
          legacy(10_001, 'decompose_text', { content: 'Again. ' }, 2),
          narration(2, 'Again. '),
          legacy(10_002, 'decompose_text', { content: 'Done.' }, 3),
        ],
        flushMode
      );

      expect(run.nodes).toHaveLength(3);
      expect(run.nodes.slice(0, 2).map((node) => node.eventId)).toEqual([
        'canonical:1',
        'canonical:2',
      ]);
      expect(run.traceRows).toMatchObject([
        {
          kind: 'node',
          runSequence: 1,
          node: { title: 'Again. Again. ', activityId: `${runId}:narration` },
        },
        {
          kind: 'node',
          node: { title: 'Done.', legacyStep: 'decompose_text' },
        },
      ]);
      expect(Object.keys(snapshot.view.seenEventIds)).toHaveLength(5);
    });

    it.each([
      ['decompose_text', 'canonical-first'],
      ['decompose_text', 'legacy-first'],
      ['write_file', 'canonical-first'],
      ['write_file', 'legacy-first'],
    ] as const)(
      'does not resurrect a %s mirror on playback reconnect (%s)',
      (family, arrivalOrder) => {
        const { mirror, owner, ownerMetadata } = mirrorPair(family);
        projectEvents(
          arrivalOrder === 'canonical-first'
            ? [owner, mirror]
            : [mirror, owner],
          flushMode
        );
        const { run, snapshot } = projectEvents(
          [{ ...mirror, sourceId: 'cloud-reconnect' }, owner],
          flushMode
        );

        expect(run.nodes).toHaveLength(1);
        expect(run.traceRows).toHaveLength(1);
        expect(run.nodes[0]).toMatchObject(ownerMetadata);
        expect(Object.keys(snapshot.view.seenEventIds)).toHaveLength(3);
        expect(snapshot.chat.seenEventIds['canonical:1']).toBe(true);

        const distinct = withCloudId(mirror, 10_001);
        const result = projectEvents([distinct], flushMode);
        expect(result.run.nodes).toHaveLength(2);
        expect(result.run.traceRows).toHaveLength(2);
        expect(result.run.nodes[0]).toMatchObject(ownerMetadata);
        expect(result.run.nodes[1].eventId).toBe(
          normalizeInput(distinct).eventId
        );
        expect(
          result.snapshot.view.legacySteps.find(
            (step) => step.eventId === 'canonical:1'
          )
        ).toMatchObject({ stepId: 10_000 });
      }
    );

    it('retains canonical file metadata when the legacy write arrives first', () => {
      const relativePath = 'models/cathedral.glb';
      const { run } = projectEvents(
        [
          legacy(10_000, 'write_file', {
            relative_path: relativePath,
            file_path: `/workspace/${relativePath}`,
            process_task_id: 'subtask-1',
          }),
          fileWrite(1, relativePath),
        ],
        flushMode
      );

      expect(run.artifacts).toHaveLength(1);
      expect(run.artifacts[0]).toMatchObject({
        eventId: 'canonical:1',
        eventType: 'file.written',
        runSequence: 1,
        relativePath,
        taskId: 'subtask-1',
        stepId: 'step-1',
        semantic: { kind: 'file_change' },
      });
      expect(run.summary.artifactCount).toBe(1);
    });
  }
);

it('prefers canonical metadata when a replacement snapshot contains legacy-first mirrors', () => {
  releaseProjectEventStore(projectId);
  const mirror = legacy(10_000, 'decompose_text', { content: 'Building ' });
  const first = narration(1, 'Building ');
  const second = narration(2, 'the cathedral.');
  const store = getProjectEventStore(projectId, {
    scheduleFlush: () => () => {},
  });
  try {
    store.replaceSnapshot({
      project_id: projectId,
      current_cursor: 0,
      recent_events: [
        normalizeLegacyChatStep(mirror.raw, {
          projectId,
          runId,
          sequence: mirror.sequence,
          sourceId: mirror.sourceId,
        }),
        normalizeLocalRunEvent(first.raw, projectId),
        normalizeLocalRunEvent(second.raw, projectId),
      ],
    });
    const snapshot = store.getSnapshot();
    expectConsistentChatIndex(snapshot);
    const runs = composeTimelineRuns(
      presentChatSemanticEntities(selectRenderableChatNodes(snapshot.chat))
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].traceRows).toMatchObject([
      {
        kind: 'node',
        runSequence: 1,
        node: {
          eventId: 'canonical:1',
          title: 'Building the cathedral.',
          activityId: `${runId}:narration`,
          stepId: 'step-1',
        },
      },
    ]);
    expect(snapshot.hasHydratedSnapshot).toBe(true);
  } finally {
    releaseProjectEventStore(projectId);
  }
});

describe('mixed history retained across snapshot replacement', () => {
  beforeEach(() => releaseProjectEventStore(projectId));
  afterEach(() => releaseProjectEventStore(projectId));

  it('keeps feedback receipt references separate from canonical ingress identity', () => {
    const store = getProjectEventStore(projectId, {
      scheduleFlush: () => () => {},
    });
    const frame = legacy(1, 'agent_end', { content: 'Worker result' });
    frame.raw = {
      ...(frame.raw as Record<string, unknown>),
      source_event_id: 'canonical:1',
    };
    expect(enqueueChatEventProjection(frame, true, true)).toBe('accepted');
    store.flushAll();
    const legacyNode = store.getSnapshot().chat.nodes[0];
    expect(legacyNode.eventId).not.toBe('canonical:1');
    expect(legacyNode.sourceEventId).toBe('canonical:1');

    expect(
      enqueueChatEventProjection(
        canonical(
          1,
          'legacy.agent_end',
          { content: 'Worker result' },
          'agent_end'
        ),
        true,
        true
      )
    ).toBe('accepted');
    store.flushAll();
    const snapshot = store.getSnapshot();
    expect(snapshot.view.runs[runId].lastSequence).toBe(1);
    expect(snapshot.view.seenEventIds['canonical:1']).toBe(true);
    // Existing mirror folding may retain the first display node; its source
    // reference is stable while canonical sequence/status still advance.
    expect(snapshot.chat.nodeById[legacyNode.id]).toMatchObject({
      sourceEventId: 'canonical:1',
      content: 'Worker result',
    });
    expect(snapshot.view.needsResync).toBe(false);
    expect(
      enqueueChatEventProjection(canonical(2, 'run.completed', {}), true, true)
    ).toBe('accepted');
    store.flushAll();
    expect(store.getSnapshot().view.runs[runId]).toMatchObject({
      lastSequence: 2,
      status: 'completed',
    });
  });

  it.each(['decompose_text', 'write_file'] as const)(
    'keeps a distinct equal %s receipt when refreshing an established pair',
    (family) => {
      const { mirror, owner, ownerMetadata } = mirrorPair(family);
      const distinct = withCloudId(mirror, 10_001);
      const mirrorEventId = normalizeInput(mirror).eventId;
      const distinctEventId = normalizeInput(distinct).eventId;
      // The backward matcher pairs C1 with the most recent L1. Earlier L2 has
      // identical content but represents a separate receipt, even on refresh.
      projectEvents([distinct, mirror, owner], 'per-event');
      const store = getProjectEventStore(projectId);
      const history = { beforeByRun: { [runId]: 0 }, runsTruncated: false };
      const checkpoint = {
        project_id: projectId,
        current_cursor: 0,
        recent_events: [normalizeInput(owner)],
      };
      const expectEstablishedPair = () => {
        const snapshot = store.getSnapshot();
        expectConsistentChatIndex(snapshot);
        const runs = composeTimelineRuns(
          presentChatSemanticEntities(selectRenderableChatNodes(snapshot.chat))
        );
        expect(runs).toHaveLength(1);
        expect(runs[0].nodes).toHaveLength(2);
        expect(runs[0].traceRows).toHaveLength(2);
        expect(runs[0].nodes[0]).toMatchObject(ownerMetadata);
        expect(runs[0].nodes[1].eventId).toBe(distinctEventId);
        expect(snapshot.view.legacySteps).toHaveLength(2);
        expect(
          snapshot.view.legacySteps.find(
            (step) => step.eventId === 'canonical:1'
          )
        ).toMatchObject({
          stepId: 10_000,
          crossLaneEventIds: [mirrorEventId],
        });
        expect(
          snapshot.view.legacySteps.find(
            (step) => step.eventId === distinctEventId
          )
        ).toMatchObject({ stepId: 10_001, source: 'chat_step_v1' });
        expect(snapshot.view.runs[runId]).toMatchObject({
          runVersion: 1,
          lastSequence: 1,
        });
        expect(snapshot.view.needsResync).toBe(false);
      };

      expectEstablishedPair();
      for (let refresh = 0; refresh < 2; refresh += 1) {
        const replacement = store.beginSnapshotReplacement();
        expect(replacement).not.toBeNull();
        expect(
          store.commitSnapshotReplacement(replacement!, checkpoint, history)
        ).toBe(true);
        expectEstablishedPair();
      }
      projectEvents(
        [{ ...mirror, sourceId: 'cloud-after-established-pair' }, owner],
        'per-event'
      );
      expectEstablishedPair();
    }
  );

  it.each([
    ['decompose_text', 'legacy-previous'],
    ['decompose_text', 'canonical-previous'],
    ['write_file', 'legacy-previous'],
    ['write_file', 'canonical-previous'],
  ] as const)(
    'reconciles the retained %s mirror with the snapshot (%s)',
    (family, previousSource) => {
      const { mirror, owner, tail, ownerMetadata, tailMetadata } =
        mirrorPair(family);
      projectEvents(
        [previousSource === 'legacy-previous' ? mirror : owner, tail],
        'per-event'
      );
      const store = getProjectEventStore(projectId);
      const history = { beforeByRun: { [runId]: 0 }, runsTruncated: false };
      const checkpoint = {
        project_id: projectId,
        current_cursor: 7,
        runs: [
          {
            run_id: runId,
            status: 'running',
            run_version: 1,
            expected_next_run_sequence: 2,
            updated_at: new Date((startedAt + 1) * 1000).toISOString(),
            total_attempt_elapsed_ms: 5_000,
          },
        ],
        recent_events: [
          normalizeInput(previousSource === 'legacy-previous' ? owner : mirror),
        ],
      };
      const expectReconciledHistory = () => {
        const snapshot = store.getSnapshot();
        expectConsistentChatIndex(snapshot);
        const runs = composeTimelineRuns(
          presentChatSemanticEntities(selectRenderableChatNodes(snapshot.chat))
        );
        expect(runs).toHaveLength(1);
        expect(runs[0].nodes).toHaveLength(2);
        expect(runs[0].nodes[0]).toMatchObject(ownerMetadata);
        expect(runs[0].nodes[1]).toMatchObject(tailMetadata);
        expect(snapshot.view.currentCursor).toBe(7);
        expect(snapshot.view.runs[runId]).toMatchObject({
          runVersion: 1,
          lastSequence: 1,
          totalAttemptElapsedMs: 5_000,
        });
        expect(snapshot.history).toEqual(history);
        expect(snapshot.view.needsResync).toBe(false);
        expect(store.getControlReplayCursor()).toBeNull();
      };

      for (let refresh = 0; refresh < 2; refresh += 1) {
        const replacement = store.beginSnapshotReplacement();
        expect(replacement).not.toBeNull();
        expect(
          store.commitSnapshotReplacement(replacement!, checkpoint, history)
        ).toBe(true);
        expectReconciledHistory();
      }
      projectEvents(
        [{ ...mirror, sourceId: 'cloud-after-refresh' }, owner],
        'per-event'
      );
      expectReconciledHistory();
    }
  );
});
