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
    | 'credential_binding';
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
    `/api/v1/runs/${encodeURIComponent(interaction.run_id)}/interactions/${encodeURIComponent(interaction.interaction_id)}/decisions`,
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
