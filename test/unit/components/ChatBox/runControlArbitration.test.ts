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
  canUseLegacyControlWithoutCanonicalOwner,
  selectActionableInterruptedRun,
  selectComposerTaskControlState,
  selectEventNativeActiveRunId,
} from '@/components/ChatBox/runControlArbitration';
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
import { ChatTaskStatus } from '@/types/constants';
import { describe, expect, it } from 'vitest';

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

function request(
  interactionId: string,
  runId: string,
  requestEventType = 'interaction.requested'
) {
  return {
    interactionId,
    runId,
    status: 'requested',
    requestSource: 'canonical',
    requestEventId: `${runId}:${requestEventType}`,
    requestEventType,
  } as HumanControlInteraction;
}

function snapshot({
  runs,
  nodes = [],
  controls = [],
  needsResync = false,
  eventsTruncated = false,
  overflowed = false,
  hasHydratedSnapshot = true,
}: {
  runs: ProjectedRun[];
  nodes?: ChatProjectionNode[];
  controls?: HumanControlInteraction[];
  needsResync?: boolean;
  eventsTruncated?: boolean;
  overflowed?: boolean;
  hasHydratedSnapshot?: boolean;
}): ProjectEventStoreSnapshot {
  const view = createProjectViewState('project-1', 'live');
  const chat = createChatProjectionState('project-1');
  const control = createHumanControlProjectionState('project-1');
  return {
    view: {
      ...view,
      needsResync,
      eventsTruncated,
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
    revision: 1,
    hasHydratedSnapshot,
    overflowed,
    lastEffects: [],
  };
}

describe('event-native Run-control arbitration', () => {
  it('uses legacy control only when no safe canonical owner is retained', () => {
    expect(canUseLegacyControlWithoutCanonicalOwner(null, 'legacy-live')).toBe(
      true
    );
    expect(
      canUseLegacyControlWithoutCanonicalOwner(
        snapshot({ runs: [run('legacy-live', 'running')] }),
        'legacy-live'
      )
    ).toBe(true);
    expect(
      canUseLegacyControlWithoutCanonicalOwner(
        snapshot({
          runs: [run('legacy-live', 'running')],
          nodes: [canonicalNode('legacy-live')],
        }),
        'legacy-live'
      )
    ).toBe(false);
    expect(
      canUseLegacyControlWithoutCanonicalOwner(
        snapshot({
          runs: [run('legacy-live', 'running')],
          eventsTruncated: true,
        }),
        'legacy-live'
      )
    ).toBe(false);
  });

  it('exposes Project-scoped pause only when the legacy task owns the selected Run', () => {
    expect(
      selectComposerTaskControlState({
        eventNativeTimelineEnabled: true,
        legacyControlRunId: 'legacy-live',
        activeTaskStatus: ChatTaskStatus.RUNNING,
        eventNativeActiveRunId: 'typed-input',
      })
    ).toBe('idle');
    expect(
      selectComposerTaskControlState({
        eventNativeTimelineEnabled: true,
        legacyControlRunId: 'legacy-live',
        activeTaskStatus: ChatTaskStatus.RUNNING,
        eventNativeActiveRunId: 'legacy-live',
      })
    ).toBe('running');
    expect(
      selectComposerTaskControlState({
        eventNativeTimelineEnabled: true,
        legacyControlRunId: 'legacy-live',
        activeTaskStatus: ChatTaskStatus.PAUSE,
        eventNativeActiveRunId: 'legacy-live',
      })
    ).toBe('paused');
    expect(
      selectComposerTaskControlState({
        eventNativeTimelineEnabled: true,
        legacyControlRunId: null,
        activeTaskStatus: ChatTaskStatus.RUNNING,
        eventNativeActiveRunId: 'legacy-live',
      })
    ).toBe('idle');
    expect(
      selectComposerTaskControlState({
        eventNativeTimelineEnabled: true,
        legacyControlRunId: 'legacy-live',
        activeTaskStatus: ChatTaskStatus.RUNNING,
        eventNativeActiveRunId: null,
      })
    ).toBe('idle');
    expect(
      selectComposerTaskControlState({
        eventNativeTimelineEnabled: true,
        legacyControlRunId: 'legacy-live',
        activeTaskStatus: ChatTaskStatus.RUNNING,
        eventNativeActiveRunId: null,
        allowLegacyFallbackControl: true,
      })
    ).toBe('running');
  });

  it('lets a typed pending control outrank the legacy-owned live Run', () => {
    const state = snapshot({
      runs: [run('legacy-live', 'running'), run('input', 'waiting_for_user')],
      nodes: [canonicalNode('legacy-live')],
      controls: [request('question-1', 'input')],
    });

    expect(selectEventNativeActiveRunId(state, 'legacy-live')).toBe('input');
  });

  it('does not give aggregate-only or orphan historical Runs controls', () => {
    expect(
      selectEventNativeActiveRunId(
        snapshot({ runs: [run('past', 'running')] }),
        'past'
      )
    ).toBeNull();
    expect(
      selectEventNativeActiveRunId(
        snapshot({
          runs: [run('past', 'running')],
          nodes: [canonicalNode('past')],
        }),
        null
      )
    ).toBeNull();
  });

  it('fails closed for truncated, resyncing, overflowed, and gapped state', () => {
    const pending = run('input', 'waiting_for_user');
    const controls = [request('question-1', 'input')];
    expect(
      selectEventNativeActiveRunId(
        snapshot({ runs: [pending], controls, eventsTruncated: true }),
        null
      )
    ).toBeNull();
    expect(
      selectEventNativeActiveRunId(
        snapshot({ runs: [pending], controls, needsResync: true }),
        null
      )
    ).toBeNull();
    expect(
      selectEventNativeActiveRunId(
        snapshot({ runs: [pending], controls, overflowed: true }),
        null
      )
    ).toBeNull();
    expect(
      selectEventNativeActiveRunId(
        snapshot({
          runs: [run('input', 'waiting_for_user', { lastSequence: 1 })],
          controls,
        }),
        null
      )
    ).toBeNull();
  });

  it('does not treat a canonical-envelope legacy ASK as typed authority', () => {
    const state = snapshot({
      runs: [run('input', 'waiting_for_user')],
      controls: [request('question-1', 'input', 'legacy.step')],
    });

    expect(selectEventNativeActiveRunId(state, null)).toBeNull();
  });

  it('allows only evidenced, actionable local interruptions', () => {
    const local = run('local', 'interrupted');
    const blocked = run('blocked', 'interrupted', {
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
