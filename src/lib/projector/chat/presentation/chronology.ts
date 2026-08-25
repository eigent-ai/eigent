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

import type { ChatProjectionNode } from '../types';

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestampValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareNullableNumbers(
  left: number | null,
  right: number | null
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

/**
 * Canonical Timeline order. Creation time is the user-visible contract;
 * transport sequence and cursor values only break ties or order receipts that
 * do not carry a valid timestamp.
 */
export function compareTimelineNodes(
  left: ChatProjectionNode,
  right: ChatProjectionNode
): number {
  const timestampDifference = compareNullableNumbers(
    timestampValue(left.createdAt),
    timestampValue(right.createdAt)
  );
  if (timestampDifference) return timestampDifference;

  // Sequence and cursor are per-Run counters, so comparing them across Runs
  // sorts by an unrelated axis: an optimistic first frame (sequence 0) would
  // overtake the durable history of an earlier Run. Untimestamped nodes from
  // different Runs keep their arrival order through the stable sort below.
  if (left.runId !== right.runId) return 0;

  const sequenceDifference = compareNullableNumbers(
    finiteNumber(left.runSequence),
    finiteNumber(right.runSequence)
  );
  if (sequenceDifference) return sequenceDifference;

  const cursorDifference = compareNullableNumbers(
    finiteNumber(left.cloudCursor),
    finiteNumber(right.cloudCursor)
  );
  if (cursorDifference) return cursorDifference;

  const eventDifference = left.eventId.localeCompare(right.eventId);
  if (eventDifference) return eventDifference;
  return left.id.localeCompare(right.id);
}

/** Sort a copy so the immutable projection ledger is never mutated. */
export function sortTimelineNodes(
  nodes: readonly ChatProjectionNode[]
): ChatProjectionNode[] {
  return [...nodes].sort(compareTimelineNodes);
}
