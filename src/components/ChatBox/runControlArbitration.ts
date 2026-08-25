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

import type { ProjectEventStoreSnapshot } from '@/store/projectEventStore';
import { ChatTaskStatus, type ChatTaskStatusType } from '@/types/constants';

export type EventNativeProjectedRun =
  ProjectEventStoreSnapshot['view']['runs'][string];

export type ComposerTaskControlState = 'idle' | 'running' | 'paused';

/**
 * Pause/resume still targets the Project-scoped legacy TaskLock. Keep the
 * control available while the durable projection is hydrating, but fail
 * closed once projection explicitly selects a different Run.
 */
export function selectComposerTaskControlState({
  eventNativeTimelineEnabled,
  legacyControlRunId,
  activeTaskStatus,
  eventNativeActiveRunId,
}: {
  eventNativeTimelineEnabled: boolean;
  legacyControlRunId: string | null | undefined;
  activeTaskStatus: ChatTaskStatusType | null | undefined;
  eventNativeActiveRunId: string | null | undefined;
}): ComposerTaskControlState {
  if (
    eventNativeTimelineEnabled &&
    (!legacyControlRunId ||
      (eventNativeActiveRunId && eventNativeActiveRunId !== legacyControlRunId))
  ) {
    return 'idle';
  }
  if (activeTaskStatus === ChatTaskStatus.PAUSE) return 'paused';
  if (activeTaskStatus === ChatTaskStatus.RUNNING) return 'running';
  return 'idle';
}

const PENDING_CONTROL_RUN_STATUSES = new Set([
  'pending',
  'running',
  'waiting_for_user',
  'cancelling',
]);

const LIVE_RUN_STATUSES = new Set(['running', 'cancelling']);

const TYPED_HUMAN_REQUEST_EVENT_TYPES = new Set([
  'interaction.requested',
  'approval.requested',
]);

export function isEventNativeRunActionable(
  run: EventNativeProjectedRun
): boolean {
  return (
    run.origin === 'local' &&
    !run.resumeBlockedReason &&
    run.lastSequence >= run.runVersion
  );
}

function snapshotCanIssueControls(
  snapshot: ProjectEventStoreSnapshot
): boolean {
  return (
    !snapshot.overflowed &&
    !snapshot.view.needsResync &&
    !snapshot.view.eventsTruncated
  );
}

function hasRetainedCanonicalRunEvidence(
  snapshot: ProjectEventStoreSnapshot,
  runId: string
): boolean {
  return snapshot.chat.nodes.some(
    (node) => node.runId === runId && !node.eventType.startsWith('legacy.')
  );
}

function hasTypedCanonicalRequestAuthority(
  snapshot: ProjectEventStoreSnapshot,
  interactionId: string
): boolean {
  const interaction = snapshot.control.interactionById[interactionId];
  return Boolean(
    interaction?.requestSource === 'canonical' &&
    interaction.requestEventType &&
    TYPED_HUMAN_REQUEST_EVENT_TYPES.has(interaction.requestEventType)
  );
}

/** Select the one Run allowed to own event-native BottomBox controls. */
export function selectEventNativeActiveRunId(
  snapshot: ProjectEventStoreSnapshot | null,
  legacyActiveRunId: string | null | undefined
): string | null {
  if (!snapshot || !snapshotCanIssueControls(snapshot)) return null;

  for (const interactionId of snapshot.control.orderedInteractionIds) {
    const interaction = snapshot.control.interactionById[interactionId];
    const projectedRun = interaction
      ? snapshot.view.runs[interaction.runId]
      : undefined;
    if (
      interaction?.status === 'requested' &&
      hasTypedCanonicalRequestAuthority(snapshot, interactionId) &&
      projectedRun &&
      PENDING_CONTROL_RUN_STATUSES.has(projectedRun.status) &&
      isEventNativeRunActionable(projectedRun)
    ) {
      return interaction.runId;
    }
  }

  if (!legacyActiveRunId) return null;
  const legacyOwnedRun = snapshot.view.runs[legacyActiveRunId];
  return legacyOwnedRun &&
    LIVE_RUN_STATUSES.has(legacyOwnedRun.status) &&
    isEventNativeRunActionable(legacyOwnedRun) &&
    hasRetainedCanonicalRunEvidence(snapshot, legacyOwnedRun.runId)
    ? legacyActiveRunId
    : null;
}

export function selectActionableInterruptedRun(
  snapshot: ProjectEventStoreSnapshot | null,
  runId: string | null | undefined
): EventNativeProjectedRun | null {
  if (!snapshot || !runId || !snapshotCanIssueControls(snapshot)) return null;
  const run = snapshot.view.runs[runId];
  return run?.status === 'interrupted' &&
    isEventNativeRunActionable(run) &&
    hasRetainedCanonicalRunEvidence(snapshot, runId)
    ? run
    : null;
}
