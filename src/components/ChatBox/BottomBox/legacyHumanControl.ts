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
import type {
  BottomBoxApprovalOption,
  BottomBoxApprovalScope,
  BottomBoxApprovalVariant,
  BottomBoxConfirmationVariant,
  BottomBoxHeaderDetail,
} from './types';

/** Minimal shape of the i18next `t` returned by `useTranslation`. */
export type HumanControlTranslate = (
  key: string,
  options?: Record<string, unknown>
) => string;

/**
 * Single source of approval copy. The event-native controller and this legacy
 * bridge must offer the identical wording for the same permission grant.
 */
export function approvalScopeLabels(
  t: HumanControlTranslate,
  isToolMatcher = false
): Record<BottomBoxApprovalScope, string> {
  void isToolMatcher;
  return {
    once: t('chat.control-approve-once'),
    run: t('chat.control-approve-run'),
    space: t('chat.control-approve-space'),
  };
}

export function approvalScopeDescriptions(
  t: HumanControlTranslate
): Record<BottomBoxApprovalScope, string> {
  return {
    once: t('chat.control-approve-once-description'),
    run: t('chat.control-approve-run-description'),
    space: t('chat.control-approve-space-description'),
  };
}

function approvalOptions(
  interaction: HumanInteractionPayload,
  t: HumanControlTranslate
): BottomBoxApprovalOption[] {
  const labels = approvalScopeLabels(t);
  const descriptions = approvalScopeDescriptions(t);
  const offered = (interaction.allowed_scopes || []).filter(
    (scope): scope is BottomBoxApprovalScope =>
      scope === 'once' || scope === 'run' || scope === 'space'
  );
  const scopes = offered.length > 0 ? [...new Set(offered)] : ['once' as const];
  return scopes.map((scope) => ({
    scope,
    label: labels[scope],
    description: descriptions[scope],
  }));
}

export function createLegacyApprovalVariant(input: {
  interaction?: HumanInteractionPayload;
  fallbackQuestion?: string;
  submitting?: boolean;
  t: HumanControlTranslate;
  onApprove: (scope: BottomBoxApprovalScope) => void;
  onReject: () => void;
}): BottomBoxApprovalVariant | null {
  if (input.interaction?.interaction_type !== 'approval') return null;

  return {
    kind: 'approval',
    header: {
      eyebrow: input.t('chat.control-input-required'),
      title:
        input.interaction.question ||
        input.fallbackQuestion ||
        input.interaction.title ||
        input.t('chat.control-approval-required'),
    },
    submitting: input.submitting,
    options: approvalOptions(input.interaction, input.t),
    onApprove: input.onApprove,
    onReject: input.onReject,
  };
}

/**
 * Requests answered with Confirm or Reject, such as a Memory change review.
 * A text reply cannot satisfy their decision, so they never use the question
 * composer.
 */
export function isLegacyConfirmationInteraction(
  interaction?: HumanInteractionPayload
): boolean {
  return (
    interaction?.interaction_type === 'memory_change_review' ||
    interaction?.interaction_type === 'confirmation'
  );
}

function reviewDetails(
  interaction: HumanInteractionPayload,
  t: HumanControlTranslate
): BottomBoxHeaderDetail[] | undefined {
  const displayArguments = interaction.display_arguments;
  if (!displayArguments || Object.keys(displayArguments).length === 0)
    return undefined;
  let content: string;
  try {
    content = JSON.stringify(displayArguments, null, 2);
  } catch {
    content = t('chat.control-arguments-unavailable');
  }
  return [
    {
      id: 'display-arguments',
      label: t('chat.control-review-arguments'),
      content,
    },
  ];
}

export function createLegacyConfirmationVariant(input: {
  interaction?: HumanInteractionPayload;
  fallbackQuestion?: string;
  submitting?: boolean;
  t: HumanControlTranslate;
  onConfirm: () => void;
  onReject: () => void;
}): BottomBoxConfirmationVariant | null {
  const { interaction } = input;
  if (!interaction || !isLegacyConfirmationInteraction(interaction))
    return null;

  return {
    kind: 'confirmation',
    header: {
      eyebrow: input.t('chat.control-input-required'),
      title: interaction.title || input.t('chat.control-input-required'),
      description: interaction.question || input.fallbackQuestion,
      details: reviewDetails(interaction, input.t),
    },
    submitting: input.submitting,
    onConfirm: input.onConfirm,
    onReject: input.onReject,
  };
}
