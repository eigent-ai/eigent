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

/**
 * Legacy Normal is safe only when it can render every Run currently present in
 * the event-native ChatProjection. A single uncovered Run must select the
 * event-native renderer so mixed migration history cannot hide new work.
 */
export function hasCompleteLegacyNormalRunCoverage(
  canonicalRunIds: Iterable<string>,
  legacyRunIds: Iterable<string>
): boolean {
  const coveredRunIds = new Set(legacyRunIds);
  for (const runId of new Set(canonicalRunIds)) {
    if (!coveredRunIds.has(runId)) return false;
  }
  return true;
}

type CanonicalApprovalNode = {
  eventType?: string;
  kind?: string;
  interactionType?: string;
};

/**
 * Permission approvals require the canonical Normal renderer. Only canonical
 * approval.requested is sufficient: a legacy ASK mirror has no guarded
 * toolCallId row and must not force an incomplete event-native presentation.
 */
export function hasCanonicalPermissionApproval(
  nodes: Iterable<CanonicalApprovalNode>
): boolean {
  for (const node of nodes) {
    if (
      node.kind === 'interaction' &&
      node.interactionType === 'approval' &&
      node.eventType === 'approval.requested'
    ) {
      return true;
    }
  }
  return false;
}
