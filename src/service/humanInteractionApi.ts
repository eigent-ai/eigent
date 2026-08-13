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

import { fetchPost } from '@/api/http';

export type InteractionDecisionScope = 'once' | 'run' | 'space';

export interface HumanInteractionPayload {
  interaction_id: string;
  interaction_type:
    | 'question'
    | 'choice'
    | 'form'
    | 'confirmation'
    | 'approval'
    | 'diff_review'
    | 'merge_conflict'
    | 'credential_binding'
    | 'memory_change_review';
  run_id?: string;
  version?: number;
  approval_id?: string;
  action_digest?: string;
  title?: string;
  question?: string;
  agent?: string;
  operation?: string;
  safety_class?: string;
  target_resources?: string[];
  display_arguments?: Record<string, unknown>;
  rule_matcher?: {
    action_pattern?: string | null;
    resource_pattern?: string | null;
    matcher_kind?: string | null;
  } | null;
  allowed_scopes?: InteractionDecisionScope[];
  options?: Array<{
    option_id?: string;
    id?: string;
    label: string;
    value?: unknown;
    description?: string;
  }>;
  fields?: Array<{
    id: string;
    label: string;
    type?: string;
    required?: boolean;
  }>;
}

export const humanInteractionDecisionPath = (
  runId: string,
  interactionId: string
): string =>
  `/runs/${encodeURIComponent(runId)}/interactions/${encodeURIComponent(interactionId)}/decisions`;

export async function decideHumanInteraction(
  interaction: HumanInteractionPayload,
  input: {
    decisionRequestId: string;
    decision: Record<string, unknown>;
    actorId?: string | number | null;
  }
) {
  if (!interaction.run_id) throw new Error('Missing durable Run id');
  return fetchPost(
    humanInteractionDecisionPath(
      interaction.run_id,
      interaction.interaction_id
    ),
    {
      decision_request_id: input.decisionRequestId,
      decision: input.decision,
      expected_version: interaction.version ?? 0,
      action_digest: interaction.action_digest,
      actor_type: 'user',
      actor_id:
        input.actorId === undefined || input.actorId === null
          ? null
          : String(input.actorId),
      source: 'desktop',
      continue_active_attempt: true,
    }
  );
}
