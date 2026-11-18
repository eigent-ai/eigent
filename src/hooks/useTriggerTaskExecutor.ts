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
import i18n from '@/i18n';
import { notifyExecutionError } from '@/lib/notifyError';
import { withoutTriggerPlaceholderTasks } from '@/lib/projectRuntimeHydration';
import { parseServerTimestamp } from '@/lib/serverTimestamp';
import { onSessionWindowMessage } from '@/lib/sessionWindows';
import { triggerExecutionEvent } from '@/lib/triggerExecutionRequests';
import { executionScope } from '@/service/executionApi';
import { createFollowUpRequest } from '@/service/followUpQueueApi';
import {
  proxyFetchPendingExecutions,
  proxyFetchTrigger,
  proxyUpdateTriggerExecution,
} from '@/service/triggerApi';
import { useAuthStore } from '@/store/authStore';
import { useInstallationStore } from '@/store/installationStore';
import {
  ProjectType,
  useProjectRuntimeStore,
  type ProjectRuntimeStore,
} from '@/store/projectRuntimeStore';
import { requireLegacyExecution } from '@/store/sessionExecutionStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useTriggerStore } from '@/store/triggerStore';
import {
  TriggeredTask,
  formatTriggeredTaskMessage,
} from '@/store/triggerTaskStore';
import { ExecutionStatus } from '@/types';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

// Ask the server for executions the websocket did not deliver. The server
// marks an unacknowledged execution missed after about a minute.
const RECONCILE_INTERVAL_MS = 30 * 1000;
// Older pending executions are stale; leave them for the server to close.
const RECONCILE_MAX_AGE_MS = 10 * 60 * 1000;
const ADMITTED_EXECUTION_LIMIT = 500;

function automationProjectName(task: TriggeredTask): string {
  return i18n.t('triggers.automation-project-name', { name: task.triggerName });
}

/**
 * A Session restored from the sidebar has no chat until it is opened. Give the
 * run one without opening the Session; its saved history is merged when the
 * user opens it.
 */
export function ensureRunChatStore(
  store: ProjectRuntimeStore,
  projectId: string
): void {
  if (store.getChatStore(projectId)) return;
  store.updateProject(projectId, {
    metadata: { remoteHistoryHydrationPending: true },
  });
  store.createChatStore(projectId);
}

function automationProjectDescription(task: TriggeredTask): string {
  return i18n.t('triggers.automation-project-description', {
    type: task.triggerType,
  });
}

/**
 * Hook that routes triggered tasks directly to project queuedMessages.
 *
 * When a WebSocket event arrives, this hook:
 * 1. Creates or loads the target project
 * 2. Adds the formatted message to projectStore.queuedMessages
 * 3. useBackgroundTaskProcessor handles execution from there
 */
export function useTriggerTaskExecutor() {
  const projectStore = useProjectRuntimeStore();
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);

  const pendingEventCount = useTriggerStore(
    (state) => state.webSocketEvents.length
  );
  const wsConnectionEpoch = useTriggerStore((state) => state.wsConnectionEpoch);
  // The websocket, Run now and the pending check can all report the same
  // execution; each one starts once.
  const admittedExecutionIds = useRef(new Set<string>());
  const reconciling = useRef(false);
  const reconcileAgain = useRef(false);
  const isBackendReady = useInstallationStore((state) => state.isBackendReady);

  // Keep stable reference to store state
  const projectStoreRef = useRef(projectStore);

  useEffect(() => {
    projectStoreRef.current = projectStore;
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

        // Fetch grouped history to find the project
        const historyProject = await proxyFetchGet(
          `/api/v1/chat/histories/grouped/${projectId}?include_tasks=true`
        );

        const tasks = withoutTriggerPlaceholderTasks<{
          id?: string | number | null;
          task_id?: string | null;
          question?: string | null;
        }>(historyProject?.tasks, projectId);
        if (tasks.length === 0) {
          console.warn(
            '[TriggerTaskExecutor] Project not found in history:',
            projectId
          );
          return false;
        }

        // Get task IDs and question from history
        const taskIdsList = tasks.map((task) => task.task_id);
        const question =
          historyProject.last_prompt ||
          tasks[0]?.question ||
          i18n.t('triggers.trigger-label');
        const historyId = String(tasks[0]?.id || '');

        console.log('[TriggerTaskExecutor] Loading project from history:', {
          projectId,
          taskCount: taskIdsList.length,
          historyId,
        });

        // Use replayProject to load the project from history
        // store.replayProject(taskIdsList, question, projectId, historyId);
        store.createProject(
          i18n.t('triggers.automation-project-name', { name: question }),
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
      toast.info(
        i18n.t('triggers.execution-started-toast', { name: task.triggerName }),
        { description: i18n.t('triggers.execution-started-description') }
      );

      if (task.needsClaim && task.executionId) {
        // No websocket ack was sent for this execution; report the start so
        // the server does not mark it missed while it waits in the queue.
        void proxyUpdateTriggerExecution(
          task.executionId,
          {
            status: ExecutionStatus.Running,
            started_at: new Date().toISOString(),
          },
          {
            triggerId: task.triggerId,
            triggerName: task.triggerName,
            projectId: task.projectId || undefined,
          }
        ).catch((error) =>
          console.warn(
            '[TriggerTaskExecutor] Could not report the execution start:',
            error
          )
        );
      }

      try {
        const store = projectStoreRef.current;
        let targetProjectId = task.projectId;
        if (targetProjectId)
          await requireLegacyExecution(executionScope(targetProjectId));

        if (!targetProjectId) {
          // No project specified, create a new project for this automation.
          const projectName = automationProjectName(task);
          const projectDescription = automationProjectDescription(task);
          targetProjectId = store.createProject(
            projectName,
            projectDescription,
            undefined,
            undefined,
            undefined,
            false,
            { spaceId: task.spaceId || activeSpaceId || undefined }
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
              const projectName = automationProjectName(task);
              const projectDescription = automationProjectDescription(task);
              targetProjectId = store.createProject(
                projectName,
                projectDescription,
                targetProjectId,
                undefined,
                undefined,
                false,
                { spaceId: task.spaceId || activeSpaceId || undefined }
              );
            }
          } else {
            if (task.spaceId && !existingProject.spaceId) {
              store.setProjectSpace(targetProjectId, task.spaceId);
            }
            ensureRunChatStore(store, targetProjectId);
          }
        }

        // Format the message with all context
        const formattedMessage = formatTriggeredTaskMessage(task);

        const durableRequestId = `scheduled:${task.executionId || task.id}`;
        await createFollowUpRequest({
          projectId: targetProjectId,
          requestId: durableRequestId,
          content: formattedMessage,
          attachmentPaths: [],
          source: 'scheduled',
        });

        // The renderer mirrors the durable Brain queue for immediate UI. It
        // is not the authority and may be rebuilt after a restart.
        const queuedTaskId = store.addQueuedMessage(
          targetProjectId,
          formattedMessage,
          [],
          durableRequestId,
          task.executionId,
          undefined,
          task.triggerId,
          task.triggerName,
          'scheduled'
        );

        if (!queuedTaskId) {
          throw new Error(
            i18n.t('triggers.queue-add-failed', {
              defaultValue: 'Failed to add the task to the session queue',
            })
          );
        }

        toast.success(
          i18n.t('triggers.task-queued', {
            defaultValue: 'Queued: {{name}}',
            name: task.triggerName,
          }),
          {
            description: i18n.t('triggers.task-queued-description', {
              defaultValue: 'Task has been added to the session queue',
            }),
          }
        );

        console.log(
          '[TriggerTaskExecutor] Task queued successfully:',
          task.id,
          '-> queuedTaskId:',
          queuedTaskId
        );
      } catch (error: any) {
        console.error('[TriggerTaskExecutor] Task queueing failed:', error);
        notifyExecutionError(
          i18n.t('triggers.execution-failed-toast', { name: task.triggerName }),
          {
            description:
              error?.message ||
              i18n.t('layout.unknown-error', {
                defaultValue: 'Unknown error',
              }),
          }
        );
      }
    },
    [activeSpaceId, loadProjectFromHistory]
  );

  const admitExecution = useCallback((executionId: string): boolean => {
    if (!executionId) return true;
    const admitted = admittedExecutionIds.current;
    if (admitted.has(executionId)) return false;
    admitted.add(executionId);
    if (admitted.size > ADMITTED_EXECUTION_LIMIT) {
      admitted.delete(admitted.values().next().value as string);
    }
    return true;
  }, []);

  // Watch for new tasks via WebSocket events and route to projectStore
  useEffect(() => {
    if (!pendingEventCount) return;
    for (const event of useTriggerStore.getState().takeWebSocketEvents()) {
      if (!admitExecution(event.executionId)) {
        console.log(
          '[TriggerTaskExecutor] Execution already started:',
          event.executionId
        );
        continue;
      }
      console.log(
        '[TriggerTaskExecutor] WebSocket event received:',
        event.executionId
      );

      const task: TriggeredTask = {
        id: `triggered-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        triggerId: event.triggerId,
        triggerName: event.triggerName,
        taskPrompt: event.taskPrompt,
        executionId: event.executionId,
        triggerType: event.triggerType,
        projectId: event.projectId,
        spaceId: event.spaceId,
        inputData: event.inputData,
        timestamp: Date.now(),
        needsClaim: event.needsClaim,
      };

      // Execute the task (adds to projectStore queuedMessages)
      void executeTask(task);
    }
  }, [pendingEventCount, admitExecution, executeTask]);

  /** Start executions that were created but never reached this app. */
  const reconcilePendingExecutions = useCallback(async () => {
    // Claiming an execution the Brain cannot queue yet would lose it; wait.
    if (
      !useAuthStore.getState().token ||
      !useInstallationStore.getState().isBackendReady
    )
      return;
    if (reconciling.current) {
      reconcileAgain.current = true;
      return;
    }
    reconciling.current = true;
    try {
      do {
        reconcileAgain.current = false;
        const now = Date.now();
        for (const execution of await proxyFetchPendingExecutions()) {
          if (admittedExecutionIds.current.has(execution.execution_id))
            continue;
          const age = now - parseServerTimestamp(execution.created_at);
          if (!(age <= RECONCILE_MAX_AGE_MS)) continue;
          try {
            const store = useTriggerStore.getState();
            const trigger =
              store.getTriggerById(execution.trigger_id) ??
              (await proxyFetchTrigger(execution.trigger_id));
            console.log(
              '[TriggerTaskExecutor] Starting an execution the websocket missed:',
              execution.execution_id
            );
            store.emitWebSocketEvent(
              triggerExecutionEvent(
                trigger,
                execution.execution_id,
                execution.input_data || {}
              )
            );
          } catch (error) {
            // One deleted or unreadable Automation must not hold up the rest.
            console.warn(
              '[TriggerTaskExecutor] Could not load the Automation for a pending execution:',
              execution.execution_id,
              error
            );
          }
        }
      } while (reconcileAgain.current);
    } catch (error) {
      console.warn(
        '[TriggerTaskExecutor] Could not check for pending executions:',
        error
      );
    } finally {
      reconciling.current = false;
    }
  }, []);

  // Run now and pending executions are only started in this window.
  useEffect(() => {
    const store = useTriggerStore.getState();
    store.setExecutionAdmissionAvailable(true);
    return () => store.setExecutionAdmissionAvailable(false);
  }, []);

  // Check after every subscribe, on a request from another window, and on a
  // timer for events lost while the socket looked connected.
  useEffect(() => {
    void reconcilePendingExecutions();
  }, [wsConnectionEpoch, isBackendReady, reconcilePendingExecutions]);

  useEffect(() => {
    const timer = setInterval(
      () => void reconcilePendingExecutions(),
      RECONCILE_INTERVAL_MS
    );
    const stopListening = onSessionWindowMessage((message) => {
      if (message.type === 'trigger-executions-requested')
        void reconcilePendingExecutions();
    });
    return () => {
      clearInterval(timer);
      stopListening();
    };
  }, [reconcilePendingExecutions]);

  return {
    /** Manually trigger a task execution (useful for testing) */
    executeTask,
  };
}
