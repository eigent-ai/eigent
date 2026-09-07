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

import {
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
} from '@/api/http';
import {
  recordFeatureUsed,
  recordScheduledTriggerCreated,
} from '@/lib/events/appEvents';
import { ActivityType, useActivityLogStore } from '@/store/activityLogStore';
import {
  ExecutionStatus,
  SkipReason,
  Trigger,
  TriggerInput,
  TriggerStatus,
  TriggerType,
  TriggerUpdate,
} from '@/types';

// Helper function to update or add execution log
const updateExecutionLog = (
  executionId: string,
  activityType: ActivityType,
  message: string,
  triggerInfo?: {
    triggerId?: number;
    triggerName?: string;
    projectId?: string;
  },
  metadata?: Record<string, any>
) => {
  const { addLog, modifyLog } = useActivityLogStore.getState();

  const logData = {
    type: activityType,
    message,
    ...(triggerInfo?.triggerId !== undefined && {
      triggerId: triggerInfo.triggerId,
    }),
    ...(triggerInfo?.triggerName !== undefined && {
      triggerName: triggerInfo.triggerName,
    }),
    ...(triggerInfo?.projectId !== undefined && {
      projectId: triggerInfo.projectId,
    }),
    metadata,
  };

  const updated = modifyLog(executionId, logData);

  if (!updated) {
    addLog({
      ...logData,
      executionId,
    });
  }
};

// ==== Proxy API calls (for server) ====

export const proxyFetchTriggers = async (
  triggerType?: TriggerType,
  status?: TriggerStatus,
  page: number = 1,
  size: number = 20
) => {
  try {
    const params: Record<string, any> = {
      page,
      size,
    };

    if (triggerType !== undefined) {
      params.trigger_type = triggerType;
    }

    if (status !== undefined) {
      params.status = status;
    }

    const res = await proxyFetchGet(`/api/v1/trigger/`, params);
    return res;
  } catch (error) {
    console.error('Failed to fetch triggers:', error);
    throw error;
  }
};

export const proxyFetchProjectTriggers = async (
  project_id: string | null,
  triggerType?: TriggerType,
  status?: TriggerStatus,
  page: number = 1,
  size: number = 50
) => {
  try {
    const params: Record<string, any> = {
      page,
      size,
      project_id,
    };

    if (triggerType !== undefined) {
      params.trigger_type = triggerType;
    }

    if (status !== undefined) {
      params.status = status;
    }

    if (!project_id) {
      throw new Error('Project ID is required to fetch project triggers.');
    }

    const res = await proxyFetchGet(`/api/v1/trigger/`, params);
    return res;
  } catch (error) {
    console.error('Failed to fetch triggers:', error);
    throw error;
  }
};

export const proxyFetchTrigger = async (
  triggerId: number
): Promise<Trigger> => {
  try {
    const res = await proxyFetchGet(`/api/v1/trigger/${triggerId}`);
    return res;
  } catch (error) {
    console.error('Failed to fetch trigger:', error);
    throw error;
  }
};

export const proxyFetchTriggerConfig = async (triggerType: TriggerType) => {
  try {
    const res = await proxyFetchGet(`/api/v1/trigger/${triggerType}/config`);
    return res;
  } catch (error) {
    console.error('Failed to fetch trigger config:', error);
    throw error;
  }
};

export const proxyCreateTrigger = async (
  triggerData: TriggerInput
): Promise<Trigger> => {
  try {
    const res = await proxyFetchPost(`/api/v1/trigger/`, triggerData);
    recordScheduledTriggerCreated({
      trigger_type: triggerData.trigger_type,
      schedule: triggerData.custom_cron_expression,
      is_single_execution: triggerData.is_single_execution,
    });
    recordFeatureUsed('triggers', { action: 'create' });
    return res;
  } catch (error) {
    console.error('Failed to create trigger:', error);
    throw error;
  }
};

export const proxyUpdateTrigger = async (
  triggerId: number,
  updateData: TriggerUpdate
): Promise<Trigger> => {
  try {
    const res = await proxyFetchPut(`/api/v1/trigger/${triggerId}`, updateData);
    return res;
  } catch (error) {
    console.error('Failed to update trigger:', error);
    throw error;
  }
};

export const proxyDeleteTrigger = async (triggerId: number): Promise<void> => {
  try {
    await proxyFetchDelete(`/api/v1/trigger/${triggerId}`);
  } catch (error) {
    console.error('Failed to delete trigger:', error);
    throw error;
  }
};

export const proxyActivateTrigger = async (
  triggerId: number
): Promise<Trigger> => {
  try {
    const res = await proxyFetchPost(`/api/v1/trigger/${triggerId}/activate`);
    return res;
  } catch (error) {
    console.error('Failed to activate trigger:', error);
    throw error;
  }
};

export const proxyDeactivateTrigger = async (
  triggerId: number
): Promise<Trigger> => {
  try {
    const res = await proxyFetchPost(`/api/v1/trigger/${triggerId}/deactivate`);
    return res;
  } catch (error) {
    console.error('Failed to deactivate trigger:', error);
    throw error;
  }
};

// Trigger Executions
export const proxyFetchTriggerExecutions = async (
  triggerId: number,
  page: number = 1,
  size: number = 20
) => {
  try {
    const params = {
      page,
      size,
    };

    const res = await proxyFetchGet(
      `/api/v1/trigger/${triggerId}/executions`,
      params
    );
    return res;
  } catch (error) {
    console.error('Failed to fetch trigger executions:', error);
    throw error;
  }
};

type TriggerExecutionUpdateData = Partial<{
  status?: string;
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  output_data?: Record<string, any>;
  error_message?: string;
  skip_reason?: SkipReason;
  attempts?: number;
  tokens_used?: number;
  tools_executed?: Record<string, any>;
}>;

type TriggerExecutionInfo = {
  triggerId?: number;
  triggerName?: string;
  projectId?: string;
};

type PendingTerminalExecutionUpdate = {
  executionId: string;
  updateData: TriggerExecutionUpdateData;
  triggerInfo?: TriggerExecutionInfo;
  queuedAt: number;
};

const TERMINAL_EXECUTION_OUTBOX_KEY = 'eigent.trigger-terminal-outbox.v1';
const TERMINAL_EXECUTION_RETRY_DELAYS_MS = [250, 1_000] as const;
const terminalExecutionStatuses = new Set<string>([
  ExecutionStatus.Completed,
  ExecutionStatus.Failed,
  ExecutionStatus.Cancelled,
  ExecutionStatus.Missed,
]);
const acceptedTerminalStatusByExecutionId = new Map<string, string>();
const pendingTerminalExecutionUpdates = new Map<
  string,
  PendingTerminalExecutionUpdate
>();
const triggerExecutionUpdateChains = new Map<string, Promise<void>>();
const terminalDeliveryChains = new Map<string, Promise<void>>();
let terminalOutboxLoaded = false;
let recoveryListenersInstalled = false;

const waitForTriggerExecutionRetry = (delayMs: number) =>
  new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs));

const isTerminalExecutionStatus = (status?: string): status is string =>
  Boolean(status && terminalExecutionStatuses.has(status));

const loadTerminalExecutionOutbox = () => {
  if (terminalOutboxLoaded) return;
  terminalOutboxLoaded = true;
  if (typeof window === 'undefined') return;

  try {
    const raw = window.localStorage.getItem(TERMINAL_EXECUTION_OUTBOX_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const candidate of parsed) {
      if (!candidate || typeof candidate !== 'object') continue;
      const record = candidate as PendingTerminalExecutionUpdate;
      const status = record.updateData?.status;
      if (
        typeof record.executionId !== 'string' ||
        !record.executionId ||
        !isTerminalExecutionStatus(status)
      ) {
        continue;
      }
      pendingTerminalExecutionUpdates.set(record.executionId, record);
      acceptedTerminalStatusByExecutionId.set(record.executionId, status);
    }
  } catch (error) {
    console.warn(
      '[TriggerExecution] Failed to restore terminal delivery outbox:',
      error
    );
  }
};

const persistTerminalExecutionOutbox = () => {
  if (typeof window === 'undefined') return;
  try {
    const records = [...pendingTerminalExecutionUpdates.values()];
    if (records.length === 0) {
      window.localStorage.removeItem(TERMINAL_EXECUTION_OUTBOX_KEY);
      return;
    }
    window.localStorage.setItem(
      TERMINAL_EXECUTION_OUTBOX_KEY,
      JSON.stringify(records)
    );
  } catch (error) {
    console.warn(
      '[TriggerExecution] Failed to persist terminal delivery outbox:',
      error
    );
  }
};

const enqueueTriggerExecutionUpdate = (
  executionId: string,
  operation: () => Promise<void>
): Promise<void> => {
  const previous =
    triggerExecutionUpdateChains.get(executionId) ?? Promise.resolve();
  let queuedUpdate: Promise<void>;
  queuedUpdate = previous
    .catch(() => undefined)
    .then(operation)
    .finally(() => {
      if (triggerExecutionUpdateChains.get(executionId) === queuedUpdate) {
        triggerExecutionUpdateChains.delete(executionId);
      }
    });
  triggerExecutionUpdateChains.set(executionId, queuedUpdate);
  return queuedUpdate;
};

const sendTriggerExecutionUpdate = async (
  executionId: string,
  updateData: TriggerExecutionUpdateData,
  triggerInfo?: TriggerExecutionInfo
) => {
  try {
    const res = await proxyFetchPut(
      `/api/v1/execution/${executionId}`,
      updateData
    );

    // Log activity when execution status is updated
    if (updateData.status) {
      let activityType: ActivityType;
      let message: string;

      switch (updateData.status) {
        case ExecutionStatus.Completed:
          activityType = ActivityType.ExecutionSuccess;
          message = `Execution ${executionId} completed successfully`;
          break;
        case ExecutionStatus.Failed:
          activityType = ActivityType.ExecutionFailed;
          message = `Execution ${executionId} failed${updateData.error_message ? `: ${updateData.error_message}` : ''}`;
          break;
        case ExecutionStatus.Running:
          activityType = ActivityType.TriggerExecuted;
          message = `Execution ${executionId} started running`;
          break;
        case ExecutionStatus.Cancelled:
          activityType = ActivityType.ExecutionCancelled;
          message = `Execution ${executionId} was cancelled`;
          break;
        default:
          activityType = ActivityType.TriggerExecuted;
          message = `Execution ${executionId} status updated to ${updateData.status}`;
      }

      // Only include metadata fields that have meaningful values
      const metadata: Record<string, any> = {};
      if (updateData.error_message)
        metadata.error_message = updateData.error_message;
      if (updateData.skip_reason) metadata.skip_reason = updateData.skip_reason;
      if (updateData.duration_seconds != null)
        metadata.duration_seconds = updateData.duration_seconds;
      if (updateData.tokens_used != null && updateData.tokens_used > 0)
        metadata.tokens_used = updateData.tokens_used;

      updateExecutionLog(
        executionId,
        activityType,
        message,
        triggerInfo,
        metadata
      );
    }

    return res;
  } catch (error) {
    console.error('Failed to update trigger execution:', error);
    throw error;
  }
};

const deliverPendingTerminalExecutionUpdate = async (
  record: PendingTerminalExecutionUpdate
) => {
  const maxAttempts = TERMINAL_EXECUTION_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await sendTriggerExecutionUpdate(
        record.executionId,
        record.updateData,
        record.triggerInfo
      );
      if (pendingTerminalExecutionUpdates.get(record.executionId) === record) {
        pendingTerminalExecutionUpdates.delete(record.executionId);
        persistTerminalExecutionOutbox();
      }
      return;
    } catch (error) {
      console.warn(
        `[TriggerExecution] Failed to deliver terminal status (attempt ${attempt + 1}/${maxAttempts}):`,
        error
      );
      if (attempt + 1 < maxAttempts) {
        await waitForTriggerExecutionRetry(
          TERMINAL_EXECUTION_RETRY_DELAYS_MS[attempt]
        );
      }
    }
  }

  // Keep the terminal receipt durable. A later app start, online/focus event,
  // or duplicate terminal receipt will replay another bounded delivery round.
  persistTerminalExecutionOutbox();
};

const enqueuePendingTerminalExecutionUpdate = (
  record: PendingTerminalExecutionUpdate
): Promise<void> => {
  const existingDelivery = terminalDeliveryChains.get(record.executionId);
  if (existingDelivery) return existingDelivery;

  let delivery: Promise<void>;
  delivery = enqueueTriggerExecutionUpdate(record.executionId, () =>
    deliverPendingTerminalExecutionUpdate(record)
  ).finally(() => {
    if (terminalDeliveryChains.get(record.executionId) === delivery) {
      terminalDeliveryChains.delete(record.executionId);
    }
  });
  terminalDeliveryChains.set(record.executionId, delivery);
  return delivery;
};

const installTerminalExecutionRecoveryListeners = () => {
  if (recoveryListenersInstalled || typeof window === 'undefined') return;
  recoveryListenersInstalled = true;
  const flush = () => void flushPendingTriggerExecutionUpdates();
  window.addEventListener('online', flush);
  window.addEventListener('focus', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });
};

/** Replay durable terminal receipts without depending on Run observers. */
export async function flushPendingTriggerExecutionUpdates(): Promise<void> {
  loadTerminalExecutionOutbox();
  installTerminalExecutionRecoveryListeners();
  const deliveries = [...pendingTerminalExecutionUpdates.values()].map(
    (record) => enqueuePendingTerminalExecutionUpdate(record)
  );
  await Promise.all(deliveries);
}

/**
 * Serialize all execution status writes and durably retain terminal outcomes.
 * A terminal state is first-writer-wins in the renderer and immutable on the
 * server, so a late Running acknowledgement cannot resurrect a finished Run.
 */
export const proxyUpdateTriggerExecution = async (
  executionId: string,
  updateData: TriggerExecutionUpdateData,
  triggerInfo?: TriggerExecutionInfo
) => {
  loadTerminalExecutionOutbox();
  installTerminalExecutionRecoveryListeners();

  const status = updateData.status;
  const acceptedTerminalStatus =
    acceptedTerminalStatusByExecutionId.get(executionId);

  if (status === ExecutionStatus.Running && acceptedTerminalStatus) {
    console.log(
      '[TriggerExecution] Ignoring Running after terminal outcome:',
      executionId
    );
    return;
  }

  if (isTerminalExecutionStatus(status)) {
    if (acceptedTerminalStatus && acceptedTerminalStatus !== status) {
      console.log(
        '[TriggerExecution] Ignoring competing terminal outcome:',
        executionId,
        status
      );
      return;
    }

    let record = pendingTerminalExecutionUpdates.get(executionId);
    if (!record && acceptedTerminalStatus) {
      // This exact terminal outcome was already delivered successfully.
      return;
    }
    if (!record) {
      record = {
        executionId,
        updateData,
        triggerInfo,
        queuedAt: Date.now(),
      };
      acceptedTerminalStatusByExecutionId.set(executionId, status);
      pendingTerminalExecutionUpdates.set(executionId, record);
      // Persist before the first network await so app shutdown cannot lose the
      // only canonical terminal receipt.
      persistTerminalExecutionOutbox();
    }

    return enqueuePendingTerminalExecutionUpdate(record);
  }

  return enqueueTriggerExecutionUpdate(executionId, async () => {
    await sendTriggerExecutionUpdate(executionId, updateData, triggerInfo);
  });
};

export const proxyRetryTriggerExecution = async (
  executionId: string,
  triggerInfo?: {
    triggerId?: number;
    triggerName?: string;
    projectId?: string;
  }
) => {
  try {
    const res = await proxyFetchPost(`/api/v1/execution/${executionId}/retry`);

    updateExecutionLog(
      executionId,
      ActivityType.TriggerExecuted,
      `Execution ${executionId} retry initiated`,
      triggerInfo,
      {
        status: ExecutionStatus.Pending,
        retried: true,
      }
    );

    return res;
  } catch (error) {
    console.error('Failed to retry trigger execution:', error);
    throw error;
  }
};
