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

import { BoxAction } from './BoxAction';
import { BoxHeaderConfirm, BoxHeaderSplitting } from './BoxHeader';
import { FileAttachment, Inputbox, InputboxProps } from './InputBox';
import { QueuedBox, QueuedMessage } from './QueuedBox';
import { type ChatTaskStatusType } from "@/types/constants";

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
  tokens?: number;
  taskTime?: string;
  taskStatus?: ChatTaskStatusType;

  // Replay
  onReplay?: () => void;
  replayDisabled?: boolean;
  replayLoading?: boolean;

  // Pause/Resume
  onPauseResume?: () => void;
  pauseResumeLoading?: boolean;

  // Input props
  inputProps: Omit<InputboxProps, 'className'> & { className?: string };

  // Loading states
  loading?: boolean;
}

export default function BottomBox({
  state,
  queuedMessages = [],
  onRemoveQueuedMessage,
  subtitle,
  onStartTask,
  onEdit,
  tokens = 0,
  taskTime,
  taskStatus,
  onReplay,
  replayDisabled,
  replayLoading,
  onPauseResume,
  pauseResumeLoading,
  inputProps,
  loading,
}: BottomBoxProps) {
  // const { t } = useTranslation();
  const enableQueuedBox = false; //TODO: Enable queued box https://github.com/eigent-ai/eigent/issues/684

  // Background color reflects current state only
  let backgroundClass = 'bg-input-bg-default';
  if (state === 'splitting') backgroundClass = 'bg-input-bg-spliting';
  else if (state === 'confirm') backgroundClass = 'bg-input-bg-confirm';

  return (
    <div className="relative z-50 flex w-full flex-col">
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
        className={`flex w-full flex-col gap-2 rounded-t-lg p-2 ${backgroundClass}`}
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

        {/* BoxAction (visible after initial input, when task has started) */}
        {state !== 'input' && (
          <BoxAction
            tokens={tokens}
            taskTime={taskTime}
            status={taskStatus}
            disabled={replayDisabled}
            loading={replayLoading}
            onReplay={onReplay}
            onPauseResume={onPauseResume}
            pauseResumeLoading={pauseResumeLoading}
          />
        )}
      </div>
    </div>
  );
}

export { type FileAttachment, type QueuedMessage };
