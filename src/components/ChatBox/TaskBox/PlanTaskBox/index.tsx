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

import type { VanillaChatStore } from '@/store/chatStore';
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import { AnimatePresence } from 'framer-motion';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { ExpandedOverlay } from './ExpandedOverlay';
import { FoldedView } from './FoldedView';
import { isPlanSplittingPhase, useWordTypingBuffer } from './utils';

/** ID of the slot element rendered by ChatBox for portaling the expanded overlay. */
export const PLAN_OVERLAY_SLOT_ID = 'plan-task-overlay-root';

interface PlanTaskBoxProps {
  chatStore: VanillaChatStore;
  taskId: string;
  userPrompt?: string;
  allowOverlay?: boolean;
}

export function PlanTaskBox({
  chatStore,
  taskId,
  userPrompt,
  allowOverlay = true,
}: PlanTaskBoxProps) {
  const [expanded, setExpanded] = useState(false);
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null);
  const [bottomOffsetPx, setBottomOffsetPx] = useState(160);
  const manuallyMinimizedPlanRef = useRef<string | null>(null);

  useEffect(() => {
    if (!allowOverlay) {
      setOverlayRoot(null);
      return;
    }

    const syncOverlayRoot = () => {
      setOverlayRoot(document.getElementById(PLAN_OVERLAY_SLOT_ID));
    };

    syncOverlayRoot();
    const id = window.requestAnimationFrame(syncOverlayRoot);
    return () => window.cancelAnimationFrame(id);
  }, [allowOverlay]);

  // Track the current BottomBox height so the overlay sits just above it.
  useEffect(() => {
    if (!expanded || !allowOverlay) return;
    const measure = () => {
      const slot = document.getElementById(PLAN_OVERLAY_SLOT_ID);
      const bottomBoxEl =
        slot?.parentElement?.querySelector<HTMLElement>(
          '[data-bottom-box-overlay]'
        ) || null;
      const h = bottomBoxEl?.offsetHeight ?? 160;
      setBottomOffsetPx(h);
    };
    measure();
    const slot = document.getElementById(PLAN_OVERLAY_SLOT_ID);
    const bottomBoxEl =
      slot?.parentElement?.querySelector<HTMLElement>(
        '[data-bottom-box-overlay]'
      ) || null;
    if (!bottomBoxEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(bottomBoxEl);
    return () => observer.disconnect();
  }, [allowOverlay, expanded]);

  const task = useSyncExternalStore(
    (cb) => chatStore.subscribe(cb),
    () => chatStore.getState().tasks[taskId],
    () => chatStore.getState().tasks[taskId]
  );

  const streamingDecomposeText = useSyncExternalStore(
    (cb) => chatStore.subscribe(cb),
    () => chatStore.getState().tasks[taskId]?.streamingDecomposeText ?? '',
    () => chatStore.getState().tasks[taskId]?.streamingDecomposeText ?? ''
  );

  const pacedStreamingText = useWordTypingBuffer(streamingDecomposeText, {
    intervalMs: 45,
    punctuationPauseMs: 140,
  });
  const latestPlanMessage = useMemo(
    () =>
      task?.messages
        ?.slice()
        .reverse()
        .find((m: Message) => m.step === AgentStep.TO_SUB_TASKS),
    [task?.messages]
  );

  const latestPlanKey = latestPlanMessage?.id || '';
  const hasUnconfirmedPlan = Boolean(
    latestPlanMessage && !latestPlanMessage.isConfirm
  );

  useEffect(() => {
    if (!allowOverlay) return;
    if (!latestPlanKey || !hasUnconfirmedPlan) {
      setExpanded(false);
      return;
    }
    if (manuallyMinimizedPlanRef.current === latestPlanKey) return;
    setExpanded(true);
  }, [allowOverlay, hasUnconfirmedPlan, latestPlanKey]);

  useEffect(() => {
    if (
      task?.status === ChatTaskStatus.RUNNING ||
      task?.status === ChatTaskStatus.FINISHED ||
      latestPlanMessage?.isConfirm
    ) {
      setExpanded(false);
    }
  }, [latestPlanMessage?.isConfirm, task?.status]);

  if (!task) return null;

  const isSplitting = isPlanSplittingPhase(task);

  const markDirty = () => chatStore.getState().setPlanDirty(taskId, true);

  const handleAddTask = () => {
    chatStore.getState().addTaskInfo();
  };
  const handleUpdateTask = (index: number, content: string) => {
    chatStore.getState().updateTaskInfo(index, content);
  };
  const handleDeleteTask = (index: number) => {
    chatStore.getState().deleteTaskInfo(index);
  };
  const handleExpand = () => {
    if (!allowOverlay) return;
    setExpanded(true);
  };
  const handleMinimize = () => {
    manuallyMinimizedPlanRef.current = latestPlanKey || null;
    setExpanded(false);
  };

  return (
    <>
      <AnimatePresence mode="popLayout" initial={false}>
        {!expanded && (
          <FoldedView
            key="folded"
            chatStore={chatStore}
            taskId={taskId}
            summaryTask={task.summaryTask || ''}
            taskInfo={task.taskInfo || []}
            streamingDecomposeText={pacedStreamingText}
            isSplitting={isSplitting}
            canExpand={allowOverlay}
            onExpand={handleExpand}
          />
        )}
      </AnimatePresence>

      {overlayRoot && allowOverlay
        ? createPortal(
            <AnimatePresence mode="wait">
              {expanded ? (
                <ExpandedOverlay
                  key="expanded"
                  chatStore={chatStore}
                  taskId={taskId}
                  userPrompt={userPrompt}
                  taskInfo={task.taskInfo || []}
                  streamingDecomposeText={pacedStreamingText}
                  isSplitting={isSplitting}
                  bottomOffsetPx={bottomOffsetPx}
                  onMinimize={handleMinimize}
                  onAddTask={handleAddTask}
                  onUpdateTask={handleUpdateTask}
                  onDeleteTask={handleDeleteTask}
                  onMarkDirty={markDirty}
                />
              ) : null}
            </AnimatePresence>,
            overlayRoot
          )
        : null}
    </>
  );
}
