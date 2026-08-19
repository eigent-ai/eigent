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
        durationMs: 1250,
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
            filePath: 'uploads/brief.pdf',
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
