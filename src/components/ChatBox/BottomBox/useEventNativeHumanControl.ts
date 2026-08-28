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

import { useProjectHumanControlProjection } from '@/hooks/useProjectEventView';
import {
  selectActiveHumanControl,
  selectPendingHumanControlCount,
  type HumanControlInteraction,
} from '@/lib/projector/control';
import {
  decideHumanInteraction,
  type HumanInteractionPayload,
} from '@/service/humanInteractionApi';
import { reconcileHumanInteractionEvents } from '@/service/humanInteractionEventReconciliation';
import { useAuthStore } from '@/store/authStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  BottomBoxApprovalScope,
  BottomBoxContextItem,
  BottomBoxVariant,
} from './types';

const DECISION_STORAGE_PREFIX = 'eigent:human-control-decision:v1';
const DECISION_STORAGE_INDEX_KEY = `${DECISION_STORAGE_PREFIX}:index`;
export const STABLE_DECISION_REQUEST_ID_CACHE_LIMIT = 128;

type ControlledBottomBoxVariant = Exclude<BottomBoxVariant, { kind: 'input' }>;

type SubmissionPhase = 'idle' | 'submitting' | 'reconciling';

type DraftState = {
  key: string;
  feedback: string;
  selectedIds: string[];
  formValues: Record<string, string>;
};

type SubmissionState = {
  key: string;
  phase: SubmissionPhase;
  error: string | null;
};

export type UseEventNativeHumanControlInput = {
  projectId: string | null | undefined;
  /** The controller never falls back to a pending control from another Run. */
  activeRunId: string | null | undefined;
  actorId?: string | number | null;
  enabled?: boolean;
  /** Immediate presentation bridge while the durable decision is in flight. */
  onSubmissionStart?: (interaction: HumanControlInteraction) => void;
  /** Restores the input-required presentation when submission cannot settle. */
  onSubmissionFailure?: (interaction: HumanControlInteraction) => void;
  /** Temporary compatibility bridge after an authoritative terminal event is loaded. */
  onDurableResolution?: (interaction: HumanControlInteraction) => void;
};

export type EventNativeHumanControlController = {
  interaction: HumanControlInteraction | null;
  variant: ControlledBottomBoxVariant | null;
  pendingCount: number;
  phase: SubmissionPhase;
  submitError: string | null;
};

function blankDraft(key: string): DraftState {
  return { key, feedback: '', selectedIds: [], formValues: {} };
}

function blankSubmission(key: string): SubmissionState {
  return { key, phase: 'idle', error: null };
}

function randomRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `decision-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, candidate: unknown) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      return candidate;
    }
    if (seen.has(candidate)) throw new Error('Decision must be serializable');
    seen.add(candidate);
    return Object.fromEntries(
      Object.entries(candidate as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
    );
  });
}

function fingerprint(value: unknown): string {
  const text = stableJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function storageKeyPrefix(
  projectId: string,
  interaction: HumanControlInteraction
): string {
  return [
    DECISION_STORAGE_PREFIX,
    encodeURIComponent(projectId),
    encodeURIComponent(interaction.runId),
    encodeURIComponent(interaction.interactionId),
  ].join(':');
}

function storageKey(
  projectId: string,
  interaction: HumanControlInteraction
): string {
  return `${storageKeyPrefix(projectId, interaction)}:${String(interaction.version ?? 0)}`;
}

function storedCacheKeys(): string[] {
  try {
    const indexedRaw = globalThis.sessionStorage?.getItem(
      DECISION_STORAGE_INDEX_KEY
    );
    const indexedValue = indexedRaw ? (JSON.parse(indexedRaw) as unknown) : [];
    const indexed = Array.isArray(indexedValue)
      ? indexedValue.filter(
          (key): key is string =>
            typeof key === 'string' &&
            key.startsWith(`${DECISION_STORAGE_PREFIX}:`) &&
            key !== DECISION_STORAGE_INDEX_KEY &&
            globalThis.sessionStorage?.getItem(key) !== null
        )
      : [];
    const indexedSet = new Set(indexed);
    const discovered: string[] = [];
    for (
      let index = 0;
      index < (globalThis.sessionStorage?.length ?? 0);
      index += 1
    ) {
      const key = globalThis.sessionStorage?.key(index);
      if (
        key &&
        key.startsWith(`${DECISION_STORAGE_PREFIX}:`) &&
        key !== DECISION_STORAGE_INDEX_KEY &&
        !indexedSet.has(key)
      ) {
        discovered.push(key);
      }
    }
    // Unindexed entries predate the LRU index and are treated as oldest.
    return [...discovered, ...indexed];
  } catch {
    return [];
  }
}

function touchStoredRequestId(
  key: string,
  stored: { fingerprint: string; requestId: string }
): void {
  try {
    globalThis.sessionStorage?.setItem(key, JSON.stringify(stored));
    const order = storedCacheKeys().filter((candidate) => candidate !== key);
    order.push(key);
    const evicted = order.splice(
      0,
      Math.max(0, order.length - STABLE_DECISION_REQUEST_ID_CACHE_LIMIT)
    );
    for (const evictedKey of evicted) {
      globalThis.sessionStorage?.removeItem(evictedKey);
    }
    globalThis.sessionStorage?.setItem(
      DECISION_STORAGE_INDEX_KEY,
      JSON.stringify(order)
    );
  } catch {
    // The bounded in-memory cache remains available when storage is blocked.
  }
}

function readStoredRequestId(
  key: string,
  decisionFingerprint: string
): string | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as {
      fingerprint?: unknown;
      requestId?: unknown;
    };
    return stored.fingerprint === decisionFingerprint &&
      typeof stored.requestId === 'string' &&
      stored.requestId
      ? stored.requestId
      : null;
  } catch {
    return null;
  }
}

const memoryRequestIds = new Map<
  string,
  {
    fingerprint: string;
    requestId: string;
    projectId: string;
    runId: string;
    interactionId: string;
  }
>();

function rememberRequestId(
  key: string,
  interaction: HumanControlInteraction,
  stored: { fingerprint: string; requestId: string }
): void {
  // Delete first so Map insertion order acts as a small LRU.
  memoryRequestIds.delete(key);
  memoryRequestIds.set(key, {
    ...stored,
    projectId: interaction.projectId,
    runId: interaction.runId,
    interactionId: interaction.interactionId,
  });
  while (memoryRequestIds.size > STABLE_DECISION_REQUEST_ID_CACHE_LIMIT) {
    const oldest = memoryRequestIds.keys().next().value as string | undefined;
    if (!oldest) break;
    memoryRequestIds.delete(oldest);
  }
  touchStoredRequestId(key, stored);
}

function releaseStableDecisionRequestIds(
  projectId: string,
  interaction: HumanControlInteraction
): void {
  const prefix = `${storageKeyPrefix(projectId, interaction)}:`;
  for (const key of memoryRequestIds.keys()) {
    if (key.startsWith(prefix)) memoryRequestIds.delete(key);
  }
  try {
    const retained = storedCacheKeys().filter((key) => {
      if (!key.startsWith(prefix)) return true;
      globalThis.sessionStorage?.removeItem(key);
      return false;
    });
    globalThis.sessionStorage?.setItem(
      DECISION_STORAGE_INDEX_KEY,
      JSON.stringify(retained)
    );
  } catch {
    // Storage cleanup is best effort; normal LRU pruning remains bounded.
  }
}

/** Stable for a remount/retry, but replaced when the user changes decision. */
export function getStableDecisionRequestId(
  projectId: string,
  interaction: HumanControlInteraction,
  decision: Record<string, unknown>
): string {
  const key = storageKey(projectId, interaction);
  const decisionFingerprint = fingerprint(decision);
  const inMemory = memoryRequestIds.get(key);
  if (inMemory?.fingerprint === decisionFingerprint) {
    rememberRequestId(key, interaction, inMemory);
    return inMemory.requestId;
  }

  const requestId =
    readStoredRequestId(key, decisionFingerprint) || randomRequestId();
  const stored = { fingerprint: decisionFingerprint, requestId };
  rememberRequestId(key, interaction, stored);
  return requestId;
}

type Translate = ReturnType<typeof useTranslation>['t'];

function humanize(value: string): string {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function displayArgumentsDetail(
  interaction: HumanControlInteraction,
  t: Translate
): ControlledBottomBoxVariant['header']['details'] {
  if (Object.keys(interaction.displayArguments).length === 0) return undefined;
  let content = '';
  try {
    content = JSON.stringify(interaction.displayArguments, null, 2);
  } catch {
    content = t('chat.control-arguments-unavailable');
  }
  const maxCharacters = 16_000;
  if (content.length > maxCharacters) {
    content = `${content.slice(0, maxCharacters)}\n… truncated`;
  }
  return [
    {
      id: 'display-arguments',
      label: t('chat.control-review-arguments'),
      content,
    },
  ];
}

function headerFor(
  interaction: HumanControlInteraction,
  submitError: string | null,
  t: Translate
): ControlledBottomBoxVariant['header'] {
  const contextItems: BottomBoxContextItem[] = [];
  if (interaction.agent) {
    contextItems.push({
      id: `agent:${interaction.agent}`,
      label: interaction.agent,
      kind: 'agent',
    });
  }
  if (interaction.operation) {
    contextItems.push({
      id: `operation:${interaction.operation}`,
      label: interaction.operation,
      kind: 'operation',
    });
  }
  interaction.targetResources.forEach((resource, index) => {
    contextItems.push({
      id: `target:${index}:${resource}`,
      label: resource,
      description: resource,
      kind: 'external-context',
    });
  });

  return {
    eyebrow: t('chat.control-input-required'),
    title: interaction.title || humanize(interaction.interactionType),
    description: [interaction.prompt, submitError].filter(Boolean).join(' '),
    contextItems,
    details: displayArgumentsDetail(interaction, t),
  };
}

const SUPPORTED_INTERACTION_TYPES = new Set<
  HumanInteractionPayload['interaction_type']
>([
  'question',
  'choice',
  'form',
  'confirmation',
  'approval',
  'diff_review',
  'merge_conflict',
  'credential_binding',
]);

function decisionPayloadFor(
  interaction: HumanControlInteraction
): HumanInteractionPayload {
  const interactionType = SUPPORTED_INTERACTION_TYPES.has(
    interaction.interactionType as HumanInteractionPayload['interaction_type']
  )
    ? (interaction.interactionType as HumanInteractionPayload['interaction_type'])
    : 'confirmation';

  return {
    interaction_id: interaction.interactionId,
    interaction_type: interactionType,
    run_id: interaction.runId,
    version: interaction.version,
    approval_id: interaction.approvalId,
    action_digest: interaction.actionDigest,
    title: interaction.title,
    question: interaction.prompt,
    agent: interaction.agent,
    operation: interaction.operation,
    target_resources: interaction.targetResources,
    display_arguments: interaction.displayArguments,
    rule_matcher: interaction.ruleMatcher
      ? {
          action_pattern: interaction.ruleMatcher.actionPattern,
          resource_pattern: interaction.ruleMatcher.resourcePattern,
          matcher_kind: interaction.ruleMatcher.matcherKind,
        }
      : null,
    allowed_scopes: interaction.allowedScopes.filter(
      (scope): scope is BottomBoxApprovalScope =>
        scope === 'once' || scope === 'run' || scope === 'space'
    ),
    options: interaction.options.map((option) => ({
      option_id: option.id,
      label: option.label,
      value: option.value,
      description: option.description,
    })),
    fields: interaction.fields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      required: field.required,
    })),
  };
}

function formFieldType(
  value: string | undefined
): 'text' | 'email' | 'number' | 'textarea' | null {
  switch (value?.trim().toLowerCase()) {
    case 'text':
    case 'string':
      return 'text';
    case 'email':
      return 'email';
    case 'number':
    case 'integer':
      return 'number';
    case 'textarea':
    case 'multiline':
      return 'textarea';
    default:
      // Password, secret, credential and future field types must never be
      // silently downgraded to a visible text control.
      return null;
  }
}

export function useEventNativeHumanControl({
  projectId,
  activeRunId,
  actorId,
  enabled = true,
  onSubmissionStart,
  onSubmissionFailure,
  onDurableResolution,
}: UseEventNativeHumanControlInput): EventNativeHumanControlController {
  const { t } = useTranslation();
  const authenticatedUserId = useAuthStore((state) => state.user_id);
  const control = useProjectHumanControlProjection(projectId);
  const interaction = useMemo(
    () =>
      enabled && activeRunId
        ? selectActiveHumanControl(control, activeRunId)
        : null,
    [activeRunId, control, enabled]
  );
  const pendingCount = useMemo(
    () =>
      enabled && activeRunId
        ? selectPendingHumanControlCount(control, activeRunId)
        : 0,
    [activeRunId, control, enabled]
  );
  const controlKey = interaction
    ? `${interaction.runId}:${interaction.interactionId}:${interaction.version ?? 0}`
    : '';
  const [draft, setDraft] = useState<DraftState>(() => blankDraft(controlKey));
  const [submission, setSubmission] = useState<SubmissionState>(() =>
    blankSubmission(controlKey)
  );
  const inFlightKey = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    const terminalInteractions = new Map<string, HumanControlInteraction>();
    for (const cached of memoryRequestIds.values()) {
      if (cached.projectId !== projectId) continue;
      const projected = control.interactionById[cached.interactionId];
      if (
        projected?.runId === cached.runId &&
        projected.status !== 'requested'
      ) {
        terminalInteractions.set(projected.interactionId, projected);
      }
    }
    for (const terminal of terminalInteractions.values()) {
      releaseStableDecisionRequestIds(projectId, terminal);
    }
  }, [control, projectId]);

  useEffect(() => {
    setDraft(blankDraft(controlKey));
    setSubmission(blankSubmission(controlKey));
    inFlightKey.current = null;
  }, [controlKey]);

  const activeDraft = draft.key === controlKey ? draft : blankDraft(controlKey);
  const activeSubmission =
    submission.key === controlKey ? submission : blankSubmission(controlKey);
  const submitting = activeSubmission.phase !== 'idle';

  const submit = useCallback(
    async (decision: Record<string, unknown>) => {
      if (!projectId || !interaction || !controlKey || submitting) return;
      if (inFlightKey.current === controlKey) return;
      inFlightKey.current = controlKey;
      setSubmission({ key: controlKey, phase: 'submitting', error: null });
      try {
        onSubmissionStart?.(interaction);
      } catch (error) {
        console.error(
          '[EventNativeHumanControl] submission-start bridge failed',
          error
        );
      }

      let decisionAccepted = false;
      const reconcileTerminalDecision = async () => {
        setSubmission({ key: controlKey, phase: 'reconciling', error: null });
        await reconcileHumanInteractionEvents({
          projectId,
          runId: interaction.runId,
          interactionId: interaction.interactionId,
          // Legacy /chat frames use a connection-local ordinal, not the
          // durable Run sequence. Start their authoritative reconciliation at
          // zero so a larger synthetic ordinal cannot skip the decision event.
          afterSequence:
            interaction.requestSource === 'canonical'
              ? interaction.sequence
              : 0,
        });
        try {
          onDurableResolution?.(interaction);
        } catch (error) {
          // Compatibility consumers must not turn an authoritative decision
          // into a failed/retryable command if their local cleanup fails.
          console.error(
            '[EventNativeHumanControl] post-resolution bridge failed',
            error
          );
        }
      };
      try {
        const decisionRequestId = getStableDecisionRequestId(
          projectId,
          interaction,
          decision
        );
        await decideHumanInteraction(decisionPayloadFor(interaction), {
          decisionRequestId,
          decision,
          actorId: actorId === undefined ? authenticatedUserId : actorId,
        });
        decisionAccepted = true;
        await reconcileTerminalDecision();
        // Remain disabled until the durable event is reduced and this pending
        // interaction disappears. There is no optimistic local resolution.
      } catch (error) {
        let failure = error;
        const status =
          error && typeof error === 'object'
            ? ((error as { status?: unknown; response?: { status?: unknown } })
                .status ??
              (error as { response?: { status?: unknown } }).response?.status)
            : null;
        if (!decisionAccepted && status === 409) {
          // A stale UI may submit after recovery or another client already
          // resolved the interaction. A conflict is not automatically a
          // failure: replay the authoritative terminal event first. If no
          // such event exists, reconciliation fails closed below.
          try {
            await reconcileTerminalDecision();
            return;
          } catch (reconciliationError) {
            failure = reconciliationError;
          }
        }
        console.error('[EventNativeHumanControl] decision failed', failure);
        try {
          onSubmissionFailure?.(interaction);
        } catch (bridgeError) {
          console.error(
            '[EventNativeHumanControl] submission-failure bridge failed',
            bridgeError
          );
        }
        const message = decisionAccepted
          ? t('chat.control-decision-unsynced')
          : t('chat.control-decision-failed');
        setSubmission({ key: controlKey, phase: 'idle', error: message });
      } finally {
        if (inFlightKey.current === controlKey) inFlightKey.current = null;
      }
    },
    [
      actorId,
      authenticatedUserId,
      controlKey,
      interaction,
      onDurableResolution,
      onSubmissionFailure,
      onSubmissionStart,
      projectId,
      submitting,
      t,
    ]
  );

  const updateDraft = useCallback(
    (update: (current: DraftState) => DraftState) => {
      setDraft((current) =>
        update(current.key === controlKey ? current : blankDraft(controlKey))
      );
    },
    [controlKey]
  );

  const variant = useMemo<ControlledBottomBoxVariant | null>(() => {
    if (!interaction) return null;
    const header = headerFor(interaction, activeSubmission.error, t);
    if (pendingCount > 1) {
      header.eyebrow = t('chat.control-input-required-count', {
        count: pendingCount,
      });
    }
    const common = { header, submitting };
    const hasDurableIdentity = !(
      interaction.requestSource !== 'canonical' &&
      interaction.interactionId.startsWith('legacy:')
    );

    if (!hasDurableIdentity) {
      return {
        kind: 'blocked',
        ...common,
        message: t('chat.control-blocked-legacy-identity'),
      };
    }

    if (interaction.interactionType === 'approval') {
      const offeredScopes = interaction.allowedScopes.filter(
        (scope): scope is BottomBoxApprovalScope =>
          scope === 'once' || scope === 'run' || scope === 'space'
      );
      const labels: Record<BottomBoxApprovalScope, string> = {
        once: t('chat.control-approve-once'),
        run: t('chat.control-approve-run'),
        space: t('chat.control-approve-space'),
      };
      const descriptions: Record<BottomBoxApprovalScope, string> = {
        once: t('chat.control-approve-once-description'),
        run: t('chat.control-approve-run-description'),
        space: t('chat.control-approve-space-description'),
      };
      return {
        kind: 'approval',
        header: {
          eyebrow: t('chat.control-input-required'),
          title:
            interaction.prompt ||
            interaction.title ||
            t('chat.control-approval-required'),
          description: activeSubmission.error || undefined,
          contextItems: header.contextItems,
          details: header.details,
        },
        submitting,
        options: [...new Set(offeredScopes)].map((scope) => ({
          scope,
          label: labels[scope],
          description: descriptions[scope],
        })),
        onApprove: (scope) => void submit({ decision: 'approved', scope }),
        onReject: () =>
          void submit({
            decision: 'rejected',
            scope: offeredScopes[0] ?? 'once',
          }),
      };
    }

    if (
      interaction.interactionType === 'choice' ||
      interaction.interactionType === 'selection' ||
      interaction.interactionType === 'merge_conflict'
    ) {
      if (interaction.options.length === 0) {
        return {
          kind: 'blocked',
          ...common,
          message: t('chat.control-blocked-no-options'),
        };
      }
      return {
        kind: 'selection',
        ...common,
        selectionMode: 'single',
        options: interaction.options.map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description,
        })),
        selectedIds: activeDraft.selectedIds,
        onSelectionChange: (selectedIds) =>
          updateDraft((current) => ({ ...current, selectedIds })),
        onSubmit: () => {
          const selected = interaction.options.find(
            (option) => option.id === activeDraft.selectedIds[0]
          );
          if (!selected) return;
          void submit({ option_id: selected.id, value: selected.value });
        },
      };
    }

    if (interaction.interactionType === 'form') {
      const hasUnsafeField = interaction.fields.some(
        (field) => formFieldType(field.type) === null
      );
      if (hasUnsafeField) {
        return {
          kind: 'blocked',
          ...common,
          message: t('chat.control-blocked-unsafe-field'),
        };
      }
      return {
        kind: 'form',
        ...common,
        fields: interaction.fields.map((field) => ({
          id: field.id,
          label: field.label,
          value: activeDraft.formValues[field.id] ?? '',
          type: formFieldType(field.type)!,
          placeholder: field.placeholder,
          required: field.required,
        })),
        onFieldChange: (fieldId, value) =>
          updateDraft((current) => ({
            ...current,
            formValues: { ...current.formValues, [fieldId]: value },
          })),
        onSubmit: () => {
          const hasMissingRequired = interaction.fields.some(
            (field) =>
              field.required && !(activeDraft.formValues[field.id] ?? '').trim()
          );
          if (!hasMissingRequired) {
            void submit({ values: activeDraft.formValues });
          }
        },
      };
    }

    if (
      interaction.interactionType === 'question' ||
      interaction.interactionType === 'feedback' ||
      interaction.interactionType === 'human_feedback'
    ) {
      const questionPresentation = interaction.interactionType === 'question';
      return {
        kind: 'feedback',
        header: questionPresentation
          ? {
              title: t('chat.timeline-question'),
              description:
                [interaction.prompt, activeSubmission.error]
                  .filter(Boolean)
                  .join(' ') || undefined,
            }
          : header,
        presentation: questionPresentation ? 'question' : 'default',
        submitting,
        value: activeDraft.feedback,
        placeholder: t('chat.control-response-placeholder'),
        onChange: (feedback) =>
          updateDraft((current) => ({ ...current, feedback })),
        onSubmit: () => {
          const reply = activeDraft.feedback.trim();
          if (reply) void submit({ reply });
        },
      };
    }

    if (interaction.interactionType === 'confirmation') {
      return {
        kind: 'confirmation',
        ...common,
        onConfirm: () => void submit({ decision: 'approved' }),
        onReject: () => void submit({ decision: 'rejected' }),
      };
    }

    if (interaction.interactionType === 'diff_review') {
      return {
        kind: 'blocked',
        ...common,
        message: t('chat.control-blocked-diff-review'),
      };
    }

    if (interaction.interactionType === 'credential_binding') {
      return {
        kind: 'blocked',
        ...common,
        message: t('chat.control-blocked-credential'),
      };
    }

    return {
      kind: 'blocked',
      ...common,
      message: t('chat.control-blocked-unsupported', {
        type: humanize(interaction.interactionType),
      }),
    };
  }, [
    activeDraft.feedback,
    activeDraft.formValues,
    activeDraft.selectedIds,
    activeSubmission.error,
    interaction,
    pendingCount,
    submit,
    submitting,
    t,
    updateDraft,
  ]);

  return {
    interaction,
    variant,
    pendingCount,
    phase: activeSubmission.phase,
    submitError: activeSubmission.error,
  };
}
