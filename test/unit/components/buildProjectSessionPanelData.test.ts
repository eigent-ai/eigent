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
  mergeProjectFiles,
} from '@/components/Session/SidePanel/sections/buildProjectSessionPanelData';
import type { ProjectSessionRun } from '@/hooks/useProjectSessionOverview';
import { normalizeLegacyChatStep } from '@/lib/projector';
import {
  adaptChatProjectionEvent,
  type ChatActivityNode,
  type ChatArtifactNode,
  type ChatPlanNode,
  type ChatProjectionNode,
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

  it('projects one subagent per durable tool call and preserves provider identity', () => {
    const subagentNode = (
      eventId: string,
      sequence: number,
      eventType: string,
      toolCallId: string,
      subagentType: string,
      agentProvider?: string,
      stepId = 'shared-authored-step',
      subagentName?: string,
      subagentAgentId?: string
    ): ChatActivityNode => ({
      ...baseNode('run-current', eventId, sequence),
      eventType,
      kind: 'activity',
      activityType: 'tool',
      status: eventType.endsWith('completed') ? 'completed' : 'running',
      title: `Started ${subagentType} sub-agent`,
      input: `Task: ${subagentType}`,
      toolName: 'agent_run_subagent',
      toolkitName: 'AgentToolkit',
      toolCallId,
      stepId,
      subagentType,
      subagentName,
      subagentAgentId,
      subagentInvocation: true,
      agentProvider,
    });
    const run = makeRun('run-current', true, [
      subagentNode(
        'local-prepared',
        1,
        'tool.prepared',
        'local-subagent-call',
        'analysis'
      ),
      subagentNode(
        'local-completed',
        2,
        'tool.completed',
        'local-subagent-call',
        'analysis',
        undefined,
        'shared-authored-step',
        'Analysis Agent',
        'child-agent-local'
      ),
      subagentNode(
        'remote-dispatched',
        3,
        'tool.dispatched',
        'remote-subagent-call',
        'researcher',
        'gemini_agents',
        'shared-authored-step',
        'Research Agent',
        'child-agent-1'
      ),
    ]);

    expect(buildProjectSessionPanelData([run], []).agents).toMatchObject([
      {
        id: 'subagent:localsubagentcall',
        name: 'Analysis Agent',
        subagent: true,
        avatarSeed: 'local-subagent-call',
        tools: ['AgentToolkit'],
      },
      {
        id: 'subagent:remotesubagentcall',
        name: 'Research Agent',
        subagent: true,
        provider: 'gemini_agents',
        avatarSeed: 'remote-subagent-call',
        tools: ['AgentToolkit'],
      },
    ]);
  });

  it('keeps ordinary remote-named toolkits on their owning agent', () => {
    const remoteSearch = {
      ...toolNode(
        'run-current',
        'remote-search',
        1,
        'completed',
        'Searched a remote index',
        'remote-search-call'
      ),
      toolkitName: 'RemoteSearchToolkit',
      methodName: 'search',
    };

    expect(
      buildProjectSessionPanelData(
        [makeRun('run-current', true, [remoteSearch])],
        []
      ).agents
    ).toMatchObject([
      {
        name: 'Research Agent',
        subagent: false,
        tools: ['RemoteSearchToolkit'],
      },
    ]);
  });

  it('collects terminal, browser, and remote execution environments', () => {
    const terminal: ChatActivityNode = {
      ...baseNode('run-current', 'terminal', 1),
      kind: 'activity',
      activityType: 'terminal',
      status: 'running',
      title: 'Run shell command',
    };
    const browser = {
      ...toolNode('run-current', 'browser', 2, 'running', 'Open page'),
      toolkitName: 'BrowserToolkit',
      methodName: 'browser_navigate',
    };
    const remote = agentNode(
      'run-current',
      'remote',
      3,
      'remote-agent',
      'research_helper',
      'agent.remote_started',
      'Remote subagent research_helper'
    );

    expect(
      buildProjectSessionPanelData(
        [makeRun('run-current', true, [terminal, browser, remote])],
        []
      ).environments.map((item) => item.label)
    ).toEqual(['Browser', 'Remote environment', 'Terminal']);
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
      relativePath: 'outputs/report.md',
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
        previewable: false,
        taskId: 'run-current',
        historical: false,
        file: { name: 'report.md', artifactChange: 'generated' },
      },
    ]);
    expect(data.resources).toMatchObject([
      { taskId: 'run-old', historical: true },
    ]);
  });

  it('maps terminal task activity statuses into side-panel task statuses', () => {
    const nodes = (
      [
        ['timed-out', 'timed_out'],
        ['unknown-outcome', 'outcome_unknown'],
        ['cancelled', 'cancelled'],
      ] as const
    ).map(([taskId, status], index): ChatActivityNode => ({
      ...baseNode('run-current', `task-${taskId}`, index + 1),
      kind: 'activity',
      activityType: 'task',
      status,
      title: taskId,
      taskId,
    }));

    expect(
      buildProjectSessionPanelData(
        [makeRun('run-current', true, nodes)],
        []
      ).progress.map((item) => item.task.status)
    ).toEqual(['failed', 'blocked', 'skipped']);
  });

  it('uses durable artifact identity and only enriches matching project files', () => {
    const created: ChatArtifactNode = {
      ...baseNode('run-current', 'artifact-created', 1),
      kind: 'artifact',
      operation: 'created',
      artifactId: 'artifact-1',
      relativePath: 'outputs/report.md',
      path: '/private/workspace/outputs/report.md',
      name: 'report.md',
    };
    const updated: ChatArtifactNode = {
      ...baseNode('run-current', 'artifact-updated', 2),
      kind: 'artifact',
      operation: 'updated',
      artifactId: 'artifact-1',
      relativePath: './outputs\\report.md',
      path: '/different-machine/workspace/outputs/report.md',
      name: 'report.md',
    };
    const data = buildProjectSessionPanelData(
      [makeRun('run-current', true, [created, updated])],
      []
    );

    const merged = mergeProjectFiles(data.files, [
      {
        name: 'report.md',
        type: 'md',
        path: 'https://files.example.test/outputs/report.md',
        relativePath: 'outputs/report.md',
        artifactId: 'artifact-1',
        isRemote: true,
      },
      {
        name: 'unrelated.txt',
        type: 'txt',
        path: '/workspace/unrelated.txt',
        relativePath: 'unrelated.txt',
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'artifact-1',
      previewable: true,
      taskId: 'run-current',
      file: {
        artifactId: 'artifact-1',
        relativePath: 'outputs/report.md',
        path: 'https://files.example.test/outputs/report.md',
        artifactChange: 'changed',
      },
    });
  });

  it('does not enrich by basename or an unsafe relative path', () => {
    const item = buildProjectSessionPanelData(
      [
        makeRun('run-current', true, [
          {
            ...baseNode('run-current', 'artifact', 1),
            kind: 'artifact',
            operation: 'created',
            path: 'reports/quarterly/report.md',
            relativePath: 'reports/quarterly/report.md',
            name: 'report.md',
          },
        ]),
      ],
      []
    ).files[0];

    const merged = mergeProjectFiles(
      [item],
      [
        {
          name: 'report.md',
          type: 'md',
          path: '/workspace/archive/report.md',
          relativePath: 'archive/report.md',
        },
        {
          name: 'report.md',
          type: 'md',
          path: '/outside/report.md',
          relativePath: '../report.md',
        },
      ]
    );

    expect(merged).toEqual([item]);
  });

  it('does not turn a display-only basename into durable file identity', () => {
    const decision = adaptChatProjectionEvent(
      normalizeLegacyChatStep(
        {
          step: 'write_file',
          data: {
            file_path: '/Users/me/eigent/proj/reports/summary.md',
          },
        },
        {
          projectId: 'project-1',
          runId: 'run-current',
          sequence: 1,
          sourceId: 'legacy-stream',
          createdAt: 1_000,
        }
      )
    );
    expect(decision).toMatchObject({
      kind: 'display',
      node: {
        kind: 'artifact',
        path: 'summary.md',
        relativePath: undefined,
      },
    });
    if (decision.kind !== 'display') throw new Error('Expected artifact node');

    const data = buildProjectSessionPanelData(
      [makeRun('run-current', true, [decision.node])],
      []
    );

    expect(data.files).toEqual([]);
    expect(
      mergeProjectFiles(data.files, [
        {
          name: 'summary.md',
          type: 'md',
          path: '/workspace/summary.md',
          relativePath: 'summary.md',
        },
      ])
    ).toEqual([]);
  });

  it('shows a trusted realtime write and converges on its terminal artifact', () => {
    const liveDecision = adaptChatProjectionEvent(
      normalizeLegacyChatStep(
        {
          step: 'write_file',
          data: {
            file_path: '/private/run/reports/summary.md',
            relative_path: 'reports/summary.md',
          },
        },
        {
          projectId: 'project-1',
          runId: 'run-current',
          sequence: 1,
          sourceId: 'legacy-stream',
          createdAt: 1_000,
        }
      )
    );
    expect(liveDecision).toMatchObject({
      kind: 'display',
      node: {
        kind: 'artifact',
        path: 'reports/summary.md',
        relativePath: 'reports/summary.md',
      },
    });
    if (liveDecision.kind !== 'display') {
      throw new Error('Expected artifact node');
    }

    const liveData = buildProjectSessionPanelData(
      [makeRun('run-current', true, [liveDecision.node])],
      []
    );
    expect(liveData.files).toMatchObject([
      {
        id: 'reports/summary.md',
        previewable: false,
        taskId: 'run-current',
        file: { relativePath: 'reports/summary.md' },
      },
    ]);

    const terminalArtifact: ChatArtifactNode = {
      ...baseNode('run-current', 'artifact-terminal', 2),
      eventType: 'artifact.created',
      kind: 'artifact',
      operation: 'created',
      artifactId: 'artifact-summary',
      path: 'reports/summary.md',
      relativePath: 'reports/summary.md',
      name: 'summary.md',
    };
    const finalized = buildProjectSessionPanelData(
      [makeRun('run-current', true, [liveDecision.node, terminalArtifact])],
      []
    );

    expect(finalized.files).toHaveLength(1);
    expect(finalized.files[0]).toMatchObject({
      id: 'artifact-summary',
      file: {
        artifactId: 'artifact-summary',
        relativePath: 'reports/summary.md',
      },
    });
    expect(
      mergeProjectFiles(finalized.files, [
        {
          name: 'summary.md',
          type: 'md',
          path: '/workspace/reports/summary.md',
          relativePath: 'reports/summary.md',
        },
      ])
    ).toMatchObject([
      {
        previewable: true,
        file: { path: '/workspace/reports/summary.md' },
      },
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

  it('preserves legacy tool lifecycle status through the shipping bridge', () => {
    const rawSteps = [
      {
        step: 'activate_toolkit',
        data: {
          toolkit_name: 'TodoToolkit',
          method_name: 'todo_write',
          tool_name: 'todo_write',
          message: '{"todos":["first","second"]}',
        },
      },
      {
        step: 'todo_state',
        data: {
          todos: [
            { id: 'todo-1', content: 'First task', status: 'in_progress' },
            { id: 'todo-2', content: 'Second task', status: 'pending' },
          ],
        },
      },
      {
        step: 'deactivate_toolkit',
        data: {
          toolkit_name: 'TodoToolkit',
          method_name: 'todo_write',
          tool_name: 'todo_write',
          message: 'Todos updated',
        },
      },
    ];
    const nodes = rawSteps.flatMap((raw, index) => {
      const decision = adaptChatProjectionEvent(
        normalizeLegacyChatStep(raw, {
          projectId: 'project-1',
          runId: 'run-current',
          sequence: index + 1,
          sourceId: 'test-stream',
          createdAt: (index + 1) * 1_000,
        })
      );
      return decision.kind === 'display' ? [decision.node] : [];
    });

    expect(
      nodes.map((node) => ('status' in node ? node.status : undefined))
    ).toEqual(['running', undefined, 'completed']);

    const data = buildProjectSessionPanelData(
      [makeRun('run-current', true, nodes)],
      []
    );
    expect(data.progress.map((item) => item.task.content)).toEqual([
      'First task',
      'Second task',
    ]);
    expect(data.toolCalls).toMatchObject([
      {
        toolkitName: 'TodoToolkit',
        method: 'todo_write',
        input: '{"todos":["first","second"]}',
        output: 'Todos updated',
        status: 'done',
      },
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

  it('collects search URLs from presentation-safe activity output', () => {
    const search = {
      ...toolNode(
        'run-current',
        'search-completed',
        1,
        'completed',
        'Completed search',
        'search-call'
      ),
      title: 'Search',
      toolName: 'search_querit',
      output:
        'Sources: https://example.com/news https://docs.example.com/releases',
    };

    expect(
      buildProjectSessionPanelData([makeRun('run-current', true, [search])], [])
        .resources
    ).toMatchObject([
      { url: 'https://example.com/news', historical: false },
      { url: 'https://docs.example.com/releases', historical: false },
    ]);
  });
});
