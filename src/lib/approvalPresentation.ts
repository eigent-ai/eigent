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

import type { HumanInteractionPayload } from '@/service/humanInteractionApi';

type Translate = (key: string, options?: Record<string, unknown>) => string;

function mappedApprovalReason(
  reason: string | null | undefined,
  t: Translate
): string {
  if (
    [
      'approval_expired',
      'tool_approval_expired',
      'approval.expired_rejected',
    ].includes(reason ?? '')
  ) {
    return t('chat.approval-expired-description');
  }
  if (reason === 'tool_terminal_before_dispatch') {
    return t('chat.approval-tool-ended-description');
  }
  return '';
}

/** Keep the journal reason verbatim unless it has an explicitly supported label. */
export function approvalTerminalReason(
  reason: string | null | undefined,
  t: Translate
): string {
  if (!reason) return '';
  return (
    mappedApprovalReason(reason, t) ||
    t('chat.approval-recorded-reason', { reason })
  );
}

/** Banners name only mapped approval causes; raw reasons stay in Detailed mode. */
export function interruptedRunDescription(
  reason: string | null | undefined,
  t: Translate
): string {
  return [
    mappedApprovalReason(reason, t),
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
