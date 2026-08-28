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
  composeTimelineRuns,
  humanCallTitle,
  interactionFamily,
  segmentTimelineRows,
  segmentTimelineRun,
  toTimelineCall,
  type TimelineSegment,
} from '@/lib/projector/chat/presentation';
import type {
  ChatMessageNode,
  ChatProjectionNode,
} from '@/lib/projector/chat/types';
import { beforeEach, describe, expect, it } from 'vitest';

const base = {
  projectId: 'project-1',
  runId: 'run-1',
  cloudCursor: 1,
  legacyStep: null,
} as const;

let sequence = 0;

function narration(content: string, agentName?: string): ChatMessageNode {
  sequence += 1;
  const id = `narration-${sequence}`;
  return {
    ...base,
    kind: 'message',
    id,
    eventId: id,
    eventType: 'message.completed',
    runSequence: sequence,
    createdAt: `2026-08-19T00:00:${String(sequence).padStart(2, '0')}Z`,
    role: 'assistant',
    purpose: 'narration',
    status: 'complete',
    content,
    agentName,
  };
}

function tool(
  toolkitName: string,
  methodName: string,
  overrides: Partial<Extract<ChatProjectionNode, { kind: 'activity' }>> = {}
): ChatProjectionNode {
  sequence += 1;
  const id = `tool-${sequence}`;
  return {
    ...base,
    kind: 'activity',
    id,
    eventId: id,
    eventType: 'tool.completed',
    runSequence: sequence,
    createdAt: `2026-08-19T00:00:${String(sequence).padStart(2, '0')}Z`,
    activityType: 'tool',
    phase: 'completed',
    status: 'completed',
    title: `${toolkitName} · ${methodName}`,
    toolCallId: id,
    toolkitName,
    methodName,
    ...overrides,
  } as ChatProjectionNode;
}

function interaction(
  interactionType: string,
  overrides: Partial<Extract<ChatProjectionNode, { kind: 'interaction' }>> = {}
): ChatProjectionNode {
  sequence += 1;
  const id = `interaction-${sequence}`;
  return {
    ...base,
    kind: 'interaction',
    id,
    eventId: id,
    eventType: 'interaction.resolved',
    runSequence: sequence,
    createdAt: `2026-08-19T00:00:${String(sequence).padStart(2, '0')}Z`,
    interactionId: id,
    interactionType,
    status: 'responded',
    prompt: 'Proceed?',
    response: 'approved',
    ...overrides,
  } as ChatProjectionNode;
}

function notice(content: string, toolCallId?: string): ChatProjectionNode {
  sequence += 1;
  const id = `notice-${sequence}`;
  return {
    ...base,
    kind: 'notice',
    id,
    eventId: id,
    eventType: 'legacy.notice',
    legacyStep: 'notice',
    runSequence: sequence,
    createdAt: `2026-08-19T00:00:${String(sequence).padStart(2, '0')}Z`,
    severity: 'info',
    content,
    toolCallId,
  };
}

function step(
  stepId: string,
  status: Extract<ChatProjectionNode, { kind: 'step' }>['status'],
  overrides: Partial<Extract<ChatProjectionNode, { kind: 'step' }>> = {}
): ChatProjectionNode {
  sequence += 1;
  const id = `step-${sequence}`;
  return {
    ...base,
    kind: 'step',
    id,
    eventId: id,
    eventType: `step.${status === 'running' ? 'started' : status}`,
    runSequence: sequence,
    createdAt: `2026-08-19T00:00:${String(sequence).padStart(2, '0')}Z`,
    stepId,
    title: 'Inspect the workspace',
    status,
    phase:
      status === 'pending'
        ? 'requested'
        : status === 'running'
          ? 'started'
          : status,
    source: 'authored',
    ...overrides,
  } as ChatProjectionNode;
}

function segmentsOf(nodes: ChatProjectionNode[]) {
  const [run] = composeTimelineRuns(nodes);
  return segmentTimelineRows(run!.traceRows);
}

function narrativeItemsOf(nodes: ChatProjectionNode[]) {
  const [run] = composeTimelineRuns(nodes);
  return segmentTimelineRun(run!);
}

function onlySegments(nodes: ChatProjectionNode[]): TimelineSegment[] {
  return segmentsOf(nodes).filter(
    (item): item is TimelineSegment => item.kind === 'segment'
  );
}

describe('timeline segmentation', () => {
  beforeEach(() => {
    sequence = 0;
  });

  it('groups a narration with the calls that followed it', () => {
    const segments = onlySegments([
      narration('I will inspect the repository.'),
      tool('File Toolkit', 'read_file'),
      tool('File Toolkit', 'read_file'),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.narration).toBe('I will inspect the repository.');
    expect(segments[0]!.calls).toHaveLength(2);
    expect(segments[0]!.label).toBe('Read · 2 actions');
    expect(segments[0]!.boundaryReason).toBe('narration');
  });

  it('keeps plans out of Chat and hides duplicate plan tool lifecycles', () => {
    const firstPlan: ChatProjectionNode = {
      ...base,
      kind: 'plan',
      id: 'plan-1',
      eventId: 'plan-1',
      eventType: 'plan.updated',
      runSequence: 1,
      createdAt: '2026-08-19T00:00:01Z',
      status: 'active',
      title: 'Plan',
      tasks: [{ id: 'one', title: 'Do it', status: 'running' }],
    };
    const finalPlan: ChatProjectionNode = {
      ...firstPlan,
      id: 'plan-3',
      eventId: 'plan-3',
      runSequence: 3,
      createdAt: '2026-08-19T00:00:03Z',
      status: 'completed',
      tasks: [{ id: 'one', title: 'Do it', status: 'completed' }],
    };

    const items = narrativeItemsOf([
      firstPlan,
      tool('TodoToolkit', 'todo_write', {
        semanticKind: 'plan_operation',
      }),
      finalPlan,
      tool('Terminal Toolkit', 'shell_exec'),
    ]);

    expect(items.filter((item) => item.kind === 'plan')).toEqual([]);
    expect(
      items.flatMap((item) => (item.kind === 'segment' ? item.calls : []))
    ).toEqual([expect.objectContaining({ toolkitName: 'Terminal Toolkit' })]);
  });

  it('hides successful framework lifecycle calls only from Narrative', () => {
    const nodes = [
      tool('Terminal Toolkit', 'cleanup'),
      tool('Screenshot Toolkit', 'register_agent'),
      tool('Database Toolkit', 'database_cleanup'),
      tool('Terminal Toolkit', 'cleanup', { status: 'failed' }),
      tool('File Toolkit', 'read_file'),
    ];
    const [run] = composeTimelineRuns(nodes);
    const narrativeCalls = segmentTimelineRun(run!).flatMap((item) =>
      item.kind === 'segment' ? item.calls : []
    );

    expect(run!.traceRows.filter((row) => row.kind === 'tool')).toHaveLength(5);
    expect(narrativeCalls.map((call) => call.methodName)).toEqual([
      'database_cleanup',
      'cleanup',
      'read_file',
    ]);
    expect(narrativeCalls[1]?.status).toBe('failed');
  });

  it('hides ordinary task lifecycle labels but preserves task failures', () => {
    const completedTask = tool('Task Toolkit', 'task_lifecycle', {
      activityType: 'task',
      semanticKind: 'subtask',
      title: 'Modify Python file with line additions and deletions',
      status: 'completed',
    });
    const failedTask = tool('Task Toolkit', 'task_lifecycle', {
      activityType: 'task',
      semanticKind: 'subtask',
      title: 'Draft report',
      status: 'failed',
    });
    const [run] = composeTimelineRuns([completedTask, failedTask]);
    const items = segmentTimelineRun(run!);
    const calls = items.flatMap((item) =>
      item.kind === 'segment' ? item.calls : []
    );

    expect(calls).toEqual([
      expect.objectContaining({ title: 'Draft report', status: 'failed' }),
    ]);
  });

  it('uses call identity to annotate the real action without replacing it', () => {
    const correlatedTool = tool('Human Toolkit', 'send_message_to_user', {
      toolCallId: 'notice-call-1',
      input: 'Deliver the finished report.',
      output: 'Delivered to the user.',
    });
    const nodes = [
      correlatedTool,
      notice('The report is ready.', 'notice-call-1'),
    ];
    const [run] = composeTimelineRuns(nodes);
    const items = segmentTimelineRun(run!);

    expect(run!.traceRows.filter((row) => row.kind === 'tool')).toHaveLength(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'segment',
      calls: [
        {
          actionKind: 'message',
          input: 'Deliver the finished report.',
          output: 'Delivered to the user.',
          notice: { content: 'The report is ready.' },
          toolCallId: 'notice-call-1',
        },
      ],
    });
  });

  it('keeps a failed correlated notice on the failed action row', () => {
    const correlatedTool = tool('Human Toolkit', 'send_message_to_user', {
      toolCallId: 'failed-notice-call',
      status: 'failed',
    });
    const [run] = composeTimelineRuns([
      correlatedTool,
      notice('The report could not be delivered.', 'failed-notice-call'),
    ]);
    const items = segmentTimelineRun(run!);
    const calls = items.flatMap((item) =>
      item.kind === 'segment' ? item.calls : []
    );

    expect(items.some((item) => item.kind === 'notice')).toBe(false);
    expect(calls).toEqual([
      expect.objectContaining({
        methodName: 'send_message_to_user',
        status: 'failed',
        notice: expect.objectContaining({
          content: 'The report could not be delivered.',
        }),
      }),
    ]);
  });

  it('keeps every derived segment marked as derived until steps are authored', () => {
    const segments = onlySegments([tool('File Toolkit', 'read_file')]);
    expect(segments.every((segment) => segment.source === 'derived')).toBe(
      true
    );
  });

  it('updates one authored Step text slot instead of rendering title and summary', () => {
    const items = narrativeItemsOf([
      step('stp-1', 'pending'),
      step('stp-1', 'running', { summary: 'Reading source and tests.' }),
      tool('File Toolkit', 'read_file', { stepId: 'stp-1' }),
      tool('File Toolkit', 'read_file', { stepId: 'stp-1' }),
      step('stp-1', 'completed', {
        summary: 'Found the projection boundary.',
      }),
    ]);
    const segments = items.filter(
      (item): item is TimelineSegment => item.kind === 'segment'
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      source: 'authored',
      stepId: 'stp-1',
      status: 'completed',
      boundaryReason: 'authored_step',
      narration: 'Found the projection boundary.',
      calls: [],
    });
    expect(segments[0]!.summary).toBeUndefined();
    expect(segments[1]).toMatchObject({
      source: 'derived',
      label: 'Read · 2 actions',
    });
    expect(segments[1]!.calls).toHaveLength(2);
  });

  it('keeps unscoped activity visible beside authored Steps', () => {
    const items = narrativeItemsOf([
      tool('Search Toolkit', 'web_search'),
      step('stp-1', 'running'),
      tool('File Toolkit', 'read_file', { stepId: 'stp-1' }),
      tool('Terminal Toolkit', 'shell_exec'),
    ]);
    const segments = items.filter(
      (item): item is TimelineSegment => item.kind === 'segment'
    );

    expect(segments.map((segment) => segment.source)).toEqual([
      'derived',
      'authored',
      'derived',
    ]);
  });

  it('preserves authored parent-child Step hierarchy for sub-agents', () => {
    const items = narrativeItemsOf([
      step('stp-parent', 'running'),
      step('stp-child', 'running', {
        title: 'Review visual references',
        parentStepId: 'stp-parent',
        agentName: 'Research sub-agent',
      }),
      tool('Search Toolkit', 'web_search', { stepId: 'stp-child' }),
      step('stp-child', 'completed', {
        title: 'Review visual references',
        parentStepId: 'stp-parent',
        summary: 'Selected three authoritative references.',
      }),
    ]);
    const segments = items.filter(
      (item): item is TimelineSegment => item.kind === 'segment'
    );
    const authored = segments.filter(
      (segment) => segment.source === 'authored'
    );

    expect(authored).toHaveLength(2);
    expect(authored[1]).toMatchObject({
      stepId: 'stp-child',
      parentStepId: 'stp-parent',
      status: 'completed',
    });
  });

  it('keeps a Step-correlated human interaction as a standalone interrupt', () => {
    const items = narrativeItemsOf([
      step('stp-1', 'running'),
      interaction('approval', {
        status: 'requested',
        stepId: 'stp-1',
      }),
      step('stp-1', 'blocked'),
    ]);

    expect(items.filter((item) => item.kind === 'segment')).toHaveLength(1);
    expect(items.filter((item) => item.kind === 'interrupt')).toEqual([
      expect.objectContaining({
        kind: 'interrupt',
        call: expect.objectContaining({ stepId: 'stp-1' }),
      }),
    ]);
  });

  it('keeps contiguous calls in one action group when the toolkit changes', () => {
    const segments = onlySegments([
      tool('File Toolkit', 'read_file'),
      tool('Search Toolkit', 'web_search'),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.boundaryReason).toBe('run_start');
    expect(segments[0]!.label).toBe('2 actions');
    expect(segments[0]!.calls).toHaveLength(2);
  });

  it('places a planned Step where it becomes active, not at creation time', () => {
    const items = narrativeItemsOf([
      step('stp-1', 'pending'),
      tool('Search Toolkit', 'web_search'),
      step('stp-1', 'running'),
      tool('File Toolkit', 'read_file', { stepId: 'stp-1' }),
    ]);

    expect(items.map((item) => item.kind)).toEqual([
      'segment',
      'segment',
      'segment',
    ]);
    expect(items[0]).toMatchObject({
      kind: 'segment',
      source: 'derived',
      calls: [expect.objectContaining({ methodName: 'web_search' })],
    });
    expect(items[1]).toMatchObject({
      kind: 'segment',
      source: 'authored',
      stepId: 'stp-1',
    });
    expect(items[2]).toMatchObject({
      kind: 'segment',
      source: 'derived',
      calls: [expect.objectContaining({ methodName: 'read_file' })],
    });
  });

  it('keeps a planning-only Step out of the narrative timeline', () => {
    const items = narrativeItemsOf([step('stp-1', 'pending')]);

    expect(items).toEqual([]);
  });

  it('projects delegated calls as explicit narrative items', () => {
    const items = narrativeItemsOf([
      tool('Agent Toolkit', 'agent_run_subagent', {
        subagentInvocation: true,
        subagentType: 'Research Agent',
      }),
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        kind: 'subagent',
        call: expect.objectContaining({
          actionKind: 'subagent',
          subagentType: 'Research Agent',
        }),
      }),
    ]);
  });

  it('preserves actions around a sub-agent in exact projected order', () => {
    const items = narrativeItemsOf([
      step('stp-1', 'running'),
      tool('File Toolkit', 'edit_file', { stepId: 'stp-1' }),
      tool('Agent Toolkit', 'agent_run_subagent', {
        stepId: 'stp-1',
        subagentInvocation: true,
        subagentType: 'Research Agent',
      }),
      tool('Terminal Toolkit', 'shell_exec', { stepId: 'stp-1' }),
    ]);

    expect(items).toMatchObject([
      {
        kind: 'segment',
        source: 'derived',
        calls: [{ methodName: 'edit_file' }],
      },
      {
        kind: 'subagent',
        authoredStepTitle: 'Inspect the workspace',
        call: { subagentType: 'Research Agent' },
      },
      {
        kind: 'segment',
        source: 'derived',
        calls: [{ methodName: 'shell_exec' }],
      },
    ]);
  });

  it('anchors a Step-correlated subagent at creation and updates it in place', () => {
    const pendingStep = step('stp-delegation', 'pending', {
      title: 'Research subagent created',
    });
    const ordinaryCall = tool('File Toolkit', 'read_file');
    const startedSubagent = tool('Agent Toolkit', 'agent_run_subagent', {
      eventType: 'tool.dispatched',
      phase: 'started',
      status: 'running',
      stepId: 'stp-delegation',
      toolCallId: 'delegation-call-1',
      subagentInvocation: true,
      subagentType: 'Research Agent',
    });
    const activeStep = step('stp-delegation', 'running', {
      title: 'Research subagent created',
      summary: 'Delegated work started.',
    });
    const beforeCompletion = [
      pendingStep,
      ordinaryCall,
      startedSubagent,
      activeStep,
    ];
    const completedSubagent = tool('Agent Toolkit', 'agent_run_subagent', {
      eventType: 'tool.completed',
      phase: 'completed',
      status: 'completed',
      stepId: 'stp-delegation',
      toolCallId: 'delegation-call-1',
      subagentInvocation: true,
      subagentType: 'Research Agent',
    });

    const runningItems = narrativeItemsOf(beforeCompletion);
    const completedItems = narrativeItemsOf([
      ...beforeCompletion,
      completedSubagent,
    ]);
    const itemIdentity = (item: (typeof runningItems)[number]) =>
      item.kind === 'segment'
        ? `${item.source}:${item.stepId || item.calls[0]?.toolCallId}`
        : item.kind === 'subagent'
          ? `subagent:${item.call.toolCallId}`
          : item.kind;

    expect(runningItems.map(itemIdentity)).toEqual([
      'derived:tool-2',
      'subagent:delegation-call-1',
    ]);
    expect(completedItems.map(itemIdentity)).toEqual(
      runningItems.map(itemIdentity)
    );
    expect(runningItems[1]).toMatchObject({
      kind: 'subagent',
      authoredStepTitle: 'Research subagent created',
      summary: 'Delegated work started.',
      call: { status: 'running' },
    });
    expect(completedItems[1]).toMatchObject({
      kind: 'subagent',
      call: { status: 'completed' },
    });
  });

  it('nests only contiguous work carrying the explicit child identity', () => {
    const delegated = tool('Agent Toolkit', 'agent_run_subagent', {
      status: 'running',
      phase: 'started',
      subagentInvocation: true,
      subagentName: 'Research Agent',
      subagentAgentId: 'child-agent-1',
      subagentTaskId: 'child-task-1',
    });
    const childReasoning = {
      ...narration('Inspecting the projection boundary.', 'Research Agent'),
      agentId: 'child-agent-1',
    } satisfies ChatProjectionNode;
    const childTool = tool('Search Toolkit', 'web_search', {
      agentId: 'child-agent-1',
      taskId: 'child-task-1',
    });
    const parentStatusCheck = tool('Agent Toolkit', 'agent_get_task_output', {
      title: 'Checked sub-agent status',
    });

    const items = narrativeItemsOf([
      delegated,
      childReasoning,
      childTool,
      parentStatusCheck,
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      kind: 'subagent',
      call: { subagentName: 'Research Agent' },
      children: [
        {
          kind: 'segment',
          narration: 'Inspecting the projection boundary.',
          calls: [{ methodName: 'web_search' }],
        },
      ],
    });
    expect(items[1]).toMatchObject({
      kind: 'segment',
      calls: [{ methodName: 'agent_get_task_output' }],
    });
  });

  it('keeps differently titled calls from one toolkit in the same segment', () => {
    const segments = onlySegments([
      tool('File Toolkit', 'read_file', { title: 'Read the first file' }),
      tool('File Toolkit', 'read_file', { title: 'Read the second file' }),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.calls).toHaveLength(2);
  });

  it('falls back to a plain count when a segment mixes methods', () => {
    const segments = onlySegments([
      tool('File Toolkit', 'read_file'),
      tool('File Toolkit', 'write_file'),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.label).toBe('2 actions');
  });

  it('starts a new segment when the agent changes', () => {
    const segments = onlySegments([
      narration('Alpha starts.', 'Alpha Agent'),
      narration('Beta continues.', 'Beta Agent'),
    ]);

    expect(segments.map((segment) => segment.agentName)).toEqual([
      'Alpha Agent',
      'Beta Agent',
    ]);
  });

  it('treats work-log progress as narration rather than a call', () => {
    const progress: ChatProjectionNode = {
      ...base,
      kind: 'activity',
      id: 'progress-1',
      eventId: 'progress-1',
      eventType: 'work_log.progress',
      runSequence: 1,
      createdAt: '2026-08-19T00:00:01Z',
      activityType: 'work_log',
      phase: 'progress',
      status: 'running',
      title: 'Searching for README files',
    };

    const segments = onlySegments([progress]);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.narration).toBe('Searching for README files');
    expect(segments[0]!.calls).toHaveLength(0);
  });

  it('breaks a segment at a human interaction instead of folding it in', () => {
    const items = segmentsOf([
      tool('File Toolkit', 'read_file'),
      interaction('approval'),
      tool('File Toolkit', 'write_file'),
    ]);

    expect(items.map((item) => item.kind)).toEqual([
      'segment',
      'interrupt',
      'segment',
    ]);
  });

  it('opens a failed segment and folds every other one', async () => {
    const { segmentDefaultsOpen } =
      await import('@/lib/projector/chat/presentation');
    const [failed] = onlySegments([
      tool('File Toolkit', 'write_file', { status: 'failed' }),
    ]);
    const [running] = onlySegments([
      tool('File Toolkit', 'read_file', { status: 'running' }),
    ]);

    expect(segmentDefaultsOpen(failed!)).toBe(true);
    expect(segmentDefaultsOpen(running!)).toBe(false);
  });
});

describe('timeline calls', () => {
  beforeEach(() => {
    sequence = 0;
  });

  it('sorts the backend interaction vocabulary into three families', () => {
    expect(interactionFamily('approval')).toBe('authorize');
    expect(interactionFamily('credential_binding')).toBe('authorize');
    expect(interactionFamily('diff_review')).toBe('choose');
    expect(interactionFamily('question')).toBe('ask');
    // An unrecognized future type must not claim to be a permission.
    expect(interactionFamily('some_future_type')).toBe('ask');
  });

  it('titles a human call with the same executor grammar as a tool call', () => {
    const [run] = composeTimelineRuns([
      interaction('approval', { response: 'approved' }),
    ]);
    const call = toTimelineCall(run!.traceRows[0]!)!;

    expect(call.executor).toBe('human');
    expect(call.title).toBe('You · Allowed');
    expect(call.inputLabel).toBe('Requested');
    expect(call.outputLabel).toBe('Decision');
  });

  it('distinguishes a rejection from an approval', () => {
    const request = {
      ...base,
      kind: 'interaction' as const,
      id: 'i-1',
      eventId: 'i-1',
      eventType: 'interaction.resolved',
      runSequence: 1,
      createdAt: '2026-08-19T00:00:00Z',
      interactionType: 'approval',
      status: 'responded' as const,
      response: 'rejected',
    };
    expect(humanCallTitle(request)).toBe('You · Rejected');
  });

  it('labels a pending request without exposing a decision', () => {
    const [run] = composeTimelineRuns([
      interaction('question', { status: 'requested', response: undefined }),
    ]);
    const call = toTimelineCall(run!.traceRows[0]!)!;

    expect(call.title).toBe('Input required');
    expect(call.status).toBe('pending');
    expect(call.emptyOutputText).toBe('Waiting for your response.');
  });
});
