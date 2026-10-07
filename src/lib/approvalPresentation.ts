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

import {
  type RunTerminalReason,
  runTerminalReasonText,
} from '@/lib/runTerminalReason';
import type { HumanInteractionPayload } from '@/service/humanInteractionApi';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Detailed mode keeps the journal's own reason verbatim. */
export function approvalRecordedReason(
  reason: string | null | undefined,
  t: Translate
): string {
  return reason ? t('chat.approval-recorded-reason', { reason }) : '';
}

/** Banners name only the closed cause; its detail stays in Detailed mode. */
export function interruptedRunDescription(
  reason: RunTerminalReason | null | undefined,
  t: Translate
): string {
  return [
    runTerminalReasonText(reason, t),
    // Only a Run that can resume asks an expired request again.
    reason === 'approval_expired' ? t('chat.run-resume-reevaluates-hint') : '',
    t('chat.run-interrupted-description'),
  ]
    .filter(Boolean)
    .join(' ');
}

export function isInteractionTerminal(
  interaction: HumanInteractionPayload
): boolean {
  return Boolean(
    interaction.status &&
    !['requested', 'presented', 'pending'].includes(interaction.status)
  );
}

export function interactionExpiryMs(
  interaction?: HumanInteractionPayload
): number | null {
  const value = interaction?.expires_at;
  if (value == null) return null;
  const ms = typeof value === 'number' ? value * 1000 : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isHumanInteractionReadOnly(input: {
  interaction: HumanInteractionPayload;
  activeTaskId?: string | null;
  taskType?: string;
  taskStatus?: string;
  durableRunStatus?: string;
}): boolean {
  const { interaction } = input;
  if (
    input.taskType === 'share' ||
    interaction.receipt ||
    isInteractionTerminal(interaction)
  )
    return true;
  if (
    [
      'interrupted',
      'completed',
      'failed',
      'cancelled',
      'timed_out',
      'cancelling',
      'stopped',
    ].includes(input.durableRunStatus || '')
  )
    return true;
  const expiry = interactionExpiryMs(interaction);
  if (expiry !== null && expiry <= Date.now()) return true;
  if (interaction.run_id && interaction.run_id !== input.activeTaskId)
    return true;
  // A matching durable waiter can outlive stale legacy replay flags. The card
  // still verifies the exact interaction/version against the pending endpoint.
  if (
    interaction.run_id === input.activeTaskId &&
    input.durableRunStatus === 'waiting_for_user'
  )
    return false;
  return input.taskType === 'replay' || input.taskStatus === 'finished';
}
