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

import { normalizeLegacyChatStep } from '@/lib/projector';
import { adaptChatProjectionEvent } from '@/lib/projector/chat';
import type { CanonicalProjectEvent } from '@/lib/projector/types';
import { describe, expect, it } from 'vitest';

function event(
  payload: Record<string, unknown>,
  eventType = 'tool.started'
): CanonicalProjectEvent {
  return {
    eventId: 'tool-event-1',
    projectId: 'project-1',
    runId: 'run-1',
    runSequence: 1,
    runVersion: 1,
    cloudCursor: 1,
    eventType,
    payload,
    legacyStep: null,
    createdAt: '2026-08-13T00:00:00Z',
    source: 'canonical',
    raw: payload,
  };
}

describe('chat activity projection', () => {
  it('projects typed Single Agent progress notices with title and correlation', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          title: 'Research complete',
          content: 'Validated three primary sources.',
          notice_id: 'notice:call-1',
          tool_call_id: 'call-1',
          purpose: 'result',
          severity: 'success',
          step_id: 'step-1',
        },
        'notice.progress'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'notice',
        title: 'Research complete',
        content: 'Validated three primary sources.',
        noticeId: 'notice:call-1',
        toolCallId: 'call-1',
        stepId: 'step-1',
        purpose: 'result',
        severity: 'success',
      },
    });
  });

  it('retains tool identity and backend call correlation for presentation', () => {
    const node = adaptChatProjectionEvent(
      event({
        toolkit_name: 'WebFetchToolkit',
        method_name: 'Web_fetch_and_analyze',
        tool_name: 'web_fetch',
        tool_call_id: 'call-10',
      })
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        activityType: 'tool',
        status: 'running',
        toolkitName: 'WebFetchToolkit',
        methodName: 'Web_fetch_and_analyze',
        toolName: 'web_fetch',
        toolCallId: 'call-10',
      },
    });
  });

  it('projects a bounded identity-shaped subagent role', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          tool_name: 'agent_run_subagent',
          tool_call_id: 'subagent-call-1',
          request: {
            subagent_type: 'analysis',
            description: 'Sensitive task detail stays out of identity fields',
          },
          display_title: 'Started analysis sub-agent',
          display_input: 'Task: Analyze the data',
        },
        'tool.prepared'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        toolCallId: 'subagent-call-1',
        subagentType: 'analysis',
        subagentInvocation: true,
        input: 'Task: Analyze the data',
      },
    });
  });

  it('does not promote a raw tool request into display identity', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          tool_name: 'agent_run_subagent',
          tool_call_id: 'subagent-call-raw',
          request: { subagent_type: '/Users/alice/private/raw-role.txt' },
        },
        'tool.prepared'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        subagentInvocation: true,
        subagentType: undefined,
      },
    });
  });

  it('does not attach generic provider metadata to ordinary tools', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          tool_name: 'search_web',
          provider: 'generic-search-provider',
          model: 'search-model',
        },
        'tool.dispatched'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        agentProvider: undefined,
        agentModel: undefined,
      },
    });
  });

  it('identifies the registered Gemini remote-subagent tool provider', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          tool_name: 'run_remote_sub_agent',
          tool_call_id: 'remote-call-1',
          request: { remote_agent_name: 'researcher' },
          display_title: 'Started remote subagent',
        },
        'tool.dispatched'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        subagentType: 'researcher',
        subagentInvocation: true,
        agentProvider: 'gemini_agents',
      },
    });
  });

  it('accepts nested camel-case tool identity', () => {
    const node = adaptChatProjectionEvent(
      event({
        tool: {
          toolkitName: 'FileToolkit',
          methodName: 'read_file',
          toolName: 'read',
          invocationId: 'read-1',
        },
      })
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        toolkitName: 'FileToolkit',
        methodName: 'read_file',
        toolName: 'read',
        toolCallId: 'read-1',
      },
    });
  });

  it('projects explicit display-safe input and output for typed tools', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          tool_call_id: 'call-safe',
          display_input: 'Query: Eigent documentation',
          display_output: 'Found 3 relevant pages',
          display_summary: 'Completed in 1.3 s',
          input: 'raw secret request',
          output: 'raw secret response',
          display_duration_ms: 1250,
        },
        'tool.completed'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        phase: 'completed',
        input: 'Query: Eigent documentation',
        output: 'Found 3 relevant pages',
        detail: 'Completed in 1.3 s',
        durationMs: 1250,
      },
    });
  });

  it('uses the versioned semantic envelope for lifecycle and correlation', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          semantic_schema_version: 1,
          display_schema_version: 1,
          semantic: {
            kind: 'command_execution',
            subject: { type: 'tool_call', id: 'command-1' },
            actor: {
              type: 'agent',
              id: 'agent-1',
              name: 'Developer Agent',
            },
            lifecycle: { phase: 'completed', status: 'completed' },
            correlation: { task_id: 'task-1' },
            completeness: { state: 'complete', missing_fields: [] },
          },
          display_title: 'Ran command',
          display_input: 'Command: npm test',
          display_output: '12 tests passed',
        },
        'tool.completed'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        activityId: 'command-1',
        toolCallId: 'command-1',
        semanticKind: 'command_execution',
        semanticCompleteness: 'complete',
        semantic: {
          kind: 'command_execution',
          subject: { type: 'tool_call', id: 'command-1' },
        },
        phase: 'completed',
        status: 'completed',
        agentId: 'agent-1',
        agentName: 'Developer Agent',
        taskId: 'task-1',
      },
    });
  });

  it('rejects unknown values instead of casting an invalid V1 envelope', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          semantic_schema_version: 1,
          display_schema_version: 1,
          semantic: {
            kind: 'invented_operation',
            subject: { type: 'tool_call', id: 'command-1' },
            lifecycle: { phase: 'completed', status: 'completed' },
            completeness: { state: 'complete', missing_fields: [] },
          },
          display_title: 'Ran command',
        },
        'tool.completed'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        semantic: undefined,
        semanticKind: undefined,
        semanticCompleteness: undefined,
      },
    });
  });

  it('projects authored Step semantics from the V2 envelope', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          step_schema_version: 1,
          step: {
            step_id: 'stp-1',
            plan_id: 'plan:run-1',
            plan_item_id: 'pli-1',
            title: 'Inspect the workspace',
            summary: 'Located the relevant source and tests.',
            status: 'completed',
            ordinal: 1,
            owner: { agent_id: 'agent-1' },
          },
          attempt_id: 'attempt-1',
          semantic_schema_version: 2,
          display_schema_version: 1,
          semantic: {
            kind: 'step',
            subject: { type: 'step', id: 'stp-1' },
            actor: { type: 'agent', id: 'agent-1' },
            lifecycle: { phase: 'completed', status: 'completed' },
            correlation: {
              attempt_id: 'attempt-1',
              plan_item_id: 'pli-1',
            },
            completeness: { state: 'complete', missing_fields: [] },
          },
        },
        'step.completed'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'step',
        stepId: 'stp-1',
        planItemId: 'pli-1',
        title: 'Inspect the workspace',
        summary: 'Located the relevant source and tests.',
        status: 'completed',
        phase: 'completed',
        agentId: 'agent-1',
        attemptId: 'attempt-1',
        source: 'authored',
      },
    });
  });

  it('projects explicit Step correlation on typed tool activities', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          tool_call_id: 'call-step-1',
          step_id: 'stp-1',
          semantic_schema_version: 1,
          display_schema_version: 1,
          semantic: {
            kind: 'file_operation',
            subject: { type: 'tool_call', id: 'call-step-1' },
            lifecycle: { phase: 'completed', status: 'completed' },
            correlation: { step_id: 'stp-1' },
            completeness: { state: 'complete', missing_fields: [] },
          },
          display_title: 'Read README.md',
        },
        'tool.completed'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: { kind: 'activity', stepId: 'stp-1' },
    });
  });

  it('unwraps complete task protocol envelopes from display-safe activity text', () => {
    const task =
      '<tasks><task>Continue fixing `<device-home>/workspace/index.html`.</task></tasks>';
    const node = adaptChatProjectionEvent(
      event(
        {
          semantic_schema_version: 1,
          display_schema_version: 1,
          semantic: {
            kind: 'subtask',
            subject: { type: 'task', id: 'task-1' },
            lifecycle: { phase: 'started', status: 'running' },
            completeness: { state: 'complete', missing_fields: [] },
          },
          display_title: task,
          display_input: task,
        },
        'subtask.started'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        title: 'Continue fixing `<device-home>/workspace/index.html`.',
        input: 'Continue fixing `<device-home>/workspace/index.html`.',
      },
    });
    expect(JSON.stringify(node)).not.toContain('<tasks>');
    expect(JSON.stringify(node)).not.toContain('<task>');
  });

  it('keeps task tags that are mentioned as ordinary prose', () => {
    const title = 'Explain why the `<task>` tag is visible.';
    const node = adaptChatProjectionEvent(
      event({ display_title: title }, 'subtask.started')
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: { kind: 'activity', title },
    });
  });

  it('projects explicit Step correlation on human interactions', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          interaction_id: 'approval-1',
          interaction_type: 'approval',
          step_id: 'stp-1',
          prompt: { title: 'Allow write?' },
        },
        'approval.requested'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'interaction',
        interactionId: 'approval-1',
        stepId: 'stp-1',
        status: 'requested',
      },
    });
  });

  it('does not expose raw typed tool payloads without display fields', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          tool_call_id: 'call-private',
          input: 'raw secret request',
          output: 'raw secret response',
        },
        'tool.completed'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        input: undefined,
        output: undefined,
      },
    });
  });

  it('projects only explicit display-safe attachments for typed user messages', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          content: 'Review this file',
          attachments: [
            {
              file_name: 'secret.txt',
              file_path: '/private/secret.txt',
            },
          ],
          display_attachments: [
            {
              file_name: 'brief.pdf',
              file_path: 'uploads/brief.pdf',
              file_id: 'file-1',
              source: 'upload',
            },
          ],
        },
        'user.message'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'message',
        attachments: [
          {
            fileName: 'brief.pdf',
            fileId: 'file-1',
            source: 'upload',
          },
        ],
      },
    });
  });

  it('does not expose raw typed attachments without display metadata', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          content: 'Review this file',
          attachments: [
            {
              file_name: 'secret.txt',
              file_path: '/private/secret.txt',
            },
          ],
        },
        'user.message'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: { kind: 'message', attachments: undefined },
    });
  });

  it('projects only bounded durable review handoff ids from user messages', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          content: 'Apply these review comments',
          review_handoff_ids: ['handoff-1', '', 42, 'x'.repeat(129)],
        },
        'user.message'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'message',
        reviewHandoffIds: ['handoff-1'],
      },
    });
  });

  it('restores durable attachment names without exposing local paths', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          content: 'Compare these files',
          attachment_names: [
            'right_hemisphere.glb',
            '/Users/alice/private/left_hemisphere.glb',
          ],
        },
        'user.message'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'message',
        attachments: [
          {
            fileName: 'right_hemisphere.glb',
          },
          {
            fileName: 'left_hemisphere.glb',
          },
        ],
      },
    });
    expect(JSON.stringify(node)).not.toContain('/Users/alice');
    expect(JSON.stringify(node)).not.toContain('filePath');
  });

  it('keeps legacy activate and deactivate messages as input and output', () => {
    const activate = adaptChatProjectionEvent(
      normalizeLegacyChatStep(
        {
          step: 'activate_toolkit',
          data: {
            toolkit_name: 'Search Toolkit',
            method_name: 'search',
            message: 'Eigent event timeline',
          },
        },
        {
          projectId: 'project-1',
          runId: 'run-1',
          sequence: 1,
          sourceId: 'legacy-stream',
          createdAt: 1_000,
        }
      )
    );
    const deactivate = adaptChatProjectionEvent(
      normalizeLegacyChatStep(
        {
          step: 'deactivate_toolkit',
          data: {
            toolkit_name: 'Search Toolkit',
            method_name: 'search',
            message: 'Three results',
          },
        },
        {
          projectId: 'project-1',
          runId: 'run-1',
          sequence: 2,
          sourceId: 'legacy-stream',
          createdAt: 2_000,
        }
      )
    );

    expect(activate).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        phase: 'started',
        input: 'Eigent event timeline',
      },
    });
    expect(deactivate).toMatchObject({
      kind: 'display',
      node: { kind: 'activity', phase: 'completed', output: 'Three results' },
    });
  });

  it('hides project metadata from the activity timeline', () => {
    const node = adaptChatProjectionEvent(
      normalizeLegacyChatStep(
        {
          step: 'project_metadata',
          data: {
            project_name: 'ISS Digital Twin',
            project_summary: 'Build and verify an interactive model.',
          },
        },
        {
          projectId: 'project-1',
          runId: 'run-1',
          sequence: 1,
          sourceId: 'legacy-stream',
          createdAt: 1_000,
        }
      )
    );

    expect(node).toEqual({
      kind: 'hidden',
      reason: 'legacy.project_metadata',
    });
  });

  it('projects legacy terminal command and result as safe input and output', () => {
    const terminal = adaptChatProjectionEvent(
      normalizeLegacyChatStep(
        {
          step: 'terminal',
          data: {
            command: 'npm test -- --runInBand',
            output: '6 tests passed',
            result: 'fallback result',
          },
        },
        {
          projectId: 'project-1',
          runId: 'run-1',
          sequence: 1,
          sourceId: 'legacy-stream',
          createdAt: 1_000,
        }
      )
    );

    expect(terminal).toMatchObject({
      kind: 'display',
      node: {
        kind: 'activity',
        activityType: 'terminal',
        status: 'completed',
        input: 'npm test -- --runInBand',
        output: '6 tests passed',
      },
    });
  });

  it('keeps artifact identity separate from a machine-local path', () => {
    const node = adaptChatProjectionEvent(
      event(
        {
          artifact_id: 'artifact-1',
          file_path: '/private/workspace/outputs/report.md',
          relative_path: 'outputs/report.md',
          name: 'report.md',
        },
        'artifact.created'
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'artifact',
        artifactId: 'artifact-1',
        path: 'outputs/report.md',
        relativePath: 'outputs/report.md',
      },
    });
  });

  it('preserves a portable legacy file path as artifact identity', () => {
    const node = adaptChatProjectionEvent(
      normalizeLegacyChatStep(
        {
          step: 'write_file',
          data: { file_path: 'reports/quarterly/summary.md' },
        },
        {
          projectId: 'project-1',
          runId: 'run-1',
          sequence: 1,
          sourceId: 'legacy-stream',
          createdAt: 1_000,
        }
      )
    );

    expect(node).toMatchObject({
      kind: 'display',
      node: {
        kind: 'artifact',
        path: 'reports/quarterly/summary.md',
        relativePath: 'reports/quarterly/summary.md',
      },
    });
  });
});
