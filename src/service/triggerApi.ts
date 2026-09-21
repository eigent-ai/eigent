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
  fetchGet,
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
} from '@/api/http';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import {
  recordFeatureUsed,
  recordScheduledTriggerCreated,
} from '@/lib/events/appEvents';
import { ActivityType, useActivityLogStore } from '@/store/activityLogStore';
import { getAuthStore } from '@/store/authStore';
import {
  ExecutionStatus,
  SkipReason,
  Trigger,
  TriggerInput,
  TriggerStatus,
  TriggerType,
  TriggerUpdate,
} from '@/types';
import { parseSummary } from './runStateReconciliation';
import { reconcileRunUsage } from './runUsageReconciliation';

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
  accountKey?: string;
};

type TriggerRunBinding = {
  executionId: string;
  projectId: string;
  runId: string;
  accountKey: string;
  terminalDelivery?: TriggerRecoveryReceipt;
  reconciledUsage?: TriggerRecoveryReceipt;
};

type TriggerRecoveryReceipt = { status: string; tokens: number };

function isRecoveryReceipt(value: unknown): value is TriggerRecoveryReceipt {
  const receipt = value as TriggerRecoveryReceipt | undefined;
  return Boolean(
    receipt &&
    ['completed', 'failed', 'cancelled'].includes(receipt.status) &&
    Number.isSafeInteger(receipt.tokens) &&
    receipt.tokens >= 0
  );
}

const TRIGGER_RUN_BINDINGS_KEY = 'eigent.trigger-run-bindings.v1';
const triggerRunBindings = new Map<string, TriggerRunBinding>();
const bindingLastChecked = new Map<string, number>();
let bindingsLoaded = false;
let recoveryPass: Promise<void> | null = null;
const currentAccountKey = () => getAccountEnvironmentKey(getAuthStore());

function loadTriggerRunBindings(): void {
  if (bindingsLoaded) return;
  const raw = window.localStorage.getItem(TRIGGER_RUN_BINDINGS_KEY);
  if (!raw) {
    bindingsLoaded = true;
    return;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Invalid Trigger Run bindings');
  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as TriggerRunBinding;
    if (
      ['executionId', 'projectId', 'runId', 'accountKey'].every(
        (key) =>
          typeof record[key as keyof TriggerRunBinding] === 'string' &&
          record[key as keyof TriggerRunBinding]
      )
    ) {
      if (!isRecoveryReceipt(record.terminalDelivery))
        delete record.terminalDelivery;
      if (!isRecoveryReceipt(record.reconciledUsage))
        delete record.reconciledUsage;
      triggerRunBindings.set(record.executionId, record);
    }
  }
  bindingsLoaded = true;
}

function persistTriggerRunBindings(): void {
  if (triggerRunBindings.size)
    window.localStorage.setItem(
      TRIGGER_RUN_BINDINGS_KEY,
      JSON.stringify([...triggerRunBindings.values()])
    );
  else window.localStorage.removeItem(TRIGGER_RUN_BINDINGS_KEY);
}

// A terminal ACK is not proof that the Journal usage tail was read. Keep both
// stages durable, including a successfully read zero, until enrichment is ACKed.
function recordTriggerRecoveryStage(
  binding: TriggerRunBinding,
  stage: 'terminalDelivery' | 'reconciledUsage',
  receipt: TriggerRecoveryReceipt
): void {
  const previous = binding[stage];
  if (previous && previous.status !== receipt.status) return;
  binding[stage] = {
    status: receipt.status,
    tokens: Math.max(previous?.tokens ?? 0, receipt.tokens),
  };
  try {
    persistTriggerRunBindings();
  } catch (error) {
    binding[stage] = previous;
    throw error;
  }
}

function forgetReconciledTriggerRun(binding: TriggerRunBinding): void {
  if (
    triggerRunBindings.get(binding.executionId) !== binding ||
    !binding.reconciledUsage ||
    binding.terminalDelivery?.status !== binding.reconciledUsage.status ||
    binding.terminalDelivery.tokens < binding.reconciledUsage.tokens
  )
    return;
  triggerRunBindings.delete(binding.executionId);
  try {
    persistTriggerRunBindings();
  } catch (error) {
    triggerRunBindings.set(binding.executionId, binding);
    throw error;
  }
  bindingLastChecked.delete(binding.executionId);
}

/** Persist identity BEFORE admission; this is not an execution/status fact. */
export function trackTriggerExecutionRun(
  executionId: string,
  projectId: string,
  runId: string,
  expectedAccountKey = currentAccountKey()
): boolean {
  if (currentAccountKey() !== expectedAccountKey)
    throw new Error('Trigger execution account changed before admission');
  loadTriggerRunBindings();
  const previous = triggerRunBindings.get(executionId);
  const record = {
    ...previous,
    executionId,
    projectId,
    runId,
    accountKey: expectedAccountKey,
  };
  if (
    previous &&
    (previous.projectId !== projectId ||
      previous.runId !== runId ||
      previous.accountKey !== record.accountKey)
  )
    throw new Error(
      'Trigger execution is already bound to a different Run or account'
    );
  triggerRunBindings.set(executionId, record);
  // Fail admission if durable identity cannot be saved. Do not start an
  // untraceable Run and hope that a terminal callback survives renderer loss.
  try {
    persistTriggerRunBindings();
  } catch (error) {
    if (previous) triggerRunBindings.set(executionId, previous);
    else triggerRunBindings.delete(executionId);
    throw error;
  }
  return previous === undefined;
}

/** Only used for a typed rejection which proves this candidate was not admitted. */
export function forgetRejectedTriggerRun(
  executionId: string,
  projectId: string,
  runId: string
): void {
  loadTriggerRunBindings();
  const record = triggerRunBindings.get(executionId);
  if (
    record?.projectId === projectId &&
    record.runId === runId &&
    record.accountKey === currentAccountKey()
  ) {
    triggerRunBindings.delete(executionId);
    try {
      persistTriggerRunBindings();
    } catch (error) {
      triggerRunBindings.set(executionId, record);
      throw error;
    }
  }
}

async function reconcileTrackedTriggerRuns(): Promise<void> {
  loadTriggerRunBindings();
  const records = [...triggerRunBindings.values()]
    .filter(
      (record) =>
        record.accountKey === currentAccountKey() &&
        !pendingTerminalExecutionUpdates.has(record.executionId)
    )
    .sort(
      (a, b) =>
        (bindingLastChecked.get(a.executionId) ?? 0) -
        (bindingLastChecked.get(b.executionId) ?? 0)
    )
    .slice(0, 10);
  await Promise.all(
    records.map(async (record) => {
      bindingLastChecked.set(record.executionId, Date.now());
      const current = () =>
        triggerRunBindings.get(record.executionId) === record &&
        currentAccountKey() === record.accountKey;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const raw = await Promise.race([
          fetchGet(
            `/runs/${encodeURIComponent(record.runId)}`,
            undefined,
            undefined,
            { signal: controller.signal, expectedAccountKey: record.accountKey }
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error('Trigger Run reconciliation timed out'));
            }, 5_000);
          }),
        ]);
        clearTimeout(timer);
        timer = undefined;
        if (!current()) return;
        const summary = parseSummary(raw, record.projectId, record.runId);
        const status =
          summary.status === 'completed'
            ? ExecutionStatus.Completed
            : summary.status === 'failed'
              ? ExecutionStatus.Failed
              : summary.status === 'cancelled'
                ? ExecutionStatus.Cancelled
                : undefined;
        // Interrupted is resumable. Missing/active/unknown facts cannot close
        // an execution and never cause another Run to be dispatched here.
        if (!status) return;
        let tokens =
          record.reconciledUsage?.status === status
            ? record.reconciledUsage.tokens
            : 0;
        if (record.reconciledUsage?.status !== status) {
          try {
            tokens = await reconcileRunUsage({
              projectId: record.projectId,
              runId: record.runId,
              terminalEventTypes:
                summary.status === 'failed'
                  ? ['run.failed', 'run.deadline_reached']
                  : [`run.${summary.status}`],
              signal: controller.signal,
              expectedAccountKey: record.accountKey,
            });
            if (!current()) return;
            recordTriggerRecoveryStage(record, 'reconciledUsage', {
              status,
              tokens,
            });
          } catch (error) {
            console.warn(
              '[TriggerExecution] Terminal usage remains incomplete:',
              error
            );
          }
        }
        if (!current()) return;
        // A previous renderer may have delivered the exact total already.
        // Even zero converges once a validated terminal boundary was read.
        forgetReconciledTriggerRun(record);
        if (!current()) return;
        if (
          record.terminalDelivery?.status === status &&
          record.terminalDelivery.tokens >= tokens
        )
          return;
        await proxyUpdateTriggerExecution(
          record.executionId,
          {
            status,
            tokens_used: tokens,
            completed_at: new Date(
              typeof summary.updated_at === 'number'
                ? summary.updated_at *
                    (summary.updated_at < 10_000_000_000 ? 1000 : 1)
                : summary.updated_at
            ).toISOString(),
          },
          { projectId: record.projectId }
        );
        forgetReconciledTriggerRun(record);
      } catch (error) {
        console.warn('[TriggerExecution] Run reconciliation deferred:', error);
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    })
  );
}

const TERMINAL_EXECUTION_OUTBOX_KEY = 'eigent.trigger-terminal-outbox.v1';
const TERMINAL_EXECUTION_RETRY_DELAYS_MS = [250, 1_000] as const;
const TRIGGER_EXECUTION_REQUEST_TIMEOUT_MS = 10_000;
const terminalExecutionStatuses = new Set<string>([
  ExecutionStatus.Completed,
  ExecutionStatus.Failed,
  ExecutionStatus.Cancelled,
  ExecutionStatus.Missed,
]);
const acceptedTerminalUpdatesByExecutionId = new Map<
  string,
  PendingTerminalExecutionUpdate
>();
const pendingTerminalExecutionUpdates = new Map<
  string,
  PendingTerminalExecutionUpdate
>();
const triggerExecutionUpdateChains = new Map<string, Promise<void>>();
const terminalDeliveryChains = new Map<
  string,
  { record: PendingTerminalExecutionUpdate; promise: Promise<void> }
>();
let terminalOutboxLoaded = false;
let recoveryListenersInstalled = false;

const waitForTriggerExecutionRetry = (delayMs: number) =>
  new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs));

const isTerminalExecutionStatus = (status?: string): status is string =>
  Boolean(status && terminalExecutionStatuses.has(status));

const executionTokens = (data: TriggerExecutionUpdateData): number =>
  Number.isSafeInteger(data.tokens_used) && (data.tokens_used ?? 0) >= 0
    ? (data.tokens_used ?? 0)
    : 0;

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
      acceptedTerminalUpdatesByExecutionId.set(record.executionId, record);
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
  triggerInfo?: TriggerExecutionInfo,
  accountKey?: string
) => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    if (accountKey !== undefined && accountKey !== currentAccountKey())
      throw new Error('Trigger execution account changed');
    const request = proxyFetchPut(
      `/api/v1/execution/${executionId}`,
      updateData,
      undefined,
      {
        signal: controller.signal,
        ...(accountKey !== undefined && { expectedAccountKey: accountKey }),
      }
    );
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        controller.abort();
        reject(
          new Error(
            `Trigger execution update timed out after ${TRIGGER_EXECUTION_REQUEST_TIMEOUT_MS}ms`
          )
        );
      }, TRIGGER_EXECUTION_REQUEST_TIMEOUT_MS);
    });
    const res = await Promise.race([request, timeout]);
    if (accountKey !== undefined && accountKey !== currentAccountKey())
      throw new Error('Trigger execution account changed during delivery');

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
  } finally {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
  }
};

const deliverPendingTerminalExecutionUpdate = async (
  record: PendingTerminalExecutionUpdate
) => {
  const maxAttempts = TERMINAL_EXECUTION_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (
      record.accountKey !== undefined &&
      record.accountKey !== currentAccountKey()
    )
      return;
    // A richer receipt is already queued behind this delivery. Do not retry
    // an obsolete total or let it remove the newer durable outbox record.
    if (pendingTerminalExecutionUpdates.get(record.executionId) !== record)
      return;
    try {
      await sendTriggerExecutionUpdate(
        record.executionId,
        record.updateData,
        record.triggerInfo,
        record.accountKey
      );
      const binding = triggerRunBindings.get(record.executionId);
      if (binding && binding.accountKey === record.accountKey) {
        const receipt = {
          status: record.updateData.status,
          tokens: executionTokens(record.updateData),
        };
        if (isRecoveryReceipt(receipt)) {
          recordTriggerRecoveryStage(binding, 'terminalDelivery', receipt);
          forgetReconciledTriggerRun(binding);
        }
      }
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
  if (existingDelivery?.record === record) return existingDelivery.promise;

  let delivery: Promise<void>;
  delivery = enqueueTriggerExecutionUpdate(record.executionId, () =>
    deliverPendingTerminalExecutionUpdate(record)
  ).finally(() => {
    if (terminalDeliveryChains.get(record.executionId)?.promise === delivery) {
      terminalDeliveryChains.delete(record.executionId);
    }
  });
  terminalDeliveryChains.set(record.executionId, { record, promise: delivery });
  return delivery;
};

const installTerminalExecutionRecoveryListeners = () => {
  if (recoveryListenersInstalled || typeof window === 'undefined') return;
  recoveryListenersInstalled = true;
  const flush = () =>
    void flushPendingTriggerExecutionUpdates().catch((error) => {
      console.warn('[TriggerExecution] Recovery deferred:', error);
    });
  window.addEventListener('online', flush);
  window.addEventListener('focus', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });
};

/** Replay durable terminal receipts without depending on Run observers. */
export async function flushPendingTriggerExecutionUpdates(): Promise<void> {
  if (recoveryPass) return recoveryPass;
  recoveryPass = flushTriggerExecutionRecovery().finally(() => {
    recoveryPass = null;
  });
  return recoveryPass;
}

async function flushTriggerExecutionRecovery(): Promise<void> {
  loadTerminalExecutionOutbox();
  loadTriggerRunBindings();
  installTerminalExecutionRecoveryListeners();
  const deliveries = [...pendingTerminalExecutionUpdates.values()].map(
    (record) => enqueuePendingTerminalExecutionUpdate(record)
  );
  await Promise.all(deliveries);
  await reconcileTrackedTriggerRuns();
}

/**
 * Serialize all execution status writes and durably retain terminal outcomes.
 * A terminal outcome is first-writer-wins. Only a larger same-outcome token
 * total may enrich its receipt; late Running cannot resurrect a finished Run.
 */
export const proxyUpdateTriggerExecution = async (
  executionId: string,
  updateData: TriggerExecutionUpdateData,
  triggerInfo?: TriggerExecutionInfo,
  expectedAccountKey?: string
) => {
  loadTerminalExecutionOutbox();
  loadTriggerRunBindings();
  installTerminalExecutionRecoveryListeners();

  const status = updateData.status;
  const accountKey =
    triggerRunBindings.get(executionId)?.accountKey ??
    expectedAccountKey ??
    currentAccountKey();
  const acceptedTerminalUpdate =
    acceptedTerminalUpdatesByExecutionId.get(executionId);
  const acceptedTerminalStatus = acceptedTerminalUpdate?.updateData.status;

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
    if (acceptedTerminalUpdate) {
      const tokens = executionTokens(updateData);
      if (tokens > executionTokens(acceptedTerminalUpdate.updateData)) {
        // Keep the first receipt's outcome, timing, error and output. A late
        // legacy END may supply the final token total after canonical settle.
        record = {
          ...acceptedTerminalUpdate,
          updateData: {
            ...acceptedTerminalUpdate.updateData,
            tokens_used: tokens,
          },
        };
      } else if (!record) {
        return;
      }
    } else {
      record = {
        executionId,
        updateData: { ...updateData },
        triggerInfo,
        queuedAt: Date.now(),
        ...(accountKey !== undefined && { accountKey }),
      };
    }
    if (!record) return;
    if (pendingTerminalExecutionUpdates.get(executionId) !== record) {
      acceptedTerminalUpdatesByExecutionId.set(executionId, record);
      pendingTerminalExecutionUpdates.set(executionId, record);
      // Persist before the first network await so app shutdown cannot lose the
      // only canonical terminal receipt.
      persistTerminalExecutionOutbox();
    }

    return enqueuePendingTerminalExecutionUpdate(record);
  }

  return enqueueTriggerExecutionUpdate(executionId, async () => {
    await sendTriggerExecutionUpdate(
      executionId,
      updateData,
      triggerInfo,
      accountKey
    );
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
