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

import { groupRepeatedToolCalls } from '@/components/ChatBox/EventTimeline/activityGrouping';
import type { ChatProjectionNode } from '@/lib/projector/chat';
import { describe, expect, it } from 'vitest';

type ActivityNode = Extract<ChatProjectionNode, { kind: 'activity' }>;

function toolNode(
  id: string,
  overrides: Partial<ActivityNode> = {}
): ActivityNode {
  return {
    id,
    eventId: `event-${id}`,
    projectId: 'project-1',
    runId: 'run-1',
    createdAt: '2026-08-13T00:00:00Z',
    runSequence: 1,
    cloudCursor: null,
    eventType: 'tool.completed',
    legacyStep: null,
    kind: 'activity',
    activityType: 'tool',
    status: 'completed',
    title: 'WebFetchToolkit.Web_fetch_and_analyze',
    toolkitName: 'WebFetchToolkit',
    methodName: 'Web_fetch_and_analyze',
    agentId: 'agent-1',
    ...overrides,
  };
}

describe('groupRepeatedToolCalls', () => {
  it('groups exact consecutive calls while preserving the source nodes', () => {
    const nodes = [toolNode('one'), toolNode('two'), toolNode('three')];
    const rows = groupRepeatedToolCalls(nodes);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowKind: 'repeated-tool-calls',
      toolkitName: 'WebFetchToolkit',
      methodName: 'Web_fetch_and_analyze',
      status: 'completed',
    });
    if (rows[0]?.rowKind !== 'repeated-tool-calls') {
      throw new Error('Expected repeated tool group');
    }
    expect(rows[0].calls).toHaveLength(3);
    expect(nodes.map((node) => node.id)).toEqual(['one', 'two', 'three']);
  });

  it('uses FIFO lifecycle pairing when older events have no call id', () => {
    const rows = groupRepeatedToolCalls([
      toolNode('start-one', { eventType: 'tool.started', status: 'running' }),
      toolNode('start-two', { eventType: 'tool.started', status: 'running' }),
      toolNode('end-one'),
      toolNode('end-two'),
    ]);

    expect(rows).toHaveLength(1);
    if (rows[0]?.rowKind !== 'repeated-tool-calls') {
      throw new Error('Expected repeated tool group');
    }
    expect(rows[0].calls).toHaveLength(2);
    expect(rows[0].calls.map((call) => call.nodes.length)).toEqual([2, 2]);
  });

  it('does not group the same method across agents or runs', () => {
    const rows = groupRepeatedToolCalls([
      toolNode('agent-one'),
      toolNode('agent-two', { agentId: 'agent-2' }),
      toolNode('run-two', { agentId: 'agent-2', runId: 'run-2' }),
    ]);

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.rowKind === 'node')).toBe(true);
  });

  it('keeps different methods as independent rows', () => {
    const rows = groupRepeatedToolCalls([
      toolNode('fetch'),
      toolNode('write', {
        methodName: 'Todo_write',
        title: 'TodoToolkit.Todo_write',
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.rowKind === 'node')).toBe(true);
  });

  it('surfaces failure on an otherwise completed group', () => {
    const rows = groupRepeatedToolCalls([
      toolNode('complete'),
      toolNode('failed', { eventType: 'tool.failed', status: 'failed' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowKind: 'repeated-tool-calls',
      status: 'failed',
    });
  });
});
