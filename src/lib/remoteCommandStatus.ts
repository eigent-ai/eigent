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
// Licensed under the Apache License, Version 2.0 (the "License");

export type LocalRemoteCommandStatus = {
  id: string;
  content: string;
  type: string;
  status: string;
  error?: string;
};

const COMMAND_STATUS_RANK: Record<string, number> = {
  pending: 0,
  leased: 1,
  sent: 1,
  delivered: 1,
  confirmed: 2,
  durably_received: 2,
  accepted: 3,
  running: 4,
  rejected: 5,
  completed: 5,
  failed: 5,
  outcome_unknown: 5,
  expired: 5,
};
const TERMINAL_COMMAND_STATUSES = new Set([
  'rejected',
  'completed',
  'failed',
  'outcome_unknown',
  'expired',
]);

/** Merge Cloud command updates without allowing stale frames to move backward. */
export function mergeLocalRemoteCommandStatus(
  current: LocalRemoteCommandStatus[],
  incoming: LocalRemoteCommandStatus
): LocalRemoteCommandStatus[] {
  const index = current.findIndex((command) => command.id === incoming.id);
  if (index < 0) return [...current, incoming];
  const existing = current[index];
  const existingRank = COMMAND_STATUS_RANK[existing.status];
  const incomingRank = COMMAND_STATUS_RANK[incoming.status];
  const preserveExisting =
    (TERMINAL_COMMAND_STATUSES.has(existing.status) &&
      existing.status !== incoming.status) ||
    (existingRank !== undefined &&
      incomingRank !== undefined &&
      incomingRank < existingRank);
  const next = [...current];
  next[index] = {
    ...existing,
    ...incoming,
    status: preserveExisting ? existing.status : incoming.status,
    error: incoming.error ?? existing.error,
  };
  return next;
}
