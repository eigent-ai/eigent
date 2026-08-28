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
import { ShortcutKeycap } from '@/components/ui/shortcut-keycap';
import { Textarea } from '@/components/ui/textarea';
import { useDesktopShortcutPlatform } from '@/hooks/useDesktopShortcutPlatform';
import { cn } from '@/lib/utils';
import { getEnterKeyLabel } from '@/shared/keyboardShortcuts';
import { Check, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BoxHeaderDisplay } from './BoxHeader';
import type { InputboxProps } from './InputBox';
import { Inputbox } from './InputBox';
import type {
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
  'flex w-full flex-col gap-3 rounded-3xl border-x border-y border border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default p-3';

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
  const { t } = useTranslation();
  const showNote =
    variant.note !== undefined || variant.onNoteChange !== undefined;

  return (
    <div className={controlSurfaceClassName}>
      {showNote && (
        <Textarea
          aria-label={t('chat.control-confirmation-note-label')}
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
          buttonRadius="full"
          disabled={variant.disabled || variant.submitting}
          onClick={variant.onReject}
        >
          {variant.rejectLabel ?? t('chat.control-reject')}
        </Button>
        <Button
          type="button"
          variant="primary"
          tone="success"
          size="sm"
          buttonRadius="full"
          disabled={variant.disabled || variant.submitting}
          onClick={variant.onConfirm}
        >
          {variant.submitting
            ? t('chat.control-submitting')
            : (variant.confirmLabel ?? t('chat.control-confirm'))}
        </Button>
      </ControlActions>
    </div>
  );
}

function ApprovalInput({ variant }: { variant: BottomBoxApprovalVariant }) {
  const { t } = useTranslation();

  return (
    <div
      data-bottom-box-input-surface
      data-approval-surface
      className={controlSurfaceClassName}
    >
      <BoxHeaderDisplay
        {...variant.header}
        eyebrow={undefined}
        contextItems={undefined}
        details={undefined}
        className="px-0 pt-0 pb-0"
      />
      <div data-approval-actions className="flex w-full justify-end">
        <ControlActions>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonRadius="full"
            disabled={variant.disabled || variant.submitting}
            onClick={variant.onReject}
          >
            {variant.rejectLabel ?? t('chat.control-reject')}
          </Button>
          {variant.options.map((option) => {
            return (
              <Button
                key={option.scope}
                type="button"
                variant="primary"
                tone="success"
                size="sm"
                buttonRadius="full"
                disabled={variant.disabled || variant.submitting}
                onClick={() => variant.onApprove(option.scope)}
              >
                <span>{option.label}</span>
              </Button>
            );
          })}
        </ControlActions>
      </div>
    </div>
  );
}

function SelectionInput({ variant }: { variant: BottomBoxSelectionVariant }) {
  const { t } = useTranslation();
  const multiple = variant.selectionMode === 'multiple';
  const selected = new Set(variant.selectedIds);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);

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

  // A radiogroup exposes a single tab stop and moves selection with the arrow
  // keys. Without roving tabindex the ARIA role would advertise behaviour the
  // control does not have.
  const firstSelectedIndex = variant.options.findIndex((option) =>
    selected.has(option.id)
  );
  const activeIndex = multiple
    ? -1
    : firstSelectedIndex >= 0
      ? firstSelectedIndex
      : Math.min(focusedIndex, Math.max(0, variant.options.length - 1));

  const moveFocus = (from: number, step: number) => {
    const count = variant.options.length;
    if (count === 0) return;
    for (let offset = 1; offset <= count; offset += 1) {
      const next = (from + step * offset + count * offset) % count;
      if (!variant.options[next].disabled) {
        setFocusedIndex(next);
        optionRefs.current[next]?.focus();
        toggle(variant.options[next].id);
        return;
      }
    }
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (multiple) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveFocus(index, 1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      moveFocus(index, -1);
    }
  };

  return (
    <div className={controlSurfaceClassName}>
      <div
        className="flex flex-col gap-1"
        role={multiple ? 'group' : 'radiogroup'}
        aria-label={t('chat.control-response-options-label')}
      >
        {variant.options.map((option, index) => {
          const isSelected = selected.has(option.id);
          return (
            <Button
              key={option.id}
              ref={(node: HTMLButtonElement | null) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              role={multiple ? undefined : 'radio'}
              aria-checked={multiple ? undefined : isSelected}
              aria-pressed={multiple ? isSelected : undefined}
              tabIndex={multiple || index === activeIndex ? 0 : -1}
              variant={isSelected ? 'secondary' : 'ghost'}
              tone={isSelected ? 'information' : 'neutral'}
              className="h-auto w-full justify-start gap-2 px-2 py-2 text-left focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:outline-none focus-visible:ring-inset"
              disabled={
                variant.disabled || variant.submitting || option.disabled
              }
              onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) =>
                handleKeyDown(event, index)
              }
              onClick={() => {
                setFocusedIndex(index);
                toggle(option.id);
              }}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center border border-x border-y border-solid border-ds-hairline-default-default',
                  multiple ? 'rounded' : 'rounded-full',
                  isSelected &&
                    'border-ds-border-status-completed-default-default bg-ds-bg-success-default-default'
                )}
              >
                {isSelected && (
                  <Check className="size-3 text-ds-success-on-default" />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-ds-text-base font-medium">
                  {option.label}
                </span>
                {option.description && (
                  <span className="text-ds-text-meta font-normal text-ds-ink-muted-default">
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
          buttonRadius="full"
          disabled={
            variant.disabled ||
            variant.submitting ||
            variant.selectedIds.length === 0
          }
          onClick={variant.onSubmit}
        >
          {variant.submitting
            ? t('chat.control-submitting')
            : (variant.submitLabel ?? t('chat.control-submit'))}
        </Button>
      </ControlActions>
    </div>
  );
}

function FeedbackInput({ variant }: { variant: BottomBoxFeedbackVariant }) {
  const { t } = useTranslation();
  const enterLabel = getEnterKeyLabel(useDesktopShortcutPlatform());

  return (
    <div className={controlSurfaceClassName}>
      <Textarea
        aria-label={t('chat.control-feedback-label')}
        value={variant.value}
        placeholder={variant.placeholder}
        className={cn(
          variant.presentation === 'question' &&
            'border-none shadow-none focus-visible:ring-0 focus-visible:ring-offset-0'
        )}
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
            buttonRadius="full"
            disabled={variant.disabled || variant.submitting}
            onClick={variant.onSkip}
          >
            {variant.skipLabel ?? t('chat.control-skip')}
          </Button>
        )}
        <Button
          type="button"
          variant="primary"
          size="sm"
          buttonRadius="full"
          disabled={
            variant.disabled ||
            variant.submitting ||
            variant.value.trim().length === 0
          }
          onClick={variant.onSubmit}
        >
          <span>
            {variant.submitting
              ? t('chat.control-submitting')
              : (variant.submitLabel ?? t('chat.control-send-feedback'))}
          </span>
          {!variant.submitting ? (
            <ShortcutKeycap appearance="button" aria-hidden>
              {enterLabel}
            </ShortcutKeycap>
          ) : null}
        </Button>
      </ControlActions>
    </div>
  );
}

function FormInput({ variant }: { variant: BottomBoxFormVariant }) {
  const { t } = useTranslation();
  // Submit stays enabled so a blocked submission can name the field that is
  // missing instead of leaving the user with a silently disabled button.
  const [showRequiredErrors, setShowRequiredErrors] = useState(false);
  const missingRequiredIds = new Set(
    variant.fields
      .filter((field) => field.required && field.value.trim().length === 0)
      .map((field) => field.id)
  );

  const submit = () => {
    if (missingRequiredIds.size > 0) {
      setShowRequiredErrors(true);
      return;
    }
    variant.onSubmit();
  };

  return (
    <div className={controlSurfaceClassName}>
      <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
        {variant.fields.map((field) => {
          const hasError =
            showRequiredErrors && missingRequiredIds.has(field.id);
          const shared = {
            title: field.label,
            'aria-label': field.label,
            'aria-invalid': hasError || undefined,
            required: field.required,
            state: hasError ? ('error' as const) : ('default' as const),
            note: hasError ? t('chat.control-field-required') : undefined,
            value: field.value,
            placeholder: field.placeholder,
            disabled: variant.disabled || variant.submitting || field.disabled,
          };

          return field.type === 'textarea' ? (
            <Textarea
              key={field.id}
              {...shared}
              variant="enhanced"
              onChange={(event) =>
                variant.onFieldChange(field.id, event.target.value)
              }
            />
          ) : (
            <Input
              key={field.id}
              {...shared}
              type={field.type ?? 'text'}
              onChange={(event) =>
                variant.onFieldChange(field.id, event.target.value)
              }
            />
          );
        })}
      </div>
      <ControlActions>
        <Button
          type="button"
          variant="primary"
          size="sm"
          buttonRadius="full"
          disabled={variant.disabled || variant.submitting}
          onClick={submit}
        >
          {variant.submitting
            ? t('chat.control-submitting')
            : (variant.submitLabel ?? t('chat.control-submit'))}
        </Button>
      </ControlActions>
    </div>
  );
}

function BlockedInput({ variant }: { variant: BottomBoxBlockedVariant }) {
  const { t } = useTranslation();

  return (
    <div className={controlSurfaceClassName} role="alert">
      <div className="flex items-start gap-2 text-ds-text-base text-ds-text-warning-default-default">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="block font-normal">{variant.message}</span>
      </div>
      {variant.onRecover ? (
        <ControlActions>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            buttonRadius="full"
            disabled={variant.disabled || variant.submitting}
            onClick={variant.onRecover}
          >
            {variant.recoveryLabel ?? t('chat.control-retry')}
          </Button>
        </ControlActions>
      ) : null}
    </div>
  );
}

function RunControlInput({ variant }: { variant: BottomBoxRunControlVariant }) {
  const { t } = useTranslation();
  const locked = Boolean(variant.disabled || variant.submitting);
  const loading =
    variant.state === 'resuming' || variant.state === 'cancelling';
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
        <span
          className="block text-ds-text-base font-normal text-ds-ink-muted-default"
          role="status"
        >
          {variant.readOnlyLabel ?? t('chat.control-read-only')}
        </span>
      ) : null}

      {showInterruptedActions ? (
        <ControlActions>
          <Button
            type="button"
            variant="ghost"
            tone="error"
            size="sm"
            buttonRadius="full"
            disabled={
              locked || variant.state !== 'interrupted' || !variant.onCancel
            }
            onClick={() => variant.onCancel?.(variant.runId)}
          >
            {variant.state === 'cancelling'
              ? (variant.cancellingLabel ?? t('chat.control-cancelling'))
              : (variant.cancelLabel ?? t('chat.control-cancel-run'))}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            buttonRadius="full"
            disabled={
              locked || variant.state !== 'interrupted' || !variant.onResume
            }
            onClick={() => variant.onResume?.(variant.runId)}
          >
            {variant.state === 'resuming'
              ? (variant.resumingLabel ?? t('chat.control-resuming'))
              : (variant.resumeLabel ?? t('chat.control-resume'))}
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
          header={variant.header}
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
