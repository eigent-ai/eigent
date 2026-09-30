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

import { fetchGet, fetchPost } from '@/api/http';
import {
  createControlOperation,
  submitControlOperation,
} from './controlOperations';
import {
  ControlOutcomeUnknown,
  controlOwner,
  controlRequest,
} from './controlRequest';

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
    display_operation?: string | null;
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

export const pendingHumanInteractionsPath = (runId: string): string =>
  `/runs/${encodeURIComponent(runId)}/interactions?status=pending`;

interface PendingHumanInteractionRecord {
  interaction_id?: string;
  status?: string;
  version?: number;
  action_digest?: string | null;
}

const PENDING_INTERACTION_CACHE_TTL_MS = 3_000;
const pendingInteractionsByRun = new Map<
  string,
  {
    expiresAt: number;
    request: Promise<PendingHumanInteractionRecord[]>;
  }
>();

export function invalidatePendingHumanInteractions(runId?: string): void {
  if (runId) {
    for (const bounded of [true, false])
      pendingInteractionsByRun.delete(
        JSON.stringify([controlOwner(), runId, bounded])
      );
  } else pendingInteractionsByRun.clear();
}

function listPendingHumanInteractions(
  runId: string,
  bounded: boolean
): Promise<PendingHumanInteractionRecord[]> {
  const key = JSON.stringify([controlOwner(), runId, bounded]);
  const now = Date.now();
  const cached = pendingInteractionsByRun.get(key);
  if (cached && cached.expiresAt > now) return cached.request;

  let request: Promise<PendingHumanInteractionRecord[]>;
  request = (
    bounded
      ? controlRequest((options) =>
          fetchGet(
            pendingHumanInteractionsPath(runId),
            undefined,
            undefined,
            options
          )
        )
      : fetchGet(pendingHumanInteractionsPath(runId))
  )
    .then((response: { interactions?: PendingHumanInteractionRecord[] }) =>
      Array.isArray(response?.interactions) ? response.interactions : []
    )
    .catch((error) => {
      if (pendingInteractionsByRun.get(key)?.request === request) {
        pendingInteractionsByRun.delete(key);
      }
      throw error;
    });
  pendingInteractionsByRun.set(key, {
    expiresAt: now + PENDING_INTERACTION_CACHE_TTL_MS,
    request,
  });
  return request;
}

/**
 * Revalidate a replayed card against the local durable store before making
 * it actionable. This is intentionally narrower than trusting legacy UI task
 * ids: the exact interaction/version must still be pending in Brain. Older
 * lightweight list responses omit action_digest; the decision POST remains
 * the authority and always performs its own digest/status/version CAS.
 */
export async function isHumanInteractionStillPending(
  interaction: HumanInteractionPayload
): Promise<boolean> {
  if (!interaction.run_id) return false;
  const interactions = await listPendingHumanInteractions(
    interaction.run_id,
    interaction.interaction_type === 'approval'
  );
  return interactions.some(
    (candidate) =>
      candidate.interaction_id === interaction.interaction_id &&
      (candidate.status === 'requested' || candidate.status === 'presented') &&
      candidate.version === (interaction.version ?? 0) &&
      (interaction.action_digest === undefined ||
        candidate.action_digest === undefined ||
        candidate.action_digest === interaction.action_digest)
  );
}

export async function decideHumanInteraction(
  interaction: HumanInteractionPayload,
  input: {
    decisionRequestId: string;
    decision: Record<string, unknown>;
    actorId?: string | number | null;
    projectId?: string;
  }
) {
  if (!interaction.run_id) throw new Error('Missing durable Run id');
  const body = {
    decision_request_id: input.decisionRequestId,
    decision: input.decision,
    expected_version: interaction.version ?? 0,
    action_digest: interaction.action_digest,
    actor_type: 'user',
    actor_id: input.actorId == null ? null : String(input.actorId),
    source: 'desktop',
    continue_active_attempt: true,
  };
  if (interaction.interaction_type !== 'approval') {
    const response = await fetchPost(
      humanInteractionDecisionPath(
        interaction.run_id,
        interaction.interaction_id
      ),
      body
    );
    invalidatePendingHumanInteractions(interaction.run_id);
    return response;
  }
  const op = createControlOperation({
    kind: 'interaction',
    runId: interaction.run_id,
    projectId: input.projectId,
    interactionId: interaction.interaction_id,
    version: interaction.version ?? 0,
    digest: interaction.action_digest,
    path: humanInteractionDecisionPath(
      interaction.run_id,
      interaction.interaction_id
    ),
    body,
  });
  // A remount may supply a fresh request ID; the frozen envelope owns delivery.
  if (
    op.version !== (interaction.version ?? 0) ||
    op.digest !== interaction.action_digest ||
    JSON.stringify(op.body.decision) !== JSON.stringify(input.decision) ||
    op.body.actor_id !== (input.actorId == null ? null : String(input.actorId))
  ) {
    throw new ControlOutcomeUnknown();
  }
  const response = await submitControlOperation(op);
  invalidatePendingHumanInteractions(interaction.run_id);
  return response;
}
