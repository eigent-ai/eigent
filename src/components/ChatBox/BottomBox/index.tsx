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
import { type SessionModeType } from '@/types/constants';
import { motion, useReducedMotion } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BoxFooter } from './BoxFooter';
import { BoxHeaderConfirm, BoxHeaderDisplay, BoxHeaderSave } from './BoxHeader';
import { ControlInputRouter } from './ControlInput';
import type { FileAttachment, InputboxProps } from './InputBox';
import { ConnectorPickerPanel, SkillPickerPanel } from './PickerPanel';
import { QueuedBox, type QueuedMessage } from './QueuedBox';
import type { BottomBoxVariant, LegacyBottomBoxVariant } from './types';
import {
  UsageLimitBanner,
  type UsageLimitBannerProps,
} from './UsageLimitBanner';

export type BottomBoxState =
  'input' | 'confirm' | 'save' | 'running' | 'finished';

type PickerPanelKind = 'connector' | 'skill';

const VARIANT_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
const VARIANT_ENTER_TRANSITION = {
  duration: 0.18,
  ease: VARIANT_EASE,
} as const;
const REDUCED_ENTER_TRANSITION = {
  duration: 0.12,
  ease: VARIANT_EASE,
} as const;
const LAYOUT_TRANSITION = { duration: 0.22, ease: VARIANT_EASE } as const;
const INSTANT_TRANSITION = { duration: 0 } as const;

interface BottomBoxCommonProps {
  // General state
  state: BottomBoxState;

  // Queue-related props
  queuedMessages?: QueuedMessage[];
  onRemoveQueuedMessage?: (id: string) => void;
  onSendQueuedMessageNow?: (id: string) => void;

  // Subtask-related props (confirm/save state)
  subtitle?: string;
  autoStartDeadline?: number | null;

  // Action buttons
  onStartTask?: () => void;
  onSavePlan?: () => void;
  onEdit?: () => void;

  usageLimitBanner?: UsageLimitBannerProps | null;

  // BoxFooter (mode, approval, thinking effort, model); omit sessionMode to hide the row.
  sessionMode?: SessionModeType;
  onSessionModeChange?: (mode: SessionModeType) => void;
  /** When true, session mode can be switched (Workspace / New session). */
  sessionModeSelectInteractive?: boolean;
  /** Project whose pinned model and thinking effort the footer selectors read and write. */
  modelSelectProjectId?: string | null;

  // Loading states
  loading?: boolean;

  /** Full-area warning overlay on the input card when no model is configured. */
  noModelOverlay?: boolean;
  onSelectModel?: () => void;
}

export type BottomBoxProps = BottomBoxCommonProps & {
  /** Defaults to the composer; event-derived variants contain display data and callbacks. */
  variant?: LegacyBottomBoxVariant | BottomBoxVariant;
  /** Required by composer owners and safely ignored by controlled variants. */
  inputProps?: Omit<InputboxProps, 'className'> & { className?: string };
};

export default function BottomBox({
  state,
  variant = 'input',
  queuedMessages = [],
  onRemoveQueuedMessage,
  onSendQueuedMessageNow,
  subtitle,
  autoStartDeadline,
  onStartTask,
  onSavePlan,
  onEdit,
  inputProps: providedInputProps,
  usageLimitBanner,
  sessionMode,
  onSessionModeChange,
  sessionModeSelectInteractive = false,
  modelSelectProjectId,
  loading = false,
  noModelOverlay = false,
  onSelectModel,
}: BottomBoxProps) {
  const { t } = useTranslation();
  const shouldReduceMotion = Boolean(useReducedMotion());
  const enableQueuedBox = true; //TODO: Fix the reason of queued box disable in https://github.com/eigent-ai/eigent/issues/684
  const inputProps: InputboxProps = providedInputProps ?? {};
  const normalizedVariant: BottomBoxVariant =
    variant === 'input' ? { kind: 'input' } : variant;

  // Picker panels (connector/skill) float above BoxMain and are mutually exclusive.
  const [openPanel, setOpenPanel] = useState<PickerPanelKind | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const togglePanel = (panel: PickerPanelKind) =>
    setOpenPanel((prev) => (prev === panel ? null : panel));

  // Close the floating panel on outside click (ignore the trigger buttons,
  // which own their own toggle).
  useEffect(() => {
    if (!openPanel) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        panelRef.current?.contains(target ?? null) ||
        target?.closest('[data-picker-trigger]')
      ) {
        return;
      }
      setOpenPanel(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openPanel]);

  useEffect(() => {
    if (normalizedVariant.kind !== 'input') setOpenPanel(null);
  }, [normalizedVariant.kind]);

  // Replacing the composer with an agent request is a mode change. Assistive
  // technology only learns about it if the new region is announced and focus
  // follows it, otherwise the caret is left on a control that no longer exists.
  const variantRegionRef = useRef<HTMLDivElement>(null);
  const previousVariantKindRef = useRef(normalizedVariant.kind);
  useEffect(() => {
    const previousKind = previousVariantKindRef.current;
    previousVariantKindRef.current = normalizedVariant.kind;
    if (
      normalizedVariant.kind === 'input' ||
      normalizedVariant.kind === 'approval' ||
      previousKind === normalizedVariant.kind
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const firstAction = variantRegionRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled])'
      );
      firstAction?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [normalizedVariant.kind]);

  const inputValue = inputProps.value ?? '';

  /** Focus the input and drop the caret at the end after a programmatic edit. */
  const focusInputEnd = () => {
    requestAnimationFrame(() => {
      const el = inputProps.textareaRef?.current;
      if (!el) return;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  };

  /** Append a `#skill` / `@connector` token to the input, space-separated. */
  const insertToken = (token: string) => {
    const trimmed = inputValue.replace(/\s+$/, '');
    const next = (trimmed.length ? `${trimmed} ` : '') + `${token} `;
    inputProps.onChange?.(next);
    focusInputEnd();
  };

  /** Remove a previously inserted token (and one adjacent space) from the input. */
  const removeToken = (token: string) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const next = inputValue
      .replace(new RegExp(`\\s?${escaped}`), '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^\s+/, '');
    inputProps.onChange?.(next);
    focusInputEnd();
  };

  const toggleToken = (token: string) =>
    inputValue.includes(token) ? removeToken(token) : insertToken(token);

  // Background color reflects current state only
  let backgroundClass = 'bg-ds-neutral-default-default';
  if (state === 'confirm' || state === 'save')
    backgroundClass = 'bg-ds-bg-status-completed-subtle-default';

  const showQueuedBox = enableQueuedBox && queuedMessages.length > 0;
  const activePickerPanel =
    normalizedVariant.kind === 'input' ? openPanel : null;
  const hasOverlay = !!usageLimitBanner || !!activePickerPanel;

  const variantHeader = normalizedVariant.header;
  // Composer and approval question/details live inside their input surfaces.
  // Other controlled variants keep the display header above their controls.
  const externalHeader =
    normalizedVariant.kind === 'input' || normalizedVariant.kind === 'approval'
      ? undefined
      : variantHeader;

  const variantDisabled =
    normalizedVariant.kind === 'input'
      ? inputProps.disabled
      : normalizedVariant.disabled || normalizedVariant.submitting;
  const showFooter =
    sessionMode !== undefined && normalizedVariant.kind !== 'approval';
  // Approval removes the footer and its space synchronously. Other variants
  // can interpolate their height unless the user prefers reduced motion.
  const instantLayout =
    shouldReduceMotion || normalizedVariant.kind === 'approval';
  const enterTransition = shouldReduceMotion
    ? REDUCED_ENTER_TRANSITION
    : VARIANT_ENTER_TRANSITION;
  const enterOffset = shouldReduceMotion ? 0 : 6;
  const overlayOffset = shouldReduceMotion ? 0 : 4;

  return (
    <div
      data-bottom-box
      className="relative z-50 flex w-full flex-col gap-1 rounded-3xl bg-ds-neutral-default-default"
    >
      {/* QueryBox — queued user requests remain separate from BoxMain. */}
      {showQueuedBox && (
        <motion.div
          key="bottom-box-query"
          data-bottom-box-query
          initial={{ opacity: 0, y: overlayOffset }}
          animate={{ opacity: 1, y: 0 }}
          transition={enterTransition}
        >
          <QueuedBox
            queuedMessages={queuedMessages}
            onRemoveQueuedMessage={onRemoveQueuedMessage}
            onSendQueuedMessageNow={onSendQueuedMessageNow}
          />
        </motion.div>
      )}

      {/* Floating utility overlays: never affect BoxMain layout. */}
      {hasOverlay && (
        <motion.div
          key={activePickerPanel ?? 'usage-limit'}
          className="pointer-events-auto absolute inset-x-0 bottom-full z-[60] mb-1 flex flex-col gap-1"
          initial={{ opacity: 0, y: overlayOffset }}
          animate={{ opacity: 1, y: 0 }}
          transition={enterTransition}
        >
          {usageLimitBanner && <UsageLimitBanner {...usageLimitBanner} />}
          {activePickerPanel && (
            <div ref={panelRef}>
              {activePickerPanel === 'connector' ? (
                <ConnectorPickerPanel
                  inputValue={inputValue}
                  onToggleItem={(item) => toggleToken(item.token)}
                />
              ) : (
                <SkillPickerPanel
                  inputValue={inputValue}
                  onToggleItem={(item) => toggleToken(item.token)}
                />
              )}
            </div>
          )}
        </motion.div>
      )}

      {/* BoxMain */}
      <motion.div
        layout={instantLayout ? false : 'size'}
        data-bottom-box-main
        data-layout-motion={instantLayout ? 'instant' : 'smooth'}
        className={`relative flex w-full flex-col rounded-3xl ${backgroundClass}`}
        transition={{
          layout: instantLayout ? INSTANT_TRANSITION : LAYOUT_TRANSITION,
        }}
      >
        {/* BoxHeader — context/question display only. */}
        {state === 'confirm' && (
          <BoxHeaderConfirm
            subtitle={subtitle}
            onStartTask={onStartTask}
            onEdit={onEdit}
            loading={loading}
            autoStartDeadline={autoStartDeadline}
          />
        )}
        {state === 'save' && (
          <BoxHeaderSave
            subtitle={subtitle}
            onSave={onSavePlan}
            onEdit={onEdit}
            loading={loading}
          />
        )}
        <motion.div
          key={normalizedVariant.kind}
          ref={variantRegionRef}
          layout={!shouldReduceMotion}
          data-bottom-box-variant-transition
          data-variant={normalizedVariant.kind}
          className="w-full"
          role={normalizedVariant.kind === 'input' ? undefined : 'region'}
          aria-label={
            normalizedVariant.kind === 'input'
              ? undefined
              : t('chat.control-region-label')
          }
          aria-live={
            normalizedVariant.kind === 'approval' ? 'assertive' : 'polite'
          }
          initial={{ opacity: 0, y: enterOffset }}
          animate={{ opacity: 1, y: 0 }}
          transition={enterTransition}
        >
          {externalHeader && (
            <BoxHeaderDisplay
              {...externalHeader}
              className="px-3"
              descriptionAsTitle={
                normalizedVariant.kind === 'feedback' &&
                normalizedVariant.presentation === 'question'
              }
              descriptionAsMarkdown={
                normalizedVariant.kind === 'feedback' &&
                normalizedVariant.presentation === 'question'
              }
              showQuestionIcon={
                normalizedVariant.kind === 'feedback' &&
                normalizedVariant.presentation === 'question'
              }
            />
          )}

          {/* InputBox — controlled router selected by event-derived variant. */}
          <ControlInputRouter
            variant={normalizedVariant}
            inputProps={inputProps}
            connectorPanelOpen={activePickerPanel === 'connector'}
            onToggleConnectorPanel={() => togglePanel('connector')}
            skillPanelOpen={activePickerPanel === 'skill'}
            onToggleSkillPanel={() => togglePanel('skill')}
          />
        </motion.div>

        {showFooter ? (
          <div data-bottom-box-footer>
            <BoxFooter
              sessionMode={sessionMode!}
              onSessionModeChange={onSessionModeChange}
              projectId={modelSelectProjectId}
              interactive={sessionModeSelectInteractive}
              disabled={variantDisabled}
            />
          </div>
        ) : null}

        {noModelOverlay &&
        onSelectModel &&
        normalizedVariant.kind === 'input' ? (
          <motion.div
            key="no-model-overlay"
            className="absolute inset-0 z-[15] flex flex-row items-center justify-center gap-3 rounded-3xl bg-ds-bg-warning-subtle-default px-4 py-5 backdrop-blur-lg"
            role="alert"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={enterTransition}
          >
            <TriangleAlert
              className="h-4 w-4 shrink-0 text-ds-icon-warning-default-default"
              aria-hidden
            />
            <span className="block text-ds-text-base font-normal text-ds-text-warning-default-default">
              {t('layout.please-select-model')}
            </span>
            <Button
              type="button"
              variant="primary"
              tone="warning"
              size="sm"
              buttonRadius="full"
              onClick={onSelectModel}
            >
              {t('layout.select-model-cta', {
                defaultValue: 'Select a model',
              })}
            </Button>
          </motion.div>
        ) : null}
      </motion.div>
    </div>
  );
}

export type {
  BottomBoxApprovalOption,
  BottomBoxApprovalScope,
  BottomBoxApprovalVariant,
  BottomBoxBlockedVariant,
  BottomBoxConfirmationVariant,
  BottomBoxContextItem,
  BottomBoxFeedbackVariant,
  BottomBoxFormField,
  BottomBoxFormVariant,
  BottomBoxHeaderContent,
  BottomBoxHeaderDetail,
  BottomBoxInputVariant,
  BottomBoxSelectionOption,
  BottomBoxSelectionVariant,
  BottomBoxVariant,
} from './types';
export { type FileAttachment, type QueuedMessage };
