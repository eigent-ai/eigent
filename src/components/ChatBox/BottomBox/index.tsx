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
import { BoxHeaderConfirm, BoxHeaderSave } from './BoxHeader';
import { FileAttachment, Inputbox, InputboxProps } from './InputBox';
import { QueuedBox, QueuedMessage } from './QueuedBox';
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

interface BottomBoxProps {
  // General state
  state: BottomBoxState;

  // Queue-related props
  queuedMessages?: QueuedMessage[];
  onRemoveQueuedMessage?: (id: string) => void;

  // Subtask-related props (confirm/save state)
  subtitle?: string;
  autoStartDeadline?: number | null;

  // Action buttons
  onStartTask?: () => void;
  onSavePlan?: () => void;
  onEdit?: () => void;

  // Task info
  taskTime?: string;
  taskStatus?: ChatTaskStatusType;

  // Pause/Resume
  onPauseResume?: () => void;
  pauseResumeLoading?: boolean;

  // Input props
  inputProps: Omit<InputboxProps, 'className'> & { className?: string };
  usageLimitBanner?: UsageLimitBannerProps | null;

  // Loading states
  loading?: boolean;

  /** Full-area warning overlay on the input card when no model is configured. */
  noModelOverlay?: boolean;
  onSelectModel?: () => void;
}

export default function BottomBox({
  state,
  queuedMessages = [],
  onRemoveQueuedMessage,
  subtitle,
  autoStartDeadline,
  onStartTask,
  onSavePlan,
  onEdit,
  inputProps,
  usageLimitBanner,
  loading = false,
  noModelOverlay = false,
  onSelectModel,
}: BottomBoxProps) {
  const { t } = useTranslation();
  const enableQueuedBox = true; //TODO: Fix the reason of queued box disable in https://github.com/eigent-ai/eigent/issues/684

  // Background color reflects current state only
  let backgroundClass = 'bg-ds-bg-neutral-subtle-default';
  if (state === 'confirm' || state === 'save')
    backgroundClass = 'bg-ds-bg-completed-subtle-default';

  return (
    <div className="relative z-50 flex w-full flex-col rounded-t-2xl bg-ds-bg-neutral-subtle-default backdrop-blur-xl">
      {/* QueuedBox overlay (should not affect BoxMain layout) */}
      {enableQueuedBox && queuedMessages.length > 0 && (
        <div className="pointer-events-auto z-50 px-2">
          <QueuedBox
            queuedMessages={queuedMessages}
            onRemoveQueuedMessage={onRemoveQueuedMessage}
          />
        </div>
      )}
      {/* BoxMain */}
      <div
        className={`relative mb-sm flex w-full flex-col rounded-3xl ${backgroundClass}`}
      >
        {/* BoxHeader variants */}
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

        {/* Inputbox (always visible) */}
        {usageLimitBanner && <UsageLimitBanner {...usageLimitBanner} />}
        <Inputbox {...inputProps} />

        {noModelOverlay && onSelectModel ? (
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

export { type FileAttachment, type QueuedMessage };
