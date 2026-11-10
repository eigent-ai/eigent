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
  t: Translate,
  /** Replaces the promise that Resume picks up when it cannot. */
  resumeUnavailableReason?: string,
  /** The Brain's `code: message` detail; only its code is read. */
  detail?: string | null
): string {
  // A model the provider could not serve also stops the runtime; name the
  // model instead of a lost process.
  const modelUnavailable =
    reason === 'runtime_lost' &&
    detail?.split(':', 1)[0] === 'model_transport_error';
  return [
    modelUnavailable
      ? t('chat.notice-model-unavailable')
      : runTerminalReasonText(reason, t),
    // Only a Run that can resume asks an expired request again.
    reason === 'approval_expired' && !resumeUnavailableReason
      ? t('chat.run-resume-reevaluates-hint')
      : '',
    resumeUnavailableReason ?? t('chat.run-interrupted-description'),
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

export type ApprovalTargetKind = 'path' | 'url' | 'command';

export interface ApprovalTarget {
  kind: ApprovalTargetKind;
  value: string;
}

// Policy-only digests that stand in for a shell command or an opaque tool.
const POLICY_DIGEST_TARGET_PREFIXES = [
  'terminal-command:sha256:',
  'tool-identity:sha256:',
];
const COMMAND_ARGUMENT_KEYS = ['command', 'cmd', 'script'];

function shellQuote(word: string): string {
  if (/^[\w@%+=:,./-]+$/.test(word)) return word;
  return `'${word.replace(/'/g, `'"'"'`)}'`;
}

function commandLines(displayArguments: Record<string, unknown>): string[] {
  const commands: string[] = [];
  for (const key of COMMAND_ARGUMENT_KEYS) {
    const value = displayArguments[key];
    if (typeof value === 'string' && value.trim()) commands.push(value.trim());
  }
  const argv = displayArguments.argv;
  if (Array.isArray(argv) && argv.length > 0) {
    commands.push(argv.map((word) => shellQuote(String(word))).join(' '));
  }
  return commands;
}

/**
 * What an approval acts on, as a person recognises it: file paths and URLs as
 * requested, and a shell command as its command line. The command comes from
 * the Brain's redacted display arguments, because the policy target is only a
 * digest of it.
 */
export function approvalTargets(input: {
  operation?: string | null;
  targetResources?: readonly string[] | null;
  displayArguments?: Record<string, unknown> | null;
}): ApprovalTarget[] {
  const resources = (input.targetResources ?? []).filter(
    (resource): resource is string =>
      typeof resource === 'string' && resource.trim() !== ''
  );
  const targets: ApprovalTarget[] = [];
  const isCommand =
    input.operation === 'terminal.execute' ||
    resources.some((resource) => resource.startsWith('terminal-command:'));
  if (isCommand && input.displayArguments) {
    for (const value of commandLines(input.displayArguments)) {
      targets.push({ kind: 'command', value });
    }
  }
  for (const resource of resources) {
    if (
      POLICY_DIGEST_TARGET_PREFIXES.some((prefix) =>
        resource.startsWith(prefix)
      )
    )
      continue;
    targets.push({
      kind: /^[a-z][a-z\d+.-]*:\/\//i.test(resource) ? 'url' : 'path',
      value: resource,
    });
  }
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.value)) return false;
    seen.add(target.value);
    return true;
  });
}

/**
 * An approval's question followed by what it acts on, one target per line, so
 * a timeline receipt names the same file or command line as the card did. A
 * target the question already names is not repeated.
 */
export function approvalRequestText(
  question: string | null | undefined,
  targets: readonly string[] | null | undefined
): string {
  const text = question?.trim() ?? '';
  const extra = (targets ?? []).filter(
    (target) => target.trim() !== '' && !text.includes(target)
  );
  return [text, ...extra].filter(Boolean).join('\n');
}
