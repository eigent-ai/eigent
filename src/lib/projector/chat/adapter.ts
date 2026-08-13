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
  ChatActivityNode,
  ChatActivityStatus,
  ChatActivityType,
  ChatArtifactNode,
  ChatArtifactOperation,
  ChatInteractionNode,
  ChatInteractionOption,
  ChatMessageNode,
  ChatNoticeNode,
  ChatPlanNode,
  ChatPlanTask,
  ChatPlanTaskStatus,
  ChatProjectionInput,
  ChatProjectionNode,
  ChatProjectionNodeBase,
  ChatRunStatus,
  ChatRunStatusNode,
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

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
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
  return {
    ...base,
    kind: 'message',
    role,
    content: messageContent(base, messagePayload, data),
    status: eventIsStreaming ? 'streaming' : 'complete',
    agentId:
      firstText(messagePayload.agent_id, messagePayload.agentId) || undefined,
    agentName:
      firstText(
        messagePayload.agent_name,
        messagePayload.agentName,
        messagePayload.agent
      ) || undefined,
  };
}

function noticeNode(
  base: ChatProjectionNodeBase,
  data: unknown,
  severity: ChatNoticeNode['severity']
): ChatNoticeNode {
  const payload = asRecord(data);
  return {
    ...base,
    kind: 'notice',
    severity,
    content:
      firstText(
        payload.notice,
        payload.content,
        payload.message,
        payload.error,
        payload.reason,
        payload.answer,
        data
      ) || humanize(base.legacyStep || base.eventType),
    title: firstText(payload.title) || undefined,
    code: firstText(payload.code) || undefined,
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
        nestedText(payload.request),
        nestedText(payload.prompt),
        request.question
      ) || undefined,
    response: responseText(decision) || undefined,
    responseOptionIds: responseOptionIds(decision),
    agentName:
      firstText(payload.agent_name, payload.agentName, payload.agent) ||
      undefined,
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
          title: candidate,
          status: 'pending' as const,
        },
      ];
    }
    if (!isRecord(candidate)) return [];
    const title = firstText(
      candidate.title,
      candidate.content,
      candidate.description,
      candidate.active_form,
      candidate.summary,
      candidate.name
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
    title: firstText(payload.title, payload.name, derivedTitle) || undefined,
    summary:
      firstText(payload.summary, payload.description, derivedSummary) ||
      undefined,
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
  if (['failed', 'error', 'timed_out', 'outcome_unknown'].includes(status)) {
    return 'failed';
  }
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  return 'unknown';
}

/**
 * Typed durable events must opt into Timeline display text. Tool output and
 * result fields can contain credentials, large blobs, or machine-oriented
 * payloads, so they are intentionally accepted only on the legacy lane.
 */
function activityDetail(payload: JsonRecord, isTypedActivity: boolean): string {
  if (isTypedActivity) {
    return firstText(
      payload.display_detail,
      payload.displayDetail,
      payload.display_summary,
      payload.displaySummary
    );
  }
  return firstText(
    payload.detail,
    payload.output,
    payload.result,
    payload.reason
  );
}

function activityTitle(
  base: ChatProjectionNodeBase,
  payload: JsonRecord,
  isTypedActivity: boolean,
  names: { methodName: string; toolName: string; toolkitName: string }
): string {
  const toolkitMethod =
    names.methodName && names.toolkitName
      ? `${names.toolkitName}.${names.methodName}`
      : '';
  if (isTypedActivity) {
    return firstText(
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
    );
  }
  return firstText(
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
    tool.invocationId
  );
  const isHumanInputActivity = isHumanInputToolkitActivity(
    toolkitName,
    methodName,
    toolName
  );
  const title = isHumanInputActivity
    ? 'Human Toolkit'
    : activityTitle(base, payload, isTypedActivity, {
        methodName,
        toolName,
        toolkitName,
      });
  return {
    ...base,
    kind: 'activity',
    activityType,
    status: normalizeActivityStatus(
      payload.status ?? payload.state ?? base.eventType.split('.').at(-1),
      fallbackStatus
    ),
    title,
    // Human input content belongs exclusively to the BottomBox header and its
    // durable interaction receipt. Toolkit activity frames can carry the
    // request or response in generic or explicitly displayable fields, which
    // must not duplicate that content in the work-log activity row.
    ...(isHumanInputActivity
      ? {}
      : { detail: activityDetail(payload, isTypedActivity) || undefined }),
    agentId: firstText(payload.agent_id, payload.agentId) || undefined,
    agentName:
      firstText(payload.agent_name, payload.agentName, payload.agent) ||
      undefined,
    taskId:
      firstText(payload.process_task_id, payload.task_id, payload.taskId) ||
      undefined,
    toolkitName: toolkitName || undefined,
    methodName: methodName || undefined,
    toolCallId: toolCallId || undefined,
    toolName: toolName || undefined,
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
  const path = firstText(
    payload.file_path,
    payload.filePath,
    payload.path,
    payload.relative_path,
    payload.relativePath,
    payload.name
  );
  return {
    ...base,
    kind: 'artifact',
    operation: normalizeArtifactOperation(
      payload.operation ?? payload.action ?? payload.artifactChange,
      fallbackOperation
    ),
    path,
    name:
      firstText(payload.name, path.split('/').filter(Boolean).at(-1)) ||
      undefined,
    mimeType: firstText(payload.mime_type, payload.mimeType) || undefined,
    agentId: firstText(payload.agent_id, payload.agentId) || undefined,
    taskId:
      firstText(payload.process_task_id, payload.task_id, payload.taskId) ||
      undefined,
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

function typedNode(
  base: ChatProjectionNodeBase,
  data: unknown
): ChatProjectionNode | null {
  const { eventType } = base;
  const runStatus = RUN_STATUS_BY_EVENT[eventType];
  if (runStatus) return runStatusNode(base, data, runStatus);

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

  if (eventType.startsWith('artifact.') || eventType === 'file.written') {
    const suffix = eventType.split('.').at(-1);
    return artifactNode(
      base,
      data,
      suffix === 'deleted'
        ? 'deleted'
        : suffix === 'updated'
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
      : step === 'create_agent'
        ? 'completed'
        : 'running';
    return activityNode(base, data, activityType, fallbackStatus);
  }

  return unknownNode(base);
}

/** Convert one durable or projected legacy event into one immutable node. */
export function adaptChatProjectionEvent(
  input: ChatProjectionInput
): ChatProjectionNode {
  const { base, data } = normalizeInput(input);
  const typed = !base.eventType.startsWith('legacy.')
    ? typedNode(base, data)
    : null;
  return typed || legacyNode(base, data);
}
