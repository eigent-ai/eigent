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

function agentNode(
  runId: string,
  eventId: string,
  sequence: number,
  agentId: string,
  agentName: string,
  eventType = 'legacy.create_agent',
  title = agentName
): ChatActivityNode {
  return {
    ...baseNode(runId, eventId, sequence),
    eventType,
    legacyStep: eventType.startsWith('legacy.')
      ? eventType.replace('legacy.', '')
      : null,
    kind: 'activity',
    activityType: 'agent',
    status: 'running',
    title,
    agentId,
    agentName,
  };
}

function todoActivity(
  eventId: string,
  sequence: number,
  status: ChatActivityNode['status'],
  eventType: string,
  legacyStep: string | null = null
): ChatActivityNode {
  return {
    ...baseNode('run-current', eventId, sequence),
    eventType,
    legacyStep,
    kind: 'activity',
    activityType: 'tool',
    status,
    title: 'todo_write',
    toolName: 'todo_write',
    toolkitName: 'TodoToolkit',
    methodName: 'todo_write',
  };
}

function todoPlan(
  eventId: string,
  sequence: number,
  title: string
): ChatPlanNode {
  return {
    ...baseNode('run-current', eventId, sequence),
    eventType: 'legacy.todo_state',
    legacyStep: 'todo_state',
    kind: 'plan',
    tasks: [{ id: 'todo_1', title, status: 'running' }],
  };
}

function skillToolkitNode(
  eventId: string,
  sequence: number,
  status: ChatActivityNode['status'],
  methodName: 'list_skills' | 'load_skill',
  detail: string
): ChatActivityNode {
  const active = status === 'running';
  return {
    ...toolNode('run-current', eventId, sequence, status, detail),
    eventType: active ? 'legacy.activate_toolkit' : 'legacy.deactivate_toolkit',
    legacyStep: active ? 'activate_toolkit' : 'deactivate_toolkit',
    title: detail,
    toolkitName: 'SkillToolkit',
    methodName,
    toolName: undefined,
    toolCallId: undefined,
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
  it('deduplicates logical agents across Runs and skips anonymous tool frames', () => {
    const oldRun = makeRun('run-old', false, [
      agentNode(
        'run-old',
        'question-confirm',
        1,
        'confirm-agent-id',
        'question_confirm_agent'
      ),
      agentNode(
        'run-old',
        'single-agent-old',
        2,
        'single-agent-instance-a',
        'single_agent'
      ),
    ]);
    const currentRun = makeRun('run-current', true, [
      agentNode(
        'run-current',
        'single-agent-current',
        1,
        'single-agent-instance-b',
        'single_agent'
      ),
      {
        ...toolNode(
          'run-current',
          'named-tool-frame',
          2,
          'running',
          'Registering agent'
        ),
        agentId: undefined,
        agentName: 'single_agent',
      },
      {
        ...toolNode(
          'run-current',
          'anonymous-canonical-tool',
          3,
          'running',
          'Tool without agent identity'
        ),
        agentId: undefined,
        agentName: undefined,
      },
    ]);

    const data = buildProjectSessionPanelData([oldRun, currentRun], []);

    expect(data.agents).toMatchObject([
      {
        id: 'agent:singleagent',
        name: 'single_agent',
        historical: false,
        subagent: false,
      },
    ]);
  });

  it('classifies remote delegated agents separately from primary agents', () => {
    const run = makeRun('run-current', true, [
      agentNode(
        'run-current',
        'primary-agent',
        1,
        'primary-instance',
        'single_agent'
      ),
      agentNode(
        'run-current',
        'remote-agent',
        2,
        'remote-instance',
        'research_helper',
        'agent.remote_started',
        'Remote subagent research_helper'
      ),
    ]);

    expect(buildProjectSessionPanelData([run], []).agents).toMatchObject([
      { name: 'single_agent', type: 'agent', subagent: false },
      { name: 'research_helper', type: 'subagent', subagent: true },
    ]);
  });

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

  it('quarantines workspace-loaded todo state without a todo_write call', () => {
    const staleStartupPlan: ChatPlanNode = {
      ...baseNode('run-current', 'stale-todos', 2),
      eventType: 'legacy.todo_state',
      legacyStep: 'todo_state',
      kind: 'plan',
      tasks: [
        {
          id: 'todo_1',
          title: 'Task from a different Project',
          status: 'completed',
        },
      ],
    };

    expect(
      buildProjectSessionPanelData(
        [makeRun('run-current', true, [staleStartupPlan])],
        []
      ).progress
    ).toEqual([]);
  });

  it('accepts a real todo lifecycle without authorizing a later stale state', () => {
    const typedPlan: ChatPlanNode = {
      ...baseNode('run-current', 'typed-plan', 1),
      eventType: 'plan.created',
      kind: 'plan',
      tasks: [
        {
          id: 'plan-task',
          title: 'Typed plan task',
          status: 'running',
        },
      ],
    };
    const run = makeRun('run-current', true, [
      typedPlan,
      todoActivity('todo-prepared-1', 2, 'running', 'tool.prepared'),
      todoActivity('todo-completed-1', 3, 'completed', 'tool.completed'),
      todoActivity(
        'todo-activate-1',
        4,
        'running',
        'legacy.activate_toolkit',
        'activate_toolkit'
      ),
      todoPlan('todo-state-1', 5, 'First current task'),
      todoActivity(
        'todo-deactivate-1',
        6,
        'completed',
        'legacy.deactivate_toolkit',
        'deactivate_toolkit'
      ),
      todoPlan('unpaired-state', 7, 'Must stay quarantined'),
      todoActivity('todo-prepared-2', 8, 'running', 'tool.prepared'),
      todoPlan('todo-state-2', 9, 'Replacement current task'),
    ]);

    expect(buildProjectSessionPanelData([run], []).progress).toMatchObject([
      { task: { content: 'Typed plan task' } },
      { task: { content: 'Replacement current task' } },
    ]);
  });

  it('accepts legacy-only activate_toolkit followed by todo_state', () => {
    const run = makeRun('run-current', true, [
      todoActivity(
        'todo-activate',
        1,
        'running',
        'legacy.activate_toolkit',
        'activate_toolkit'
      ),
      todoPlan('todo-state', 2, 'Legacy current task'),
    ]);

    expect(buildProjectSessionPanelData([run], []).progress).toMatchObject([
      { task: { content: 'Legacy current task' } },
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

  it('shows only explicitly loaded skills and ignores skill discovery', () => {
    const availableSkills =
      "[{'name': 'skill-security-auditor', 'description': " +
      "'Security auditing for code, configs, and infrastructure.'}]";
    const run = makeRun('run-current', true, [
      skillToolkitNode(
        'list-start',
        1,
        'running',
        'list_skills',
        JSON.stringify({ message_title: 'List Skills' })
      ),
      skillToolkitNode(
        'list-end',
        2,
        'completed',
        'list_skills',
        availableSkills
      ),
      skillToolkitNode(
        'load-start',
        3,
        'running',
        'load_skill',
        JSON.stringify({ name: 'pdf', message_title: 'Load Skill' })
      ),
      skillToolkitNode(
        'load-end',
        4,
        'completed',
        'load_skill',
        '## Skill: pdf\n\n# PDF Processing Guide'
      ),
    ]);

    expect(buildProjectSessionPanelData([run], []).contextItems).toMatchObject([
      {
        id: 'skill:pdf',
        label: 'pdf',
        category: 'skill',
        historical: false,
      },
    ]);
  });

  it('extracts unique searched URLs without trailing punctuation', () => {
    expect(
      extractHttpUrls(
        'Read https://example.com/a, then https://example.com/a and https://docs.example.com/page).'
      )
    ).toEqual(['https://example.com/a', 'https://docs.example.com/page']);
  });
});
