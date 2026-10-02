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

import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import { useHumanInteractionExpiry } from '@/hooks/useHumanInteractionExpiry';
import { useHost } from '@/host';
import {
  approvalTerminalReason,
  isInteractionTerminal,
} from '@/lib/approvalPresentation';
import { controlOwner } from '@/service/controlRequest';
import {
  decideHumanInteraction,
  getHumanInteractionReceipt,
  invalidatePendingHumanInteractions,
  isHumanInteractionStillPending,
  type HumanInteractionPayload,
} from '@/service/humanInteractionApi';
import { useAuthStore } from '@/store/authStore';
import { useProjectStore } from '@/store/projectStore';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  approvalScopeLabels,
  type HumanControlTranslate,
} from '../BottomBox/legacyHumanControl';
import { ControlRecovery, useControlOperations } from '../ControlRecovery';

interface HumanInteractionCardProps {
  interaction: HumanInteractionPayload;
  /** Historical answer for a question resolved through the legacy composer. */
  response?: string;
  readOnly?: boolean;
  /** Supplies a safe display receipt so legacy history can survive remounts. */
  onResolved?: (response?: string) => void;
  /** Work-log mode: pending prompt lives in BottomBox; resolved history includes it. */
  timelineReceipt?: boolean;
}

export { isHumanInteractionReadOnly } from '@/lib/approvalPresentation';

const requestId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `interaction-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function mergeJournalReceipt(
  interaction: HumanInteractionPayload,
  receipt: Pick<HumanInteractionPayload, 'status' | 'reason' | 'expires_at'>
): HumanInteractionPayload {
  if (!isInteractionTerminal(interaction))
    return { ...interaction, ...receipt };
  // Terminal status and its metadata travel together. Only a matching
  // terminal receipt can fill missing metadata, never a stale pending read.
  if (receipt.status !== interaction.status) return interaction;
  return {
    ...interaction,
    reason: interaction.reason || receipt.reason,
    expires_at: interaction.expires_at ?? receipt.expires_at,
  };
}

function decisionDisplayText(
  interaction: HumanInteractionPayload,
  decision: Record<string, unknown>,
  t: HumanControlTranslate
): string | null {
  const selectedOptionId =
    typeof decision.option_id === 'string' ? decision.option_id : null;
  const selectedOption = selectedOptionId
    ? interaction.options?.find(
        (option) => (option.option_id || option.id) === selectedOptionId
      )
    : null;
  if (selectedOption?.label) return selectedOption.label;

  if (typeof decision.decision === 'string') {
    const normalized = decision.decision.toLowerCase();
    if (normalized === 'approved') {
      const scope = typeof decision.scope === 'string' ? decision.scope : '';
      if (scope === 'run') return t('chat.control-approved-run-receipt');
      if (scope === 'space') return t('chat.control-approved-space-receipt');
      return t('chat.control-approved-once-receipt');
    }
    if (normalized === 'rejected') return t('chat.control-rejected');
    return decision.decision;
  }

  if (decision.values && typeof decision.values === 'object') {
    const values = decision.values as Record<string, unknown>;
    const fieldReceipts = (interaction.fields || []).map((field) => {
      const rawValue = values[field.id];
      const fieldType = (field.type || 'text').toLowerCase();
      const sensitive = /password|secret|credential|token|key/.test(fieldType);
      const displayValue = sensitive
        ? t('chat.control-redacted')
        : typeof rawValue === 'string' || typeof rawValue === 'number'
          ? String(rawValue)
          : typeof rawValue === 'boolean'
            ? rawValue
              ? t('chat.control-yes')
              : t('chat.control-no')
            : t('chat.control-submitted');
      return `${field.label}: ${displayValue}`;
    });
    return fieldReceipts.length
      ? fieldReceipts.join('\n')
      : t('chat.control-form-submitted');
  }

  return null;
}

export function HumanInteractionCard({
  interaction,
  response,
  readOnly = false,
  onResolved,
  timelineReceipt = false,
}: HumanInteractionCardProps) {
  const { t } = useTranslation();
  const host = useHost();
  const userId = useAuthStore((state) => state.user_id);
  const projectId = useProjectStore((state) => state.activeProjectId);
  const owner = controlOwner();
  const viewKey = JSON.stringify([
    owner,
    interaction.run_id,
    interaction.interaction_id,
    interaction.version,
    interaction.action_digest,
  ]);
  const view = useRef({ key: viewKey, generation: 0, mounted: true });
  if (view.current.key !== viewKey)
    view.current = {
      key: viewKey,
      generation: view.current.generation + 1,
      mounted: true,
    };
  useEffect(() => {
    view.current.mounted = true;
    return () => {
      view.current.mounted = false;
      view.current.generation++;
    };
  }, []);
  const operations = useControlOperations();
  const operation = operations.find(
    (op) =>
      op.kind === 'interaction' &&
      op.runId === interaction.run_id &&
      op.interactionId === interaction.interaction_id
  );
  const decisionRequestId = useRef(requestId());
  const submissionGuard = useRef<string | null>(null);
  const delivered = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [journalReceipt, setJournalReceipt] = useState<{
    identity: string;
    status?: string;
    reason?: string;
    expires_at?: number | string | null;
  } | null>(null);
  const receiptInteraction =
    journalReceipt?.identity === viewKey
      ? mergeJournalReceipt(interaction, journalReceipt)
      : interaction;
  const expiredLocally = useHumanInteractionExpiry(receiptInteraction);
  const receiptOnly =
    readOnly ||
    Boolean(interaction.receipt) ||
    isInteractionTerminal(receiptInteraction);
  const [pendingCheck, setPendingCheck] = useState<{
    identity: string;
    pending: boolean;
  } | null>(null);
  const [submittedResponse, setSubmittedResponse] = useState<string | null>(
    null
  );
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  useEffect(() => {
    decisionRequestId.current = requestId();
    setSubmitting(false);
    setResolved(false);
    setPendingCheck(null);
    setSubmittedResponse(null);
    setSubmissionError(null);
    setFormValues({});
  }, [viewKey]);
  useEffect(() => {
    let cancelled = false;
    let checkNumber = 0;
    setPendingCheck(null);
    if (
      interaction.interaction_type !== 'approval' ||
      receiptOnly ||
      timelineReceipt ||
      expiredLocally ||
      !interaction.run_id
    )
      return;
    const validatePending = () => {
      const currentCheck = ++checkNumber;
      setPendingCheck(null);
      void isHumanInteractionStillPending(interaction)
        .then((isPending) => {
          if (!cancelled && currentCheck === checkNumber)
            setPendingCheck({ identity: viewKey, pending: isPending });
        })
        .catch((error) => {
          // Keep fail-closed until a lifecycle recovery retries the check.
          console.warn(
            '[HumanInteractionCard] pending interaction revalidation failed',
            error
          );
        });
    };
    const revalidatePending = () => {
      invalidatePendingHumanInteractions(interaction.run_id);
      validatePending();
    };
    validatePending();
    window.addEventListener('focus', revalidatePending);
    host?.ipcRenderer?.on('backend-ready', revalidatePending);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', revalidatePending);
      host?.ipcRenderer?.off('backend-ready', revalidatePending);
    };
  }, [
    interaction,
    viewKey,
    receiptOnly,
    timelineReceipt,
    expiredLocally,
    host?.ipcRenderer,
  ]);
  const durablyPending =
    pendingCheck?.identity === viewKey && pendingCheck.pending;
  const pendingUnavailable =
    pendingCheck?.identity === viewKey && pendingCheck.pending === false;
  const effectiveReadOnly =
    receiptOnly ||
    expiredLocally ||
    (interaction.interaction_type === 'approval' && !durablyPending);
  // The pre-submit check is async; a card retired meanwhile must not submit.
  const retired = useRef(false);
  retired.current = receiptOnly || expiredLocally;
  const receiptNeedsReason =
    interaction.interaction_type === 'approval' &&
    (receiptOnly || expiredLocally || pendingUnavailable) &&
    !receiptInteraction.reason;
  useEffect(() => {
    if (!receiptNeedsReason) return;
    let cancelled = false;
    const readReceipt = () => {
      void getHumanInteractionReceipt(interaction)
        .then((receipt) => {
          if (!cancelled && receipt)
            setJournalReceipt((previous) => {
              const currentReceipt =
                previous?.identity === viewKey
                  ? mergeJournalReceipt(interaction, previous)
                  : interaction;
              const merged = mergeJournalReceipt(currentReceipt, receipt);
              return {
                identity: viewKey,
                status: merged.status,
                reason: merged.reason,
                expires_at: merged.expires_at,
              };
            });
        })
        .catch(() => {
          /* Offline history retains its persisted read-only receipt. */
        });
    };
    readReceipt();
    window.addEventListener('focus', readReceipt);
    host?.ipcRenderer?.on('backend-ready', readReceipt);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', readReceipt);
      host?.ipcRenderer?.off('backend-ready', readReceipt);
    };
  }, [viewKey, receiptNeedsReason, interaction, host?.ipcRenderer]);
  const targets = useMemo(
    () => interaction.target_resources?.filter(Boolean) || [],
    [interaction.target_resources]
  );

  const deliver = (receipt: Record<string, unknown>) => {
    if (
      receipt.interaction_id !== interaction.interaction_id ||
      receipt.run_id !== interaction.run_id ||
      !['resolved', 'expired', 'cancelled'].includes(String(receipt.status))
    )
      return;
    if (delivered.current === viewKey) return;
    const canonical = receipt.response;
    if (
      receipt.status === 'resolved' &&
      (!canonical || typeof canonical !== 'object')
    )
      return;
    const text =
      receipt.status === 'expired'
        ? t('chat.control-recovery-expired')
        : receipt.status === 'cancelled'
          ? t('chat.control-recovery-cancelled')
          : decisionDisplayText(
              interaction,
              canonical as Record<string, unknown>,
              t
            );
    delivered.current = viewKey;
    setSubmittedResponse(text);
    setResolved(true);
    onResolved?.(text || undefined);
  };
  useEffect(() => {
    if (
      operation?.phase === 'resolved' &&
      operation.receipt &&
      operation.version === (interaction.version ?? 0) &&
      operation.digest === interaction.action_digest
    )
      deliver(operation.receipt);
  });

  const submit = async (decision: Record<string, unknown>) => {
    if (
      effectiveReadOnly ||
      resolved ||
      submitting ||
      operation ||
      submissionGuard.current === viewKey
    )
      return;
    submissionGuard.current = viewKey;
    const generation = view.current.generation;
    const isCurrent = () =>
      view.current.mounted &&
      view.current.key === viewKey &&
      view.current.generation === generation &&
      controlOwner() === owner;
    setSubmitting(true);
    setSubmissionError(null);
    try {
      if (interaction.interaction_type === 'approval') {
        invalidatePendingHumanInteractions(interaction.run_id);
        const isPending = await isHumanInteractionStillPending(interaction);
        if (!isCurrent() || retired.current) return;
        if (!isPending) {
          setPendingCheck({ identity: viewKey, pending: false });
          return;
        }
      }
      const receipt = await decideHumanInteraction(interaction, {
        decisionRequestId: decisionRequestId.current,
        decision,
        actorId: userId,
        projectId: projectId ?? undefined,
      });
      if (isCurrent()) deliver(receipt);
    } catch (error) {
      if (!isCurrent()) return;
      if (interaction.interaction_type === 'approval') {
        // A definite conflict retires the card; an unknown outcome stays open
        // for ControlRecovery.
        if (
          (error as { response?: { status?: number } })?.response?.status ===
            409 ||
          (error as { status?: number })?.status === 409
        )
          setPendingCheck({ identity: viewKey, pending: false });
        setSubmissionError(t('chat.control-outcome-unknown'));
        return;
      }
      console.error('[HumanInteractionCard] decision failed', error);
      const message =
        (error as any)?.response?.data?.detail?.message ||
        (error as any)?.response?.data?.detail ||
        (error as Error)?.message ||
        t('chat.control-decision-failed');
      setSubmissionError(
        typeof message === 'string' ? message : JSON.stringify(message)
      );
    } finally {
      if (isCurrent()) setSubmitting(false);
      if (submissionGuard.current === viewKey) submissionGuard.current = null;
    }
  };

  const displayedResponse = response?.trim() || submittedResponse;
  const disabled =
    effectiveReadOnly ||
    Boolean(displayedResponse) ||
    resolved ||
    submitting ||
    Boolean(operation);
  const title = timelineReceipt
    ? t('chat.control-input-required')
    : interaction.title ||
      (interaction.interaction_type === 'approval'
        ? t('chat.control-approval-required')
        : t('chat.control-input-required'));
  const isToolMatcher =
    interaction.rule_matcher?.matcher_kind === 'literal_tool';
  // Approval wording is shared with the BottomBox control so the same
  // permission grant never reads differently in two places.
  const scopeLabels = approvalScopeLabels(t, isToolMatcher);

  // Preserve the legacy card's remove-on-resolution behavior. Work-log
  // receipts remain mounted so their submitted decision can be displayed.
  if (resolved && !timelineReceipt) return null;

  // An unresolved control operation keeps the card body, which owns
  // ControlRecovery, until its outcome is confirmed.
  if (
    interaction.interaction_type === 'approval' &&
    (timelineReceipt ||
      ((receiptOnly || expiredLocally || pendingUnavailable) &&
        (!operation || operation.phase === 'resolved')))
  ) {
    const inactive = receiptOnly || expiredLocally || pendingUnavailable;
    const label =
      receiptInteraction.status === 'expired'
        ? t('chat.approval-expired-title')
        : receiptInteraction.status === 'cancelled'
          ? t('chat.approval-cancelled-title')
          : inactive
            ? t('chat.approval-inactive-title')
            : t('chat.control-input-required');
    const reason = approvalTerminalReason(receiptInteraction.reason, t);
    return (
      <div
        data-human-input-receipt
        data-approval-timeline-receipt
        className="flex w-full min-w-0 items-start gap-ds-stack-related rounded-ds-card border border-x border-y border-ds-hairline-default-default bg-ds-neutral-muted-default p-ds-card-inset"
      >
        <DsIcon
          icon={ShieldAlert}
          recipe="main"
          className="shrink-0 text-ds-ink-muted-default"
        />
        <div className="min-w-0 flex-1 space-y-ds-4 break-words">
          <DsText
            as="span"
            role="base"
            weight="medium"
            className="block text-ds-ink-default-default"
          >
            {label}
          </DsText>
          {inactive && interaction.question ? (
            <DsText role="base" className="text-ds-ink-muted-default">
              {interaction.question}
            </DsText>
          ) : null}
          {reason ? (
            <DsText as="p" role="meta" className="text-ds-ink-muted-default">
              {reason}
            </DsText>
          ) : null}
          {inactive ? (
            <DsText as="p" role="meta" className="text-ds-ink-muted-default">
              {t('chat.approval-read-only-receipt')}
            </DsText>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      data-human-input-receipt={timelineReceipt ? '' : undefined}
      className={`${timelineReceipt ? 'w-full' : 'mx-6 my-3'} rounded-2xl border border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default p-4`}
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-ds-icon-warning-default-default" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <span className="block text-sm font-semibold text-ds-ink-default-default">
              {title}
            </span>
            {interaction.question &&
            (!timelineReceipt || Boolean(displayedResponse)) ? (
              <span className="mt-1 block text-sm font-normal text-ds-ink-subtle-default">
                {interaction.question}
              </span>
            ) : null}
          </div>

          {!timelineReceipt && interaction.operation ? (
            <div className="rounded-xl bg-ds-neutral-default-default px-3 py-2 text-xs text-ds-ink-subtle-default">
              <span className="block font-normal">{interaction.operation}</span>
              {targets.slice(0, 3).map((target) => (
                <span
                  key={target}
                  className="block truncate font-mono font-normal"
                  title={target}
                >
                  {target}
                </span>
              ))}
            </div>
          ) : null}

          {!timelineReceipt &&
          interaction.display_arguments &&
          Object.keys(interaction.display_arguments).length > 0 ? (
            <details className="rounded-xl bg-ds-neutral-default-default px-3 py-2 text-xs text-ds-ink-subtle-default">
              <summary className="cursor-pointer font-medium">
                {t('chat.control-review-arguments')}
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto font-mono break-all whitespace-pre-wrap">
                {JSON.stringify(interaction.display_arguments, null, 2)}
              </pre>
            </details>
          ) : null}

          {!timelineReceipt && interaction.rule_matcher?.resource_pattern ? (
            <div className="rounded-xl border border-x border-y border-ds-border-warning-subtle-default px-3 py-2 text-xs text-ds-ink-subtle-default">
              <span className="block font-medium">
                {t('chat.control-persistent-approval-applies-to')}
              </span>
              <span
                className="mt-1 block font-mono font-normal"
                title={interaction.rule_matcher.resource_pattern}
              >
                {interaction.rule_matcher.display_operation ||
                  interaction.rule_matcher.action_pattern}{' '}
                {interaction.rule_matcher.resource_pattern}
              </span>
            </div>
          ) : null}

          {displayedResponse ? (
            <div
              data-interaction-response
              className="rounded-xl bg-ds-neutral-default-default px-3 py-2"
            >
              <span className="block text-xs font-medium text-ds-ink-muted-default">
                {t('chat.control-your-response')}
              </span>
              <span className="mt-1 block text-sm font-normal break-words whitespace-pre-wrap text-ds-ink-default-default">
                {displayedResponse}
              </span>
            </div>
          ) : null}

          {!displayedResponse && interaction.interaction_type === 'form' ? (
            <div className="space-y-2">
              {(interaction.fields || []).map((field) => (
                <label key={field.id} className="block text-ds-text-meta">
                  <span>{field.label}</span>
                  <Input
                    className="mt-1"
                    type={field.type || 'text'}
                    required={field.required}
                    value={formValues[field.id] || ''}
                    onChange={(event) =>
                      setFormValues((current) => ({
                        ...current,
                        [field.id]: event.target.value,
                      }))
                    }
                    disabled={disabled}
                  />
                </label>
              ))}
            </div>
          ) : null}

          {!displayedResponse ? (
            <div className="flex flex-wrap justify-end gap-2">
              {interaction.interaction_type === 'approval' ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    buttonRadius="full"
                    disabled={disabled}
                    onClick={() =>
                      void submit({ decision: 'rejected', scope: 'once' })
                    }
                  >
                    {t('chat.control-reject')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    tone="success"
                    buttonRadius="full"
                    disabled={disabled}
                    onClick={() =>
                      void submit({ decision: 'approved', scope: 'once' })
                    }
                  >
                    {submitting
                      ? t('chat.control-approving')
                      : scopeLabels.once}
                  </Button>
                  {(interaction.allowed_scopes || []).includes('space') ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      tone="success"
                      buttonRadius="full"
                      disabled={disabled}
                      onClick={() =>
                        void submit({ decision: 'approved', scope: 'space' })
                      }
                    >
                      {scopeLabels.space}
                    </Button>
                  ) : null}
                </>
              ) : interaction.interaction_type === 'choice' ? (
                (interaction.options || []).map((option) => (
                  <Button
                    type="button"
                    key={option.option_id || option.id || option.label}
                    size="sm"
                    variant="secondary"
                    buttonRadius="full"
                    disabled={disabled}
                    onClick={() =>
                      void submit({
                        option_id: option.option_id || option.id,
                        value: option.value,
                      })
                    }
                  >
                    {option.label}
                  </Button>
                ))
              ) : interaction.interaction_type === 'form' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  buttonRadius="full"
                  disabled={disabled}
                  onClick={() => void submit({ values: formValues })}
                >
                  {submitting
                    ? t('chat.control-submitting')
                    : t('chat.control-submit')}
                </Button>
              ) : interaction.interaction_type !== 'question' ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    buttonRadius="full"
                    disabled={disabled}
                    onClick={() => void submit({ decision: 'rejected' })}
                  >
                    {t('chat.control-reject')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    tone="success"
                    buttonRadius="full"
                    disabled={disabled}
                    onClick={() => void submit({ decision: 'approved' })}
                  >
                    {submitting
                      ? t('chat.control-submitting')
                      : t('chat.control-confirm')}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
          {resolved ? (
            <span className="block text-xs font-normal text-ds-text-success-default-default">
              {t('chat.control-decision-saved')}
            </span>
          ) : null}
          {submitting ? (
            <span
              role="status"
              className="block text-xs font-normal text-ds-ink-subtle-default"
            >
              {t('chat.control-decision-saving')}
            </span>
          ) : null}
          {operation && <ControlRecovery operation={operation} />}
          {submissionError && !operation ? (
            <span
              role="alert"
              className="block text-xs font-normal text-ds-text-error-default-default"
            >
              {submissionError}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
