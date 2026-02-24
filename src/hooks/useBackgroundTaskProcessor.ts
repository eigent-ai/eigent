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

import { proxyUpdateTriggerExecution } from '@/service/triggerApi';
import { useProjectStore } from '@/store/projectStore';
import { useTriggerTaskStore } from '@/store/triggerTaskStore';
import { ChatTaskStatus } from '@/types/constants';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

/** Max concurrent background tasks (pool size) */
const POOL_SIZE = 5;

/** Poll interval in ms */
const POLL_INTERVAL_MS = 2000;

interface ActiveBackgroundTask {
  projectId: string;
  chatTaskId: string;
  executionId: string;
  triggerTaskId?: string;
}

/**
 * Hook that processes background tasks from project queuedMessages.
 * Supports trigger tasks (with executionId) and can be extended for other task types.
 *
 * - Polls all projects' queuedMessages for messages with executionId
 * - Runs up to POOL_SIZE tasks concurrently
 * - Uses appendInitChatStore + startTask for execution (supports same-project parallelism)
 */
export function useBackgroundTaskProcessor() {
  const projectStore = useProjectStore();
  const triggerTaskStore = useTriggerTaskStore();

  const inFlightCountRef = useRef(0);
  const activeTasksRef = useRef<Map<string, ActiveBackgroundTask>>(new Map());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processOneTask = useCallback(async () => {
    if (inFlightCountRef.current >= POOL_SIZE) return;

    const projects = projectStore.getAllProjects();
    let messageToProcess: {
      projectId: string;
      task_id: string;
      content: string;
      attaches: File[];
      executionId: string;
      triggerTaskId?: string;
      triggerId?: number;
      triggerName?: string;
      timestamp: number;
    } | null = null;

    for (const project of projects) {
      const projectData = projectStore.getProjectById(project.id);
      if (!projectData?.queuedMessages?.length) continue;

      const msg = projectData.queuedMessages.find((m) => m.executionId);
      if (msg && msg.executionId) {
        messageToProcess = {
          projectId: project.id,
          task_id: msg.task_id,
          content: msg.content,
          attaches: msg.attaches || [],
          executionId: msg.executionId,
          triggerTaskId: msg.triggerTaskId,
          triggerId: msg.triggerId,
          triggerName: msg.triggerName,
          timestamp: msg.timestamp,
        };
        break;
      }
    }

    if (!messageToProcess) return;

    inFlightCountRef.current++;
    const {
      projectId,
      task_id,
      content,
      attaches,
      executionId,
      triggerTaskId,
      triggerId,
      triggerName,
    } = messageToProcess;

    projectStore.removeQueuedMessage(projectId, task_id);

    try {
      // Run trigger in background: don't switch active chat (preserve user's current task view)
      const newChatResult = projectStore.appendInitChatStore(
        projectId,
        undefined,
        undefined,
        { preserveActiveChat: true, isTrigger: true }
      );
      if (!newChatResult) {
        throw new Error('Failed to create chat store for background task');
      }

      const { taskId: newTaskId, chatStore } = newChatResult;

      activeTasksRef.current.set(executionId, {
        projectId,
        chatTaskId: newTaskId,
        executionId,
        triggerTaskId,
      });

      triggerTaskStore.registerExecutionMapping(
        newTaskId,
        executionId,
        triggerTaskId || task_id,
        projectId,
        triggerName,
        triggerId
      );

      // Notify backend that we're starting - prevents 60s timeout marking as "missed"
      // (WebSocket ack may not reach backend in some cases, e.g. multi-worker, connection issues)
      proxyUpdateTriggerExecution(
        executionId,
        { status: 'running' },
        { projectId, triggerId, triggerName }
      ).catch((err) =>
        console.warn(
          '[BackgroundTaskProcessor] Failed to update execution status to running:',
          err
        )
      );

      // Fire and forget - startTask streams until completion
      chatStore
        .getState()
        .startTask(
          newTaskId,
          undefined,
          undefined,
          undefined,
          content,
          attaches,
          executionId,
          projectId
        )
        .catch((err: any) => {
          console.error(
            '[BackgroundTaskProcessor] Background task error:',
            err
          );
          triggerTaskStore.failTask(
            triggerTaskId || task_id,
            err?.message || 'Task failed',
            { triggerName: triggerName ?? 'Unknown' }
          );
          toast.error('Background task failed', {
            description: err?.message || 'Unknown error',
          });
          inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
          activeTasksRef.current.delete(executionId);
        });

      console.log(
        '[BackgroundTaskProcessor] Started background task:',
        executionId,
        'for project',
        projectId
      );
    } catch (error: any) {
      console.error(
        '[BackgroundTaskProcessor] Failed to start background task:',
        error
      );
      triggerTaskStore.failTask(
        triggerTaskId || task_id,
        error?.message || 'Background task failed',
        { triggerName: triggerName ?? 'Unknown' }
      );
      toast.error('Background task failed', {
        description: error?.message || 'Unknown error',
      });
      inFlightCountRef.current--;
      activeTasksRef.current.delete(executionId);
    }
  }, [projectStore, triggerTaskStore]);

  const checkCompletedTasks = useCallback(() => {
    const toRemove: string[] = [];

    activeTasksRef.current.forEach((task, executionId) => {
      const project = projectStore.getProjectById(task.projectId);
      if (!project?.chatStores) return;

      for (const chatStore of Object.values(project.chatStores)) {
        const state = chatStore.getState();
        const t = state.tasks[task.chatTaskId];
        if (
          t &&
          t.status !== ChatTaskStatus.RUNNING &&
          t.status !== ChatTaskStatus.PAUSE
        ) {
          toRemove.push(executionId);
          break;
        }
      }
    });

    toRemove.forEach((executionId) => {
      activeTasksRef.current.delete(executionId);
      inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
    });
  }, [projectStore]);

  const poll = useCallback(() => {
    checkCompletedTasks();
    processOneTask();
  }, [checkCompletedTasks, processOneTask]);

  useEffect(() => {
    // Run poll immediately on mount - don't wait for first interval
    poll();

    const runPoll = () => {
      poll();
      pollTimerRef.current = setTimeout(runPoll, POLL_INTERVAL_MS);
    };

    pollTimerRef.current = setTimeout(runPoll, POLL_INTERVAL_MS);

    const unsubscribe = useProjectStore.subscribe(() => {
      const state = useProjectStore.getState();
      const hasTriggerTasks = Object.values(state.projects).some((p) =>
        p?.queuedMessages?.some((m) => m.executionId)
      );
      if (hasTriggerTasks) poll();
    });

    return () => {
      unsubscribe();
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [poll]);

  return {
    inFlightCount: inFlightCountRef.current,
    poolSize: POOL_SIZE,
  };
}
