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

import { createProjectViewState, type ProjectedRun } from '@/lib/projector';
import {
  createChatProjectionState,
  type ChatProjectionNode,
} from '@/lib/projector/chat';
import {
  createHumanControlProjectionState,
  type HumanControlInteraction,
} from '@/lib/projector/control';
import type { ProjectEventStoreSnapshot } from '@/store/projectEventStore';
import { describe, expect, it } from 'vitest';
import {
  selectActionableInterruptedRun,
  selectEventNativeActiveRunId,
} from './runControlArbitration';

function run(
  runId: string,
  status: ProjectedRun['status'],
  overrides: Partial<ProjectedRun> = {}
): ProjectedRun {
  return {
    runId,
    status,
    lastSequence: 2,
    runVersion: 2,
    updatedAt: '2026-08-12T10:00:00.000Z',
    origin: 'local',
    resumeBlockedReason: null,
    ...overrides,
  };
}

function canonicalNode(runId: string, eventType = 'run.attempt_started') {
  return {
    id: `${runId}:${eventType}`,
    eventId: `${runId}:${eventType}`,
    projectId: 'project-1',
    runId,
    createdAt: '2026-08-12T10:00:00.000Z',
    runSequence: 1,
    cloudCursor: null,
    eventType,
    legacyStep: null,
    kind: 'run_status',
    status: 'running',
  } as ChatProjectionNode;
}

function typedRequestNode(
  runId: string,
  interactionId: string,
  eventType:
    | 'interaction.requested'
    | 'approval.requested' = 'interaction.requested'
) {
  return {
    id: `${runId}:${eventType}`,
    eventId: `${runId}:${eventType}`,
    projectId: 'project-1',
    runId,
    createdAt: '2026-08-12T10:00:00.000Z',
    runSequence: 1,
    cloudCursor: null,
    eventType,
    legacyStep: null,
    kind: 'interaction',
    interactionId,
    interactionType: eventType === 'approval.requested' ? 'approval' : 'text',
    status: 'requested',
  } as ChatProjectionNode;
}

function legacyAskNode(runId: string, interactionId: string) {
  return {
    ...typedRequestNode(runId, interactionId),
    id: `${runId}:legacy.step`,
    eventId: `${runId}:legacy.step`,
    eventType: 'legacy.step',
    legacyStep: 'ask',
  } as ChatProjectionNode;
}

function request(
  interactionId: string,
  runId: string,
  requestSource: HumanControlInteraction['requestSource'] = 'canonical',
  requestEventId = `${runId}:interaction.requested`,
  requestEventType: HumanControlInteraction['requestEventType'] = 'interaction.requested'
) {
  return {
    interactionId,
    runId,
    status: 'requested',
    requestSource,
    requestEventId,
    requestEventType,
  } as HumanControlInteraction;
}

function snapshot({
  runs,
  nodes = [],
  controls = [],
  needsResync = false,
  overflowed = false,
}: {
  runs: ProjectedRun[];
  nodes?: ChatProjectionNode[];
  controls?: HumanControlInteraction[];
  needsResync?: boolean;
  overflowed?: boolean;
}): ProjectEventStoreSnapshot {
  const view = createProjectViewState('project-1', 'live');
  const chat = createChatProjectionState('project-1');
  const control = createHumanControlProjectionState('project-1');
  return {
    view: {
      ...view,
      needsResync,
      runs: Object.fromEntries(runs.map((item) => [item.runId, item])),
    },
    chat: {
      ...chat,
      nodes,
      nodeById: Object.fromEntries(nodes.map((node) => [node.eventId, node])),
    },
    control: {
      ...control,
      orderedInteractionIds: controls.map((item) => item.interactionId),
      interactionById: Object.fromEntries(
        controls.map((item) => [item.interactionId, item])
      ),
    },
    incarnation: 0,
    revision: 1,
    hasHydratedSnapshot: true,
    overflowed,
    lastEffects: [],
  };
}

describe('event-native Run-control arbitration', () => {
  it('lets a compacted typed pending control outrank the legacy-owned live Run', () => {
    const state = snapshot({
      runs: [
        run('legacy-live', 'running'),
        run('needs-input', 'waiting_for_user'),
      ],
      nodes: [canonicalNode('legacy-live')],
      controls: [request('question-1', 'needs-input')],
    });

    expect(selectEventNativeActiveRunId(state, 'legacy-live')).toBe(
      'needs-input'
    );
  });

  it('keeps a current live Run ahead of newer read-only history', () => {
    const state = snapshot({
      runs: [
        run('live', 'running'),
        run('restored', 'interrupted', {
          updatedAt: '2026-08-12T11:00:00.000Z',
          origin: 'cloud_restore',
          resumeBlockedReason: 'cloud_history_is_read_only',
        }),
      ],
      nodes: [
        canonicalNode('live'),
        canonicalNode('restored', 'run.interrupted'),
      ],
    });

    expect(selectEventNativeActiveRunId(state, 'live')).toBe('live');
    expect(selectActionableInterruptedRun(state, 'restored')).toBeNull();
  });

  it('does not give an orphan historical running Run a control', () => {
    const state = snapshot({
      runs: [run('past-running', 'running')],
      nodes: [canonicalNode('past-running')],
    });

    expect(selectEventNativeActiveRunId(state, null)).toBeNull();
  });

  it('does not give aggregate-only unfinished history a Run control', () => {
    const state = snapshot({ runs: [run('past-running', 'running')] });

    expect(selectEventNativeActiveRunId(state, 'past-running')).toBeNull();
  });

  it('does not expose controls for a Run with incomplete event coverage', () => {
    const state = snapshot({
      runs: [
        run('truncated-run', 'waiting_for_user', { eventsTruncated: true }),
        run('watermark-gap', 'waiting_for_user', {
          lastSequence: 1,
          runVersion: 2,
        }),
      ],
      controls: [
        request('question-1', 'truncated-run'),
        request('question-2', 'watermark-gap'),
      ],
    });

    expect(selectEventNativeActiveRunId(state, null)).toBeNull();
  });

  it('does not promote a canonical-transport legacy ASK into a durable pending control', () => {
    const state = snapshot({
      runs: [run('legacy-question', 'waiting_for_user')],
      nodes: [legacyAskNode('legacy-question', 'legacy-ask')],
      controls: [
        request(
          'legacy-ask',
          'legacy-question',
          'canonical',
          'legacy-question:legacy.step',
          'legacy.step'
        ),
      ],
    });

    expect(selectEventNativeActiveRunId(state, 'legacy-question')).toBeNull();
  });

  it('recognizes both typed durable request event families', () => {
    const state = snapshot({
      runs: [run('approval-run', 'waiting_for_user')],
      nodes: [
        typedRequestNode('approval-run', 'approval-1', 'approval.requested'),
      ],
      controls: [
        request(
          'approval-1',
          'approval-run',
          'canonical',
          'approval-run:approval.requested',
          'approval.requested'
        ),
      ],
    });

    expect(selectEventNativeActiveRunId(state, null)).toBe('approval-run');
  });

  it('fails closed while event coverage needs resynchronization', () => {
    const state = snapshot({
      runs: [run('live', 'running')],
      nodes: [canonicalNode('live'), typedRequestNode('live', 'question-1')],
      controls: [request('question-1', 'live')],
      needsResync: true,
    });

    expect(selectEventNativeActiveRunId(state, 'live')).toBeNull();
    expect(selectActionableInterruptedRun(state, 'live')).toBeNull();
  });

  it('allows an evidenced local interruption but not a blocked one', () => {
    const local = run('interrupted-local', 'interrupted');
    const blocked = run('interrupted-blocked', 'interrupted', {
      resumeBlockedReason: 'local_workspace_missing',
    });
    const state = snapshot({
      runs: [local, blocked],
      nodes: [
        canonicalNode(local.runId, 'run.interrupted'),
        canonicalNode(blocked.runId, 'run.interrupted'),
      ],
    });

    expect(selectActionableInterruptedRun(state, local.runId)).toBe(local);
    expect(selectActionableInterruptedRun(state, blocked.runId)).toBeNull();
  });
});
