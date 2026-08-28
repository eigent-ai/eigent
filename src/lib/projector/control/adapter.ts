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

import type { CanonicalProjectEvent, ProjectedLegacyStep } from '../types';
import type {
  HumanControlField,
  HumanControlOption,
  HumanControlProjectionInput,
  HumanControlProjectionUpdate,
  HumanControlRuleMatcher,
  HumanControlStatus,
  HumanControlTimestamp,
} from './types';

type JsonRecord = Record<string, unknown>;

type NormalizedInput = {
  eventId: string;
  eventType: string;
  legacyStep: string | null;
  source: CanonicalProjectEvent['source'];
  projectId: string;
  runId: string;
  sequence: number;
  cloudCursor: number | null;
  createdAt: string | null;
  data: unknown;
};

const TERMINAL_EVENT_STATUS: Record<string, HumanControlStatus> = {
  'interaction.resolved': 'resolved',
  'interaction.expired': 'expired',
  'interaction.cancelled': 'cancelled',
  'interaction.canceled': 'cancelled',
  'approval.decided': 'resolved',
  'approval.expired': 'expired',
  'approval.expired_rejected': 'expired',
  'approval.cancelled': 'cancelled',
  'approval.canceled': 'cancelled',
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function firstRecord(...values: unknown[]): JsonRecord {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return {};
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function firstTimestamp(
  ...values: unknown[]
): HumanControlTimestamp | null | undefined {
  for (const value of values) {
    if (
      (typeof value === 'string' && value.trim()) ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      return value;
    }
    if (value === null) return null;
  }
  return undefined;
}

function firstStringArray(...values: unknown[]): string[] | undefined {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    return value.filter((item): item is string => typeof item === 'string');
  }
  return undefined;
}

function own(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function humanize(value: string): string {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function options(value: unknown): HumanControlOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const projected: HumanControlOption[] = [];
  value.forEach((item, index) => {
    if (typeof item === 'string') {
      projected.push({ id: item, label: item, value: item });
      return;
    }
    if (!isRecord(item)) return;
    const id =
      firstText(item.option_id, item.id) ||
      (typeof item.value === 'string' ? item.value : String(index));
    const label = firstText(item.label, item.title, item.id, item.option_id);
    if (!label) return;
    projected.push({
      id,
      label,
      value: own(item, 'value') ? item.value : id,
      description: firstText(item.description),
    });
  });
  return projected;
}

function directFields(value: unknown): HumanControlField[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const projected = value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const id = firstText(item.id, item.name) || String(index);
    const label = firstText(item.label, item.title) || humanize(id);
    return [
      {
        id,
        label,
        type: firstText(item.type, item.input_type),
        required: item.required === true,
        description: firstText(item.description, item.help_text),
        placeholder: firstText(item.placeholder),
        options: options(item.options) || options(item.enum),
      },
    ];
  });
  return projected.length ? projected : undefined;
}

function schemaFields(value: unknown): HumanControlField[] | undefined {
  const schema = asRecord(value);
  const properties = asRecord(schema.properties);
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (field): field is string => typeof field === 'string'
        )
      : []
  );
  const projected = Object.entries(properties).flatMap(([id, rawField]) => {
    const field = asRecord(rawField);
    const enumOptions = Array.isArray(field.enum)
      ? field.enum.map((value) => {
          const label =
            typeof value === 'string'
              ? value
              : (JSON.stringify(value) ?? String(value));
          return { id: label, label, value };
        })
      : undefined;
    return [
      {
        id,
        label: firstText(field.title) || humanize(id),
        type: firstText(field.type),
        required: required.has(id),
        description: firstText(field.description),
        placeholder: firstText(field.placeholder),
        options: enumOptions,
      },
    ];
  });
  return projected.length ? projected : undefined;
}

function ruleMatcher(
  value: unknown
): HumanControlRuleMatcher | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  return {
    actionPattern: firstText(value.action_pattern, value.actionPattern) ?? null,
    resourcePattern:
      firstText(value.resource_pattern, value.resourcePattern) ?? null,
    matcherKind: firstText(value.matcher_kind, value.matcherKind) ?? null,
  };
}

function timestampFromLegacy(step: ProjectedLegacyStep): string | null {
  if (step.timestamp === null || !Number.isFinite(step.timestamp)) return null;
  return new Date(step.timestamp * 1000).toISOString();
}

function isCanonicalEvent(
  input: HumanControlProjectionInput
): input is CanonicalProjectEvent {
  return 'eventType' in input && 'payload' in input;
}

function normalizeInput(input: HumanControlProjectionInput): NormalizedInput {
  if (isCanonicalEvent(input)) {
    return {
      eventId: input.eventId,
      eventType: input.eventType,
      legacyStep: input.legacyStep,
      source: input.source,
      projectId: input.projectId,
      runId: input.runId,
      sequence: input.runSequence,
      cloudCursor: input.cloudCursor,
      createdAt: input.createdAt,
      data: input.payload.__legacy_data ?? input.payload,
    };
  }
  return {
    eventId: input.eventId,
    eventType: `legacy.${input.step}`,
    legacyStep: input.step,
    source: input.source,
    projectId: input.projectId,
    runId: input.taskId,
    sequence: input.runSequence,
    cloudCursor: input.cloudCursor,
    createdAt: timestampFromLegacy(input),
    data: input.data,
  };
}

function metadata(
  input: NormalizedInput,
  status: HumanControlStatus
): HumanControlProjectionUpdate {
  const payload = asRecord(input.data);
  const request = asRecord(payload.request);
  const promptRecord = asRecord(payload.prompt);
  const action = firstRecord(
    payload.action,
    request.action,
    promptRecord.action
  );
  const displayArguments = firstRecord(
    payload.display_arguments,
    request.display_arguments,
    promptRecord.display_arguments,
    action.normalized_arguments
  );
  const responseSchema = firstRecord(
    payload.response_schema,
    request.response_schema,
    promptRecord.response_schema
  );
  const approvalId = firstText(
    payload.approval_id,
    request.approval_id,
    promptRecord.approval_id
  );
  const explicitInteractionId = firstText(
    payload.interaction_id,
    payload.interactionId,
    request.interaction_id,
    promptRecord.interaction_id,
    approvalId
  );
  const isRequest = status === 'requested';
  const isApproval =
    input.eventType.startsWith('approval.') || Boolean(approvalId);
  const directPrompt =
    typeof payload.prompt === 'string' ? payload.prompt : undefined;
  const fieldList =
    directFields(payload.fields) ||
    directFields(request.fields) ||
    directFields(promptRecord.fields) ||
    schemaFields(responseSchema);

  return {
    eventId: input.eventId,
    eventType: input.eventType,
    source: input.source,
    projectId: input.projectId,
    runId: input.runId,
    sequence: input.sequence,
    cloudCursor: input.cloudCursor,
    createdAt: input.createdAt,
    status,
    interactionId:
      explicitInteractionId ||
      (isRequest ? `legacy:${input.runId}:${input.eventId}` : undefined),
    interactionType:
      firstText(
        payload.interaction_type,
        payload.interactionType,
        request.interaction_type,
        promptRecord.interaction_type
      ) || (isApproval ? 'approval' : isRequest ? 'question' : undefined),
    version: firstNumber(
      payload.version,
      request.version,
      promptRecord.version
    ),
    approvalId,
    actionDigest: firstText(
      payload.action_digest,
      request.action_digest,
      promptRecord.action_digest
    ),
    allowedScopes: firstStringArray(
      payload.allowed_scopes,
      request.allowed_scopes,
      promptRecord.allowed_scopes
    ),
    title: firstText(payload.title, request.title, promptRecord.title),
    prompt: firstText(
      payload.question,
      directPrompt,
      request.question,
      request.prompt,
      promptRecord.question,
      promptRecord.prompt
    ),
    agent: firstText(
      payload.agent,
      payload.agent_name,
      payload.agent_id,
      request.agent,
      request.agent_name,
      request.agent_id,
      promptRecord.agent,
      promptRecord.agent_name,
      promptRecord.agent_id
    ),
    operation: firstText(
      payload.operation,
      request.operation,
      promptRecord.operation,
      action.operation
    ),
    targetResources: firstStringArray(
      payload.target_resources,
      payload.conflict_paths,
      request.target_resources,
      request.conflict_paths,
      promptRecord.target_resources,
      promptRecord.conflict_paths,
      action.target_resources
    ),
    // Only explicitly redacted/display-safe fields are retained here. Raw
    // action arguments and the complete event payload never enter the state.
    displayArguments:
      Object.keys(displayArguments).length > 0 ? displayArguments : undefined,
    ruleMatcher: ruleMatcher(
      payload.rule_matcher ?? request.rule_matcher ?? promptRecord.rule_matcher
    ),
    options:
      options(payload.options) ||
      options(request.options) ||
      options(promptRecord.options),
    fields: fieldList,
    expiresAt: firstTimestamp(
      payload.expires_at,
      request.expires_at,
      promptRecord.expires_at
    ),
    deadlineAt: firstTimestamp(
      payload.deadline_at,
      payload.deadline,
      request.deadline_at,
      request.deadline,
      promptRecord.deadline_at,
      promptRecord.deadline
    ),
  };
}

/**
 * Convert canonical and migration-era interaction events into one lifecycle
 * patch. Unrelated events return null and cannot enter human-control state.
 */
export function adaptHumanControlEvent(
  source: HumanControlProjectionInput
): HumanControlProjectionUpdate | null {
  const input = normalizeInput(source);

  if (
    input.eventType === 'interaction.requested' ||
    input.eventType === 'approval.requested'
  ) {
    return metadata(input, 'requested');
  }

  const terminalStatus = TERMINAL_EVENT_STATUS[input.eventType];
  if (terminalStatus) return metadata(input, terminalStatus);

  const step = input.legacyStep || input.eventType.replace(/^legacy\./, '');
  if (step === 'ask') return metadata(input, 'requested');
  if (step === 'human_reply') return metadata(input, 'resolved');

  return null;
}
