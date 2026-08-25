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

import i18next from 'i18next';
import type {
  CanonicalProjectEvent,
  CanonicalSemanticActorType,
  CanonicalSemanticEnvelope,
  CanonicalSemanticKind,
  CanonicalSemanticKindV2,
  CanonicalSemanticPhase,
  CanonicalSemanticPhaseV2,
  CanonicalSemanticStatus,
  CanonicalSemanticStatusV2,
  CanonicalSemanticSubjectType,
  CanonicalSemanticSubjectTypeV2,
  ProjectedLegacyStep,
} from '../types';
import type {
  ChatActivityNode,
  ChatActivityPhase,
  ChatActivityStatus,
  ChatActivityType,
  ChatArtifactNode,
  ChatArtifactOperation,
  ChatInteractionNode,
  ChatInteractionOption,
  ChatMessageAttachment,
  ChatMessageNode,
  ChatMessagePurpose,
  ChatNoticeNode,
  ChatPlanNode,
  ChatPlanTask,
  ChatPlanTaskStatus,
  ChatProjectionDecision,
  ChatProjectionInput,
  ChatProjectionNode,
  ChatProjectionNodeBase,
  ChatRunStatus,
  ChatRunStatusNode,
  ChatStepNode,
  ChatStepStatus,
  ChatUnknownNode,
} from './types';

type JsonRecord = Record<string, unknown>;

type NormalizedInput = {
  base: ChatProjectionNodeBase;
  data: unknown;
};

const RUN_STATUS_BY_EVENT: Record<string, ChatRunStatus> = {
  'run.attempt_created': 'pending',
  'run.attempt_started': 'running',
  'run.cancel_requested': 'cancelling',
  'run.cancelled': 'cancelled',
  'run.completed': 'completed',
  'run.failed': 'failed',
  'run.deadline_reached': 'failed',
  'run.interrupted': 'interrupted',
  'runtime.interrupted': 'interrupted',
};

const NOTICE_STEP_SEVERITY: Record<string, ChatNoticeNode['severity']> = {
  notice: 'info',
  notice_card: 'info',
  budget_not_enough: 'warning',
  context_too_long: 'warning',
  error: 'error',
  failed: 'error',
};

const RECEIPT_ONLY_EVENT_TYPES = new Set([
  'run.environment_resolved',
  'run.timeout_policy_configured',
  'run.attempt_environment_bound',
  'run.forked',
  'approval.expiry_observed',
  'artifact.manifest.finalized',
  'artifact.uploaded',
  'workspace.writer.released',
  'workspace.writer.interrupted',
]);

const RECEIPT_ONLY_EVENT_PREFIXES = [
  'permission.action.',
  'admission.',
  'execution.',
  'model.invocation.',
] as const;

const HIDDEN_LEGACY_STEPS = new Set([
  'project_metadata',
  'request_usage',
  'sync',
]);

const SEMANTIC_KINDS = new Set<CanonicalSemanticKind>([
  'agent',
  'agent_turn',
  'browser_operation',
  'command_execution',
  'file_change',
  'file_operation',
  'git_conflict_resolution',
  'git_integration',
  'narration',
  'plan',
  'plan_operation',
  'subtask',
  'tool_call',
  'workspace_writer',
]);

const SEMANTIC_SUBJECT_TYPES = new Set<CanonicalSemanticSubjectType>([
  'activity_stream',
  'agent',
  'agent_turn',
  'agent_workspace',
  'artifact',
  'file',
  'plan',
  'task',
  'tool_call',
  'writer_request',
]);

const SEMANTIC_ACTOR_TYPES = new Set<CanonicalSemanticActorType>([
  'agent',
  'system',
  'user',
]);

const SEMANTIC_PHASES = new Set<CanonicalSemanticPhase>([
  'requested',
  'started',
  'progress',
  'completed',
  'failed',
  'cancelled',
  'unknown',
]);

const SEMANTIC_STATUSES = new Set<CanonicalSemanticStatus>([
  'pending',
  'running',
  'completed',
  'failed',
  'timed_out',
  'outcome_unknown',
  'cancelled',
  'unknown',
]);

const SEMANTIC_KINDS_V2 = new Set<CanonicalSemanticKindV2>([
  ...SEMANTIC_KINDS,
  'step',
]);
const SEMANTIC_SUBJECT_TYPES_V2 = new Set<CanonicalSemanticSubjectTypeV2>([
  ...SEMANTIC_SUBJECT_TYPES,
  'step',
]);
const SEMANTIC_PHASES_V2 = new Set<CanonicalSemanticPhaseV2>([
  ...SEMANTIC_PHASES,
  'blocked',
  'resumed',
  'interrupted',
]);
const SEMANTIC_STATUSES_V2 = new Set<CanonicalSemanticStatusV2>([
  ...SEMANTIC_STATUSES,
  'blocked',
  'interrupted',
]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function own(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function ownsAny(record: JsonRecord, keys: readonly string[]): boolean {
  return keys.some((key) => own(record, key));
}

function semanticEnvelope(
  payload: JsonRecord
): CanonicalSemanticEnvelope | null {
  const version = payload.semantic_schema_version;
  if (
    ![1, 2].includes(Number(version)) ||
    payload.display_schema_version !== 1
  ) {
    return null;
  }
  const semantic = asRecord(payload.semantic);
  const subject = asRecord(semantic.subject);
  const lifecycle = asRecord(semantic.lifecycle);
  const completeness = asRecord(semantic.completeness);
  const kind = firstText(semantic.kind) as CanonicalSemanticKindV2;
  const subjectType = firstText(subject.type) as CanonicalSemanticSubjectTypeV2;
  const phase = firstText(lifecycle.phase) as CanonicalSemanticPhaseV2;
  const status = firstText(lifecycle.status) as CanonicalSemanticStatusV2;
  const completenessState = firstText(completeness.state);
  const kinds = version === 2 ? SEMANTIC_KINDS_V2 : SEMANTIC_KINDS;
  const subjectTypes =
    version === 2 ? SEMANTIC_SUBJECT_TYPES_V2 : SEMANTIC_SUBJECT_TYPES;
  const phases = version === 2 ? SEMANTIC_PHASES_V2 : SEMANTIC_PHASES;
  const statuses = version === 2 ? SEMANTIC_STATUSES_V2 : SEMANTIC_STATUSES;
  if (
    !kinds.has(kind as never) ||
    !subjectTypes.has(subjectType as never) ||
    !phases.has(phase as never) ||
    !statuses.has(status as never) ||
    !['complete', 'partial'].includes(completenessState)
  ) {
    return null;
  }
  const actor = asRecord(semantic.actor);
  const actorType = firstText(actor.type) as CanonicalSemanticActorType;
  if (actorType && !SEMANTIC_ACTOR_TYPES.has(actorType)) return null;
  const correlation = asRecord(semantic.correlation);
  const provenance = asRecord(semantic.provenance);
  return {
    kind,
    subject: { type: subjectType, id: firstText(subject.id) },
    actor: Object.keys(actor).length
      ? {
          type: actorType || undefined,
          id: firstText(actor.id) || undefined,
          name: firstText(actor.name) || undefined,
        }
      : undefined,
    lifecycle: {
      phase,
      status,
    },
    correlation: Object.fromEntries(
      Object.entries(correlation).flatMap(([key, value]) => {
        const text = firstText(value);
        return text ? [[key, text]] : [];
      })
    ),
    completeness: {
      state: completenessState as 'complete' | 'partial',
      missing_fields: Array.isArray(completeness.missing_fields)
        ? completeness.missing_fields.flatMap((value) => {
            const text = firstText(value);
            return text ? [text] : [];
          })
        : [],
    },
    provenance: Object.keys(provenance).length
      ? { source: firstText(provenance.source) || undefined }
      : undefined,
  } as CanonicalSemanticEnvelope;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return '';
}

/**
 * Delegated-agent role fields are model/provider supplied rather than
 * presentation text. Accept only short identity-shaped values before they can
 * become a UI label; paths, URLs, control characters, and free-form payloads
 * fall back to the localized generic label.
 */
function safeDelegatedAgentIdentity(...values: unknown[]): string {
  const identity = firstText(...values)
    .trim()
    .replace(/\s+/g, ' ');
  if (!identity || identity.length > 48) return '';
  return /^[A-Za-z0-9]+(?:[ _.-][A-Za-z0-9]+)*$/.test(identity) ? identity : '';
}

function portableRelativePath(value: unknown): string {
  const normalized = firstText(value).trim().replaceAll('\\', '/');
  if (!normalized) return '';

  const withoutCurrentDirectory = normalized.replace(/^(\.\/)+/, '');
  if (
    !withoutCurrentDirectory ||
    withoutCurrentDirectory.startsWith('/') ||
    withoutCurrentDirectory.startsWith('~/') ||
    /^[a-zA-Z]:\//.test(withoutCurrentDirectory) ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(withoutCurrentDirectory) ||
    withoutCurrentDirectory.split('/').includes('..')
  ) {
    return '';
  }
  return withoutCurrentDirectory;
}

function safeArtifactBasename(...values: unknown[]): string {
  for (const value of values) {
    const normalized = firstText(value).trim().replaceAll('\\', '/');
    const basename = normalized.split('/').filter(Boolean).at(-1);
    if (basename && basename !== '.' && basename !== '..') return basename;
  }
  return '';
}

/** Message bodies and delta fragments must preserve significant whitespace. */
function firstContent(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return '';
}

/**
 * CAMEL uses `<tasks><task>…</task></tasks>` as an agent-to-agent protocol
 * envelope. The canonical event keeps that source text for replay and audit,
 * but exposing the envelope in Timeline makes implementation syntax look like
 * user-authored content. Only unwrap a complete outer envelope so ordinary
 * prose or code that merely mentions `<task>` remains unchanged.
 */
function unwrapTaskProtocolEnvelope(value: string): string {
  let text = value.trim();
  if (!text) return value;

  const tasksEnvelope = text.match(
    /^<tasks(?:\s[^>]*)?>\s*([\s\S]*?)\s*<\/tasks>$/i
  );
  if (tasksEnvelope) {
    text = tasksEnvelope[1]!.trim();
    return text
      .replace(/<\/task>\s*<task(?:\s[^>]*)?>/gi, '\n\n')
      .replace(/^<task(?:\s[^>]*)?>\s*/i, '')
      .replace(/\s*<\/task>$/i, '')
      .trim();
  }

  const taskEnvelope = text.match(
    /^<task(?:\s[^>]*)?>\s*([\s\S]*?)\s*<\/task>$/i
  );
  return taskEnvelope ? taskEnvelope[1]!.trim() : value;
}

function messageContent(
  base: ChatProjectionNodeBase,
  payload: JsonRecord,
  data: unknown
): string {
  if (base.eventType === 'message.delta') {
    const deltaRecord = asRecord(payload.delta);
    const hasDelta = ownsAny(payload, [
      'delta',
      'content_delta',
      'text_delta',
      'chunk',
    ]);
    if (hasDelta) {
      return firstContent(
        typeof payload.delta === 'string' ? payload.delta : undefined,
        deltaRecord.content,
        deltaRecord.text,
        payload.content_delta,
        payload.text_delta,
        payload.chunk
      );
    }
    if (ownsAny(payload, ['content', 'text', 'message', 'answer', 'result'])) {
      return firstContent(
        payload.content,
        payload.text,
        payload.message,
        payload.answer,
        payload.result
      );
    }
    return '';
  }

  if (
    ownsAny(payload, [
      'content',
      'text',
      'message',
      'answer',
      'result',
      'summary',
      'report',
      'question',
    ])
  ) {
    return firstContent(
      payload.content,
      payload.text,
      payload.message,
      payload.answer,
      payload.result,
      payload.summary,
      payload.report,
      payload.question
    );
  }

  const legacyContent = firstText(data);
  return legacyContent || '';
}

function messageAttachments(
  base: ChatProjectionNodeBase,
  payload: JsonRecord
): ChatMessageAttachment[] | undefined {
  const isLegacy = base.eventType.startsWith('legacy.');
  const source = isLegacy
    ? (payload.attaches ?? payload.attachments)
    : (payload.display_attachments ?? payload.displayAttachments);
  if (Array.isArray(source)) {
    const attachments = source.flatMap<ChatMessageAttachment>((value) => {
      const attachment = asRecord(value);
      const fileName = firstText(
        attachment.file_name,
        attachment.fileName,
        attachment.name
      );
      const filePath = firstText(
        attachment.file_path,
        attachment.filePath,
        attachment.relative_path,
        attachment.relativePath
      );
      if (!fileName || (isLegacy && !filePath)) return [];
      const rawSource = firstText(attachment.source);
      return [
        {
          fileName,
          ...(isLegacy && filePath ? { filePath } : {}),
          fileId: firstText(attachment.file_id, attachment.fileId) || undefined,
          source:
            rawSource === 'local' || rawSource === 'upload'
              ? rawSource
              : undefined,
        },
      ];
    });
    if (attachments.length > 0) return attachments;
  }

  if (isLegacy) return undefined;
  const durableNames = payload.attachment_names ?? payload.attachmentNames;
  if (!Array.isArray(durableNames)) return undefined;
  const attachments = durableNames.flatMap<ChatMessageAttachment>((value) => {
    const fileName = safeArtifactBasename(value);
    return fileName ? [{ fileName }] : [];
  });
  return attachments.length > 0 ? attachments : undefined;
}

function nestedText(value: unknown): string {
  if (!isRecord(value)) return firstText(value);
  return firstText(
    value.content,
    value.text,
    value.message,
    value.question,
    value.title,
    value.description,
    value.reason
  );
}

function responseText(value: unknown): string {
  const direct = firstText(value);
  if (direct) return direct;
  if (!isRecord(value)) return '';
  const nested = firstText(
    value.reply,
    value.response,
    value.answer,
    value.content,
    value.text,
    value.decision,
    value.result
  );
  return nested;
}

function explicitInteractionId(payload: JsonRecord): string | undefined {
  const request = asRecord(payload.request);
  const prompt = asRecord(payload.prompt);
  return (
    firstText(
      payload.interaction_id,
      payload.interactionId,
      payload.approval_id,
      payload.approvalId,
      request.interaction_id,
      request.interactionId,
      request.approval_id,
      request.approvalId,
      prompt.interaction_id,
      prompt.interactionId,
      prompt.approval_id,
      prompt.approvalId
    ) || undefined
  );
}

function explicitMessageId(payload: JsonRecord): string | undefined {
  const message = asRecord(payload.message);
  return (
    firstText(
      payload.message_id,
      payload.messageId,
      message.message_id,
      message.messageId
    ) || undefined
  );
}

/**
 * Retain only backend option identifiers from a decision. Option values can be
 * opaque objects (and may contain data that is not intended for Timeline
 * display), so the presentation layer resolves these ids against the safe
 * labels retained on the request node.
 */
function responseOptionIds(value: unknown): string[] | undefined {
  if (!isRecord(value)) return undefined;
  const candidates: unknown[] = [value.option_id, value.optionId];
  for (const collection of [
    value.option_ids,
    value.optionIds,
    value.selected_option_ids,
    value.selectedOptionIds,
    value.selected_ids,
    value.selectedIds,
  ]) {
    if (Array.isArray(collection)) candidates.push(...collection);
  }

  const ids = candidates.flatMap((candidate) => {
    if (typeof candidate === 'string' && candidate.trim()) {
      return [candidate];
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return [String(candidate)];
    }
    return [];
  });
  const uniqueIds = [...new Set(ids)];
  return uniqueIds.length ? uniqueIds : undefined;
}

function timestampFromLegacy(step: ProjectedLegacyStep): string | null {
  if (step.timestamp === null || !Number.isFinite(step.timestamp)) return null;
  return new Date(step.timestamp * 1000).toISOString();
}

function isCanonicalEvent(
  input: ChatProjectionInput
): input is CanonicalProjectEvent {
  return 'eventType' in input && 'payload' in input;
}

function normalizeInput(input: ChatProjectionInput): NormalizedInput {
  if (isCanonicalEvent(input)) {
    const semantic = semanticEnvelope(input.payload) || undefined;
    return {
      base: {
        id: input.eventId,
        eventId: input.eventId,
        projectId: input.projectId,
        runId: input.runId,
        createdAt: input.createdAt,
        runSequence: input.runSequence,
        cloudCursor: input.cloudCursor,
        eventType: input.eventType,
        legacyStep: input.legacyStep,
        semantic,
      },
      data: input.payload.__legacy_data ?? input.payload,
    };
  }
  return {
    base: {
      id: input.eventId,
      eventId: input.eventId,
      projectId: input.projectId,
      runId: input.taskId,
      createdAt: timestampFromLegacy(input),
      runSequence: input.runSequence,
      cloudCursor: input.cloudCursor,
      eventType: `legacy.${input.step}`,
      legacyStep: input.step,
    },
    data: input.data,
  };
}

function messageNode(
  base: ChatProjectionNodeBase,
  data: unknown,
  roleOverride?: ChatMessageNode['role']
): ChatMessageNode {
  const payload = asRecord(data);
  const message = asRecord(payload.message);
  const messagePayload = { ...payload, ...message };
  const rawRole = firstText(messagePayload.role).toLowerCase();
  const role =
    roleOverride ||
    (rawRole === 'user' || rawRole === 'human' ? 'user' : 'assistant');
  const eventIsStreaming =
    base.eventType === 'message.created' ||
    base.eventType === 'message.delta' ||
    base.legacyStep === 'decompose_text';
  const explicitPurpose = firstText(
    messagePayload.message_purpose,
    messagePayload.messagePurpose,
    messagePayload.display_purpose,
    messagePayload.displayPurpose
  )
    .trim()
    .toLowerCase();
  const knownPurposes = new Set<ChatMessagePurpose>([
    'query',
    'narration',
    'agent_result',
    'final',
    'interaction_response',
    'unknown',
  ]);
  const purpose: ChatMessagePurpose = knownPurposes.has(
    explicitPurpose as ChatMessagePurpose
  )
    ? (explicitPurpose as ChatMessagePurpose)
    : role === 'user'
      ? base.legacyStep === 'human_reply'
        ? 'interaction_response'
        : 'query'
      : base.eventType === 'assistant.final' || base.legacyStep === 'end'
        ? 'final'
        : base.legacyStep === 'agent_end' ||
            base.legacyStep === 'agent_summary_end'
          ? 'agent_result'
          : 'narration';
  const rawReviewHandoffIds =
    messagePayload.review_handoff_ids ?? messagePayload.reviewHandoffIds;
  const reviewHandoffIds = Array.isArray(rawReviewHandoffIds)
    ? [
        ...new Set(
          rawReviewHandoffIds.flatMap((value) => {
            const id = typeof value === 'string' ? value.trim() : '';
            return id && id.length <= 128 ? [id] : [];
          })
        ),
      ].slice(0, 64)
    : [];
  return {
    ...base,
    kind: 'message',
    role,
    content: messageContent(base, messagePayload, data),
    status: eventIsStreaming ? 'streaming' : 'complete',
    purpose,
    attachments: messageAttachments(base, messagePayload),
    messageId: explicitMessageId(messagePayload),
    agentId:
      firstText(messagePayload.agent_id, messagePayload.agentId) || undefined,
    agentName:
      firstText(
        messagePayload.agent_name,
        messagePayload.agentName,
        messagePayload.agent
      ) || undefined,
    reviewHandoffIds:
      reviewHandoffIds.length > 0 ? reviewHandoffIds : undefined,
  };
}

function noticeNode(
  base: ChatProjectionNodeBase,
  data: unknown,
  severity: ChatNoticeNode['severity']
): ChatNoticeNode {
  const payload = asRecord(data);
  const payloadSeverity = firstText(payload.severity).toLowerCase();
  const resolvedSeverity = ['info', 'success', 'warning', 'error'].includes(
    payloadSeverity
  )
    ? (payloadSeverity as ChatNoticeNode['severity'])
    : severity;
  const payloadPurpose = firstText(payload.purpose).toLowerCase();
  return {
    ...base,
    kind: 'notice',
    severity: resolvedSeverity,
    content:
      firstText(
        payload.notice,
        payload.content,
        payload.message_description,
        payload.messageDescription,
        payload.message,
        payload.error,
        payload.reason,
        payload.answer,
        data
      ) || humanize(base.legacyStep || base.eventType),
    title:
      firstText(payload.title, payload.message_title, payload.messageTitle) ||
      undefined,
    purpose: ['progress', 'result', 'decision', 'status'].includes(
      payloadPurpose
    )
      ? (payloadPurpose as ChatNoticeNode['purpose'])
      : undefined,
    noticeId: firstText(payload.notice_id, payload.noticeId) || undefined,
    code: firstText(payload.code) || undefined,
    toolCallId:
      firstText(
        payload.tool_call_id,
        payload.toolCallId,
        payload.call_id,
        payload.callId
      ) || undefined,
    stepId:
      firstText(
        payload.step_id,
        payload.stepId,
        base.semantic?.correlation?.step_id
      ) || undefined,
  };
}

function interactionOptions(
  value: unknown
): ChatInteractionOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value.flatMap((option, index) => {
    if (typeof option === 'string') {
      return [{ id: option, label: option }];
    }
    if (!isRecord(option)) return [];
    const label = firstText(
      option.label,
      option.title,
      option.value,
      option.id
    );
    if (!label) return [];
    return [
      {
        id:
          firstText(option.id, option.option_id, option.value) || String(index),
        label,
        description: firstText(option.description) || undefined,
      },
    ];
  });
  return options.length ? options : undefined;
}

function interactionNode(
  base: ChatProjectionNodeBase,
  data: unknown,
  status: ChatInteractionNode['status']
): ChatInteractionNode {
  const payload = asRecord(data);
  const request = asRecord(payload.request ?? payload.prompt);
  const decision = payload.decision ?? payload.response ?? payload.reply;
  return {
    ...base,
    kind: 'interaction',
    interactionId: explicitInteractionId(payload),
    stepId: firstText(payload.step_id, payload.stepId) || undefined,
    interactionType:
      firstText(
        payload.interaction_type,
        payload.interactionType,
        base.eventType.startsWith('approval.') ? 'approval' : undefined
      ) || 'question',
    status,
    prompt:
      firstText(
        payload.question,
        payload.content,
        payload.notice,
        payload.answer,
        request.question,
        nestedText(payload.request),
        nestedText(payload.prompt)
      ) || undefined,
    response: responseText(decision) || undefined,
    responseOptionIds: responseOptionIds(decision),
    agentName:
      firstText(
        payload.agent_name,
        payload.agentName,
        payload.agent,
        // A typed approval keeps the requesting agent inside its prompt, while
        // the legacy mirror carries it at the top level. Reading both keeps the
        // canonical node at identity parity with the mirror it replaces.
        request.agent_name,
        request.agentName,
        request.agent
      ) || undefined,
    options: interactionOptions(payload.options),
  };
}

function normalizePlanTaskStatus(value: unknown): ChatPlanTaskStatus {
  const status = firstText(value).toLowerCase();
  if (['pending', 'open', 'waiting', ''].includes(status)) return 'pending';
  if (['running', 'in_progress', 'active'].includes(status)) return 'running';
  if (['completed', 'complete', 'done', 'success'].includes(status)) {
    return 'completed';
  }
  if (['failed', 'error'].includes(status)) return 'failed';
  if (status === 'skipped') return 'skipped';
  if (status === 'blocked') return 'blocked';
  return 'unknown';
}

function planTasks(data: JsonRecord, eventId: string): ChatPlanTask[] {
  const candidates = data.tasks ?? data.sub_tasks ?? data.todos;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap<ChatPlanTask>((candidate, index) => {
    if (typeof candidate === 'string') {
      return [
        {
          id: `${eventId}:task:${index}`,
          title: unwrapTaskProtocolEnvelope(candidate),
          status: 'pending' as const,
        },
      ];
    }
    if (!isRecord(candidate)) return [];
    const title = unwrapTaskProtocolEnvelope(
      firstText(
        candidate.title,
        candidate.content,
        candidate.description,
        candidate.active_form,
        candidate.summary,
        candidate.name
      )
    );
    if (!title) return [];
    return [
      {
        id:
          firstText(candidate.id, candidate.task_id, candidate.taskId) ||
          `${eventId}:task:${index}`,
        title,
        status: normalizePlanTaskStatus(candidate.status ?? candidate.state),
        agentId:
          firstText(candidate.agent_id, candidate.assignee_id) || undefined,
        agentName:
          firstText(candidate.agent_name, candidate.assignee_name) || undefined,
      },
    ];
  });
}

function planNode(base: ChatProjectionNodeBase, data: unknown): ChatPlanNode {
  const root = asRecord(data);
  const nestedPlan = asRecord(root.plan);
  const payload = { ...root, ...nestedPlan };
  const isTypedPlan = base.eventType.startsWith('plan.');
  const summaryTask = firstText(payload.summary_task);
  const separator = summaryTask.indexOf('|');
  const derivedTitle =
    separator >= 0 ? summaryTask.slice(0, separator).trim() : '';
  const derivedSummary =
    separator >= 0 ? summaryTask.slice(separator + 1).trim() : summaryTask;
  return {
    ...base,
    kind: 'plan',
    status: isTypedPlan
      ? base.eventType === 'plan.completed'
        ? 'completed'
        : 'active'
      : undefined,
    title:
      firstText(
        payload.display_title,
        payload.displayTitle,
        payload.title,
        payload.name,
        derivedTitle
      ) || undefined,
    summary:
      firstText(
        payload.display_summary,
        payload.displaySummary,
        payload.summary,
        payload.description,
        derivedSummary
      ) || undefined,
    tasks: planTasks(payload, base.id),
  };
}

function normalizeActivityStatus(
  value: unknown,
  fallback: ChatActivityStatus
): ChatActivityStatus {
  const status = firstText(value).toLowerCase();
  if (!status) return fallback;
  if (['pending', 'open', 'waiting', 'assigned'].includes(status)) {
    return 'pending';
  }
  if (status === 'prepared') return 'pending';
  if (['running', 'active', 'in_progress', 'started'].includes(status)) {
    return 'running';
  }
  if (status === 'dispatched') return 'running';
  if (
    ['completed', 'complete', 'done', 'success', 'resolved'].includes(status)
  ) {
    return 'completed';
  }
  if (['failed', 'error'].includes(status)) return 'failed';
  if (status === 'timed_out') return 'timed_out';
  if (status === 'outcome_unknown') return 'outcome_unknown';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (status === 'blocked') return 'blocked';
  if (status === 'interrupted') return 'interrupted';
  return 'unknown';
}

/**
 * Typed durable events must opt into Timeline display text. Tool output and
 * result fields can contain credentials, large blobs, or machine-oriented
 * payloads, so they are intentionally accepted only on the legacy lane.
 */
function activityDetail(payload: JsonRecord, isTypedActivity: boolean): string {
  if (isTypedActivity) {
    return unwrapTaskProtocolEnvelope(
      firstText(
        payload.display_detail,
        payload.displayDetail,
        payload.display_summary,
        payload.displaySummary
      )
    );
  }
  return unwrapTaskProtocolEnvelope(
    firstText(payload.detail, payload.output, payload.result, payload.reason)
  );
}

/**
 * Typed events may expose tool payloads only through explicit display fields.
 * The canonical raw request/result can contain credentials or large blobs and
 * must never be used as a UI fallback.
 */
function activityInput(
  base: ChatProjectionNodeBase,
  payload: JsonRecord,
  tool: JsonRecord,
  isTypedActivity: boolean
): string {
  const display = asRecord(payload.display);
  const toolDisplay = asRecord(tool.display);
  if (isTypedActivity) {
    return unwrapTaskProtocolEnvelope(
      firstText(
        payload.display_input,
        payload.displayInput,
        payload.display_request,
        payload.displayRequest,
        display.input,
        display.request,
        tool.display_input,
        tool.displayInput,
        toolDisplay.input,
        toolDisplay.request
      )
    );
  }
  if (base.legacyStep === 'terminal') {
    return unwrapTaskProtocolEnvelope(
      firstText(payload.command, payload.input, payload.request)
    );
  }
  return unwrapTaskProtocolEnvelope(
    base.legacyStep === 'activate_toolkit'
      ? firstText(payload.message, payload.input, payload.request)
      : firstText(payload.input, payload.request)
  );
}

function activityOutput(
  base: ChatProjectionNodeBase,
  payload: JsonRecord,
  tool: JsonRecord,
  isTypedActivity: boolean
): string {
  const display = asRecord(payload.display);
  const toolDisplay = asRecord(tool.display);
  if (isTypedActivity) {
    return unwrapTaskProtocolEnvelope(
      firstText(
        payload.display_output,
        payload.displayOutput,
        payload.display_response,
        payload.displayResponse,
        display.output,
        display.response,
        tool.display_output,
        tool.displayOutput,
        toolDisplay.output,
        toolDisplay.response
      )
    );
  }
  if (base.legacyStep === 'terminal') {
    return unwrapTaskProtocolEnvelope(
      firstText(payload.output, payload.result, payload.response)
    );
  }
  return unwrapTaskProtocolEnvelope(
    base.legacyStep === 'deactivate_toolkit'
      ? firstText(
          payload.message,
          payload.output,
          payload.result,
          payload.response
        )
      : firstText(payload.output, payload.result, payload.response)
  );
}

function activityPhase(
  base: ChatProjectionNodeBase,
  status: ChatActivityStatus,
  semanticPhase?: string
): ChatActivityPhase {
  if (
    semanticPhase &&
    [
      'requested',
      'started',
      'progress',
      'completed',
      'failed',
      'cancelled',
      'blocked',
      'resumed',
      'interrupted',
      'unknown',
    ].includes(semanticPhase)
  ) {
    return semanticPhase as ChatActivityPhase;
  }
  if (base.legacyStep === 'activate_toolkit') return 'started';
  if (base.legacyStep === 'deactivate_toolkit') return 'completed';

  const suffix = base.eventType.split('.').at(-1)?.toLowerCase();
  if (suffix === 'requested') return 'requested';
  if (['started', 'active', 'running'].includes(suffix || '')) return 'started';
  if (['progress', 'delta', 'updated'].includes(suffix || ''))
    return 'progress';
  if (['completed', 'complete', 'succeeded'].includes(suffix || '')) {
    return 'completed';
  }
  if (['failed', 'error', 'timed_out'].includes(suffix || '')) return 'failed';
  if (['cancelled', 'canceled'].includes(suffix || '')) return 'cancelled';
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'timed_out') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'unknown';
}

function activityDurationMs(payload: JsonRecord): number | undefined {
  const value =
    payload.display_duration_ms ??
    payload.displayDurationMs ??
    payload.duration_ms ??
    payload.durationMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function activityTitle(
  base: ChatProjectionNodeBase,
  payload: JsonRecord,
  isTypedActivity: boolean,
  activityType: ChatActivityType,
  names: { methodName: string; toolName: string; toolkitName: string }
): string {
  const toolkitMethod =
    names.methodName && names.toolkitName
      ? `${names.toolkitName}.${names.methodName}`
      : '';
  if (isTypedActivity) {
    return unwrapTaskProtocolEnvelope(
      firstText(
        payload.display_title,
        payload.displayTitle,
        payload.display_label,
        payload.displayLabel,
        names.toolName,
        toolkitMethod,
        names.toolkitName,
        payload.agent_name,
        payload.agentName,
        payload.task_name,
        payload.taskName,
        humanize(base.eventType)
      )
    );
  }
  if (activityType === 'tool') {
    return unwrapTaskProtocolEnvelope(
      firstText(
        payload.title,
        names.toolName,
        toolkitMethod,
        names.toolkitName,
        payload.message,
        payload.content,
        humanize(base.legacyStep || base.eventType)
      )
    );
  }
  if (activityType === 'agent') {
    return unwrapTaskProtocolEnvelope(
      firstText(
        payload.title,
        payload.agent_name,
        payload.agentName,
        payload.message,
        humanize(base.legacyStep || base.eventType)
      )
    );
  }
  return unwrapTaskProtocolEnvelope(
    firstText(
      payload.title,
      payload.message,
      payload.content,
      payload.notice,
      payload.command,
      names.toolName,
      toolkitMethod,
      names.toolkitName,
      payload.agent_name,
      payload.task_name,
      humanize(base.legacyStep || base.eventType)
    )
  );
}

function isHumanInputToolkitActivity(
  toolkitName: string,
  methodName: string,
  toolName: string
): boolean {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return (
    normalize(toolkitName) === 'humantoolkit' &&
    [methodName, toolName].some(
      (operationName) => normalize(operationName) === 'askhumanviagui'
    )
  );
}

function activityNode(
  base: ChatProjectionNodeBase,
  data: unknown,
  activityType: ChatActivityType,
  fallbackStatus: ChatActivityStatus
): ChatActivityNode {
  const payload = asRecord(data);
  const tool = asRecord(payload.tool);
  const request = asRecord(payload.request);
  const result = asRecord(payload.result);
  const semantic = base.semantic;
  const semanticActor = semantic?.actor;
  const semanticCorrelation = semantic?.correlation;
  const isTypedActivity = !base.eventType.startsWith('legacy.');
  const toolkitName = firstText(
    payload.toolkit_name,
    payload.toolkitName,
    tool.toolkit_name,
    tool.toolkitName
  );
  const methodName = firstText(
    payload.method_name,
    payload.methodName,
    tool.method_name,
    tool.methodName
  );
  const toolName = firstText(
    payload.tool_name,
    payload.toolName,
    tool.tool_name,
    tool.toolName,
    tool.name
  );
  const toolCallId = firstText(
    payload.tool_call_id,
    payload.toolCallId,
    payload.call_id,
    payload.callId,
    payload.invocation_id,
    payload.invocationId,
    payload.tool_use_id,
    payload.toolUseId,
    tool.tool_call_id,
    tool.toolCallId,
    tool.call_id,
    tool.callId,
    tool.invocation_id,
    tool.invocationId,
    semantic?.subject.type === 'tool_call' ? semantic.subject.id : undefined
  );
  const normalizedToolName = firstText(toolName, methodName)
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  const subagentTool = ['agent_run_subagent', 'run_remote_sub_agent'].includes(
    normalizedToolName
  );
  const subagentStatusTool = ['agent_get_task_output'].includes(
    normalizedToolName
  );
  const subagentLifecycleTool = subagentTool || subagentStatusTool;
  const agentProvider = subagentTool
    ? firstText(
        payload.agent_provider,
        payload.agentProvider,
        payload.provider,
        payload.provider_name,
        payload.providerName,
        request.provider,
        request.provider_name,
        request.providerName,
        result.provider,
        result.provider_name,
        result.providerName,
        // The only currently registered remote provider. Explicit producer
        // metadata above wins as soon as additional providers are introduced.
        normalizedToolName === 'run_remote_sub_agent'
          ? 'gemini_agents'
          : undefined
      )
    : '';
  const agentModel = subagentTool
    ? firstText(
        payload.agent_model,
        payload.agentModel,
        payload.model,
        payload.model_name,
        payload.modelName,
        request.model,
        request.model_name,
        request.modelName,
        result.model,
        result.model_name,
        result.modelName
      )
    : '';
  const subagentType = subagentTool
    ? safeDelegatedAgentIdentity(
        payload.subagent_type,
        payload.subagentType,
        request.subagent_type,
        request.subagentType,
        request.remote_agent_name,
        request.remoteAgentName
      )
    : '';
  const subagentName = subagentTool
    ? safeDelegatedAgentIdentity(
        payload.subagent_name,
        payload.subagentName,
        payload.description,
        request.subagent_name,
        request.subagentName,
        request.description,
        result.description
      )
    : '';
  const isHumanInputActivity = isHumanInputToolkitActivity(
    toolkitName,
    methodName,
    toolName
  );
  const title = isHumanInputActivity
    ? i18next.t('chat.human-toolkit', { defaultValue: 'Human Toolkit' })
    : activityTitle(base, payload, isTypedActivity, activityType, {
        methodName,
        toolName,
        toolkitName,
      });
  const status = normalizeActivityStatus(
    semantic?.lifecycle.status ??
      payload.status ??
      payload.state ??
      (isTypedActivity ? base.eventType.split('.').at(-1) : undefined),
    fallbackStatus
  );
  const explicitSubagentStatus = firstText(
    payload.subagent_status,
    payload.subagentStatus,
    result.status,
    result.state
  );
  const subagentStatus = subagentLifecycleTool
    ? firstText(result.error, payload.subagent_error, payload.subagentError)
      ? 'failed'
      : explicitSubagentStatus
        ? normalizeActivityStatus(explicitSubagentStatus, status)
        : subagentTool
          ? status
          : undefined
    : undefined;
  const input = isHumanInputActivity
    ? ''
    : activityInput(base, payload, tool, isTypedActivity);
  const output = isHumanInputActivity
    ? ''
    : activityOutput(base, payload, tool, isTypedActivity);
  return {
    ...base,
    kind: 'activity',
    activityType,
    status,
    phase: activityPhase(base, status, semantic?.lifecycle.phase),
    title,
    // Human input content belongs exclusively to the BottomBox header and its
    // durable interaction receipt. Toolkit activity frames can carry the
    // request or response in generic or explicitly displayable fields, which
    // must not duplicate that content in the work-log activity row.
    ...(isHumanInputActivity
      ? {}
      : { detail: activityDetail(payload, isTypedActivity) || undefined }),
    input: input || undefined,
    output: output || undefined,
    durationMs: activityDurationMs(payload),
    agentId:
      firstText(payload.agent_id, payload.agentId, semanticActor?.id) ||
      undefined,
    agentName:
      firstText(
        payload.agent_name,
        payload.agentName,
        payload.agent,
        semanticActor?.name
      ) || undefined,
    taskId:
      firstText(
        payload.process_task_id,
        payload.task_id,
        payload.taskId,
        semanticCorrelation?.task_id
      ) || undefined,
    toolkitName: toolkitName || undefined,
    methodName: methodName || undefined,
    toolCallId: toolCallId || undefined,
    stepId:
      firstText(
        payload.step_id,
        payload.stepId,
        semanticCorrelation?.step_id
      ) || undefined,
    toolName: toolName || undefined,
    subagentType: subagentType || undefined,
    subagentName: subagentName || undefined,
    subagentInvocation: subagentTool || undefined,
    subagentStatus,
    subagentAgentId: subagentLifecycleTool
      ? firstText(
          payload.subagent_agent_id,
          payload.subagentAgentId,
          result.agent_id,
          result.agentId
        ) || undefined
      : undefined,
    subagentTaskId: subagentLifecycleTool
      ? firstText(
          payload.subagent_task_id,
          payload.subagentTaskId,
          request.task_id,
          request.taskId,
          result.task_id,
          result.taskId
        ) || undefined
      : undefined,
    agentProvider: agentProvider || undefined,
    agentModel: agentModel || undefined,
    activityId: semantic?.subject.id || undefined,
    ...(semantic?.subject.type === 'activity_stream' ||
    base.legacyStep === 'decompose_text'
      ? {
          streamFragmentMode:
            base.legacyStep === 'decompose_text' ||
            payload.display_fragment_exact === true
              ? ('exact' as const)
              : ('normalized' as const),
        }
      : {}),
    semanticKind: semantic?.kind,
    semanticCompleteness: semantic?.completeness.state,
  };
}

function normalizeArtifactOperation(
  value: unknown,
  fallback: ChatArtifactOperation
): ChatArtifactOperation {
  const operation = firstText(value).toLowerCase();
  if (
    ['create', 'created', 'write', 'written', 'generated'].includes(operation)
  ) {
    return 'created';
  }
  if (
    ['update', 'updated', 'change', 'changed', 'modify', 'modified'].includes(
      operation
    )
  ) {
    return 'updated';
  }
  if (['delete', 'deleted', 'remove', 'removed'].includes(operation)) {
    return 'deleted';
  }
  return operation ? 'unknown' : fallback;
}

function artifactNode(
  base: ChatProjectionNodeBase,
  data: unknown,
  fallbackOperation: ChatArtifactOperation
): ChatArtifactNode {
  const payload = asRecord(data);
  const semantic = base.semantic;
  const isTypedArtifact = !base.eventType.startsWith('legacy.');
  // Shared typed projections carry only portable identity. A Desktop-local
  // absolute path belongs in the resolver/transport layer, never in this node.
  const explicitRelativePath = firstText(
    payload.relative_path,
    payload.relativePath
  );
  const rawPath = isTypedArtifact
    ? explicitRelativePath
    : firstText(
        explicitRelativePath,
        payload.file_path,
        payload.filePath,
        payload.path
      );
  const portablePath = portableRelativePath(rawPath);
  const name = safeArtifactBasename(payload.name, rawPath);
  const path = portablePath || name;
  return {
    ...base,
    kind: 'artifact',
    operation: normalizeArtifactOperation(
      payload.operation ?? payload.action ?? payload.artifactChange,
      fallbackOperation
    ),
    artifactId:
      firstText(
        payload.artifact_id,
        payload.artifactId,
        semantic?.subject.type === 'artifact' ? semantic.subject.id : undefined
      ) || undefined,
    path,
    name: name || safeArtifactBasename(path) || undefined,
    relativePath:
      portableRelativePath(explicitRelativePath) || portablePath || undefined,
    mimeType: firstText(payload.mime_type, payload.mimeType) || undefined,
    agentId:
      firstText(payload.agent_id, payload.agentId, semantic?.actor?.id) ||
      undefined,
    taskId:
      firstText(
        payload.process_task_id,
        payload.task_id,
        payload.taskId,
        semantic?.correlation?.task_id
      ) || undefined,
    stepId:
      firstText(
        payload.step_id,
        payload.stepId,
        semantic?.correlation?.step_id
      ) || undefined,
  };
}

function runStatusNode(
  base: ChatProjectionNodeBase,
  data: unknown,
  status: ChatRunStatus
): ChatRunStatusNode {
  const payload = asRecord(data);
  return {
    ...base,
    kind: 'run_status',
    status,
    reason:
      firstText(payload.reason, payload.error, payload.message) || undefined,
  };
}

function unknownNode(base: ChatProjectionNodeBase): ChatUnknownNode {
  return {
    ...base,
    kind: 'unknown',
    summary: `Unsupported event: ${base.eventType}`,
  };
}

function humanize(value: string): string {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function workspaceWriterNotice(
  base: ChatProjectionNodeBase,
  data: unknown
): ChatNoticeNode | null {
  const payload = asRecord(data);
  if (base.eventType === 'workspace.writer.queued') {
    const position = Number(payload.queue_position);
    const positionText =
      Number.isInteger(position) && position > 0
        ? i18next.t('chat.workspace-queue-position', {
            defaultValue: ' Queue position: {{position}}.',
            position,
          })
        : '';
    return noticeNode(
      base,
      {
        title: i18next.t('chat.workspace-waiting-title', {
          defaultValue: 'Waiting for Space',
        }),
        content: i18next.t('chat.workspace-waiting-description', {
          defaultValue:
            'Another task is updating this Space. This task will start automatically when the Space is available.{{position}}',
          position: positionText,
        }),
      },
      'info'
    );
  }
  if (
    base.eventType === 'workspace.writer.acquired' &&
    payload.waited === true
  ) {
    return noticeNode(
      base,
      {
        title: i18next.t('chat.workspace-available-title', {
          defaultValue: 'Space available',
        }),
        content: i18next.t('chat.workspace-available-description', {
          defaultValue: 'This task now has write access and is continuing.',
        }),
      },
      'info'
    );
  }
  return null;
}

function stepNode(
  base: ChatProjectionNodeBase,
  data: unknown
): ChatStepNode | null {
  const payload = asRecord(data);
  const step = asRecord(payload.step);
  const semantic = base.semantic;
  const stepId = firstText(
    step.step_id,
    step.stepId,
    payload.step_id,
    payload.stepId,
    semantic?.subject.type === 'step' ? semantic.subject.id : undefined
  );
  const rawStatus = firstText(
    step.status,
    semantic?.lifecycle.status,
    base.eventType.split('.').at(-1)
  ).toLowerCase();
  const statuses = new Set<ChatStepStatus>([
    'pending',
    'running',
    'blocked',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ]);
  if (!stepId || !statuses.has(rawStatus as ChatStepStatus)) return null;
  const ordinal = Number(step.ordinal);
  const owner = asRecord(step.owner);
  return {
    ...base,
    kind: 'step',
    stepId,
    planId: firstText(step.plan_id, step.planId) || undefined,
    planItemId:
      firstText(
        step.plan_item_id,
        step.planItemId,
        semantic?.correlation?.plan_item_id
      ) || undefined,
    parentStepId:
      firstText(
        step.parent_step_id,
        step.parentStepId,
        semantic?.correlation?.parent_step_id
      ) || undefined,
    title:
      firstText(step.title, payload.display_title) ||
      i18next.t('chat.task-step', { defaultValue: 'Task step' }),
    summary: firstText(step.summary, payload.display_summary) || undefined,
    status: rawStatus as ChatStepStatus,
    phase: activityPhase(
      base,
      rawStatus as ChatActivityStatus,
      semantic?.lifecycle.phase
    ),
    ordinal: Number.isFinite(ordinal) ? ordinal : undefined,
    agentId:
      firstText(owner.agent_id, owner.agentId, semantic?.actor?.id) ||
      undefined,
    agentName:
      firstText(owner.agent_name, owner.agentName, semantic?.actor?.name) ||
      undefined,
    attemptId:
      firstText(payload.attempt_id, semantic?.correlation?.attempt_id) ||
      undefined,
    source: 'authored',
  };
}

function typedNode(
  base: ChatProjectionNodeBase,
  data: unknown
): ChatProjectionNode | null {
  const { eventType } = base;
  const runStatus = RUN_STATUS_BY_EVENT[eventType];
  if (runStatus) return runStatusNode(base, data, runStatus);

  if (eventType.startsWith('workspace.writer.')) {
    return workspaceWriterNotice(base, data);
  }

  if (eventType.startsWith('step.')) {
    return stepNode(base, data);
  }

  if (eventType === 'user.message') {
    return messageNode(base, data, 'user');
  }
  if (eventType === 'assistant.final') {
    return messageNode(base, data, 'assistant');
  }

  if (
    ['message.created', 'message.delta', 'message.completed'].includes(
      eventType
    )
  ) {
    return messageNode(base, data);
  }

  if (eventType === 'interaction.requested') {
    return interactionNode(base, data, 'requested');
  }
  if (eventType === 'interaction.resolved') {
    return interactionNode(base, data, 'responded');
  }
  if (eventType === 'interaction.expired') {
    return interactionNode(base, data, 'expired');
  }
  if (eventType === 'interaction.cancelled') {
    return interactionNode(base, data, 'cancelled');
  }
  if (eventType === 'approval.requested') {
    return interactionNode(base, data, 'requested');
  }
  if (eventType === 'approval.decided') {
    return interactionNode(base, data, 'responded');
  }
  if (eventType === 'approval.expired_rejected') {
    return interactionNode(base, data, 'expired');
  }
  if (eventType === 'approval.cancelled') {
    return interactionNode(base, data, 'cancelled');
  }

  if (
    ['plan.created', 'plan.updated', 'plan.revised', 'plan.completed'].includes(
      eventType
    )
  ) {
    return planNode(base, data);
  }

  if (
    [
      'artifact.created',
      'artifact.modified',
      'artifact.updated',
      'artifact.deleted',
      'file.written',
    ].includes(eventType)
  ) {
    const suffix = eventType.split('.').at(-1);
    return artifactNode(
      base,
      data,
      suffix === 'deleted'
        ? 'deleted'
        : suffix === 'updated' || suffix === 'modified'
          ? 'updated'
          : 'created'
    );
  }

  const activityType: ChatActivityType | null = eventType.startsWith('agent.')
    ? 'agent'
    : eventType.startsWith('tool.')
      ? 'tool'
      : eventType.startsWith('terminal.')
        ? 'terminal'
        : eventType.startsWith('task.') || eventType.startsWith('subtask.')
          ? 'task'
          : eventType.startsWith('activity.') || eventType.startsWith('git.')
            ? 'work_log'
            : null;
  if (activityType) {
    return activityNode(base, data, activityType, 'running');
  }

  if (eventType.startsWith('notice.')) {
    return noticeNode(base, data, 'info');
  }
  if (eventType.startsWith('warning.')) {
    return noticeNode(base, data, 'warning');
  }
  if (eventType.startsWith('error.')) {
    return noticeNode(base, data, 'error');
  }
  return null;
}

function legacyNode(
  base: ChatProjectionNodeBase,
  data: unknown
): ChatProjectionNode {
  const payload = asRecord(data);
  const step = base.legacyStep || base.eventType.replace(/^legacy\./, '');

  if (step === 'confirmed') {
    return messageNode(base, data, 'user');
  }
  if (step === 'wait_confirm') {
    const question = firstText(payload.question);
    const answer = firstText(
      payload.content,
      payload.answer,
      payload.message,
      payload.result
    );
    if (answer) {
      return messageNode(base, { ...payload, content: answer }, 'assistant');
    }
    return question
      ? messageNode(base, { ...payload, content: question }, 'user')
      : messageNode(base, data, 'assistant');
  }
  if (step === 'human_reply') {
    const reply = firstText(payload.reply, payload.content, data);
    const message = messageNode(base, { ...payload, content: reply }, 'user');
    const interactionId = explicitInteractionId(payload);
    return interactionId
      ? { ...message, interactionId, interactionResponse: true }
      : message;
  }
  if (step === 'ask') {
    return interactionNode(base, data, 'requested');
  }
  if (step === 'agent_summary_end' || step === 'agent_end') {
    return messageNode(base, data, 'assistant');
  }
  if (step === 'end') {
    const content = firstText(
      payload.content,
      payload.result,
      payload.answer,
      payload.message,
      data
    );
    return content
      ? messageNode(base, { ...payload, content }, 'assistant')
      : runStatusNode(base, data, 'completed');
  }

  if (step === 'to_sub_tasks' || step === 'todo_state') {
    return planNode(base, data);
  }

  if (step === 'write_file') {
    return artifactNode(base, data, 'created');
  }

  if (step in NOTICE_STEP_SEVERITY) {
    return noticeNode(base, data, NOTICE_STEP_SEVERITY[step]);
  }

  const activityType: ChatActivityType | null = [
    'create_agent',
    'activate_agent',
    'deactivate_agent',
  ].includes(step)
    ? 'agent'
    : ['activate_toolkit', 'deactivate_toolkit'].includes(step)
      ? 'tool'
      : step === 'terminal'
        ? 'terminal'
        : [
              'assign_task',
              'task_state',
              'new_task_state',
              'add_task',
              'remove_task',
            ].includes(step)
          ? 'task'
          : step === 'decompose_text'
            ? 'work_log'
            : null;
  if (activityType) {
    const fallbackStatus: ChatActivityStatus = step.startsWith('deactivate_')
      ? 'completed'
      : step === 'create_agent' || step === 'terminal'
        ? 'completed'
        : 'running';
    return activityNode(base, data, activityType, fallbackStatus);
  }

  return unknownNode(base);
}

function displayDecision(node: ChatProjectionNode): ChatProjectionDecision {
  return { kind: 'display', node };
}

function unsupportedDecision(
  base: ChatProjectionNodeBase
): ChatProjectionDecision {
  return { kind: 'unsupported', node: unknownNode(base) };
}

/** Classify one durable or projected legacy event for semantic presentation. */
export function adaptChatProjectionEvent(
  input: ChatProjectionInput
): ChatProjectionDecision {
  const { base, data } = normalizeInput(input);
  if (!base.eventType.startsWith('legacy.')) {
    if (
      base.eventType === 'workspace.writer.acquired' &&
      asRecord(data).waited !== true
    ) {
      return { kind: 'receipt', receiptType: base.eventType };
    }
    if (
      RECEIPT_ONLY_EVENT_TYPES.has(base.eventType) ||
      RECEIPT_ONLY_EVENT_PREFIXES.some((prefix) =>
        base.eventType.startsWith(prefix)
      )
    ) {
      return { kind: 'receipt', receiptType: base.eventType };
    }

    const typed = typedNode(base, data);
    if (
      base.eventType === 'assistant.final' &&
      typed?.kind === 'message' &&
      !typed.content.trim()
    ) {
      return { kind: 'hidden', reason: 'assistant.final.empty' };
    }
    return typed ? displayDecision(typed) : unsupportedDecision(base);
  }

  if (base.legacyStep && HIDDEN_LEGACY_STEPS.has(base.legacyStep)) {
    return { kind: 'hidden', reason: `legacy.${base.legacyStep}` };
  }
  const legacy = legacyNode(base, data);
  return legacy.kind === 'unknown'
    ? { kind: 'unsupported', node: legacy }
    : displayDecision(legacy);
}
