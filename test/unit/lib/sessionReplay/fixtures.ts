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

import type { CanonicalProjectEvent } from '@/lib/projector/types';

export function runEvent(
  eventType: string,
  payload: Record<string, unknown>,
  sequence: number,
  overrides: Partial<CanonicalProjectEvent> = {}
): CanonicalProjectEvent {
  const runId = overrides.runId ?? 'run-1';
  return {
    eventId: `${runId}:${sequence}`,
    projectId: 'project-1',
    runId,
    runSequence: sequence,
    runVersion: sequence,
    cloudCursor: null,
    eventType,
    payload,
    legacyStep: null,
    createdAt: `2026-11-01T10:00:${String(sequence).padStart(2, '0')}.000Z`,
    source: 'canonical',
    raw: payload,
    ...overrides,
  };
}

/** One finished Run: request, a tool call, an approval, the answer. */
export function finishedRun(runId = 'run-1'): CanonicalProjectEvent[] {
  return [
    runEvent('run.attempt_started', {}, 1, { runId }),
    runEvent('user.message', { content: 'Write the report' }, 2, { runId }),
    runEvent(
      'tool.completed',
      {
        tool_name: 'search',
        tool_call_id: 'call-1',
        display_input: 'quarterly numbers',
        display_output: 'Found 3 results',
      },
      3,
      { runId }
    ),
    runEvent(
      'approval.requested',
      {
        approval_id: 'approval:call-2',
        prompt: { question: 'The agent wants to write report.md' },
      },
      4,
      { runId }
    ),
    runEvent(
      'approval.decided',
      { approval_id: 'approval:call-2', decision: 'approve' },
      5,
      { runId }
    ),
    runEvent('assistant.final', { content: 'The report is ready.' }, 6, {
      runId,
    }),
    runEvent('run.completed', {}, 7, { runId }),
  ];
}
