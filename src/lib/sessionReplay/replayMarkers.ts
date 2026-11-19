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

import type { CanonicalProjectEvent } from '@/lib/projector';
import {
  adaptChatProjectionEvent,
  type ChatProjectionNode,
} from '@/lib/projector/chat';

export type ReplayMarkerKind = 'approval' | 'question' | 'error' | 'final';

export interface ReplayMarker {
  kind: ReplayMarkerKind;
  /** Play-head position that shows this event (index + 1). */
  position: number;
  eventId: string;
}

function markerKind(node: ChatProjectionNode): ReplayMarkerKind | null {
  switch (node.kind) {
    case 'interaction':
      // One marker per request; the matching decision is the same moment.
      if (node.status !== 'requested') return null;
      return node.interactionType === 'approval' ? 'approval' : 'question';
    case 'run_status':
      return node.status === 'failed' || node.status === 'timed_out'
        ? 'error'
        : null;
    case 'notice':
      return node.severity === 'error' ? 'error' : null;
    case 'message':
      return node.role === 'assistant' &&
        node.purpose === 'final' &&
        node.status === 'complete'
        ? 'final'
        : null;
    default:
      return null;
  }
}

/**
 * Scrubber markers for approvals, questions, errors and final answers,
 * classified with the same adapter the timeline uses.
 */
export function buildReplayMarkers(
  events: readonly CanonicalProjectEvent[]
): ReplayMarker[] {
  const markers: ReplayMarker[] = [];
  events.forEach((event, index) => {
    let decision;
    try {
      decision = adaptChatProjectionEvent(event);
    } catch {
      return;
    }
    if (decision.kind !== 'display') return;
    const kind = markerKind(decision.node);
    if (kind) {
      markers.push({ kind, position: index + 1, eventId: event.eventId });
    }
  });
  return markers;
}
