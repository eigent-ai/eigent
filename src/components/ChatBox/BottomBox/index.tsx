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
import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BoxFooter } from './BoxFooter';
import { BoxHeaderConfirm, BoxHeaderDisplay, BoxHeaderSave } from './BoxHeader';
import { ControlInputRouter } from './ControlInput';
import type { FileAttachment, InputboxProps } from './InputBox';
import { ConnectorPickerPanel, SkillPickerPanel } from './PickerPanel';
import { QueuedBox, type QueuedMessage } from './QueuedBox';
import type {
  BottomBoxContextItem,
  BottomBoxVariant,
  LegacyBottomBoxVariant,
} from './types';
import {
  UsageLimitBanner,
  type UsageLimitBannerProps,
} from './UsageLimitBanner';

export type BottomBoxState =
  | 'input'
  | 'confirm'
  | 'save'
  | 'running'
  | 'finished';

type PickerPanelKind = 'connector' | 'skill';

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

  // BoxFooter (project-setup controls: mode + model); omit sessionMode to hide the row.
  sessionMode?: SessionModeType;
  onSessionModeChange?: (mode: SessionModeType) => void;
  /** Interactive during project setup (workspace); once the project starts the row is read-only. */
  sessionModeSelectInteractive?: boolean;
  /** Project whose pinned model the footer model selector reads and writes. */
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
  let backgroundClass = 'bg-ds-bg-neutral-default-default';
  if (state === 'confirm' || state === 'save')
    backgroundClass = 'bg-ds-bg-completed-default-default';

  const showQueuedBox = enableQueuedBox && queuedMessages.length > 0;
  const activePickerPanel =
    normalizedVariant.kind === 'input' ? openPanel : null;
  const hasOverlay = !!usageLimitBanner || !!activePickerPanel;

  const variantHeader = normalizedVariant.header;
  const attachedFiles =
    normalizedVariant.kind === 'input' ? (inputProps.files ?? []) : [];
  const attachmentContext: BottomBoxContextItem[] = attachedFiles.map(
    (file) => ({
      id: `attachment:${file.filePath}`,
      label: file.fileName,
      description: file.filePath,
      kind: 'file',
      removable: typeof inputProps.onFilesChange === 'function',
    })
  );
  const headerContextItems = [
    ...(variantHeader?.contextItems ?? []),
    ...attachmentContext,
  ];
  const resolvedHeader =
    variantHeader || headerContextItems.length > 0
      ? {
          ...variantHeader,
          contextItems: headerContextItems,
          onRemoveContextItem:
            inputProps.onFilesChange || variantHeader?.onRemoveContextItem
              ? (id: string) => {
                  if (id.startsWith('attachment:')) {
                    const filePath = id.slice('attachment:'.length);
                    inputProps.onFilesChange?.(
                      attachedFiles.filter((file) => file.filePath !== filePath)
                    );
                    return;
                  }
                  variantHeader?.onRemoveContextItem?.(id);
                }
              : undefined,
        }
      : undefined;

  const variantDisabled =
    normalizedVariant.kind === 'input'
      ? inputProps.disabled
      : normalizedVariant.disabled || normalizedVariant.submitting;

  return (
    <div
      data-bottom-box
      className="relative z-50 flex w-full flex-col gap-1 rounded-3xl bg-ds-bg-neutral-default-default"
    >
      {/* QueryBox — queued user requests remain separate from BoxMain. */}
      {showQueuedBox && (
        <div data-bottom-box-query>
          <QueuedBox
            queuedMessages={queuedMessages}
            onRemoveQueuedMessage={onRemoveQueuedMessage}
            onSendQueuedMessageNow={onSendQueuedMessageNow}
          />
        </div>
      )}

      {/* Floating utility overlays: never affect BoxMain layout. */}
      {hasOverlay && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-full z-[60] mb-1 flex flex-col gap-1">
          {usageLimitBanner && <UsageLimitBanner {...usageLimitBanner} />}
          {activePickerPanel && (
            <div
              ref={panelRef}
              className="duration-150 animate-in fade-in-0 slide-in-from-bottom-1"
            >
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
        </div>
      )}

      {/* BoxMain */}
      <div
        data-bottom-box-main
        className={`relative flex w-full flex-col rounded-3xl ${backgroundClass}`}
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
        {resolvedHeader && <BoxHeaderDisplay {...resolvedHeader} />}

        {/* InputBox — controlled router selected by event-derived variant. */}
        <ControlInputRouter
          variant={normalizedVariant}
          inputProps={inputProps}
          connectorPanelOpen={activePickerPanel === 'connector'}
          onToggleConnectorPanel={() => togglePanel('connector')}
          skillPanelOpen={activePickerPanel === 'skill'}
          onToggleSkillPanel={() => togglePanel('skill')}
        />

        {/* BoxFooter remains the stable project-setup region for every variant. */}
        <div data-bottom-box-footer>
          {sessionMode !== undefined && (
            <BoxFooter
              sessionMode={sessionMode}
              onSessionModeChange={onSessionModeChange}
              projectId={modelSelectProjectId}
              interactive={sessionModeSelectInteractive}
              disabled={variantDisabled}
            />
          )}
        </div>

        {noModelOverlay &&
        onSelectModel &&
        normalizedVariant.kind === 'input' ? (
          <div
            className="absolute inset-0 z-[15] flex flex-row items-center justify-center gap-3 rounded-3xl bg-ds-bg-warning-subtle-default px-4 py-5 backdrop-blur-lg"
            role="alert"
          >
            <TriangleAlert
              className="h-4 w-4 shrink-0 text-ds-icon-warning-default-default"
              aria-hidden
            />
            <p className="text-sm font-medium leading-snug text-ds-text-warning-default-default">
              {t('layout.please-select-model')}
            </p>
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
          </div>
        ) : null}
      </div>
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
