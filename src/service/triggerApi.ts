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
import { ActivityType, useActivityLogStore } from '@/store/activityLogStore';
import {
  ExecutionStatus,
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

    const res = await proxyFetchGet(`/api/trigger/`, params);
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

    const res = await proxyFetchGet(`/api/trigger/`, params);
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
    const res = await proxyFetchGet(`/api/trigger/${triggerId}`);
    return res;
  } catch (error) {
    console.error('Failed to fetch trigger:', error);
    throw error;
  }
};

export const proxyFetchTriggerConfig = async (triggerType: TriggerType) => {
  try {
    const res = await proxyFetchGet(`/api/trigger/${triggerType}/config`);
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
    const res = await proxyFetchPost(`/api/trigger/`, triggerData);
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
    const res = await proxyFetchPut(`/api/trigger/${triggerId}`, updateData);
    return res;
  } catch (error) {
    console.error('Failed to update trigger:', error);
    throw error;
  }
};

export const proxyDeleteTrigger = async (triggerId: number): Promise<void> => {
  try {
    await proxyFetchDelete(`/api/trigger/${triggerId}`);
  } catch (error) {
    console.error('Failed to delete trigger:', error);
    throw error;
  }
};

export const proxyActivateTrigger = async (
  triggerId: number
): Promise<Trigger> => {
  try {
    const res = await proxyFetchPost(`/api/trigger/${triggerId}/activate`);
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
    const res = await proxyFetchPost(`/api/trigger/${triggerId}/deactivate`);
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
      `/api/trigger/${triggerId}/executions`,
      params
    );
    return res;
  } catch (error) {
    console.error('Failed to fetch trigger executions:', error);
    throw error;
  }
};

export const proxyUpdateTriggerExecution = async (
  executionId: string,
  updateData: Partial<{
    status?: string;
    started_at?: string;
    completed_at?: string;
    duration_seconds?: number;
    output_data?: Record<string, any>;
    error_message?: string;
    attempts?: number;
    tokens_used?: number;
    tools_executed?: Record<string, any>;
  }>,
  triggerInfo?: {
    triggerId?: number;
    triggerName?: string;
    projectId?: string;
  }
) => {
  try {
    const res = await proxyFetchPut(
      `/api/execution/${executionId}`,
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

export const proxyRetryTriggerExecution = async (
  executionId: string,
  triggerInfo?: {
    triggerId?: number;
    triggerName?: string;
    projectId?: string;
  }
) => {
  try {
    const res = await proxyFetchPost(`/api/execution/${executionId}/retry`);

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
