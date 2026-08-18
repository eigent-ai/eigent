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
