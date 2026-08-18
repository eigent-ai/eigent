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

import { adaptChatProjectionEvent } from '@/lib/projector/chat';
import type { CanonicalProjectEvent } from '@/lib/projector/types';
import { describe, expect, it } from 'vitest';

function event(payload: Record<string, unknown>): CanonicalProjectEvent {
  return {
    eventId: 'tool-event-1',
    projectId: 'project-1',
    runId: 'run-1',
    runSequence: 1,
    runVersion: 1,
    cloudCursor: 1,
    eventType: 'tool.started',
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
});
