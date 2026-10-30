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

import { buildProjectSessionOverview } from '@/hooks/useProjectSessionOverview';
import {
  createChatProjectionState,
  type ChatMessageNode,
} from '@/lib/projector/chat';
import {
  createHumanControlProjectionState,
  type HumanControlProjectionState,
} from '@/lib/projector/control';
import type { ProjectEventStoreSnapshot } from '@/store/projectEventStore';
import { describe, expect, it } from 'vitest';

function message(
  runId: string,
  sequence: number,
  createdAt = new Date(sequence * 1_000).toISOString()
): ChatMessageNode {
  return {
    id: `${runId}:${sequence}`,
    eventId: `${runId}:${sequence}`,
    projectId: 'project-1',
    runId,
    createdAt,
    runSequence: sequence,
    cloudCursor: null,
    eventType: 'message.completed',
    legacyStep: null,
    kind: 'message',
    role: 'assistant',
    content: runId,
    status: 'complete',
  };
}

function snapshot(): ProjectEventStoreSnapshot {
  const nodes = [message('run-complete', 4), message('run-live', 1)];
  return {
    view: {
      projectId: 'project-1',
      mode: 'live',
      seenEventIds: {},
      currentCursor: 0,
      eventsTruncated: false,
      lastSyncedAt: null,
      needsResync: false,
      resyncReason: null,
      resyncTargetCursor: null,
      runs: {
        'run-complete': {
          runId: 'run-complete',
          status: 'completed',
          lastSequence: 4,
          runVersion: 4,
          updatedAt: new Date(4_000).toISOString(),
          origin: 'local',
          resumeBlockedReason: null,
        },
        'run-live': {
          runId: 'run-live',
          status: 'running',
          lastSequence: 1,
          runVersion: 1,
          updatedAt: new Date(1_000).toISOString(),
          origin: 'local',
          resumeBlockedReason: null,
        },
      },
      legacySteps: [],
      unknownEvents: [],
    },
    chat: {
      ...createChatProjectionState('project-1'),
      nodes,
      nodeById: Object.fromEntries(nodes.map((node) => [node.id, node])),
      seenEventIds: Object.fromEntries(
        nodes.map((node) => [node.eventId, true as const])
      ),
    },
    control: createHumanControlProjectionState(
      'project-1'
    ) as HumanControlProjectionState,
    revision: 1,
    hasHydratedSnapshot: true,
    overflowed: false,
    lastEffects: [],
  };
}

describe('buildProjectSessionOverview', () => {
  it('keeps an active durable Run current even when history is newer', () => {
    const overview = buildProjectSessionOverview(snapshot());

    expect(overview.currentRun?.runId).toBe('run-live');
    expect(overview.historicalRuns.map((run) => run.runId)).toContain(
      'run-complete'
    );
  });

  it('groups semantic nodes by Run without consulting ChatStore', () => {
    const overview = buildProjectSessionOverview(snapshot());

    expect(overview.runs).toHaveLength(2);
    expect(
      overview.runs.find((run) => run.runId === 'run-complete')?.nodes
    ).toMatchObject([{ content: 'run-complete' }]);
  });

  it('keeps canonical Run sequence order when timestamps are reversed', () => {
    const input = snapshot();
    const nodes = [
      message('run-live', 2, new Date(1_000).toISOString()),
      message('run-live', 1, new Date(2_000).toISOString()),
    ];
    input.chat.nodes = nodes;
    input.chat.nodeById = Object.fromEntries(
      nodes.map((node) => [node.id, node])
    );
    input.chat.seenEventIds = Object.fromEntries(
      nodes.map((node) => [node.eventId, true as const])
    );

    const overview = buildProjectSessionOverview(input);

    expect(overview.currentRun?.nodes.map((node) => node.runSequence)).toEqual([
      1, 2,
    ]);
  });

  it('returns an empty view before durable hydration has a snapshot', () => {
    expect(buildProjectSessionOverview(null)).toEqual({
      currentRun: null,
      historicalRuns: [],
      runs: [],
    });
  });
});
