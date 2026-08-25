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

import type {
  ChatActivityNode,
  ChatActivityStatus,
  ChatInteractionNode,
} from '../types';

import i18next from 'i18next';
import { actionKindForActivities } from './actionKind';
import type {
  TimelineActionKind,
  TimelineToolInvocation,
  TimelineToolNotice,
  TimelineTraceRow,
} from './types';

/**
 * Who produced the response half of one call. A toolkit invocation and a
 * human interaction have the same shape — a request, an executor, and a
 * response — so both render through one row instead of two components.
 */
export type TimelineCallExecutor = 'toolkit' | 'human';

/** Presentation families that share one request/response label pair. */
export type TimelineInteractionFamily = 'ask' | 'authorize' | 'choose';

export interface TimelineCall {
  id: string;
  runId: string;
  executor: TimelineCallExecutor;
  /** `Toolkit · method` for a tool, `You · Allowed` for a human decision. */
  title: string;
  /** Projection-owned category consumed by the action icon matcher. */
  actionKind: TimelineActionKind;
  status: ChatActivityStatus;
  /** Presentation-safe request text. Never a raw transport payload. */
  input?: string;
  /** Presentation-safe response text. Never a raw transport payload. */
  output?: string;
  /** Short lifecycle/outcome summary, separate from request and response. */
  detail?: string;
  /** Correlated progress/result text; never replaces request/response detail. */
  notice?: TimelineToolNotice;
  inputLabel: string;
  outputLabel: string;
  emptyOutputText?: string;
  durationMs?: number;
  agentId?: string;
  agentName?: string;
  taskId?: string;
  stepId?: string;
  /** Present only for toolkit calls; human calls have no backend call id. */
  toolCallId?: string;
  /** Toolkit/method identity, used for segmentation and label derivation. */
  toolkitName?: string;
  methodName?: string;
  /** Delegated-agent classification supplied by projection, never title inference. */
  subagentInvocation?: boolean;
  subagentType?: string;
  subagentName?: string;
  subagentAgentId?: string;
  subagentTaskId?: string;
  agentProvider?: string;
  agentModel?: string;
  /** Present only for human calls; used for receipt correlation in tests. */
  interactionId?: string;
  interactionFamily?: TimelineInteractionFamily;
}

const ASK_INTERACTION_TYPES = new Set([
  'question',
  'feedback',
  'human_feedback',
  'form',
  'confirmation',
]);

const AUTHORIZE_INTERACTION_TYPES = new Set(['approval', 'credential_binding']);

const CHOOSE_INTERACTION_TYPES = new Set([
  'choice',
  'selection',
  'merge_conflict',
  'diff_review',
]);

/**
 * Group the backend interaction vocabulary into three presentation families.
 * An unrecognized future type falls back to `ask`, which is the only family
 * whose labels stay accurate for an unknown request/response pair.
 */
export function interactionFamily(
  interactionType: string
): TimelineInteractionFamily {
  if (AUTHORIZE_INTERACTION_TYPES.has(interactionType)) return 'authorize';
  if (CHOOSE_INTERACTION_TYPES.has(interactionType)) return 'choose';
  if (ASK_INTERACTION_TYPES.has(interactionType)) return 'ask';
  return 'ask';
}

function familyLabels(family: TimelineInteractionFamily): {
  input: string;
  output: string;
} {
  if (family === 'authorize') {
    return {
      input: i18next.t('chat.timeline-requested', {
        defaultValue: 'Requested',
      }),
      output: i18next.t('chat.timeline-decision', {
        defaultValue: 'Decision',
      }),
    };
  }
  if (family === 'choose') {
    return {
      input: i18next.t('chat.timeline-options', { defaultValue: 'Options' }),
      output: i18next.t('chat.timeline-selected', {
        defaultValue: 'Selected',
      }),
    };
  }
  return {
    input: i18next.t('chat.timeline-question', { defaultValue: 'Question' }),
    output: i18next.t('chat.timeline-answer', { defaultValue: 'Answer' }),
  };
}

/**
 * Map an interaction lifecycle onto the activity status vocabulary so one row
 * component can style both executors from a single status set.
 */
function interactionCallStatus(node: ChatInteractionNode): ChatActivityStatus {
  if (node.status === 'requested') return 'pending';
  if (node.status === 'responded') return 'completed';
  if (node.status === 'cancelled') return 'cancelled';
  if (node.status === 'expired') return 'timed_out';
  return 'unknown';
}

function isRejectedDecision(response: string | undefined): boolean {
  const normalized = (response || '').trim().toLowerCase();
  return normalized === 'rejected' || normalized === 'denied';
}

/**
 * Title one human call using the same `{executor} · {action}` grammar as a
 * toolkit call. The prompt itself stays in the disclosure, so the row never
 * grows with an arbitrary-length backend question.
 */
export function humanCallTitle(node: ChatInteractionNode): string {
  if (node.status === 'requested')
    return i18next.t('chat.timeline-input-required', {
      defaultValue: 'Input required',
    });
  if (node.status === 'cancelled')
    return i18next.t('chat.timeline-input-cancelled', {
      defaultValue: 'Input cancelled',
    });
  if (node.status === 'expired')
    return i18next.t('chat.timeline-input-expired', {
      defaultValue: 'Input expired',
    });

  const family = interactionFamily(node.interactionType);
  if (family === 'authorize') {
    return isRejectedDecision(node.response)
      ? i18next.t('chat.timeline-you-rejected', {
          defaultValue: 'You · Rejected',
        })
      : i18next.t('chat.timeline-you-allowed', {
          defaultValue: 'You · Allowed',
        });
  }
  if (family === 'choose')
    return i18next.t('chat.timeline-you-selected', {
      defaultValue: 'You · Selected',
    });
  return i18next.t('chat.timeline-you-answered', {
    defaultValue: 'You · Answered',
  });
}

function toolCall(invocation: TimelineToolInvocation): TimelineCall {
  return {
    id: invocation.id,
    runId: invocation.runId,
    executor: 'toolkit',
    title: invocation.title,
    actionKind: invocation.actionKind,
    status:
      invocation.subagentInvocation && invocation.subagentStatus
        ? invocation.subagentStatus
        : invocation.status,
    input: invocation.input,
    output: invocation.output,
    detail: invocation.detail,
    notice: invocation.notice,
    inputLabel: i18next.t('chat.timeline-request', {
      defaultValue: 'Request',
    }),
    outputLabel: i18next.t('chat.timeline-response', {
      defaultValue: 'Response',
    }),
    durationMs: invocation.durationMs,
    agentId: invocation.agentId,
    agentName: invocation.agentName,
    taskId: invocation.taskId,
    stepId: invocation.stepId,
    toolCallId: invocation.toolCallId,
    toolkitName: invocation.toolkitName,
    methodName: invocation.methodName || invocation.toolName,
    subagentInvocation: invocation.subagentInvocation,
    subagentType: invocation.subagentType,
    subagentName: invocation.subagentName,
    subagentAgentId: invocation.subagentAgentId,
    subagentTaskId: invocation.subagentTaskId,
    agentProvider: invocation.agentProvider,
    agentModel: invocation.agentModel,
  };
}

function humanCall(id: string, node: ChatInteractionNode): TimelineCall {
  const family = interactionFamily(node.interactionType);
  const labels = familyLabels(family);
  const pending = node.status === 'requested';

  return {
    id,
    runId: node.runId,
    executor: 'human',
    title: humanCallTitle(node),
    actionKind: 'message',
    status: interactionCallStatus(node),
    input: node.prompt,
    output: node.response,
    inputLabel: labels.input,
    outputLabel: labels.output,
    emptyOutputText: pending
      ? i18next.t('chat.timeline-waiting-response', {
          defaultValue: 'Waiting for your response.',
        })
      : i18next.t('chat.timeline-no-response', {
          defaultValue: 'No response was recorded for this request.',
        }),
    agentName: node.agentName,
    stepId: node.stepId,
    interactionId: node.interactionId,
    interactionFamily: family,
  };
}

/**
 * Non-tool activity that never reached the invocation composer, for example a
 * task or work-log frame. It keeps the toolkit executor so it renders with the
 * same subdued treatment as a tool call.
 */
function activityCall(id: string, node: ChatActivityNode): TimelineCall {
  return {
    id,
    runId: node.runId,
    executor: 'toolkit',
    title: node.title,
    actionKind: actionKindForActivities([node]),
    status: node.status,
    input: node.input,
    output: node.output || node.detail,
    detail: node.detail,
    inputLabel: i18next.t('chat.timeline-request', {
      defaultValue: 'Request',
    }),
    outputLabel: i18next.t('chat.timeline-response', {
      defaultValue: 'Response',
    }),
    durationMs: node.durationMs,
    agentId: node.agentId,
    agentName: node.agentName,
    taskId: node.taskId,
    stepId: node.stepId,
    toolCallId: node.toolCallId,
    toolkitName: node.toolkitName,
    methodName: node.methodName || node.toolName,
  };
}

/**
 * Present one trace row as a call when it has request/response shape.
 * Messages, plans, artifacts, notices, and run status stay outside this
 * mapping; the caller renders those with their own semantics.
 */
export function toTimelineCall(row: TimelineTraceRow): TimelineCall | null {
  if (row.kind === 'tool') return toolCall(row.invocation);
  if (row.node.kind === 'interaction') return humanCall(row.id, row.node);
  if (row.node.kind === 'activity' && row.node.activityType !== 'agent') {
    return activityCall(row.id, row.node);
  }
  return null;
}

/** True when a human call is still awaiting a response in BottomBox. */
export function isPendingHumanCall(call: TimelineCall): boolean {
  return call.executor === 'human' && call.status === 'pending';
}
