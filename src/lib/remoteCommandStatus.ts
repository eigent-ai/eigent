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

import type { TFunction } from 'i18next';

export type LocalRemoteCommandStatus = {
  id: string;
  content: string;
  type: string;
  status: string;
  error?: string;
};

/** Translate only stable bridge-owned errors; preserve dynamic server detail. */
export function remoteControlErrorText(
  error: string | null | undefined,
  t: TFunction
): string {
  switch (error) {
    case 'Remote command failed':
      return t('layout.remote-control-error-command-failed', {
        defaultValue: 'Remote command failed',
      });
    case 'Remote command timed out':
      return t('layout.remote-control-error-command-timeout', {
        defaultValue: 'Remote command timed out',
      });
    case 'Remote control authentication expired':
      return t('layout.remote-control-error-auth-expired', {
        defaultValue: 'Remote control authentication expired',
      });
    case 'Desktop chat view is offline':
      return t('layout.remote-control-error-chat-offline', {
        defaultValue: 'The desktop chat view is offline',
      });
    case 'Desktop Space is not loaded locally':
      return t('layout.remote-control-error-space-not-loaded', {
        defaultValue: 'This Space is not loaded on the desktop',
      });
    case 'Desktop Project is not loaded in this Space':
      return t('layout.remote-control-error-session-not-loaded', {
        defaultValue: 'This session is not loaded in the desktop Space',
      });
    case 'Too many remote commands in a short time':
      return t('layout.remote-control-error-rate-limit', {
        defaultValue: 'Too many remote commands in a short time',
      });
    case 'The command was admitted before Desktop restarted; it was not replayed.':
      return t('layout.remote-control-error-restart', {
        defaultValue:
          'The command was accepted before the desktop restarted and was not replayed.',
      });
    case 'Command was rejected':
      return t('layout.remote-control-error-rejected', {
        defaultValue: 'The command was rejected',
      });
    case 'Durable command state has no replayable execution result':
      return t('layout.remote-control-error-no-result', {
        defaultValue: 'The command has no replayable result',
      });
    case 'Command expired or could not pass its receipt gate':
      return t('layout.remote-control-error-expired', {
        defaultValue: 'The command expired before the desktop confirmed it',
      });
    case 'Remote control bridge registration failed.':
      return t('layout.remote-control-error-registration-failed', {
        defaultValue: 'Remote control registration failed.',
      });
    case 'Remote control bridge registration was rejected by policy.':
      return t('layout.remote-control-error-registration-rejected', {
        defaultValue: 'Remote control registration was rejected by policy.',
      });
    default:
      return (
        error ||
        t('layout.unknown-error', {
          defaultValue: 'Unknown error',
        })
      );
  }
}

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
