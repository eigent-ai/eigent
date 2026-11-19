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
  advanceReplayProjection,
  composeReplayRuns,
} from '@/components/Session/SessionReplay/replayProjection';
import { selectRenderableChatNodes } from '@/lib/projector/chat';
import { buildReplayMarkers } from '@/lib/sessionReplay/replayMarkers';
import { describe, expect, it } from 'vitest';

import { finishedRun, runEvent } from './fixtures';

describe('buildReplayMarkers', () => {
  it('marks approvals, errors and final answers at their play-head position', () => {
    const events = [
      ...finishedRun('run-1'),
      runEvent('user.message', { content: 'Try again' }, 1, {
        runId: 'run-2',
      }),
      runEvent('run.failed', { reason: 'boom' }, 2, { runId: 'run-2' }),
    ];
    const markers = buildReplayMarkers(events);
    expect(markers.map((marker) => [marker.kind, marker.position])).toEqual([
      ['approval', 4],
      ['final', 6],
      ['error', 9],
    ]);
  });

  it('marks a question that is not an approval', () => {
    const markers = buildReplayMarkers([
      runEvent(
        'interaction.requested',
        {
          interaction_id: 'ask-1',
          interaction_type: 'question',
          question: 'Which format?',
        },
        1
      ),
    ]);
    expect(markers).toEqual([
      { kind: 'question', position: 1, eventId: 'run-1:1' },
    ]);
  });
});

describe('advanceReplayProjection', () => {
  const events = finishedRun();

  it('projects only the visible prefix', () => {
    const projection = advanceReplayProjection(null, 'project-1', events, 2);
    const nodes = selectRenderableChatNodes(projection.chat);
    expect(nodes.map((node) => node.eventId)).toEqual(['run-1:1', 'run-1:2']);
    expect(projection.view.runs['run-1']?.status).not.toBe('completed');
  });

  it('moving forward matches projecting from scratch', () => {
    const step = advanceReplayProjection(
      advanceReplayProjection(null, 'project-1', events, 3),
      'project-1',
      events,
      events.length
    );
    const full = advanceReplayProjection(
      null,
      'project-1',
      events,
      events.length
    );
    expect(step.chat.nodes).toEqual(full.chat.nodes);
    expect(step.view.runs).toEqual(full.view.runs);
    expect(full.view.runs['run-1']?.status).toBe('completed');
  });

  it('moving back starts again and drops later events', () => {
    const end = advanceReplayProjection(
      null,
      'project-1',
      events,
      events.length
    );
    const back = advanceReplayProjection(end, 'project-1', events, 2);
    expect(back.position).toBe(2);
    expect(
      selectRenderableChatNodes(back.chat).map((node) => node.eventId)
    ).toEqual(['run-1:1', 'run-1:2']);
  });

  it('returns the same projection when nothing moved', () => {
    const first = advanceReplayProjection(null, 'project-1', events, 3);
    expect(advanceReplayProjection(first, 'project-1', events, 3)).toBe(first);
  });

  it('times an unfinished Run to the last event shown, not the wall clock', () => {
    const projection = advanceReplayProjection(null, 'project-1', events, 3);
    const [run] = composeReplayRuns(projection);
    expect(run.status).not.toBe('completed');
    // Events 1 and 3 are two seconds apart in the fixture.
    expect(run.timestamps.durationMs).toBe(2000);
    expect(run.timestamps.elapsedAnchor).toBeNull();
  });

  it('composes renderer Runs with the request and final answer', () => {
    const projection = advanceReplayProjection(
      null,
      'project-1',
      events,
      events.length
    );
    const [run] = composeReplayRuns(projection);
    expect(run.runId).toBe('run-1');
    expect(run.userQuery?.content).toBe('Write the report');
    expect(run.status).toBe('completed');
  });
});
