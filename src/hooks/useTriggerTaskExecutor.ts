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
import { ProjectType, useProjectStore } from '@/store/projectStore';
import { useTriggerStore } from '@/store/triggerStore';
import {
  TriggeredTask,
  formatTriggeredTaskMessage,
} from '@/store/triggerTaskStore';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * Hook that routes triggered tasks directly to project queuedMessages.
 *
 * When a WebSocket event arrives, this hook:
 * 1. Creates or loads the target project
 * 2. Adds the formatted message to projectStore.queuedMessages
 * 3. useBackgroundTaskProcessor handles execution from there
 */
export function useTriggerTaskExecutor() {
  const projectStore = useProjectStore();

  // Subscribe specifically to webSocketEvent to ensure re-renders when it changes
  const webSocketEvent = useTriggerStore((state) => state.webSocketEvent);
  const clearWebSocketEvent = useTriggerStore(
    (state) => state.clearWebSocketEvent
  );

  // Keep stable reference to store state
  const projectStoreRef = useRef(projectStore);

  useEffect(() => {
    projectStoreRef.current = projectStore;
  });

  /**
   * Helper function to load a project from history if it doesn't exist locally.
   * Similar to handleSetActive in HistorySidebar.
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

        // Fetch grouped history to find the project
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

        // Get task IDs and question from history
        const taskIdsList = historyProject.tasks.map(
          (task: any) => task.task_id
        );
        const question =
          historyProject.last_prompt ||
          historyProject.tasks[0]?.question ||
          'Triggered task';
        const historyId = String(historyProject.tasks[0]?.id || '');

        console.log('[TriggerTaskExecutor] Loading project from history:', {
          projectId,
          taskCount: taskIdsList.length,
          historyId,
        });

        // Use replayProject to load the project from history
        // store.replayProject(taskIdsList, question, projectId, historyId);
        store.createProject(
          `Trigger Project ${question}`,
          `No tasks to replay`,
          projectId,
          ProjectType.NORMAL,
          historyId,
          false
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
   * Execute a triggered task by:
   * 1. Creating or selecting a project (loading from history if needed)
   * 2. Adding the message to the project's queue via addQueuedMessage
   * 3. ChatBox will consume and process the queued message via handleSend
   */
  const executeTask = useCallback(
    async (task: TriggeredTask) => {
      console.log(
        '[TriggerTaskExecutor] Executing task:',
        task.id,
        task.triggerName
      );

      // Show toast when execution starts
      toast.info(`Execution started: ${task.triggerName}`, {
        description: 'Processing trigger task...',
      });

      try {
        const store = projectStoreRef.current;
        let targetProjectId = task.projectId;

        if (!targetProjectId) {
          // No project specified, create a new project for this trigger
          const projectName = `Trigger: ${task.triggerName}`;
          const projectDescription = `Auto-created project for ${task.triggerType} trigger execution`;
          targetProjectId = store.createProject(
            projectName,
            projectDescription,
            undefined,
            undefined,
            undefined,
            false
          );
          console.log(
            '[TriggerTaskExecutor] Created new project:',
            targetProjectId
          );
        } else {
          // Project ID is specified, check if it exists locally
          const existingProject = store.getProjectById(targetProjectId);

          if (!existingProject) {
            // Project doesn't exist locally, try to load from history
            const loaded = await loadProjectFromHistory(targetProjectId, store);

            if (!loaded) {
              console.log(
                '[TriggerTaskExecutor] Creating new project for specified ID:',
                targetProjectId
              );
              const projectName = `Trigger: ${task.triggerName}`;
              const projectDescription = `Auto-created project for ${task.triggerType} trigger execution`;
              targetProjectId = store.createProject(
                projectName,
                projectDescription,
                targetProjectId,
                undefined,
                undefined,
                false
              );
            }
          }
        }

        // Format the message with all context
        const formattedMessage = formatTriggeredTaskMessage(task);

        // Add message directly to projectStore's queuedMessages
        // useBackgroundTaskProcessor will pick it up and execute it
        const queuedTaskId = store.addQueuedMessage(
          targetProjectId,
          formattedMessage,
          [],
          undefined,
          task.executionId,
          undefined,
          task.triggerId,
          task.triggerName
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
        toast.error(`Trigger failed: ${task.triggerName}`, {
          description: error?.message || 'Unknown error',
        });
      }
    },
    [loadProjectFromHistory]
  );

  // Watch for new tasks via WebSocket events and route to projectStore
  useEffect(() => {
    if (webSocketEvent) {
      console.log(
        '[TriggerTaskExecutor] WebSocket event received:',
        webSocketEvent.executionId
      );

      const task: TriggeredTask = {
        id: `triggered-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        triggerId: webSocketEvent.triggerId,
        triggerName: webSocketEvent.triggerName,
        taskPrompt: webSocketEvent.taskPrompt,
        executionId: webSocketEvent.executionId,
        triggerType: webSocketEvent.triggerType,
        projectId: webSocketEvent.projectId,
        inputData: webSocketEvent.inputData,
        timestamp: Date.now(),
      };

      // Clear the event after processing
      clearWebSocketEvent();

      // Execute the task (adds to projectStore queuedMessages)
      executeTask(task);
    }
  }, [webSocketEvent, clearWebSocketEvent, executeTask]);

  return {
    /** Manually trigger a task execution (useful for testing) */
    executeTask,
  };
}
