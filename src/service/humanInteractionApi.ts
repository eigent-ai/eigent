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
  interactionExpiryMs,
  isInteractionTerminal,
} from '@/lib/approvalPresentation';

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
  status?: string;
  reason?: string;
  expires_at?: number | string | null;
  /** Persisted display receipt only; never submitted as decision authority. */
  receipt?: { runStatus: string };
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
  expires_at?: number | null;
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
  if (runId) pendingInteractionsByRun.delete(runId);
  else pendingInteractionsByRun.clear();
}

function listPendingHumanInteractions(
  runId: string
): Promise<PendingHumanInteractionRecord[]> {
  const now = Date.now();
  const cached = pendingInteractionsByRun.get(runId);
  if (cached && cached.expiresAt > now) return cached.request;

  let request: Promise<PendingHumanInteractionRecord[]>;
  request = fetchGet(pendingHumanInteractionsPath(runId))
    .then((response: { interactions?: PendingHumanInteractionRecord[] }) =>
      Array.isArray(response?.interactions) ? response.interactions : []
    )
    .catch((error) => {
      if (pendingInteractionsByRun.get(runId)?.request === request) {
        pendingInteractionsByRun.delete(runId);
      }
      throw error;
    });
  pendingInteractionsByRun.set(runId, {
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
  if (
    !interaction.run_id ||
    interaction.receipt ||
    isInteractionTerminal(interaction)
  )
    return false;
  const expiry = interactionExpiryMs(interaction);
  if (expiry !== null && expiry <= Date.now()) return false;
  const interactions = await listPendingHumanInteractions(interaction.run_id);
  return interactions.some(
    (candidate) =>
      candidate.interaction_id === interaction.interaction_id &&
      (candidate.status === 'requested' || candidate.status === 'presented') &&
      candidate.version === (interaction.version ?? 0) &&
      (candidate.expires_at == null ||
        candidate.expires_at * 1000 > Date.now()) &&
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
  }
) {
  if (!interaction.run_id) throw new Error('Missing durable Run id');
  const response = await fetchPost(
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
  invalidatePendingHumanInteractions(interaction.run_id);
  return response;
}

// Many legacy receipts from one Run mount together. Share only the in-flight
// snapshot; a later focus/recovery read must see the current journal state.
const receiptReads = new Map<string, ReturnType<typeof fetchGet>>();

/** Historical cards read the existing journal snapshot; a read never grants authority. */
export async function getHumanInteractionReceipt(
  interaction: HumanInteractionPayload
): Promise<Pick<
  HumanInteractionPayload,
  'status' | 'reason' | 'expires_at'
> | null> {
  if (!interaction.run_id) return null;
  const runId = interaction.run_id;
  let read = receiptReads.get(runId);
  if (!read) {
    read = fetchGet(`/runs/${encodeURIComponent(runId)}`).finally(() => {
      if (receiptReads.get(runId) === read) receiptReads.delete(runId);
    });
    receiptReads.set(runId, read);
  }
  const snapshot = await read;
  if (snapshot.run_id !== interaction.run_id) return null;
  const record = snapshot.interactions?.find(
    (candidate: { interaction_id: string }) =>
      candidate.interaction_id === interaction.interaction_id
  );
  const approval = snapshot.approvals?.find(
    (candidate: { approval_id: string }) =>
      candidate.approval_id ===
      (interaction.approval_id || interaction.interaction_id)
  );
  if (!record) return null;
  return {
    status: record.status,
    expires_at: record.expires_at,
    reason:
      typeof approval?.decision?.reason === 'string'
        ? approval.decision.reason
        : undefined,
  };
}
