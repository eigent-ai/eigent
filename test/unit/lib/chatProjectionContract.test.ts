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
