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

import { partitionLegacyReplyEvidence } from '@/components/ChatBox/EventTimeline/legacyReplyEvidence';
import { presentChatSemanticEntities } from '@/components/ChatBox/EventTimeline/presentationPolicy';
import { isActiveRunStatus } from '@/components/ChatBox/TimelineModes/shared';
import {
  createProjectViewState,
  reduceProjectView,
  type CanonicalProjectEvent,
  type ProjectViewState,
} from '@/lib/projector';
import {
  createChatProjectionState,
  projectChatEvents,
  selectRenderableChatNodes,
  type ChatProjectionState,
} from '@/lib/projector/chat';
import {
  composeTimelineRuns,
  reconcileTimelineRuns,
  type TimelineRunView,
} from '@/lib/projector/chat/presentation';

/** Projection of the first `position` events of a replay. */
export interface ReplayProjection {
  projectId: string;
  events: readonly CanonicalProjectEvent[];
  position: number;
  chat: ChatProjectionState;
  view: ProjectViewState;
}

/**
 * Project the visible prefix. Moving forward reduces only the new events onto
 * the previous projection; moving back starts again from the first event,
 * because the reducers only move forward.
 */
export function advanceReplayProjection(
  previous: ReplayProjection | null,
  projectId: string,
  events: readonly CanonicalProjectEvent[],
  position: number
): ReplayProjection {
  const target = Math.max(0, Math.min(position, events.length));
  const reusable =
    previous &&
    previous.projectId === projectId &&
    previous.events === events &&
    previous.position <= target;
  if (reusable && previous.position === target) return previous;

  const from = reusable ? previous.position : 0;
  const slice = events.slice(from, target);
  const chat = projectChatEvents(
    projectId,
    slice,
    reusable ? previous.chat : createChatProjectionState(projectId)
  );
  let view = reusable
    ? previous.view
    : createProjectViewState(projectId, 'playback');
  for (const event of slice) view = reduceProjectView(view, event);
  return { projectId, events, position: target, chat, view };
}

/** Timeline Runs for the renderer, composed exactly like the live view. */
export function composeReplayRuns(
  projection: ReplayProjection
): TimelineRunView[] {
  const nodes = selectRenderableChatNodes(projection.chat).filter(
    (node) => node.projectId === projection.projectId
  );
  const conversation = partitionLegacyReplyEvidence(nodes);
  // Same presentation pass as the live timeline, without its DOM window:
  // a replay shows every event up to the play head.
  const visibleNodes = presentChatSemanticEntities(conversation.nodes);
  const runs = reconcileTimelineRuns(
    composeTimelineRuns(visibleNodes),
    projection.view.runs
  );
  return runs.map((run) => withReplayClock(run, projection));
}

function timeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A Run that has not ended yet in the replay would otherwise count its
 * elapsed time against the wall clock. Measure it to the last event shown
 * instead, so the timer moves with the replay.
 */
function withReplayClock(
  run: TimelineRunView,
  projection: ReplayProjection
): TimelineRunView {
  if (!isActiveRunStatus(run.status)) return run;
  let lastShown: number | null = null;
  for (let index = projection.position - 1; index >= 0; index -= 1) {
    const event = projection.events[index];
    if (event.runId !== run.runId) continue;
    lastShown = timeMs(event.createdAt);
    break;
  }
  const started =
    timeMs(run.timestamps.startedAt) ?? timeMs(run.timestamps.createdAt);
  if (lastShown === null || started === null) return run;
  return {
    ...run,
    timestamps: {
      ...run.timestamps,
      durationMs: Math.max(0, lastShown - started),
      elapsedAnchor: null,
    },
  };
}
