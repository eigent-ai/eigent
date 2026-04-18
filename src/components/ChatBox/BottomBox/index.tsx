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
import { type ChatTaskStatusType } from '@/types/constants';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BoxHeaderConfirm, BoxHeaderSplitting } from './BoxHeader';
import { FileAttachment, Inputbox, InputboxProps } from './InputBox';
import { QueuedBox, QueuedMessage } from './QueuedBox';

export type StarterSuggestion = { label: string; message: string };

export type BottomBoxState =
  | 'input'
  | 'splitting'
  | 'confirm'
  | 'running'
  | 'finished';

interface BottomBoxProps {
  // General state
  state: BottomBoxState;

  // Queue-related props
  queuedMessages?: QueuedMessage[];
  onRemoveQueuedMessage?: (id: string) => void;

  // Subtask-related props (confirm/splitting state)
  subtitle?: string;

  // Action buttons
  onStartTask?: () => void;
  onEdit?: () => void;

  // Task info
  taskTime?: string;
  taskStatus?: ChatTaskStatusType;

  // Pause/Resume
  onPauseResume?: () => void;
  pauseResumeLoading?: boolean;

  // Input props
  inputProps: Omit<InputboxProps, 'className'> & { className?: string };

  // Loading states
  loading?: boolean;

  /** Full-area warning overlay on the input card when no model is configured. */
  noModelOverlay?: boolean;
  onSelectModel?: () => void;

  /** Optional starter prompts below the input (empty chat); hidden when `noModelOverlay` is true. */
  starterSuggestions?: StarterSuggestion[];
  onStarterSuggestion?: (message: string) => void;
}

export default function BottomBox({
  state,
  queuedMessages = [],
  onRemoveQueuedMessage,
  subtitle,
  onStartTask,
  onEdit,
  inputProps,
  loading = false,
  noModelOverlay = false,
  onSelectModel,
  starterSuggestions,
  onStarterSuggestion,
}: BottomBoxProps) {
  const { t } = useTranslation();
  const enableQueuedBox = true; //TODO: Fix the reason of queued box disable in https://github.com/eigent-ai/eigent/issues/684

  // Background color reflects current state only
  let backgroundClass = 'bg-[var(--ds-bg-neutral-default-default)]';
  if (state === 'splitting')
    backgroundClass = 'bg-[var(--ds-bg-status-splitting-subtle-default)]';
  else if (state === 'confirm')
    backgroundClass = 'bg-[var(--ds-bg-status-pending-subtle-default)]';

  return (
    <div className="relative z-50 flex w-full flex-col bg-[var(--ds-bg-neutral-default-default)]">
      {/* QueuedBox overlay (should not affect BoxMain layout) */}
      {enableQueuedBox && queuedMessages.length > 0 && (
        <div className="px-2 pointer-events-auto z-50">
          <QueuedBox
            queuedMessages={queuedMessages}
            onRemoveQueuedMessage={onRemoveQueuedMessage}
          />
        </div>
      )}
      {/* BoxMain */}
      <div
        className={`rounded-3xl mb-sm relative flex w-full flex-col ${backgroundClass}`}
      >
        {/* BoxHeader variants */}
        {state === 'splitting' && <BoxHeaderSplitting />}
        {state === 'confirm' && (
          <BoxHeaderConfirm
            subtitle={subtitle}
            onStartTask={onStartTask}
            onEdit={onEdit}
            loading={loading}
          />
        )}

        {/* Inputbox (always visible) */}
        <Inputbox {...inputProps} />

        {!noModelOverlay &&
          starterSuggestions &&
          starterSuggestions.length > 0 &&
          onStarterSuggestion && (
            <div className="gap-2 px-2 pb-3 pt-1 flex flex-col items-center">
              {starterSuggestions.map(({ label, message }) => (
                <div
                  key={label}
                  className="rounded-md px-sm py-xs text-xs font-medium cursor-pointer bg-[var(--ds-bg-neutral-strong-default)] leading-none text-[color:var(--ds-text-neutral-default-default)] opacity-70 transition-all duration-300 hover:opacity-100"
                  onClick={() => onStarterSuggestion(message)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onStarterSuggestion(message);
                    }
                  }}
                >
                  <span>{label}</span>
                </div>
              ))}
            </div>
          )}

        {noModelOverlay && onSelectModel ? (
          <div
            className="inset-0 rounded-3xl gap-3 backdrop-blur-md px-4 py-5 absolute z-[15] flex flex-row items-center justify-center bg-transparent"
            role="alert"
          >
            <TriangleAlert
              className="h-4 w-4 shrink-0 text-[color:var(--ds-icon-warning-default-default)]"
              aria-hidden
            />
            <p className="text-sm font-medium leading-snug text-[color:var(--ds-text-warning-default-default)]">
              {t('layout.please-select-model')}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonRadius="full"
              className="bg-[var(--ds-bg-status-pending-subtle-default)] !text-[color:var(--ds-text-warning-default-default)]"
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

export { type FileAttachment, type QueuedMessage };
