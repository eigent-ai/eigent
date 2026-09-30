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
import { ownErrorField } from './errorEnvelope';
import {
  classifyError,
  errorCopy,
  errorPresentationReason,
  isRawErrorMessage,
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
  message: Parameters<typeof toast.error>[0] | Error,
  options?: Parameters<typeof toast.error>[1],
  executionId?: string
) {
  const { account, modelType } = useUsageNoticeStore.getState();
  const elementType = ownErrorField(message, '$$typeof');
  const envelope =
    message !== null &&
    typeof message === 'object' &&
    elementType !== Symbol.for('react.element') &&
    elementType !== Symbol.for('react.transitional.element');
  const reason = reportError(
    envelope ? message : { message, detail: options?.description },
    { modelType, executionId },
    account
  );
  if (isUsageReason(reason)) return;
  // Only a status-only summary of an already reported execution is a duplicate.
  // Detailed failures and listener errors must remain independently visible.
  if (
    reason === 'task' &&
    typeof message === 'string' &&
    !isRawErrorMessage(message) &&
    !options?.description &&
    executionId &&
    useUsageNoticeStore
      .getState()
      .incidents.some((incident) =>
        incident.executionIds?.includes(executionId)
      )
  )
    return;
  const presentationReason = [
    'task',
    'request',
    'model-unavailable',
    'rate-limit',
  ].includes(reason)
    ? errorPresentationReason(
        envelope ? message : { message, detail: options?.description },
        { modelType }
      )
    : reason;
  const text = envelope ? ownErrorField(message, 'message') : message;
  const raw = isRawErrorMessage(text) || envelope;
  const safeOptions =
    options && isRawErrorMessage(options.description)
      ? { ...options, description: errorCopy(presentationReason) }
      : options;
  return toast.error(
    raw || reason === 'model-restricted'
      ? errorCopy(presentationReason)
      : (text as Parameters<typeof toast.error>[0]),
    safeOptions
  );
}

/** Execution status can arrive again over WebSocket after the task SSE failure. */
export function notifyExecutionError(
  message: Parameters<typeof toast.error>[0] | Error,
  options?: Parameters<typeof toast.error>[1],
  executionId?: string
) {
  return notifyError(message, options, executionId);
}
