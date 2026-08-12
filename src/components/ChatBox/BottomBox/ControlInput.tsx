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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Check, TriangleAlert } from 'lucide-react';
import type { InputboxProps } from './InputBox';
import { Inputbox } from './InputBox';
import type {
  BottomBoxApprovalScope,
  BottomBoxApprovalVariant,
  BottomBoxBlockedVariant,
  BottomBoxConfirmationVariant,
  BottomBoxFeedbackVariant,
  BottomBoxFormVariant,
  BottomBoxRunControlVariant,
  BottomBoxSelectionVariant,
  BottomBoxVariant,
} from './types';

interface InputVariantRouterProps {
  variant: BottomBoxVariant;
  inputProps: InputboxProps;
  connectorPanelOpen?: boolean;
  onToggleConnectorPanel?: () => void;
  skillPanelOpen?: boolean;
  onToggleSkillPanel?: () => void;
}

const controlSurfaceClassName =
  'flex w-full flex-col gap-3 rounded-3xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default p-3';

function ControlActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-wrap justify-end gap-2">{children}</div>
  );
}

function ConfirmationInput({
  variant,
}: {
  variant: BottomBoxConfirmationVariant;
}) {
  const showNote =
    variant.note !== undefined || variant.onNoteChange !== undefined;

  return (
    <div className={controlSurfaceClassName}>
      {showNote && (
        <Textarea
          aria-label="Confirmation note"
          value={variant.note ?? ''}
          placeholder={variant.notePlaceholder}
          disabled={variant.disabled || variant.submitting}
          onChange={(event) => variant.onNoteChange?.(event.target.value)}
        />
      )}
      <ControlActions>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={variant.disabled || variant.submitting}
          onClick={variant.onReject}
        >
          {variant.rejectLabel ?? 'Reject'}
        </Button>
        <Button
          type="button"
          variant="primary"
          tone="success"
          size="sm"
          disabled={variant.disabled || variant.submitting}
          onClick={variant.onConfirm}
        >
          {variant.confirmLabel ?? 'Confirm'}
        </Button>
      </ControlActions>
    </div>
  );
}

function ApprovalInput({ variant }: { variant: BottomBoxApprovalVariant }) {
  const approve = (scope: BottomBoxApprovalScope) => {
    if (!variant.disabled && !variant.submitting) variant.onApprove(scope);
  };

  return (
    <div className={controlSurfaceClassName}>
      <ControlActions>
        {variant.options.map((option) => (
          <Button
            key={option.scope}
            type="button"
            variant="primary"
            tone="success"
            size="sm"
            title={option.description}
            disabled={variant.disabled || variant.submitting}
            onClick={() => approve(option.scope)}
          >
            {option.label}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={variant.disabled || variant.submitting}
          onClick={variant.onReject}
        >
          {variant.rejectLabel ?? 'Reject'}
        </Button>
      </ControlActions>
    </div>
  );
}

function SelectionInput({ variant }: { variant: BottomBoxSelectionVariant }) {
  const multiple = variant.selectionMode === 'multiple';
  const selected = new Set(variant.selectedIds);

  const toggle = (id: string) => {
    if (variant.disabled || variant.submitting) return;
    if (!multiple) {
      variant.onSelectionChange([id]);
      return;
    }
    variant.onSelectionChange(
      selected.has(id)
        ? variant.selectedIds.filter((selectedId) => selectedId !== id)
        : [...variant.selectedIds, id]
    );
  };

  return (
    <div className={controlSurfaceClassName}>
      <div
        className="flex flex-col gap-1"
        role={multiple ? 'group' : 'radiogroup'}
        aria-label="Response options"
      >
        {variant.options.map((option) => {
          const isSelected = selected.has(option.id);
          return (
            <Button
              key={option.id}
              type="button"
              role={multiple ? undefined : 'radio'}
              aria-checked={multiple ? undefined : isSelected}
              aria-pressed={multiple ? isSelected : undefined}
              variant={isSelected ? 'secondary' : 'ghost'}
              tone={isSelected ? 'information' : 'neutral'}
              className="h-auto w-full justify-start gap-2 px-2 py-2 text-left"
              disabled={
                variant.disabled || variant.submitting || option.disabled
              }
              onClick={() => toggle(option.id)}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center border border-solid border-ds-border-neutral-default-default',
                  multiple ? 'rounded' : 'rounded-full',
                  isSelected &&
                    'border-ds-border-status-completed-default-default bg-ds-bg-success-default-default'
                )}
              >
                {isSelected && (
                  <Check className="size-3 text-ds-text-brand-inverse-default" />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-body-sm font-medium">{option.label}</span>
                {option.description && (
                  <span className="text-body-xs font-normal text-ds-text-neutral-muted-default">
                    {option.description}
                  </span>
                )}
              </span>
            </Button>
          );
        })}
      </div>
      <ControlActions>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={
            variant.disabled ||
            variant.submitting ||
            variant.selectedIds.length === 0
          }
          onClick={variant.onSubmit}
        >
          {variant.submitLabel ?? 'Submit'}
        </Button>
      </ControlActions>
    </div>
  );
}

function FeedbackInput({ variant }: { variant: BottomBoxFeedbackVariant }) {
  return (
    <div className={controlSurfaceClassName}>
      <Textarea
        aria-label="Feedback"
        value={variant.value}
        placeholder={variant.placeholder}
        disabled={variant.disabled || variant.submitting}
        onChange={(event) => variant.onChange(event.target.value)}
        onEnter={variant.value.trim() ? variant.onSubmit : undefined}
      />
      <ControlActions>
        {variant.onSkip && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={variant.disabled || variant.submitting}
            onClick={variant.onSkip}
          >
            {variant.skipLabel ?? 'Skip'}
          </Button>
        )}
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={
            variant.disabled ||
            variant.submitting ||
            variant.value.trim().length === 0
          }
          onClick={variant.onSubmit}
        >
          {variant.submitLabel ?? 'Send feedback'}
        </Button>
      </ControlActions>
    </div>
  );
}

function FormInput({ variant }: { variant: BottomBoxFormVariant }) {
  const hasMissingRequiredField = variant.fields.some(
    (field) => field.required && field.value.trim().length === 0
  );

  return (
    <div className={controlSurfaceClassName}>
      <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
        {variant.fields.map((field) =>
          field.type === 'textarea' ? (
            <Textarea
              key={field.id}
              aria-label={field.label}
              title={field.label}
              required={field.required}
              value={field.value}
              placeholder={field.placeholder}
              disabled={
                variant.disabled || variant.submitting || field.disabled
              }
              onChange={(event) =>
                variant.onFieldChange(field.id, event.target.value)
              }
            />
          ) : (
            <Input
              key={field.id}
              aria-label={field.label}
              title={field.label}
              required={field.required}
              type={field.type ?? 'text'}
              value={field.value}
              placeholder={field.placeholder}
              disabled={
                variant.disabled || variant.submitting || field.disabled
              }
              onChange={(event) =>
                variant.onFieldChange(field.id, event.target.value)
              }
            />
          )
        )}
      </div>
      <ControlActions>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={
            variant.disabled || variant.submitting || hasMissingRequiredField
          }
          onClick={variant.onSubmit}
        >
          {variant.submitLabel ?? 'Submit'}
        </Button>
      </ControlActions>
    </div>
  );
}

function BlockedInput({ variant }: { variant: BottomBoxBlockedVariant }) {
  return (
    <div className={controlSurfaceClassName} role="alert">
      <div className="flex items-start gap-2 text-body-sm text-ds-text-warning-default-default">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p className="m-0">{variant.message}</p>
      </div>
      {variant.onRecover ? (
        <ControlActions>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={variant.disabled || variant.submitting}
            onClick={variant.onRecover}
          >
            {variant.recoveryLabel ?? 'Retry'}
          </Button>
        </ControlActions>
      ) : null}
    </div>
  );
}

function RunControlInput({ variant }: { variant: BottomBoxRunControlVariant }) {
  const locked = Boolean(variant.disabled || variant.submitting);
  const loading =
    variant.state === 'stopping' ||
    variant.state === 'resuming' ||
    variant.state === 'cancelling';
  const showStop = variant.state === 'running' || variant.state === 'stopping';
  const showInterruptedActions =
    variant.state === 'interrupted' ||
    variant.state === 'resuming' ||
    variant.state === 'cancelling';

  return (
    <div
      className={controlSurfaceClassName}
      data-run-control
      data-run-id={variant.runId}
      data-run-state={variant.state}
      aria-busy={loading || undefined}
    >
      {variant.state === 'read_only' ? (
        <p
          className="m-0 text-body-sm text-ds-text-neutral-muted-default"
          role="status"
        >
          {variant.readOnlyLabel ??
            'Run controls are unavailable in read-only mode.'}
        </p>
      ) : null}

      {showStop ? (
        <ControlActions>
          <Button
            type="button"
            variant="secondary"
            tone="error"
            size="sm"
            disabled={locked || variant.state === 'stopping' || !variant.onStop}
            onClick={() => variant.onStop?.(variant.runId)}
          >
            {variant.state === 'stopping'
              ? (variant.stoppingLabel ?? 'Stopping…')
              : (variant.stopLabel ?? 'Stop')}
          </Button>
        </ControlActions>
      ) : null}

      {showInterruptedActions ? (
        <ControlActions>
          <Button
            type="button"
            variant="ghost"
            tone="error"
            size="sm"
            disabled={
              locked || variant.state !== 'interrupted' || !variant.onCancel
            }
            onClick={() => variant.onCancel?.(variant.runId)}
          >
            {variant.state === 'cancelling'
              ? (variant.cancellingLabel ?? 'Cancelling…')
              : (variant.cancelLabel ?? 'Cancel Run')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={
              locked || variant.state !== 'interrupted' || !variant.onResume
            }
            onClick={() => variant.onResume?.(variant.runId)}
          >
            {variant.state === 'resuming'
              ? (variant.resumingLabel ?? 'Resuming…')
              : (variant.resumeLabel ?? 'Resume')}
          </Button>
        </ControlActions>
      ) : null}
    </div>
  );
}

export function ControlInputRouter({
  variant,
  inputProps,
  connectorPanelOpen,
  onToggleConnectorPanel,
  skillPanelOpen,
  onToggleSkillPanel,
}: InputVariantRouterProps) {
  let content: React.ReactNode;

  switch (variant.kind) {
    case 'input':
      content = (
        <Inputbox
          {...inputProps}
          showFileAttachments={false}
          connectorPanelOpen={connectorPanelOpen}
          onToggleConnectorPanel={onToggleConnectorPanel}
          skillPanelOpen={skillPanelOpen}
          onToggleSkillPanel={onToggleSkillPanel}
        />
      );
      break;
    case 'confirmation':
      content = <ConfirmationInput variant={variant} />;
      break;
    case 'approval':
      content = <ApprovalInput variant={variant} />;
      break;
    case 'selection':
      content = <SelectionInput variant={variant} />;
      break;
    case 'feedback':
      content = <FeedbackInput variant={variant} />;
      break;
    case 'form':
      content = <FormInput variant={variant} />;
      break;
    case 'blocked':
      content = <BlockedInput variant={variant} />;
      break;
    case 'run_control':
      content = <RunControlInput variant={variant} />;
      break;
    default:
      variant satisfies never;
      return null;
  }

  return (
    <div data-bottom-box-input data-variant={variant.kind} className="w-full">
      {content}
    </div>
  );
}
