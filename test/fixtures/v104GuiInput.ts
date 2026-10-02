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

/**
 * RunEvent shapes emitted by official-v1.0.4@449f15d2. In particular the
 * legacy human_reply payload contains only agent/reply, with no interaction,
 * request or transaction identity. Each envelope remains a distinct event.
 */
export function v104GuiInputEvents(replies = ['report.csv']) {
  const events: {
    event_type: string;
    legacy_step: string | null;
    payload: Record<string, unknown>;
  }[] = [
    {
      event_type: 'interaction.requested',
      legacy_step: null,
      payload: {
        interaction_id: 'gui-question',
        attempt_id: 'attempt-1',
        interaction_type: 'question',
        request: { agent: 'worker', question: 'Which file?' },
        requested_by: 'agent',
        step_id: null,
        options: [],
        response_schema: {},
        version: 0,
        expires_at: null,
      },
    },
    {
      event_type: 'interaction.resolved',
      legacy_step: null,
      payload: {
        interaction_id: 'gui-question',
        interaction_type: 'question',
        decision_request_id: 'gui-submit',
        decision: { agent: 'worker', reply: 'report.csv' },
        actor_id: null,
        actor_type: 'user',
        source: 'desktop',
        step_id: null,
        continued_attempt: true,
        remaining_interaction_count: 0,
      },
    },
    ...replies.map((reply) => ({
      event_type: 'legacy.human_reply',
      legacy_step: 'human_reply',
      payload: { agent: 'worker', reply },
    })),
  ];
  return events.map((event, index) => ({
    schema_version: 1,
    event_id: `v104-event-${index}`,
    project_id: 'project-1',
    run_id: 'run-1',
    sequence: index + 2,
    run_sequence: index + 2,
    run_version: index + 2,
    created_at: 1000 + index,
    ...event,
  }));
}
