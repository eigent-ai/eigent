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

import { presentChatSemanticEntities } from '@/components/ChatBox/EventTimeline/presentationPolicy';
import {
  adaptChatProjectionEvent,
  createChatProjectionState,
  projectChatEvents,
  reduceChatProjection,
  selectRenderableChatNodes,
} from '@/lib/projector/chat';
import type { CanonicalProjectEvent } from '@/lib/projector/types';
import { shouldProjectLegacyChatStep } from '@/store/chatEventProjectionBridge';
import { describe, expect, it } from 'vitest';

function event(
  eventType: string,
  payload: Record<string, unknown>,
  sequence: number,
  overrides: Partial<CanonicalProjectEvent> = {}
): CanonicalProjectEvent {
  return {
    eventId: `event-${sequence}`,
    projectId: 'project-1',
    runId: 'run-1',
    runSequence: sequence,
    runVersion: sequence,
    cloudCursor: sequence,
    eventType,
    payload,
    legacyStep: null,
    createdAt: `2026-08-18T00:00:${String(sequence).padStart(2, '0')}Z`,
    source: 'canonical',
    raw: payload,
    ...overrides,
  };
}

function semanticSubtaskPayload(
  taskId: string,
  phase: 'requested' | 'started' | 'progress' | 'completed' | 'failed',
  status: 'pending' | 'running' | 'completed' | 'failed',
  display: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    semantic_schema_version: 1,
    display_schema_version: 1,
    semantic: {
      kind: 'subtask',
      subject: { type: 'task', id: taskId },
      lifecycle: { phase, status },
      completeness: { state: 'complete', missing_fields: [] },
    },
    ...display,
  };
}

describe('chat projection presentation contract', () => {
  it('uses the explicit approval question for the durable timeline receipt', () => {
    const state = projectChatEvents('project-1', [
      event(
        'approval.requested',
        {
          approval_id: 'approval:call-1',
          prompt: {
            title: 'Allow brave_search.web_search?',
            question:
              'The agent wants to run brave_search.web_search (mcp.tool.write).',
          },
        },
        1
      ),
    ]);

    expect(selectRenderableChatNodes(state)).toEqual([
      expect.objectContaining({
        kind: 'interaction',
        interactionId: 'approval:call-1',
        interactionType: 'approval',
        status: 'requested',
        prompt:
          'The agent wants to run brave_search.web_search (mcp.tool.write).',
      }),
    ]);
  });

  it('reads the requesting agent from a typed approval prompt', () => {
    // The legacy ASK mirror carries `agent` at the top level while the typed
    // approval nests it in the prompt. Both lanes must name the same agent, or
    // the two copies of one approval stop looking like copies.
    const state = projectChatEvents('project-1', [
      event(
        'approval.requested',
        {
          approval_id: 'approval:call-1',
          prompt: {
            question: 'The agent wants to run shell_exec (process.spawn).',
            agent: 'single_agent',
          },
        },
        1
      ),
    ]);

    expect(selectRenderableChatNodes(state)).toEqual([
      expect.objectContaining({
        kind: 'interaction',
        interactionId: 'approval:call-1',
        agentName: 'single_agent',
      }),
    ]);
  });

  it('classifies known receipts without rendering false unsupported cards', () => {
    const knownReceipts = [
      'run.environment_resolved',
      'run.timeout_policy_configured',
      'run.attempt_environment_bound',
      'run.forked',
      'approval.expiry_observed',
      'permission.action.allow',
      'admission.accepted',
      'execution.completed',
      'model.invocation.dispatched',
      'artifact.manifest.finalized',
      'artifact.uploaded',
    ];

    knownReceipts.forEach((eventType, index) => {
      expect(adaptChatProjectionEvent(event(eventType, {}, index + 1))).toEqual(
        { kind: 'receipt', receiptType: eventType }
      );
    });

    expect(
      adaptChatProjectionEvent(event('future.super_event', {}, 20))
    ).toMatchObject({
      kind: 'unsupported',
      node: { kind: 'unknown', eventType: 'future.super_event' },
    });
  });

  it('shows shared-workspace waits without cluttering uncontended tasks', () => {
    expect(
      adaptChatProjectionEvent(
        event(
          'workspace.writer.queued',
          { queue_position: 2, blocker_task_id: 'task-private' },
          1
        )
      )
    ).toMatchObject({
      kind: 'display',
      node: {
        kind: 'notice',
        title: 'Waiting for Space',
        content: expect.stringContaining('Queue position: 2.'),
      },
    });
    expect(
      JSON.stringify(
        adaptChatProjectionEvent(
          event(
            'workspace.writer.queued',
            { queue_position: 2, blocker_task_id: 'task-private' },
            1
          )
        )
      )
    ).not.toContain('task-private');

    expect(
      adaptChatProjectionEvent(
        event('workspace.writer.acquired', { waited: false }, 2)
      )
    ).toEqual({
      kind: 'receipt',
      receiptType: 'workspace.writer.acquired',
    });
    expect(
      adaptChatProjectionEvent(
        event('workspace.writer.acquired', { waited: true }, 3)
      )
    ).toMatchObject({
      kind: 'display',
      node: {
        kind: 'notice',
        title: 'Space available',
      },
    });
  });

  it('keeps canonical transcript, tool outcomes, and safe artifact identity semantic', () => {
    const inputs = [
      event('user.message', { content: 'Create the report' }, 1),
      event('run.environment_resolved', { local_path: '/Users/alice' }, 2),
      event('tool.failed', { tool_name: 'writer' }, 3),
      event('tool.timed_out', { tool_name: 'browser' }, 4),
      event('tool.outcome_unknown', { tool_name: 'email_sender' }, 5),
      event(
        'artifact.created',
        {
          artifact_id: 'artifact-1',
          path: '/Users/alice/private/report.md',
          relativePath: 'reports/report.md',
          name: 'C:\\Users\\alice\\private\\report.md',
        },
        6
      ),
      event(
        'artifact.manifest.finalized',
        {
          artifacts: [
            { artifact_id: 'artifact-1', relativePath: 'reports/report.md' },
          ],
        },
        7
      ),
      event(
        'artifact.uploaded',
        {
          artifact_id: 'artifact-1',
          relativePath: 'reports/report.md',
          asset_ref: { key: 'safe/object-key' },
        },
        8
      ),
    ];

    const state = projectChatEvents('project-1', inputs);
    const nodes = selectRenderableChatNodes(state);

    expect(nodes).toHaveLength(5);
    expect(nodes[0]).toMatchObject({
      kind: 'message',
      role: 'user',
      content: 'Create the report',
    });
    expect(
      nodes
        .filter((node) => node.kind === 'activity')
        .map((node) => node.status)
    ).toEqual(['failed', 'timed_out', 'outcome_unknown']);
    expect(nodes.at(-1)).toMatchObject({
      kind: 'artifact',
      artifactId: 'artifact-1',
      path: 'reports/report.md',
      name: 'report.md',
    });
    expect(JSON.stringify(state)).not.toContain('/Users/alice');
    expect(JSON.stringify(state)).not.toContain('C:\\\\Users');
    expect(state.seenEventIds).toEqual(
      Object.fromEntries(inputs.map((input) => [input.eventId, true]))
    );
  });

  it('never retains absolute or parent-traversing artifact paths', () => {
    const state = projectChatEvents('project-1', [
      event(
        'artifact.created',
        {
          artifact_id: 'artifact-absolute',
          relative_path: '../../Users/alice/secret.txt',
          path: '/Users/alice/secret.txt',
          name: '/Users/alice/secret.txt',
        },
        1
      ),
    ]);

    expect(selectRenderableChatNodes(state)).toEqual([
      expect.objectContaining({
        kind: 'artifact',
        artifactId: 'artifact-absolute',
        path: 'secret.txt',
        name: 'secret.txt',
      }),
    ]);
    expect(JSON.stringify(state)).not.toContain('/Users/alice');
    expect(JSON.stringify(state)).not.toContain('../');
  });

  it('hides an empty assistant final instead of rendering an empty bubble', () => {
    expect(adaptChatProjectionEvent(event('assistant.final', {}, 1))).toEqual({
      kind: 'hidden',
      reason: 'assistant.final.empty',
    });

    const state = projectChatEvents('project-1', [
      event('assistant.final', {}, 1),
      event('run.completed', {}, 2),
    ]);
    expect(selectRenderableChatNodes(state)).toEqual([
      expect.objectContaining({
        kind: 'run_status',
        status: 'completed',
      }),
    ]);
  });

  it('prefers canonical transcript events over legacy history fallbacks per Run', () => {
    const mixed = projectChatEvents('project-1', [
      event('legacy.confirmed', { content: 'Legacy prompt' }, 1, {
        legacyStep: 'confirmed',
      }),
      event('user.message', { content: 'Canonical prompt' }, 2),
      event('legacy.end', { content: 'Legacy answer' }, 3, {
        legacyStep: 'end',
      }),
      event('assistant.final', { content: 'Canonical answer' }, 4, {
        legacyStep: 'end',
      }),
    ]);

    expect(
      presentChatSemanticEntities(selectRenderableChatNodes(mixed)).map(
        (node) => (node.kind === 'message' ? node.content : node.eventType)
      )
    ).toEqual(['Canonical prompt', 'Canonical answer']);

    const legacyOnly = projectChatEvents('project-1', [
      event('legacy.confirmed', { content: 'Old prompt' }, 1, {
        legacyStep: 'confirmed',
      }),
      event('legacy.end', { content: 'Old answer' }, 2, {
        legacyStep: 'end',
      }),
    ]);
    expect(
      presentChatSemanticEntities(selectRenderableChatNodes(legacyOnly)).map(
        (node) => (node.kind === 'message' ? node.content : node.eventType)
      )
    ).toEqual(['Old prompt', 'Old answer']);
  });

  it('coalesces typed message lifecycle receipts by message_id', () => {
    const state = projectChatEvents('project-1', [
      event(
        'message.created',
        { message_id: 'message-1', role: 'assistant', content: 'Hel' },
        1
      ),
      event('message.delta', { message_id: 'message-1', delta: 'lo ' }, 2),
      event('message.delta', { message_id: 'message-1', delta: 'world' }, 3),
      event(
        'message.completed',
        { message_id: 'message-1', role: 'assistant' },
        4
      ),
    ]);

    const presented = presentChatSemanticEntities(
      selectRenderableChatNodes(state)
    );
    expect(presented).toHaveLength(1);
    expect(presented[0]).toMatchObject({
      kind: 'message',
      messageId: 'message-1',
      content: 'Hello world',
      status: 'complete',
    });
    expect(presentChatSemanticEntities(presented)).toEqual(presented);
  });

  it('folds projected subtask lifecycle receipts into the earliest event', () => {
    const state = projectChatEvents('project-1', [
      event(
        'subtask.created',
        semanticSubtaskPayload('task-1', 'requested', 'pending', {
          display_title: 'Draft the report',
          display_input: 'Prepare the first draft',
        }),
        1
      ),
      event(
        'subtask.started',
        semanticSubtaskPayload('task-1', 'started', 'running', {
          display_title: 'Drafting the report',
          display_summary: 'Writer started the subtask',
        }),
        2
      ),
      event(
        'subtask.completed',
        semanticSubtaskPayload('task-1', 'completed', 'completed', {
          display_title: 'Report draft finished',
          display_summary: 'Subtask completed',
          display_output: 'Saved reports/draft.md',
        }),
        3
      ),
    ]);
    const sourceNodes = selectRenderableChatNodes(state);

    expect(sourceNodes).toHaveLength(3);
    const presented = presentChatSemanticEntities(sourceNodes);
    expect(presented).toEqual([
      expect.objectContaining({
        kind: 'activity',
        activityType: 'task',
        eventId: 'event-1',
        eventType: 'subtask.created',
        runSequence: 1,
        createdAt: '2026-08-18T00:00:01Z',
        activityId: 'task-1',
        status: 'completed',
        phase: 'completed',
        title: 'Report draft finished',
        detail: 'Subtask completed',
        input: 'Prepare the first draft',
        output: 'Saved reports/draft.md',
        semantic: expect.objectContaining({
          subject: { type: 'task', id: 'task-1' },
          lifecycle: { phase: 'completed', status: 'completed' },
        }),
      }),
    ]);
    expect(sourceNodes.map((node) => node.eventId)).toEqual([
      'event-1',
      'event-2',
      'event-3',
    ]);
    expect(
      sourceNodes.map((node) =>
        node.kind === 'activity' ? node.status : undefined
      )
    ).toEqual(['pending', 'running', 'completed']);
    expect(presentChatSemanticEntities(presented)).toEqual(presented);
  });

  it('anchors lifecycle folding by Run sequence when creation time conflicts', () => {
    const state = projectChatEvents('project-1', [
      event(
        'subtask.created',
        semanticSubtaskPayload('task-chronology', 'requested', 'pending', {
          display_title: 'Inspect workspace',
        }),
        20,
        {
          runSequence: 2,
          cloudCursor: 2,
          createdAt: '2026-08-18T00:00:03Z',
        }
      ),
      event(
        'subtask.completed',
        semanticSubtaskPayload('task-chronology', 'completed', 'completed', {
          display_title: 'Inspecting workspace',
        }),
        2,
        {
          runSequence: 20,
          cloudCursor: 20,
          createdAt: '2026-08-18T00:00:01Z',
        }
      ),
    ]);

    expect(
      presentChatSemanticEntities(selectRenderableChatNodes(state))
    ).toEqual([
      expect.objectContaining({
        eventId: 'event-20',
        createdAt: '2026-08-18T00:00:03Z',
        status: 'completed',
        title: 'Inspecting workspace',
      }),
    ]);
  });

  it('projects safe delegated-agent identity, lifecycle, and child correlations', () => {
    const projected = adaptChatProjectionEvent(
      event(
        'tool.completed',
        {
          tool_name: 'agent_run_subagent',
          tool_call_id: 'call-subagent-1',
          request: {
            description: 'Research Agent',
            subagent_type: 'research',
          },
          result: {
            agent_id: 'child-agent-1',
            task_id: 'child-task-1',
            status: 'failed',
            error: 'private transport failure',
          },
          display_input: 'Inspect the Timeline implementation.',
          display_output: 'The delegated task failed.',
        },
        4
      )
    );

    expect(projected).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        subagentInvocation: true,
        subagentType: 'research',
        subagentName: 'Research Agent',
        subagentStatus: 'failed',
        subagentAgentId: 'child-agent-1',
        subagentTaskId: 'child-task-1',
        input: 'Inspect the Timeline implementation.',
        output: 'The delegated task failed.',
      },
    });
    expect(JSON.stringify(projected)).not.toContain(
      'private transport failure'
    );
  });

  it('updates a delegated-agent card from a separately correlated status check', () => {
    const state = projectChatEvents('project-1', [
      event(
        'tool.completed',
        {
          tool_name: 'agent_run_subagent',
          tool_call_id: 'call-subagent-create',
          request: {
            description: 'Research Agent',
            subagent_type: 'research',
          },
          result: {
            agent_id: 'child-agent-1',
            task_id: 'child-task-1',
            status: 'running',
          },
          display_output: 'Sub-agent status: running',
        },
        1
      ),
      event(
        'tool.dispatched',
        {
          tool_name: 'agent_get_task_output',
          tool_call_id: 'call-subagent-status',
          request: { task_id: 'child-task-1' },
        },
        2
      ),
      event(
        'tool.failed',
        {
          tool_name: 'agent_get_task_output',
          tool_call_id: 'call-subagent-status',
          request: { task_id: 'child-task-1' },
          result: {
            agent_id: 'child-agent-1',
            task_id: 'child-task-1',
            status: 'failed',
            error: 'private provider failure',
          },
          display_output: 'The delegated task failed.',
        },
        3
      ),
      event('run.completed', {}, 4),
    ]);

    const projected = selectRenderableChatNodes(state);
    expect(
      projected.find(
        (node) =>
          node.kind === 'activity' &&
          node.eventType === 'tool.dispatched' &&
          node.toolCallId === 'call-subagent-status'
      )
    ).toMatchObject({ subagentStatus: undefined });
    const statusCheck = projected.find(
      (node) =>
        node.kind === 'activity' &&
        node.eventType === 'tool.failed' &&
        node.toolCallId === 'call-subagent-status'
    );
    expect(statusCheck).toMatchObject({
      kind: 'activity',
      subagentInvocation: undefined,
      subagentAgentId: 'child-agent-1',
      subagentTaskId: 'child-task-1',
      subagentStatus: 'failed',
    });

    const presented = presentChatSemanticEntities(projected);
    const delegation = presented.find(
      (node) =>
        node.kind === 'activity' && node.toolCallId === 'call-subagent-create'
    );
    expect(delegation).toMatchObject({
      kind: 'activity',
      subagentInvocation: true,
      subagentStatus: 'failed',
      output: 'The delegated task failed.',
    });
    expect(
      presented.some(
        (node) =>
          node.kind === 'activity' && node.toolCallId === 'call-subagent-status'
      )
    ).toBe(true);
    expect(JSON.stringify(presented)).not.toContain('private provider failure');
  });

  it('does not leave a delegated-agent card active after its Run ends', () => {
    const state = projectChatEvents('project-1', [
      event(
        'tool.completed',
        {
          tool_name: 'agent_run_subagent',
          tool_call_id: 'call-subagent-create',
          result: {
            agent_id: 'child-agent-1',
            task_id: 'child-task-1',
            status: 'running',
          },
        },
        1
      ),
      event('run.completed', {}, 2),
    ]);

    const presented = presentChatSemanticEntities(
      selectRenderableChatNodes(state)
    );
    expect(
      presented.find(
        (node) =>
          node.kind === 'activity' && node.toolCallId === 'call-subagent-create'
      )
    ).toMatchObject({ subagentStatus: 'outcome_unknown' });
  });

  it('folds task and subtask namespaces only through an explicit task id', () => {
    const state = projectChatEvents('project-1', [
      event(
        'task.started',
        {
          task_id: 'task-explicit',
          status: 'running',
          display_title: 'Research sources',
          display_input: 'Find primary sources',
        },
        1
      ),
      event('notice.progress', { content: 'Work continues' }, 2),
      event(
        'subtask.completed',
        {
          task_id: 'task-explicit',
          status: 'completed',
          display_title: 'Sources researched',
          display_output: 'Found three sources',
        },
        3
      ),
    ]);

    expect(
      presentChatSemanticEntities(selectRenderableChatNodes(state))
    ).toEqual([
      expect.objectContaining({
        eventId: 'event-1',
        activityType: 'task',
        taskId: 'task-explicit',
        status: 'completed',
        title: 'Sources researched',
        input: 'Find primary sources',
        output: 'Found three sources',
      }),
      expect.objectContaining({ eventId: 'event-2', kind: 'notice' }),
    ]);
  });

  it('does not infer task lifecycle identity from text or contradictory ids', () => {
    const state = projectChatEvents('project-1', [
      event(
        'subtask.started',
        { status: 'running', display_title: 'Same visible task' },
        1
      ),
      event(
        'subtask.completed',
        { status: 'completed', display_title: 'Same visible task' },
        2
      ),
      event(
        'subtask.started',
        {
          ...semanticSubtaskPayload('semantic-task', 'started', 'running', {
            display_title: 'Conflicting task',
            task_id: 'payload-task',
          }),
        },
        3
      ),
      event(
        'subtask.completed',
        {
          ...semanticSubtaskPayload('semantic-task', 'completed', 'completed', {
            display_title: 'Conflicting task',
            task_id: 'payload-task',
          }),
        },
        4
      ),
    ]);

    const presentedTasks = presentChatSemanticEntities(
      selectRenderableChatNodes(state)
    ).filter(
      (node) => node.kind === 'activity' && node.activityType === 'task'
    );
    expect(presentedTasks).toHaveLength(4);
    expect(presentedTasks.map((node) => node.eventId)).toEqual([
      'event-1',
      'event-2',
      'event-3',
      'event-4',
    ]);
  });

  it('treats projected task ids as exact opaque identities', () => {
    const state = projectChatEvents('project-1', [
      event(
        'subtask.started',
        semanticSubtaskPayload('task-opaque', 'started', 'running', {
          display_title: 'Same visible task',
        }),
        1
      ),
      event(
        'subtask.completed',
        semanticSubtaskPayload(' task-opaque ', 'completed', 'completed', {
          display_title: 'Same visible task',
        }),
        2
      ),
    ]);

    const presentedTasks = presentChatSemanticEntities(
      selectRenderableChatNodes(state)
    ).filter(
      (node) => node.kind === 'activity' && node.activityType === 'task'
    );

    expect(presentedTasks).toHaveLength(2);
    expect(presentedTasks.map((node) => node.eventId)).toEqual([
      'event-1',
      'event-2',
    ]);
  });

  it('keeps only the latest Run lifecycle status for presentation', () => {
    const state = projectChatEvents('project-1', [
      event('run.attempt_created', {}, 1),
      event('user.message', { content: 'Research this' }, 2),
      event('run.attempt_started', {}, 3),
      event('run.completed', {}, 4),
    ]);

    const presented = presentChatSemanticEntities(
      selectRenderableChatNodes(state)
    );
    const statuses = presented.filter((node) => node.kind === 'run_status');

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      eventId: 'event-4',
      status: 'completed',
      startedAt: '2026-08-18T00:00:03Z',
    });
    expect(presentChatSemanticEntities(presented)).toEqual(presented);
  });

  it('folds correlated agent activation and completion receipts', () => {
    const state = projectChatEvents('project-1', [
      event(
        'legacy.activate_agent',
        {
          agent_name: 'single_agent',
          agent_id: 'agent-1',
          process_task_id: 'task-1',
          message: '=== Lightweight Memory ===',
        },
        1,
        { legacyStep: 'activate_agent' }
      ),
      event(
        'legacy.deactivate_agent',
        {
          agent_name: 'single_agent',
          agent_id: 'agent-1',
          process_task_id: 'task-1',
          message: 'Research complete',
        },
        2,
        { legacyStep: 'deactivate_agent' }
      ),
      event(
        'legacy.activate_agent',
        {
          agent_name: 'writer_agent',
          agent_id: 'agent-2',
          process_task_id: 'task-2',
          message: 'Draft the report',
        },
        3,
        { legacyStep: 'activate_agent' }
      ),
    ]);

    const presented = presentChatSemanticEntities(
      selectRenderableChatNodes(state)
    );
    const agents = presented.filter(
      (node) => node.kind === 'activity' && node.activityType === 'agent'
    );

    expect(agents).toHaveLength(2);
    expect(agents[0]).toMatchObject({
      eventId: 'event-1',
      status: 'completed',
      phase: 'completed',
      title: 'single_agent',
    });
    expect(agents[1]).toMatchObject({
      eventId: 'event-3',
      status: 'running',
      phase: 'unknown',
    });
    expect(presentChatSemanticEntities(presented)).toEqual(presented);
  });

  it('gives migrated live transcript families to the canonical lane only', () => {
    for (const step of ['confirmed', 'end', 'decompose_text', 'write_file']) {
      expect(shouldProjectLegacyChatStep(step, true)).toBe(false);
      expect(shouldProjectLegacyChatStep(step, false)).toBe(true);
    }
    expect(shouldProjectLegacyChatStep('ask', true)).toBe(true);
  });

  it('converges batch hydration, live reduction, and duplicate delivery', () => {
    const inputs = [
      event('user.message', { content: 'Summarize the report' }, 1),
      event('run.environment_resolved', {}, 2),
      event('tool.completed', { tool_name: 'reader' }, 3),
      event('assistant.final', { content: 'Summary complete' }, 4, {
        legacyStep: 'end',
      }),
      event('run.completed', {}, 5),
    ];
    const hydrated = projectChatEvents('project-1', inputs);
    const live = inputs.reduce(
      (state, input) => reduceChatProjection(state, input),
      createChatProjectionState('project-1')
    );
    const duplicate = reduceChatProjection(live, inputs[2]);

    const visible = (state: typeof hydrated) =>
      presentChatSemanticEntities(selectRenderableChatNodes(state));
    expect(visible(live)).toEqual(visible(hydrated));
    expect(duplicate).toBe(live);
  });
});
