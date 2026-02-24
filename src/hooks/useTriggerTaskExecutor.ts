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

import { proxyFetchGet } from '@/api/http';
import { proxyFetchListExecutions } from '@/service/triggerApi';
import { ProjectType, useProjectStore } from '@/store/projectStore';
import { useTriggerStore } from '@/store/triggerStore';
import {
  TriggeredTask,
  formatTriggeredTaskMessage,
  useTriggerTaskStore,
} from '@/store/triggerTaskStore';
import { ExecutionStatus } from '@/types';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * Hook that queues triggered tasks to their target projects.
 *
 * This provides a modular way to enqueue tasks from:
 * - Webhook triggers
 * - Scheduled triggers
 * - Future: per-project triggers
 *
 * Tasks are added directly to projectStore.queuedMessages (per-project queue).
 * Background execution is handled by useBackgroundTaskProcessor.
 */
export function useTriggerTaskExecutor() {
  const projectStore = useProjectStore();
  const triggerTaskStore = useTriggerTaskStore();

  // Subscribe specifically to webSocketEvent to ensure re-renders when it changes
  const webSocketEvent = useTriggerStore((state) => state.webSocketEvent);
  const clearWebSocketEvent = useTriggerStore(
    (state) => state.clearWebSocketEvent
  );

  const projectStoreRef = useRef(projectStore);
  const triggerTaskStoreRef = useRef(triggerTaskStore);
  const emitWebSocketEvent = useTriggerStore((s) => s.emitWebSocketEvent);
  const triggers = useTriggerStore((s) => s.triggers);

  useEffect(() => {
    projectStoreRef.current = projectStore;
    triggerTaskStoreRef.current = triggerTaskStore;
  });

  /**
   * Helper function to load a project from history if it doesn't exist locally.
   */
  const loadProjectFromHistory = useCallback(
    async (
      projectId: string,
      store: typeof projectStoreRef.current
    ): Promise<boolean> => {
      try {
        console.log(
          '[TriggerTaskExecutor] Project not found locally, attempting to load from history:',
          projectId
        );

        const historyProject = await proxyFetchGet(
          `/api/chat/histories/grouped/${projectId}?include_tasks=true`
        );

        if (!historyProject) {
          console.warn(
            '[TriggerTaskExecutor] Project not found in history:',
            projectId
          );
          return false;
        }

        const question =
          historyProject.last_prompt ||
          historyProject.tasks[0]?.question ||
          'Triggered task';
        const historyId = String(historyProject.tasks[0]?.id || '');

        store.createProject(
          `Trigger Project ${question}`,
          `No tasks to replay`,
          projectId,
          ProjectType.NORMAL,
          historyId
        );

        return true;
      } catch (error) {
        console.error(
          '[TriggerTaskExecutor] Failed to load project from history:',
          error
        );
        return false;
      }
    },
    []
  );

  /**
   * Add a triggered task directly to projectStore.queuedMessages.
   * No intermediate queue - projectStore.queuedMessages is the single source of truth.
   */
  const executeTask = useCallback(
    async (task: TriggeredTask) => {
      console.log(
        '[TriggerTaskExecutor] Executing task:',
        task.id,
        task.triggerName
      );

      toast.info(`Execution started: ${task.triggerName}`, {
        description: 'Processing trigger task...',
      });

      try {
        const store = projectStoreRef.current;
        let targetProjectId = task.projectId;

        if (!targetProjectId) {
          const projectName = `Trigger: ${task.triggerName}`;
          const projectDescription = `Auto-created project for ${task.triggerType} trigger execution`;
          targetProjectId = store.createProject(
            projectName,
            projectDescription,
            undefined,
            undefined,
            undefined,
            { setAsActive: false }
          );
        } else {
          const existingProject = store.getProjectById(targetProjectId);

          if (!existingProject) {
            const loaded = await loadProjectFromHistory(targetProjectId, store);

            if (!loaded) {
              const projectName = `Trigger: ${task.triggerName}`;
              const projectDescription = `Auto-created project for ${task.triggerType} trigger execution`;
              targetProjectId = store.createProject(
                projectName,
                projectDescription,
                targetProjectId,
                undefined,
                undefined,
                { setAsActive: false }
              );
            }
          }
        }

        const formattedMessage = formatTriggeredTaskMessage(task);

        const queuedTaskId = store.addQueuedMessage(
          targetProjectId,
          formattedMessage,
          [],
          {
            executionId: task.executionId,
            triggerTaskId: task.id,
            triggerId: task.triggerId,
            triggerName: task.triggerName,
          }
        );

        if (!queuedTaskId) {
          throw new Error('Failed to add message to project queue');
        }

        toast.success(`Queued: ${task.triggerName}`, {
          description: 'Task has been added to the project queue',
        });

        console.log(
          '[TriggerTaskExecutor] Task queued successfully:',
          task.id,
          '-> queuedTaskId:',
          queuedTaskId
        );
      } catch (error: any) {
        console.error('[TriggerTaskExecutor] Task queueing failed:', error);
        triggerTaskStoreRef.current.failTask(
          task.id,
          error?.message || 'Queueing failed',
          { triggerName: task.triggerName }
        );
        toast.error(`Trigger failed: ${task.triggerName}`, {
          description: error?.message || 'Unknown error',
        });
      }
    },
    [loadProjectFromHistory]
  );

  // Watch for new tasks added via WebSocket events
  useEffect(() => {
    if (!webSocketEvent) return;

    console.log(
      '[TriggerTaskExecutor] WebSocket event received:',
      webSocketEvent
    );

    const triggerTaskStore = useTriggerTaskStore.getState();

    const triggerTaskId = `triggered-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Check for duplicate event_id (Slack deduplication)
    const eventId = webSocketEvent.inputData?.event_id;
    if (eventId && triggerTaskStore.hasEventIdProcessed(eventId)) {
      console.warn(
        '[TriggerTaskExecutor] Duplicate event_id detected:',
        eventId
      );
      triggerTaskStore.recordFailedTask(
        triggerTaskId,
        webSocketEvent.triggerName,
        `Duplicate event_id: ${eventId}`,
        ExecutionStatus.Missed
      );
      clearWebSocketEvent();
      return;
    }
    if (eventId) {
      triggerTaskStore.registerEventId(eventId);
    }

    const task: TriggeredTask = {
      id: triggerTaskId,
      triggerId: webSocketEvent.triggerId,
      triggerName: webSocketEvent.triggerName,
      taskPrompt: webSocketEvent.taskPrompt,
      executionId: webSocketEvent.executionId,
      triggerType: webSocketEvent.triggerType,
      projectId: webSocketEvent.projectId,
      inputData: webSocketEvent.inputData ?? {},
      timestamp: Date.now(),
      status: 'pending' as any,
      formattedMessage: formatTriggeredTaskMessage({
        id: triggerTaskId,
        triggerId: webSocketEvent.triggerId,
        triggerName: webSocketEvent.triggerName,
        taskPrompt: webSocketEvent.taskPrompt,
        executionId: webSocketEvent.executionId,
        triggerType: webSocketEvent.triggerType,
        projectId: webSocketEvent.projectId,
        inputData: webSocketEvent.inputData ?? {},
        timestamp: Date.now(),
        status: 'pending' as any,
      }),
    };

    clearWebSocketEvent();

    queueMicrotask(() => {
      executeTask(task);
    });
  }, [webSocketEvent, clearWebSocketEvent, executeTask]);

  // Polling fallback: fetch pending executions when WebSocket may have missed them
  useEffect(() => {
    const POLL_INTERVAL_MS = 15_000; // 15 seconds
    let timer: ReturnType<typeof setTimeout>;

    const pollPendingExecutions = async () => {
      try {
        const res = await proxyFetchListExecutions({
          status: 'pending',
          page: 1,
          size: 20,
        });
        const items = res?.items ?? [];
        if (items.length === 0) return;

        const projectState = useProjectStore.getState();
        const triggerStore = useTriggerTaskStore.getState();
        for (const exec of items) {
          const executionId = exec.execution_id;
          const triggerId = exec.trigger_id;

          // Skip if already queued or running
          const alreadyQueued = Object.values(projectState.projects ?? {}).some(
            (p) => p?.queuedMessages?.some((m) => m.executionId === executionId)
          );
          const alreadyMapped =
            triggerStore.getExecutionMappingByExecutionId(executionId);
          if (alreadyQueued || alreadyMapped) continue;

          const trigger = triggers.find((t) => t.id === triggerId);
          const triggerName =
            trigger?.name ?? exec.trigger_name ?? `Trigger #${triggerId}`;
          const taskPrompt =
            exec.task_prompt ?? trigger?.task_prompt ?? 'Triggered task';
          const projectId = exec.project_id ?? trigger?.project_id ?? null;

          console.log(
            '[TriggerTaskExecutor] Polling fallback: queueing pending execution',
            executionId
          );
          emitWebSocketEvent({
            triggerId,
            triggerName,
            taskPrompt,
            executionId,
            timestamp: Date.now(),
            triggerType: (exec.trigger_type ??
              exec.execution_type ??
              'schedule') as any,
            projectId: projectId ? String(projectId) : null,
            inputData: exec.input_data ?? {},
          });
          break; // Process one at a time
        }
      } catch (err) {
        console.warn(
          '[TriggerTaskExecutor] Polling pending executions failed:',
          err
        );
      }
    };

    timer = setTimeout(function run() {
      pollPendingExecutions();
      timer = setTimeout(run, POLL_INTERVAL_MS);
    }, 5000); // First poll after 5s

    return () => clearTimeout(timer);
  }, [triggers, emitWebSocketEvent]);

  return {
    executeTask,
    taskHistory: triggerTaskStore.taskHistory,
  };
}
