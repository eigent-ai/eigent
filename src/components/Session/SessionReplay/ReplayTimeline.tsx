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

import { TimelineModeRenderer } from '@/components/ChatBox/TimelineModes';
import type { CanonicalProjectEvent } from '@/lib/projector';
import type { ChatTimelineDetailLevel } from '@/types/chatTimeline';
import type { SessionModeType } from '@/types/constants';
import { useMemo, useState } from 'react';

import {
  advanceReplayProjection,
  composeReplayRuns,
  type ReplayProjection,
} from './replayProjection';

/**
 * The first `position` events, drawn by the same renderer as the live
 * timeline. Pass `position = events.length` for the finished view (the Share
 * preview does this).
 */
export function ReplayTimeline({
  projectId,
  events,
  position,
  detailLevel,
  sessionMode,
  paused,
}: {
  projectId: string;
  events: readonly CanonicalProjectEvent[];
  position: number;
  detailLevel: ChatTimelineDetailLevel;
  sessionMode?: SessionModeType;
  paused?: boolean;
}) {
  // Keep the previous projection so moving forward only reduces new events.
  // Updating state during render is React's pattern for values derived from
  // the previous render.
  const [cached, setCached] = useState<ReplayProjection | null>(null);
  let projection = cached;
  if (
    !projection ||
    projection.projectId !== projectId ||
    projection.events !== events ||
    projection.position !== Math.min(position, events.length)
  ) {
    projection = advanceReplayProjection(cached, projectId, events, position);
    setCached(projection);
  }
  const runs = useMemo(() => composeReplayRuns(projection), [projection]);

  return (
    <div data-replay-timeline>
      <TimelineModeRenderer
        detailLevel={detailLevel}
        sessionMode={sessionMode}
        runs={runs}
        paused={paused}
        projectedArtifactsByRun={projection.view.artifactsByRun}
        artifactManifestsByRun={projection.view.artifactManifestsByRun}
      />
    </div>
  );
}
