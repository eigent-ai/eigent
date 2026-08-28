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
  composeTimelineRun,
  composeTimelineRuns,
  reconcileTimelineRun,
  reconcileTimelineRuns,
} from '@/lib/projector/chat/presentation';
import type {
  ChatActivityNode,
  ChatArtifactNode,
  ChatInteractionNode,
  ChatMessageNode,
  ChatNoticeNode,
  ChatPlanNode,
  ChatProjectionNodeBase,
  ChatRunStatusNode,
} from '@/lib/projector/chat/types';
import type { ProjectedRun } from '@/lib/projector/types';
import { describe, expect, it } from 'vitest';

function base(
  id: string,
  runId: string,
  runSequence: number,
  createdAt:
    | string
    | null = `2026-08-19T00:00:${String(runSequence).padStart(2, '0')}.000Z`,
  cloudCursor: number | null = runSequence
): ChatProjectionNodeBase {
  return {
    id,
    eventId: id,
    projectId: 'project-1',
    runId,
    createdAt,
    runSequence,
    cloudCursor,
    eventType: `test.${id}`,
    legacyStep: null,
  };
}

function message(
  id: string,
  runId: string,
  runSequence: number,
  overrides: Partial<ChatMessageNode> = {}
): ChatMessageNode {
  return {
    ...base(id, runId, runSequence),
    kind: 'message',
    role: 'assistant',
    content: id,
    status: 'complete',
    purpose: 'narration',
    ...overrides,
  };
}

function tool(
  id: string,
  runId: string,
  runSequence: number,
  overrides: Partial<ChatActivityNode> = {}
): ChatActivityNode {
  return {
    ...base(id, runId, runSequence),
    kind: 'activity',
    activityType: 'tool',
    status: 'running',
    phase: 'started',
    title: 'Search Toolkit.search',
    toolkitName: 'Search Toolkit',
    methodName: 'search',
    ...overrides,
  };
}

function workLogChunk(
  id: string,
  runSequence: number,
  title: string,
  streamFragmentMode: ChatActivityNode['streamFragmentMode'] = 'normalized'
): ChatActivityNode {
  return {
    ...base(id, 'run-1', runSequence),
    eventType: 'activity.progress',
    semantic: {
      kind: 'narration',
      subject: { type: 'activity_stream', id: 'run-1:narration' },
      lifecycle: { phase: 'progress', status: 'running' },
      completeness: { state: 'complete', missing_fields: [] },
    },
    kind: 'activity',
    activityType: 'work_log',
    status: 'running',
    phase: 'progress',
    title,
    activityId: 'run-1:narration',
    streamFragmentMode,
  };
}

describe('event-native Timeline Run presentation', () => {
  it('folds adjacent transport batches from one narration stream', () => {
    const first = workLogChunk('chunk-1', 1, 'Build a complete,');
    const second = workLogChunk('chunk-2', 2, 'responsive experience.');

    const run = composeTimelineRun([first, second], 'run-1');

    expect(run?.nodes).toEqual([first, second]);
    expect(run?.traceRows).toHaveLength(1);
    const row = run?.traceRows[0];
    expect(row?.kind).toBe('node');
    if (row?.kind !== 'node' || row.node.kind !== 'activity') {
      throw new Error('expected one composed activity stream row');
    }
    expect(row.node.title).toBe('Build a complete, responsive experience.');
  });

  it('preserves exact boundaries when a streamed word spans two batches', () => {
    const first = workLogChunk('chunk-1', 1, 'tr', 'exact');
    const second = workLogChunk('chunk-2', 2, 'uss', 'exact');

    const run = composeTimelineRun([first, second], 'run-1');
    const row = run?.traceRows[0];

    if (row?.kind !== 'node' || row.node.kind !== 'activity') {
      throw new Error('expected one composed activity stream row');
    }
    expect(row.node.title).toBe('truss');
  });

  it('does not fold narration batches across a semantic boundary', () => {
    const first = workLogChunk('chunk-1', 1, 'First thought.');
    const boundary = message('assistant-note', 'run-1', 2, {
      content: 'A separate authored update.',
    });
    const second = workLogChunk('chunk-2', 3, 'Second thought.');

    const run = composeTimelineRun([first, boundary, second], 'run-1');

    expect(run?.traceRows.map((row) => row.id)).toEqual([
      'chunk-1',
      'assistant-note',
      'chunk-2',
    ]);
  });

  it('groups Runs and orders their nodes deterministically without mutating input', () => {
    const runTwoFinal = message('run-2-final', 'run-2', 2, {
      purpose: 'final',
      content: 'Second result',
      cloudCursor: 22,
    });
    const runOneFinal = message('run-1-final', 'run-1', 3, {
      purpose: 'final',
      content: 'First result',
      cloudCursor: 13,
    });
    const runOneQuery = message('run-1-query', 'run-1', 1, {
      role: 'user',
      purpose: 'query',
      content: 'First query',
      cloudCursor: 11,
    });
    const runTwoQuery = message('run-2-query', 'run-2', 1, {
      role: 'user',
      purpose: 'query',
      content: 'Second query',
      cloudCursor: 21,
    });
    const input = [runTwoFinal, runOneFinal, runOneQuery, runTwoQuery] as const;
    const originalOrder = input.map((node) => node.id);

    const runs = composeTimelineRuns(input);

    expect(runs.map((run) => run.runId)).toEqual(['run-1', 'run-2']);
    expect(runs[0]?.nodes.map((node) => node.id)).toEqual([
      'run-1-query',
      'run-1-final',
    ]);
    expect(runs[1]?.nodes.map((node) => node.id)).toEqual([
      'run-2-query',
      'run-2-final',
    ]);
    expect(runs[0]?.id).toBe('timeline-run:run-1');
    expect(runs[0]?.userQuery?.content).toBe('First query');
    expect(runs[0]?.finalAssistantResponse?.content).toBe('First result');
    expect(input.map((node) => node.id)).toEqual(originalOrder);
  });

  it('uses Run sequence before creation time within a Run', () => {
    const subagentCreated = tool('subagent-created', 'run-1', 50, {
      createdAt: '2026-08-19T00:00:02.000Z',
      runSequence: 2,
      toolCallId: 'subagent-created',
      methodName: 'agent_run_subagent',
      subagentInvocation: true,
    });
    const checkedStatus = tool('checked-status', 'run-1', 2, {
      createdAt: '2026-08-19T00:00:01.000Z',
      runSequence: 50,
      toolCallId: 'checked-status',
      methodName: 'agent_get_task_output',
      title: 'Checked sub-agent status',
    });

    const run = composeTimelineRun([checkedStatus, subagentCreated], 'run-1');

    expect(run?.traceRows.map((row) => row.id)).toEqual([
      'tool-call:run-1:subagent-created',
      'tool-call:run-1:checked-status',
    ]);
  });

  it('exposes plans, interactions, artifacts, terminal status, and Run timestamps', () => {
    const plan: ChatPlanNode = {
      ...base('plan', 'run-1', 3),
      kind: 'plan',
      status: 'active',
      title: 'Plan',
      tasks: [],
    };
    const interaction: ChatInteractionNode = {
      ...base('interaction', 'run-1', 4),
      kind: 'interaction',
      interactionId: 'interaction-1',
      interactionType: 'question',
      status: 'requested',
      prompt: 'Which tone?',
    };
    const artifact: ChatArtifactNode = {
      ...base('artifact', 'run-1', 5),
      kind: 'artifact',
      operation: 'updated',
      path: 'src/index.ts',
      relativePath: 'src/index.ts',
    };
    const started: ChatRunStatusNode = {
      ...base('started', 'run-1', 1, '2026-08-19T00:00:01.000Z'),
      kind: 'run_status',
      status: 'running',
    };
    const completed: ChatRunStatusNode = {
      ...base('completed', 'run-1', 7, '2026-08-19T00:00:11.000Z'),
      kind: 'run_status',
      status: 'completed',
    };
    const query = message('query', 'run-1', 2, {
      role: 'user',
      purpose: 'query',
      content: 'Implement it',
    });
    const final = message('final', 'run-1', 6, {
      purpose: 'final',
      content: 'Implemented',
    });

    const run = composeTimelineRun(
      [completed, final, artifact, interaction, plan, query, started],
      'run-1'
    );

    expect(run).not.toBeNull();
    expect(run?.plans).toEqual([plan]);
    expect(run?.interactions).toEqual([interaction]);
    expect(run?.artifacts).toEqual([artifact]);
    expect(run?.runStatus).toBe(completed);
    expect(run?.status).toBe('completed');
    expect(run?.timestamps).toEqual({
      createdAt: '2026-08-19T00:00:01.000Z',
      startedAt: '2026-08-19T00:00:01.000Z',
      updatedAt: '2026-08-19T00:00:11.000Z',
      endedAt: '2026-08-19T00:00:11.000Z',
      durationMs: 10_000,
      totalAttemptElapsedMs: null,
      elapsedAnchor: null,
    });
  });

  it('uses a retained Attempt start after Run status receipts are collapsed', () => {
    const completed: ChatRunStatusNode = {
      ...base('completed', 'run-1', 3, '2026-08-19T08:30:20.000Z'),
      kind: 'run_status',
      status: 'completed',
      startedAt: '2026-08-19T08:30:10.000Z',
    };
    const queuedNotice = message('queued', 'run-1', 1, {
      createdAt: '2026-08-19T01:00:00.000Z',
      purpose: 'narration',
    });

    const run = composeTimelineRun([queuedNotice, completed], 'run-1');

    expect(run?.timestamps.startedAt).toBe('2026-08-19T08:30:10.000Z');
    expect(run?.timestamps.durationMs).toBe(10_000);
  });

  it('freezes a terminal Run duration when late cleanup events arrive', () => {
    const started: ChatRunStatusNode = {
      ...base('started', 'run-1', 1, '2026-08-19T08:30:00.000Z'),
      kind: 'run_status',
      status: 'running',
    };
    const final = message('final', 'run-1', 2, {
      purpose: 'final',
      createdAt: '2026-08-19T08:30:09.000Z',
    });
    const completed: ChatRunStatusNode = {
      ...base('completed', 'run-1', 3, '2026-08-19T08:30:10.000Z'),
      kind: 'run_status',
      status: 'completed',
    };
    const cleanup = tool('cleanup', 'run-1', 4, {
      methodName: 'cleanup',
      status: 'completed',
      phase: 'completed',
      createdAt: '2026-08-19T09:00:00.000Z',
    });

    const run = composeTimelineRun(
      [started, final, completed, cleanup],
      'run-1'
    );

    expect(run?.timestamps.updatedAt).toBe('2026-08-19T09:00:00.000Z');
    expect(run?.timestamps.endedAt).toBe('2026-08-19T08:30:10.000Z');
    expect(run?.timestamps.durationMs).toBe(10_000);
  });

  it('uses the final assistant receipt when a terminal status slice is absent', () => {
    const started: ChatRunStatusNode = {
      ...base('started', 'run-1', 1, '2026-08-19T08:30:00.000Z'),
      kind: 'run_status',
      status: 'running',
    };
    const final = message('final', 'run-1', 2, {
      purpose: 'final',
      createdAt: '2026-08-19T08:30:09.000Z',
    });
    const cleanup = tool('cleanup', 'run-1', 3, {
      methodName: 'cleanup',
      status: 'completed',
      phase: 'completed',
      createdAt: '2026-08-19T09:00:00.000Z',
    });

    const run = composeTimelineRun([started, final, cleanup], 'run-1');

    expect(run?.timestamps.endedAt).toBe('2026-08-19T08:30:09.000Z');
    expect(run?.timestamps.durationMs).toBe(9_000);
  });

  it('pairs non-adjacent tool lifecycle receipts by toolCallId with stable safe fields', () => {
    const started = tool('tool-started', 'run-1', 2, {
      toolCallId: 'call-1',
      input: 'safe request',
      createdAt: '2026-08-19T00:00:02.000Z',
    });
    const narration = message('narration', 'run-1', 3, {
      content: 'Searching now',
    });
    const completed = tool('tool-completed', 'run-1', 4, {
      toolCallId: 'call-1',
      status: 'completed',
      phase: 'completed',
      output: 'safe response',
      createdAt: '2026-08-19T00:00:07.000Z',
    });

    const first = composeTimelineRun([completed, narration, started], 'run-1');
    const second = composeTimelineRun([started, completed, narration], 'run-1');
    const toolRow = first?.traceRows.find((row) => row.kind === 'tool');

    expect(toolRow?.kind).toBe('tool');
    if (toolRow?.kind !== 'tool') throw new Error('Expected a tool row');
    expect(toolRow.id).toBe('tool-call:run-1:call-1');
    expect(toolRow.invocation.nodes.map((node) => node.id)).toEqual([
      'tool-started',
      'tool-completed',
    ]);
    expect(toolRow.invocation.input).toBe('safe request');
    expect(toolRow.invocation.output).toBe('safe response');
    expect(toolRow.invocation.detail).toBeUndefined();
    expect(toolRow.invocation.status).toBe('completed');
    expect(toolRow.invocation.actionKind).toBe('search');
    expect(toolRow.invocation.durationMs).toBe(5_000);
    expect(first?.summary.toolCallCount).toBe(1);
    expect(second?.traceRows.map((row) => row.id)).toEqual(
      first?.traceRows.map((row) => row.id)
    );
  });

  it('attaches explicitly correlated notices without removing trace rows', () => {
    const invocation = tool('message-tool', 'run-1', 1, {
      toolCallId: 'message-call-1',
      toolkitName: 'Human Toolkit',
      methodName: 'send_message_to_user',
      status: 'completed',
      phase: 'completed',
    });
    const notice: ChatNoticeNode = {
      ...base('message-notice', 'run-1', 2),
      kind: 'notice',
      severity: 'success',
      title: 'Report delivered',
      content: 'The report is ready.',
      toolCallId: 'message-call-1',
    };

    const run = composeTimelineRun([notice, invocation], 'run-1');
    const row = run?.traceRows.find((candidate) => candidate.kind === 'tool');

    if (row?.kind !== 'tool') throw new Error('Expected a tool row');
    expect(row.invocation).toMatchObject({
      actionKind: 'message',
      notice: {
        eventId: 'message-notice',
        title: 'Report delivered',
        content: 'The report is ready.',
        severity: 'success',
      },
    });
    expect(run?.traceRows.some((candidate) => candidate.id === notice.id)).toBe(
      true
    );
  });

  it('classifies common action icons from projected identity, not visible title', () => {
    const actions = [
      tool('research', 'run-1', 1, {
        toolCallId: 'research',
        title: 'Working',
        methodName: 'research_sources',
      }),
      tool('editing', 'run-1', 2, {
        toolCallId: 'editing',
        title: 'Working',
        methodName: 'edit_file',
      }),
      tool('drafting', 'run-1', 3, {
        toolCallId: 'drafting',
        title: 'Working',
        methodName: 'draft_report',
      }),
      tool('checking', 'run-1', 4, {
        toolCallId: 'checking',
        title: 'Working',
        methodName: 'check_file',
      }),
    ];
    const run = composeTimelineRun(actions, 'run-1');
    const kinds = run?.traceRows.flatMap((row) =>
      row.kind === 'tool' ? [row.invocation.actionKind] : []
    );

    expect(kinds).toEqual(['search', 'edit', 'write', 'inspect']);
  });

  it('preserves projection-owned delegated-agent metadata on a folded invocation', () => {
    const started = tool('subagent-started', 'run-1', 2, {
      eventType: 'tool.dispatched',
      toolCallId: 'subagent-call-1',
      subagentInvocation: true,
      subagentType: 'researcher',
      subagentName: 'Research Agent',
      subagentStatus: 'running',
      subagentAgentId: 'child-agent-1',
      subagentTaskId: 'child-task-1',
      agentProvider: 'gemini_agents',
      agentModel: 'gemini-2.5-pro',
    });
    const completed = tool('subagent-completed', 'run-1', 3, {
      eventType: 'tool.completed',
      toolCallId: 'subagent-call-1',
      status: 'completed',
      phase: 'completed',
      subagentInvocation: true,
      subagentStatus: 'failed',
    });

    const run = composeTimelineRun([completed, started], 'run-1');
    const row = run?.traceRows.find((candidate) => candidate.kind === 'tool');

    if (row?.kind !== 'tool') throw new Error('Expected a tool row');
    expect(row.invocation).toMatchObject({
      subagentInvocation: true,
      subagentType: 'researcher',
      subagentName: 'Research Agent',
      subagentStatus: 'failed',
      subagentAgentId: 'child-agent-1',
      subagentTaskId: 'child-task-1',
      agentProvider: 'gemini_agents',
      agentModel: 'gemini-2.5-pro',
    });
  });

  it('keeps same-title retries separate when projected call ids differ', () => {
    const retries = [
      tool('retry-1', 'run-1', 1, {
        toolCallId: 'call-retry-1',
        title: 'Modify Python file',
        status: 'failed',
        phase: 'failed',
      }),
      tool('retry-2', 'run-1', 2, {
        toolCallId: 'call-retry-2',
        title: 'Modify Python file',
        status: 'failed',
        phase: 'failed',
      }),
      tool('retry-3', 'run-1', 3, {
        toolCallId: 'call-retry-3',
        title: 'Modify Python file',
        status: 'completed',
        phase: 'completed',
      }),
      tool('retry-4', 'run-1', 4, {
        toolCallId: 'call-retry-4',
        title: 'Modify Python file',
        status: 'completed',
        phase: 'completed',
      }),
    ];

    const run = composeTimelineRun(retries, 'run-1');
    const toolRows = run?.traceRows.filter((row) => row.kind === 'tool') ?? [];

    expect(toolRows.map((row) => row.id)).toEqual([
      'tool-call:run-1:call-retry-1',
      'tool-call:run-1:call-retry-2',
      'tool-call:run-1:call-retry-3',
      'tool-call:run-1:call-retry-4',
    ]);
    expect(
      toolRows.map((row) =>
        row.kind === 'tool' ? row.invocation.status : undefined
      )
    ).toEqual(['failed', 'failed', 'completed', 'completed']);
    expect(run?.summary.toolCallCount).toBe(4);
  });

  it('merges canonical and legacy receipts by call id without exposing legacy payloads', () => {
    const canonicalStarted = tool('canonical-started', 'run-1', 1, {
      eventType: 'tool.dispatched',
      toolCallId: 'call-safe',
      title: 'Read notes.md',
      input: 'File: notes.md',
      detail: 'Running',
    });
    const legacyStarted = tool('legacy-started', 'run-1', 2, {
      eventType: 'legacy.activate_toolkit',
      legacyStep: 'activate_toolkit',
      toolCallId: 'call-safe',
      input: 'raw request with secret',
    });
    const canonicalCompleted = tool('canonical-completed', 'run-1', 3, {
      eventType: 'tool.completed',
      toolCallId: 'call-safe',
      title: 'Read notes.md',
      status: 'completed',
      phase: 'completed',
      output: 'Returned 42 characters',
      detail: 'Completed in 12 ms',
      durationMs: 12,
    });
    const legacyCompleted = tool('legacy-completed', 'run-1', 4, {
      eventType: 'legacy.deactivate_toolkit',
      legacyStep: 'deactivate_toolkit',
      toolCallId: 'call-safe',
      status: 'completed',
      phase: 'completed',
      output: 'raw response with secret',
    });

    const run = composeTimelineRun(
      [legacyCompleted, canonicalStarted, legacyStarted, canonicalCompleted],
      'run-1'
    );
    const rows = run?.traceRows.filter((row) => row.kind === 'tool');
    expect(rows).toHaveLength(1);
    const invocation = rows?.[0]?.kind === 'tool' ? rows[0].invocation : null;
    expect(invocation).toMatchObject({
      title: 'Read notes.md',
      input: 'File: notes.md',
      output: 'Returned 42 characters',
      detail: 'Completed in 12 ms',
      durationMs: 12,
    });
    expect(JSON.stringify(invocation)).not.toContain('raw request');
    expect(JSON.stringify(invocation)).not.toContain('raw response');
  });

  it('does not guess lifecycle correlation when a toolCallId is absent', () => {
    const started = tool('anonymous-started', 'run-1', 1);
    const completed = tool('anonymous-completed', 'run-1', 2, {
      status: 'completed',
      phase: 'completed',
    });

    const run = composeTimelineRun([started, completed], 'run-1');

    expect(run?.traceRows.map((row) => row.id)).toEqual([
      'tool-event:anonymous-started',
      'tool-event:anonymous-completed',
    ]);
    expect(run?.summary.toolCallCount).toBe(2);
  });

  it('pairs legacy toolkit receipts FIFO while preserving stable call rows', () => {
    const firstStarted = tool('first-started', 'run-1', 1, {
      eventType: 'legacy.activate_toolkit',
      legacyStep: 'activate_toolkit',
      input: 'first request',
    });
    const secondStarted = tool('second-started', 'run-1', 2, {
      eventType: 'legacy.activate_toolkit',
      legacyStep: 'activate_toolkit',
      input: 'second request',
    });
    const firstCompleted = tool('first-completed', 'run-1', 3, {
      eventType: 'legacy.deactivate_toolkit',
      legacyStep: 'deactivate_toolkit',
      status: 'completed',
      phase: 'completed',
      output: 'first response',
    });
    const secondCompleted = tool('second-completed', 'run-1', 4, {
      eventType: 'legacy.deactivate_toolkit',
      legacyStep: 'deactivate_toolkit',
      status: 'completed',
      phase: 'completed',
      output: 'second response',
    });

    const run = composeTimelineRun(
      [secondCompleted, firstStarted, firstCompleted, secondStarted],
      'run-1'
    );
    const calls = run?.traceRows.flatMap((row) =>
      row.kind === 'tool' ? [row.invocation] : []
    );

    expect(calls?.map((call) => call.id)).toEqual([
      'legacy-tool-call:run-1:first-started',
      'legacy-tool-call:run-1:second-started',
    ]);
    expect(calls?.map((call) => call.nodes.map((node) => node.id))).toEqual([
      ['first-started', 'first-completed'],
      ['second-started', 'second-completed'],
    ]);
    expect(calls?.map((call) => [call.input, call.output])).toEqual([
      ['first request', 'first response'],
      ['second request', 'second response'],
    ]);
    expect(run?.summary.toolCallCount).toBe(2);
  });

  it('presents terminal activity as an invocation with vertical input/output data', () => {
    const terminal = tool('terminal-1', 'run-1', 1, {
      activityType: 'terminal',
      eventType: 'legacy.terminal',
      legacyStep: 'terminal',
      title: 'Terminal',
      input: 'npm test',
      output: '6 tests passed',
      status: 'completed',
      phase: 'completed',
      toolkitName: undefined,
      methodName: undefined,
    });

    const run = composeTimelineRun([terminal], 'run-1');
    const row = run?.traceRows[0];

    expect(row?.kind).toBe('tool');
    if (row?.kind !== 'tool') throw new Error('Expected invocation row');
    expect(row.invocation).toMatchObject({
      id: 'tool-event:terminal-1',
      activityType: 'terminal',
      input: 'npm test',
      output: '6 tests passed',
    });
  });

  it('uses unique semantic identities for summarised counts', () => {
    const nodes = [
      tool('tool-start', 'run-1', 1, { toolCallId: 'tool-1' }),
      tool('tool-end', 'run-1', 2, {
        toolCallId: 'tool-1',
        status: 'completed',
        phase: 'completed',
      }),
      message('message-created', 'run-1', 3, {
        messageId: 'message-1',
        status: 'streaming',
      }),
      message('message-completed', 'run-1', 4, {
        messageId: 'message-1',
      }),
      message('message-2', 'run-1', 5, { purpose: 'final' }),
      {
        ...base('artifact-created', 'run-1', 6),
        kind: 'artifact',
        operation: 'created',
        path: 'src/a.ts',
        relativePath: 'src/a.ts',
      } satisfies ChatArtifactNode,
      {
        ...base('artifact-updated', 'run-1', 7),
        kind: 'artifact',
        operation: 'updated',
        path: 'src/a.ts',
        relativePath: 'src/a.ts',
      } satisfies ChatArtifactNode,
      {
        ...base('interaction-requested', 'run-1', 8),
        kind: 'interaction',
        interactionId: 'interaction-1',
        interactionType: 'question',
        status: 'requested',
      } satisfies ChatInteractionNode,
      {
        ...base('interaction-responded', 'run-1', 9),
        kind: 'interaction',
        interactionId: 'interaction-1',
        interactionType: 'question',
        status: 'responded',
      } satisfies ChatInteractionNode,
    ];

    const run = composeTimelineRun(nodes, 'run-1');

    expect(run?.summary).toEqual({
      toolCallCount: 1,
      agentMessageCount: 2,
      artifactCount: 1,
      interactionCount: 1,
    });
  });

  it('returns null when the requested Run has no semantic nodes', () => {
    expect(composeTimelineRun([], 'missing')).toBeNull();
  });

  it('reconciles an active Run with the authoritative status and elapsed anchor', () => {
    const final = message('final', 'run-1', 1, {
      purpose: 'final',
      createdAt: '2026-08-19T00:00:01.000Z',
    });
    const composed = composeTimelineRun([final], 'run-1')!;
    const projected: ProjectedRun = {
      runId: 'run-1',
      status: 'running',
      lastSequence: 8,
      runVersion: 2,
      updatedAt: '2026-08-19T00:00:10.000Z',
      totalAttemptElapsedMs: 7_500,
    };

    const reconciled = reconcileTimelineRun(composed, projected);

    expect(reconciled.status).toBe('running');
    expect(reconciled.timestamps).toMatchObject({
      updatedAt: '2026-08-19T00:00:10.000Z',
      endedAt: null,
      durationMs: null,
      totalAttemptElapsedMs: 7_500,
      elapsedAnchor: {
        accumulatedMs: 7_500,
        anchoredAt: '2026-08-19T00:00:10.000Z',
      },
    });
  });

  it('freezes a terminal Run at the authoritative attempt aggregate', () => {
    const running = tool('running', 'run-1', 1, {
      createdAt: '2026-08-19T00:00:01.000Z',
    });
    const composed = composeTimelineRun([running], 'run-1')!;
    const projected: ProjectedRun = {
      runId: 'run-1',
      status: 'completed',
      lastSequence: 9,
      runVersion: 3,
      updatedAt: '2026-08-19T00:00:15.000Z',
      totalAttemptElapsedMs: 12_345,
    };

    const reconciled = reconcileTimelineRun(composed, projected);

    expect(reconciled.status).toBe('completed');
    expect(reconciled.timestamps).toMatchObject({
      updatedAt: '2026-08-19T00:00:15.000Z',
      endedAt: '2026-08-19T00:00:15.000Z',
      durationMs: 12_345,
      totalAttemptElapsedMs: 12_345,
      elapsedAnchor: { accumulatedMs: 12_345, anchoredAt: null },
    });
  });

  it('updates the presented Run status row from the authoritative aggregate', () => {
    const started: ChatRunStatusNode = {
      ...base('started', 'run-1', 1, '2026-08-19T00:00:01.000Z'),
      kind: 'run_status',
      status: 'running',
    };
    const composed = composeTimelineRun([started], 'run-1')!;
    const projected: ProjectedRun = {
      runId: 'run-1',
      status: 'completed',
      lastSequence: 2,
      runVersion: 1,
      updatedAt: '2026-08-19T00:00:05.000Z',
      totalAttemptElapsedMs: 4_000,
    };

    const reconciled = reconcileTimelineRun(composed, projected);
    const statusRow = reconciled.traceRows.find(
      (row) => row.kind === 'node' && row.node.kind === 'run_status'
    );

    expect(reconciled.runStatus?.status).toBe('completed');
    expect(reconciled.nodes[0]).toMatchObject({ status: 'completed' });
    expect(statusRow).toMatchObject({
      kind: 'node',
      node: { status: 'completed' },
    });
  });

  it('reconciles a Run collection by id and preserves unmatched Runs', () => {
    const first = composeTimelineRun([message('first', 'run-1', 1)], 'run-1')!;
    const second = composeTimelineRun(
      [message('second', 'run-2', 1)],
      'run-2'
    )!;
    const projected: ProjectedRun = {
      runId: 'run-1',
      status: 'interrupted',
      lastSequence: 2,
      runVersion: 1,
      updatedAt: '2026-08-19T00:01:00.000Z',
      totalAttemptElapsedMs: 2_000,
    };

    const reconciled = reconcileTimelineRuns([first, second], {
      'run-1': projected,
    });

    expect(reconciled[0]?.status).toBe('interrupted');
    expect(reconciled[1]).toBe(second);
  });
});
