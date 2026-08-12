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
import { Input } from '@/components/ui/input';
import {
  decideHumanInteraction,
  isHumanInteractionStillPending,
  type HumanInteractionPayload,
} from '@/service/humanInteractionApi';
import { useAuthStore } from '@/store/authStore';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

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

export function isHumanInteractionReadOnly(input: {
  interaction: HumanInteractionPayload;
  activeTaskId?: string | null;
  taskType?: string;
  taskStatus?: string;
  durableRunStatus?: string;
}): boolean {
  if (input.taskType === 'share') return true;
  const isExplicitlyTerminal =
    input.durableRunStatus === 'completed' ||
    input.durableRunStatus === 'failed' ||
    input.durableRunStatus === 'cancelled' ||
    input.durableRunStatus === 'stopped';
  const belongsToCurrentRun =
    Boolean(input.interaction.run_id) &&
    input.interaction.run_id === input.activeTaskId;

  // A requested interaction is a durable, server-CAS-protected action. When
  // reopening a Project, the legacy task shell can still say replay/finished
  // for a short time after the Run has already returned to waiting_for_user.
  // Do not let those stale presentation flags permanently disable the only
  // recovery control. Explicit canonical terminal status still wins, and a
  // stale decision is rejected safely by the Brain's version/status checks.
  if (belongsToCurrentRun && !isExplicitlyTerminal) return false;
  const isDurablyWaiting =
    input.durableRunStatus === 'waiting_for_user' &&
    Boolean(input.interaction.run_id) &&
    input.interaction.run_id === input.activeTaskId;
  if (isDurablyWaiting) return false;
  return input.taskType === 'replay' || input.taskStatus === 'finished';
}

const requestId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `interaction-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function decisionDisplayText(
  interaction: HumanInteractionPayload,
  decision: Record<string, unknown>
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
      if (scope === 'run') return 'Allowed for this Run';
      if (scope === 'space') return 'Always allowed in this Space';
      return 'Approved once';
    }
    if (normalized === 'rejected') return 'Rejected';
    return decision.decision;
  }

  if (decision.values && typeof decision.values === 'object') {
    const values = decision.values as Record<string, unknown>;
    const fieldReceipts = (interaction.fields || []).map((field) => {
      const rawValue = values[field.id];
      const fieldType = (field.type || 'text').toLowerCase();
      const sensitive = /password|secret|credential|token|key/.test(fieldType);
      const displayValue = sensitive
        ? '[redacted]'
        : typeof rawValue === 'string' || typeof rawValue === 'number'
          ? String(rawValue)
          : typeof rawValue === 'boolean'
            ? rawValue
              ? 'Yes'
              : 'No'
            : '[submitted]';
      return `${field.label}: ${displayValue}`;
    });
    return fieldReceipts.length ? fieldReceipts.join('\n') : 'Form submitted';
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
  const userId = useAuthStore((state) => state.user_id);
  const decisionRequestId = useRef(requestId());
  const [submitting, setSubmitting] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [durablyPending, setDurablyPending] = useState(false);
  const [submittedResponse, setSubmittedResponse] = useState<string | null>(
    null
  );
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  useEffect(() => {
    decisionRequestId.current = requestId();
    setSubmitting(false);
    setResolved(false);
    setDurablyPending(false);
    setSubmittedResponse(null);
    setSubmissionError(null);
    setFormValues({});
  }, [interaction.interaction_id]);
  useEffect(() => {
    let cancelled = false;
    setDurablyPending(false);
    if (!readOnly || !interaction.run_id) return;
    void isHumanInteractionStillPending(interaction)
      .then((isPending) => {
        if (!cancelled) setDurablyPending(isPending);
      })
      .catch((error) => {
        // Keep fail-closed on transport/auth failures; the ordinary inline
        // decision path must not silently treat an unavailable Brain as safe.
        console.warn(
          '[HumanInteractionCard] pending interaction revalidation failed',
          error
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    interaction.action_digest,
    interaction.interaction_id,
    interaction.run_id,
    interaction.version,
    readOnly,
  ]);
  const effectiveReadOnly = readOnly && !durablyPending;
  const targets = useMemo(
    () => interaction.target_resources?.filter(Boolean) || [],
    [interaction.target_resources]
  );

  const submit = async (decision: Record<string, unknown>) => {
    if (effectiveReadOnly || resolved || submitting) return;
    setSubmitting(true);
    setSubmissionError(null);
    try {
      await decideHumanInteraction(interaction, {
        decisionRequestId: decisionRequestId.current,
        decision,
        actorId: userId,
      });
      const decisionText = decisionDisplayText(interaction, decision);
      setSubmittedResponse(decisionText);
      setResolved(true);
      onResolved?.(decisionText || undefined);
    } catch (error) {
      console.error('[HumanInteractionCard] decision failed', error);
      const message =
        (error as any)?.response?.data?.detail?.message ||
        (error as any)?.response?.data?.detail ||
        (error as Error)?.message ||
        'Could not save your decision. Please try again.';
      const readableMessage =
        typeof message === 'string' ? message : JSON.stringify(message);
      setSubmissionError(readableMessage);
      toast.error(readableMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const displayedResponse = response?.trim() || submittedResponse;
  const disabled =
    effectiveReadOnly || Boolean(displayedResponse) || resolved || submitting;
  const title = timelineReceipt
    ? 'Input required'
    : interaction.title ||
      (interaction.interaction_type === 'approval'
        ? 'Approval required'
        : 'Input required');
  const isToolMatcher =
    interaction.rule_matcher?.matcher_kind === 'literal_tool';

  // Preserve the legacy card's remove-on-resolution behavior. Work-log
  // receipts remain mounted so their submitted decision can be displayed.
  if (resolved && !timelineReceipt) return null;

  return (
    <div
      data-human-input-receipt={timelineReceipt ? '' : undefined}
      className={`${timelineReceipt ? 'w-full' : 'mx-6 my-3'} rounded-2xl border border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default p-4`}
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-ds-icon-warning-default-default" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="text-sm font-semibold text-ds-text-neutral-default-default">
              {title}
            </div>
            {interaction.question &&
            (!timelineReceipt || Boolean(displayedResponse)) ? (
              <p className="mt-1 text-sm text-ds-text-neutral-subtle-default">
                {interaction.question}
              </p>
            ) : null}
          </div>

          {!timelineReceipt && interaction.operation ? (
            <div className="rounded-xl bg-ds-bg-neutral-default-default px-3 py-2 text-xs text-ds-text-neutral-subtle-default">
              <div>{interaction.operation}</div>
              {targets.slice(0, 3).map((target) => (
                <div key={target} className="truncate font-mono" title={target}>
                  {target}
                </div>
              ))}
            </div>
          ) : null}

          {!timelineReceipt &&
          interaction.display_arguments &&
          Object.keys(interaction.display_arguments).length > 0 ? (
            <details className="rounded-xl bg-ds-bg-neutral-default-default px-3 py-2 text-xs text-ds-text-neutral-subtle-default">
              <summary className="cursor-pointer font-medium">
                Review arguments (secrets redacted)
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono">
                {JSON.stringify(interaction.display_arguments, null, 2)}
              </pre>
            </details>
          ) : null}

          {!timelineReceipt && interaction.rule_matcher?.resource_pattern ? (
            <div className="rounded-xl border border-ds-border-warning-subtle-default px-3 py-2 text-xs text-ds-text-neutral-subtle-default">
              <div className="font-medium">Persistent approval matcher</div>
              <div
                className="mt-1 font-mono"
                title={interaction.rule_matcher.resource_pattern}
              >
                {interaction.rule_matcher.display_operation ||
                  interaction.rule_matcher.action_pattern}{' '}
                {interaction.rule_matcher.resource_pattern}
              </div>
            </div>
          ) : null}

          {displayedResponse ? (
            <div
              data-interaction-response
              className="rounded-xl bg-ds-bg-neutral-default-default px-3 py-2"
            >
              <div className="text-xs font-medium text-ds-text-neutral-muted-default">
                Your response
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ds-text-neutral-default-default">
                {displayedResponse}
              </p>
            </div>
          ) : null}

          {!displayedResponse && interaction.interaction_type === 'form' ? (
            <div className="space-y-2">
              {(interaction.fields || []).map((field) => (
                <label key={field.id} className="block text-xs">
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
            <div className="flex flex-wrap gap-2">
              {interaction.interaction_type === 'approval' ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={disabled}
                    onClick={() =>
                      void submit({ decision: 'approved', scope: 'once' })
                    }
                  >
                    {submitting ? 'Approving…' : 'Approve once'}
                  </Button>
                  {(interaction.allowed_scopes || []).includes('space') ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() =>
                        void submit({ decision: 'approved', scope: 'space' })
                      }
                    >
                      {isToolMatcher
                        ? 'Always allow this tool in Space'
                        : 'Always allow in Space'}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() =>
                      void submit({ decision: 'rejected', scope: 'once' })
                    }
                  >
                    Reject
                  </Button>
                </>
              ) : interaction.interaction_type === 'choice' ? (
                (interaction.options || []).map((option) => (
                  <Button
                    type="button"
                    key={option.option_id || option.id || option.label}
                    size="sm"
                    variant="outline"
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
                  disabled={disabled}
                  onClick={() => void submit({ values: formValues })}
                >
                  Submit
                </Button>
              ) : interaction.interaction_type !== 'question' ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={disabled}
                    onClick={() => void submit({ decision: 'approved' })}
                  >
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => void submit({ decision: 'rejected' })}
                  >
                    Reject
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
          {resolved ? (
            <div className="text-xs text-ds-text-success-default-default">
              Decision saved
            </div>
          ) : null}
          {submitting ? (
            <div
              role="status"
              className="text-xs text-ds-text-neutral-subtle-default"
            >
              Saving decision…
            </div>
          ) : null}
          {submissionError ? (
            <div
              role="alert"
              className="text-xs text-ds-text-error-default-default"
            >
              {submissionError}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
