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
  buildProjectSessionPanelData,
  collectSessionToolCalls,
  extractHttpUrls,
} from '@/components/Session/SidePanel/sections/buildProjectSessionPanelData';
import type { ProjectSessionRun } from '@/hooks/useProjectSessionOverview';
import type {
  ChatActivityNode,
  ChatArtifactNode,
  ChatPlanNode,
  ChatProjectionNode,
} from '@/lib/projector/chat';
import { describe, expect, it } from 'vitest';

function baseNode(
  runId: string,
  eventId: string,
  runSequence: number
): Omit<ChatProjectionNode, 'kind'> {
  return {
    id: eventId,
    eventId,
    projectId: 'project-1',
    runId,
    createdAt: new Date(runSequence * 1_000).toISOString(),
    runSequence,
    cloudCursor: null,
    eventType: 'test.event',
    legacyStep: null,
  } as Omit<ChatProjectionNode, 'kind'>;
}

function toolNode(
  runId: string,
  eventId: string,
  sequence: number,
  status: ChatActivityNode['status'],
  detail: string,
  toolCallId?: string
): ChatActivityNode {
  return {
    ...baseNode(runId, eventId, sequence),
    kind: 'activity',
    activityType: 'tool',
    status,
    title: 'Notion search',
    detail,
    agentId: 'agent-1',
    agentName: 'Research Agent',
    toolkitName: 'MCPToolkit',
    methodName: 'notion_search',
    toolCallId,
  };
}

function makeRun(
  runId: string,
  isCurrent: boolean,
  nodes: ChatProjectionNode[]
): ProjectSessionRun {
  return {
    runId,
    taskId: runId,
    status: isCurrent ? 'running' : 'completed',
    nodes,
    createdAt: isCurrent ? 2_000 : 1_000,
    updatedAt: isCurrent ? 20_000 : 10_000,
    isCurrent,
  };
}

describe('buildProjectSessionPanelData', () => {
  it('pairs semantic tool lifecycle events by durable call id', () => {
    const run = makeRun('run-1', true, [
      toolNode('run-1', 'tool-start', 1, 'running', 'Searching', 'call-1'),
      toolNode('run-1', 'tool-end', 2, 'completed', '3 results', 'call-1'),
    ]);

    expect(collectSessionToolCalls([run])).toMatchObject([
      {
        id: 'call-1',
        toolkitName: 'MCPToolkit',
        method: 'notion_search',
        input: 'Searching',
        output: '3 results',
        status: 'done',
        taskId: 'run-1',
      },
    ]);
  });

  it('scopes durable call ids to their owning Run', () => {
    const current = makeRun('run-current', true, [
      toolNode(
        'run-current',
        'current-start',
        1,
        'running',
        'current input',
        'call-1'
      ),
      toolNode(
        'run-current',
        'current-end',
        2,
        'completed',
        'current output',
        'call-1'
      ),
    ]);
    const historical = makeRun('run-old', false, [
      toolNode('run-old', 'old-start', 1, 'running', 'old input', 'call-1'),
      toolNode('run-old', 'old-end', 2, 'completed', 'old output', 'call-1'),
    ]);

    expect(collectSessionToolCalls([current, historical])).toMatchObject([
      { taskId: 'run-old', input: 'old input', output: 'old output' },
      {
        taskId: 'run-current',
        input: 'current input',
        output: 'current output',
      },
    ]);
  });

  it('uses FIFO fallback for older tool frames without correlation ids', () => {
    const run = makeRun('run-1', true, [
      toolNode('run-1', 'start-1', 1, 'running', 'first'),
      toolNode('run-1', 'start-2', 2, 'running', 'second'),
      toolNode('run-1', 'end-1', 3, 'completed', 'first result'),
      toolNode('run-1', 'end-2', 4, 'completed', 'second result'),
    ]);

    expect(collectSessionToolCalls([run])).toMatchObject([
      { input: 'first', output: 'first result', status: 'done' },
      { input: 'second', output: 'second result', status: 'done' },
    ]);
  });

  it('projects plans, artifacts and safe URL resources across Runs', () => {
    const plan: ChatPlanNode = {
      ...baseNode('run-current', 'plan', 3),
      kind: 'plan',
      tasks: [{ id: 'task-1', title: 'Build report', status: 'running' }],
    };
    const artifact: ChatArtifactNode = {
      ...baseNode('run-current', 'artifact', 4),
      kind: 'artifact',
      operation: 'created',
      path: 'outputs/report.md',
      name: 'report.md',
    };
    const current = makeRun('run-current', true, [plan, artifact]);
    const historical = makeRun('run-old', false, [
      {
        ...baseNode('run-old', 'message', 1),
        kind: 'message',
        role: 'assistant',
        content: 'Read https://old.example.com/research.',
        status: 'complete',
      },
    ]);

    const data = buildProjectSessionPanelData([current, historical], []);

    expect(data.progress).toMatchObject([
      {
        taskId: 'run-current',
        historical: false,
        task: { id: 'task-1', content: 'Build report', status: 'running' },
      },
    ]);
    expect(data.files).toMatchObject([
      {
        id: 'outputs/report.md',
        taskId: 'run-current',
        historical: false,
        file: { name: 'report.md', artifactChange: 'generated' },
      },
    ]);
    expect(data.resources).toMatchObject([
      { taskId: 'run-old', historical: true },
    ]);
  });

  it('uses connector identity without reading a raw event payload', () => {
    const current = makeRun('run-current', true, [
      toolNode(
        'run-current',
        'tool-start',
        1,
        'running',
        'roadmap',
        'notion-call'
      ),
      toolNode(
        'run-current',
        'tool-end',
        2,
        'completed',
        'done',
        'notion-call'
      ),
    ]);

    const data = buildProjectSessionPanelData(
      [current],
      [],
      [
        {
          service: 'notion',
          displayName: 'Notion',
          iconUrl: 'https://cdn.example.com/notion.svg',
          actions: [{ id: 'notion_search', name: 'Search Notion' }],
        },
      ]
    );

    expect(data.contextItems).toMatchObject([
      {
        id: 'connector:notion',
        label: 'Notion',
        iconUrl: 'https://cdn.example.com/notion.svg',
        historical: false,
        calls: [{ id: 'notion-call' }],
      },
    ]);
    expect(JSON.stringify(data)).not.toContain('__legacy_data');
  });

  it('extracts unique searched URLs without trailing punctuation', () => {
    expect(
      extractHttpUrls(
        'Read https://example.com/a, then https://example.com/a and https://docs.example.com/page).'
      )
    ).toEqual(['https://example.com/a', 'https://docs.example.com/page']);
  });
});
