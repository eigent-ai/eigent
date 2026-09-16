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
  reportUsageIncident,
  useUsageNoticeStore,
} from '@/store/usageNoticeStore';
import { toast } from 'sonner';
import {
  classifyError,
  errorCopy,
  isUsageReason,
  type ErrorContext,
} from './usageErrors';

export function reportError(
  value: unknown,
  context: ErrorContext & { executionId?: string } = {},
  account?: string | null
) {
  const reason = classifyError(value, context);
  const { executionId } = context;
  // Catch handlers may only carry the sanitized message. Preserve the model
  // already established by the same execution's SSE failure.
  const modelId =
    context.modelId ??
    (executionId
      ? useUsageNoticeStore
          .getState()
          .incidents.find(
            (incident) =>
              incident.reason === reason &&
              incident.executionIds?.includes(executionId)
          )?.modelId
      : undefined);
  if (isUsageReason(reason))
    reportUsageIncident(
      {
        reason,
        modelId,
        ...(executionId ? { executionIds: [executionId] } : {}),
      },
      account
    );
  return reason;
}

/** For interactive catch handlers. A classified incident already owns its reminder. */
export function notifyError(
  message: Parameters<typeof toast.error>[0],
  options?: Parameters<typeof toast.error>[1],
  executionId?: string
) {
  const { account, modelType } = useUsageNoticeStore.getState();
  const reason = reportError(
    { message, detail: options?.description },
    { modelType, executionId },
    account
  );
  if (isUsageReason(reason)) return;
  // Only a status-only summary of an already reported execution is a duplicate.
  // Detailed failures and listener errors must remain independently visible.
  if (
    reason === 'task' &&
    !options?.description &&
    executionId &&
    useUsageNoticeStore
      .getState()
      .incidents.some((incident) =>
        incident.executionIds?.includes(executionId)
      )
  )
    return;
  const raw =
    typeof message === 'string' &&
    /error code:|\{'error'|"error"\s*:|HTTP \d{3}/i.test(message);
  const safeOptions =
    options &&
    typeof options.description === 'string' &&
    /error code:|\{'error'|"error"\s*:|HTTP \d{3}/i.test(options.description)
      ? { ...options, description: errorCopy(reason) }
      : options;
  return toast.error(raw ? errorCopy(reason) : message, safeOptions);
}

/** Execution status can arrive again over WebSocket after the task SSE failure. */
export function notifyExecutionError(
  message: Parameters<typeof toast.error>[0],
  options?: Parameters<typeof toast.error>[1],
  executionId?: string
) {
  return notifyError(message, options, executionId);
}
