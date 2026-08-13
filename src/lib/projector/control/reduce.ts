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

import { adaptHumanControlEvent } from './adapter';
import type {
  HumanControlInteraction,
  HumanControlProjectionInput,
  HumanControlProjectionState,
  HumanControlProjectionUpdate,
} from './types';

const TERMINAL_STATUSES = new Set<HumanControlInteraction['status']>([
  'resolved',
  'expired',
  'cancelled',
]);

function isTypedRequestEvent(eventType: string | undefined): boolean {
  return (
    eventType === 'interaction.requested' || eventType === 'approval.requested'
  );
}

export function createHumanControlProjectionState(
  projectId: string
): HumanControlProjectionState {
  return {
    projectId,
    interactionById: {},
    orderedInteractionIds: [],
    seenEventIds: {},
  };
}

function findCorrelatedInteractionId(
  state: HumanControlProjectionState,
  update: HumanControlProjectionUpdate
): string | undefined {
  if (update.interactionId) return update.interactionId;

  let latestInRun: string | undefined;
  for (
    let index = state.orderedInteractionIds.length - 1;
    index >= 0;
    index -= 1
  ) {
    const id = state.orderedInteractionIds[index];
    const interaction = state.interactionById[id];
    if (
      interaction.runId !== update.runId ||
      interaction.status !== 'requested' ||
      interaction.interactionType === 'approval'
    ) {
      continue;
    }
    if (!latestInRun) latestInRun = id;
    if (update.agent && interaction.agent === update.agent) return id;
  }
  // A legacy reply with an explicit agent must fail closed rather than resolve
  // another agent's request. Only truly agent-less migration data falls back
  // to the latest non-approval interaction in the Run.
  return update.agent ? undefined : latestInRun;
}

function createInteraction(
  interactionId: string,
  update: HumanControlProjectionUpdate
): HumanControlInteraction {
  return {
    interactionId,
    interactionType:
      update.interactionType ||
      (update.eventType.startsWith('approval.') ? 'approval' : 'question'),
    status: update.status,
    projectId: update.projectId,
    runId: update.runId,
    sequence: update.sequence,
    lastSequence: update.sequence,
    cloudCursor: update.cloudCursor,
    lastCloudCursor: update.cloudCursor,
    requestEventId: update.status === 'requested' ? update.eventId : undefined,
    requestEventType:
      update.status === 'requested' ? update.eventType : undefined,
    requestSource: update.source,
    lastEventId: update.eventId,
    requestedAt: update.status === 'requested' ? update.createdAt : undefined,
    updatedAt: update.createdAt,
    version: update.version,
    approvalId: update.approvalId,
    actionDigest: update.actionDigest,
    allowedScopes: update.allowedScopes || [],
    title: update.title,
    prompt: update.prompt,
    agent: update.agent,
    operation: update.operation,
    targetResources: update.targetResources || [],
    displayArguments: update.displayArguments || {},
    ruleMatcher: update.ruleMatcher ?? null,
    options: update.options || [],
    fields: update.fields || [],
    expiresAt: update.expiresAt,
    deadlineAt: update.deadlineAt,
  };
}

function defined<T>(incoming: T | undefined, existing: T): T {
  return incoming === undefined ? existing : incoming;
}

function mergeInteraction(
  existing: HumanControlInteraction,
  update: HumanControlProjectionUpdate
): HumanControlInteraction {
  const existingIsTerminal = TERMINAL_STATUSES.has(existing.status);
  const requestSuppliesIdentity =
    update.status === 'requested' &&
    (!existing.requestEventId ||
      (isTypedRequestEvent(update.eventType) &&
        !isTypedRequestEvent(existing.requestEventType)));
  const updateIsLatest = update.sequence >= existing.lastSequence;

  return {
    ...existing,
    interactionType: defined(update.interactionType, existing.interactionType),
    status: existingIsTerminal ? existing.status : update.status,
    sequence: requestSuppliesIdentity ? update.sequence : existing.sequence,
    lastSequence: Math.max(existing.lastSequence, update.sequence),
    cloudCursor: requestSuppliesIdentity
      ? update.cloudCursor
      : existing.cloudCursor,
    lastCloudCursor:
      updateIsLatest && update.cloudCursor !== null
        ? update.cloudCursor
        : existing.lastCloudCursor,
    requestEventId: requestSuppliesIdentity
      ? update.eventId
      : existing.requestEventId,
    requestEventType: requestSuppliesIdentity
      ? update.eventType
      : existing.requestEventType,
    requestSource: requestSuppliesIdentity
      ? update.source
      : existing.requestSource,
    lastEventId: updateIsLatest ? update.eventId : existing.lastEventId,
    requestedAt:
      update.status === 'requested'
        ? (existing.requestedAt ?? update.createdAt)
        : existing.requestedAt,
    updatedAt: updateIsLatest ? update.createdAt : existing.updatedAt,
    version: defined(update.version, existing.version),
    approvalId: defined(update.approvalId, existing.approvalId),
    actionDigest: defined(update.actionDigest, existing.actionDigest),
    allowedScopes: defined(update.allowedScopes, existing.allowedScopes),
    title: defined(update.title, existing.title),
    prompt: defined(update.prompt, existing.prompt),
    agent: defined(update.agent, existing.agent),
    operation: defined(update.operation, existing.operation),
    targetResources: defined(update.targetResources, existing.targetResources),
    displayArguments: defined(
      update.displayArguments,
      existing.displayArguments
    ),
    ruleMatcher: defined(update.ruleMatcher, existing.ruleMatcher),
    options: defined(update.options, existing.options),
    fields: defined(update.fields, existing.fields),
    expiresAt: defined(update.expiresAt, existing.expiresAt),
    deadlineAt: defined(update.deadlineAt, existing.deadlineAt),
  };
}

function compareInteractionOrder(
  left: HumanControlInteraction,
  right: HumanControlInteraction
): number {
  if (
    left.cloudCursor !== null &&
    right.cloudCursor !== null &&
    left.cloudCursor !== right.cloudCursor
  ) {
    return left.cloudCursor - right.cloudCursor;
  }
  if (left.runId === right.runId && left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  if (
    left.requestedAt &&
    right.requestedAt &&
    left.requestedAt !== right.requestedAt
  ) {
    return left.requestedAt.localeCompare(right.requestedAt);
  }
  return left.interactionId.localeCompare(right.interactionId);
}

function orderedIds(
  interactionById: HumanControlProjectionState['interactionById']
): string[] {
  return Object.values(interactionById)
    .sort(compareInteractionOrder)
    .map((interaction) => interaction.interactionId);
}

/** Pure, idempotent reducer; store policy keeps unresolved BottomBox state. */
export function reduceHumanControlProjection(
  state: HumanControlProjectionState,
  input: HumanControlProjectionInput
): HumanControlProjectionState {
  if (
    input.projectId !== state.projectId ||
    state.seenEventIds[input.eventId]
  ) {
    return state;
  }

  const update = adaptHumanControlEvent(input);
  if (!update) return state;

  const interactionId = findCorrelatedInteractionId(state, update);
  if (!interactionId) {
    return {
      ...state,
      seenEventIds: { ...state.seenEventIds, [input.eventId]: true },
    };
  }

  const existing = state.interactionById[interactionId];
  const interaction = existing
    ? mergeInteraction(existing, update)
    : createInteraction(interactionId, update);
  const interactionById = {
    ...state.interactionById,
    [interactionId]: interaction,
  };

  return {
    ...state,
    interactionById,
    orderedInteractionIds: orderedIds(interactionById),
    seenEventIds: { ...state.seenEventIds, [input.eventId]: true },
  };
}

export function projectHumanControlEvents(
  projectId: string,
  inputs: readonly HumanControlProjectionInput[],
  initial?: HumanControlProjectionState
): HumanControlProjectionState {
  let state =
    initial?.projectId === projectId
      ? initial
      : createHumanControlProjectionState(projectId);
  for (const input of inputs)
    state = reduceHumanControlProjection(state, input);
  return state;
}
