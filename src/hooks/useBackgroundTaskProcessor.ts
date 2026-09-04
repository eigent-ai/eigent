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

import { fetchGet, fetchPost } from '@/api/http';
import i18n from '@/i18n';
import { generateUniqueId } from '@/lib';
import { proxyUpdateTriggerExecution } from '@/service/triggerApi';
import {
  closeIdleSSEConnectionsForTasks,
  hasActiveSSEConnection,
  hasSSETransportForTasks,
} from '@/store/chatStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useTriggerTaskStore } from '@/store/triggerTaskStore';
import { ExecutionStatus } from '@/types';
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

/** Poll interval in ms */
const POLL_INTERVAL_MS = 2000;

interface ActiveBackgroundTask {
  projectId: string;
  chatTaskId: string;
  executionId: string;
  triggerTaskId?: string;
}

interface LegacyChatRuntimeStatus {
  status?: string;
  run_id?: string | null;
  consumer_alive?: boolean;
}

/**
 * Hook that processes background tasks from project queuedMessages.
 * Supports trigger tasks (with executionId) and can be extended for other task types.
 *
 * - Polls all projects' queuedMessages for messages with executionId
 * - Retires an idle Project consumer before cold start
 */
export function useBackgroundTaskProcessor() {
  const projectStore = useProjectRuntimeStore();
  const triggerTaskStore = useTriggerTaskStore();

  const activeTasksRef = useRef<Map<string, ActiveBackgroundTask>>(new Map());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessingRef = useRef(false);

  const processOneTask = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    try {
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
        const msg = projectData.queuedMessages.find(
          (queuedMessage) =>
            queuedMessage.executionId && !queuedMessage.processing
        );
        if (!msg?.executionId) continue;

        // Per-project concurrency: skip if this project already has an active background task
        const hasActiveBackgroundTask = Array.from(
          activeTasksRef.current.values()
        ).some((t) => t.projectId === project.id);
        if (hasActiveBackgroundTask) {
          console.log(
            '[BackgroundTaskProcessor] Skipping project',
            project.id,
            '- already has an active background task'
          );
          continue;
        }

        // Also check if any chat in this project has a running/paused task
        const hasRunningChatTask = Object.values(
          projectData.chatStores || {}
        ).some((cs) => {
          const state = cs.getState();
          return Object.values(state.tasks).some(
            (t) =>
              t.status === ChatTaskStatus.RUNNING ||
              t.status === ChatTaskStatus.PAUSE ||
              // splitting phase
              t.messages.some(
                (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
              ) ||
              // skeleton/computing phase
              (!t.messages.find((m) => m.step === AgentStep.TO_SUB_TASKS) &&
                !t.hasWaitComfirm &&
                t.messages.length > 0) ||
              t.isTakeControl
          );
        });

        if (hasRunningChatTask) {
          console.log(
            '[BackgroundTaskProcessor] Skipping project',
            project.id,
            '- has a running/paused chat task',
            hasRunningChatTask
          );
          continue;
        }

        // A logically active Run blocks queued trigger processing. Browser SSE
        // ownership and the backend TaskLock consumer have separate lifetimes,
        // so both must be resolved before admitting a scheduled Run.
        const allTaskIds = Object.values(projectData.chatStores || {}).flatMap(
          (cs) => Object.keys(cs.getState().tasks)
        );
        if (hasActiveSSEConnection(allTaskIds)) {
          console.log(
            '[BackgroundTaskProcessor] Skipping project',
            project.id,
            '- SSE Run still logically active'
          );
          continue;
        }

        let runtimeStatus: LegacyChatRuntimeStatus;
        try {
          runtimeStatus = await fetchGet(
            `/chat/${encodeURIComponent(project.id)}/status`
          );
        } catch (error) {
          console.warn(
            '[BackgroundTaskProcessor] Skipping project',
            project.id,
            '- could not verify legacy runtime ownership',
            error
          );
          continue;
        }

        if (runtimeStatus.consumer_alive) {
          if (runtimeStatus.status !== 'done' || !runtimeStatus.run_id) {
            console.log(
              '[BackgroundTaskProcessor] Skipping project',
              project.id,
              '- backend legacy Run is not idle'
            );
            continue;
          }

          // subscriber_count is only a point-in-time observation. Reusing a
          // warm consumer would race a renderer disconnect between this read
          // and follow-up admission, leaving the new Run without either the
          // legacy stream or a canonical terminal observer. Scheduled work
          // therefore retires the idle consumer before opening a fresh stream.
          let retired: LegacyChatRuntimeStatus;
          try {
            retired = await fetchPost(
              `/chat/${encodeURIComponent(project.id)}/runtime/retire-idle`,
              { run_id: runtimeStatus.run_id }
            );
          } catch (error) {
            console.warn(
              '[BackgroundTaskProcessor] Skipping project',
              project.id,
              '- could not retire the backend idle consumer',
              error
            );
            continue;
          }
          if (retired?.consumer_alive) {
            console.warn(
              '[BackgroundTaskProcessor] Skipping project',
              project.id,
              '- backend idle consumer did not retire'
            );
            continue;
          }
        }

        if (hasSSETransportForTasks(allTaskIds)) {
          console.log(
            '[BackgroundTaskProcessor] Closing idle SSE for project',
            project.id,
            '- backend consumer is retired'
          );
          closeIdleSSEConnectionsForTasks(allTaskIds);
          if (hasSSETransportForTasks(allTaskIds)) {
            console.warn(
              '[BackgroundTaskProcessor] Skipping project',
              project.id,
              '- idle SSE cleanup did not release the transport'
            );
            continue;
          }
        }

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

      if (!messageToProcess) return;

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

      const newTaskId = generateUniqueId();

      // Track BEFORE markQueuedMessageAsProcessing — that call triggers
      // projectStore subscription → poll() → processOneTask() re-entrancy.
      // Having the guard set first ensures the per-project concurrency check
      // blocks any re-entrant attempt.
      activeTasksRef.current.set(executionId, {
        projectId,
        chatTaskId: newTaskId,
        executionId,
        triggerTaskId,
      });

      projectStore.markQueuedMessageAsProcessing(projectId, task_id);

      console.log(
        '[BackgroundTaskProcessor] Marked message as processing:',
        task_id,
        'executionId:',
        executionId
      );

      try {
        // Get the latest project's chatStore
        const chatStore = projectStore.getChatStore(projectId);
        if (!chatStore) {
          throw new Error('Failed to get chat store for background task');
        }

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

        const admissionPromise = chatStore
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
          );

        // Fire and forget - task state and canonical ingress track completion.
        admissionPromise
          .then(() => {
            console.log(
              '[BackgroundTaskProcessor] Background task completed:',
              executionId
            );
            // Remove from queue after successful completion
            projectStore.removeQueuedMessage(projectId, task_id);
            activeTasksRef.current.delete(executionId);
          })
          .catch((err: any) => {
            console.error(
              '[BackgroundTaskProcessor] Background task error:',
              err
            );
            // Remove from queue on error as well
            projectStore.removeQueuedMessage(projectId, task_id);
            // Report failure to backend
            proxyUpdateTriggerExecution(
              executionId,
              {
                status: ExecutionStatus.Failed,
                error_message: err?.message || 'Task failed',
              },
              { projectId, triggerId, triggerName }
            ).catch((e) =>
              console.warn(
                '[BackgroundTaskProcessor] Failed to report error status:',
                e
              )
            );
            toast.error(
              i18n.t('triggers.background-task-failed', {
                defaultValue: 'Background task failed',
              }),
              {
                description:
                  err?.message ||
                  i18n.t('layout.unknown-error', {
                    defaultValue: 'Unknown error',
                  }),
              }
            );
            activeTasksRef.current.delete(executionId);
          });

        console.log(
          '[BackgroundTaskProcessor] Started background task:',
          executionId,
          'for project',
          projectId
        );

        console.log(
          '[BackgroundTaskProcessor] Current active tasks:',
          Array.from(activeTasksRef.current.keys())
        );
      } catch (error: any) {
        console.error(
          '[BackgroundTaskProcessor] Failed to start background task:',
          error
        );
        // Remove from queue on error
        projectStore.removeQueuedMessage(projectId, task_id);
        // Report failure to backend
        proxyUpdateTriggerExecution(
          executionId,
          {
            status: ExecutionStatus.Failed,
            error_message: error?.message || 'Background task failed',
          },
          { projectId, triggerId, triggerName }
        ).catch((e) =>
          console.warn(
            '[BackgroundTaskProcessor] Failed to report error status:',
            e
          )
        );
        toast.error(
          i18n.t('triggers.background-task-failed', {
            defaultValue: 'Background task failed',
          }),
          {
            description:
              error?.message ||
              i18n.t('layout.unknown-error', {
                defaultValue: 'Unknown error',
              }),
          }
        );
        activeTasksRef.current.delete(executionId);
      }
    } finally {
      isProcessingRef.current = false;
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
        if (t) {
          if (
            t.status !== ChatTaskStatus.RUNNING &&
            t.status !== ChatTaskStatus.PAUSE
          ) {
            toRemove.push(executionId);
          }
          break;
        }
      }
    });

    toRemove.forEach((executionId) => {
      activeTasksRef.current.delete(executionId);
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

    const unsubscribe = useProjectRuntimeStore.subscribe(() => {
      const state = useProjectRuntimeStore.getState();
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
}
