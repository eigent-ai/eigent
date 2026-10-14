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

import { ownErrorField } from './errorEnvelope';
import {
  classifyError,
  errorCopy,
  isRawErrorMessage,
  isUsageReason,
  type ErrorContext,
  type ErrorReason,
} from './usageErrors';

/** Shared HTTP/SSE copy boundary; the original reason still owns incidents. */
export function sanitizeResponseError(
  error: Error,
  reason: ErrorReason,
  force = false
): Error {
  const status = ownErrorField(error, 'status');
  const message = ownErrorField(error, 'message');
  if (
    force ||
    isUsageReason(reason) ||
    // The backend's capability diagnostic is written for developers.
    reason === 'thinking-effort' ||
    (ownErrorField(error, 'response') &&
      (((typeof status === 'number' || typeof status === 'string') &&
        [402, 429].includes(Number(status))) ||
        isRawErrorMessage(message)))
  ) {
    // Return a trusted Error, never a proxy or an object with setters. Keep
    // own diagnostic fields by reference; the original error stays untouched.
    const sanitized = new Error(errorCopy(reason));
    for (const key of [
      'name',
      'stack',
      'status',
      'response',
      'code',
      'userMessage',
    ]) {
      const value = ownErrorField(error, key);
      if (value !== undefined)
        Object.defineProperty(sanitized, key, {
          value,
          configurable: true,
          writable: true,
        });
    }
    return Object.assign(sanitized, {
      cause: ownErrorField(error, 'cause') ?? message,
      usageReason: reason,
    });
  }
  return error;
}

/** Called only after startTask has rejected admission; does not report or retry. */
export async function createSSEAdmissionError(
  response: Response,
  context: ErrorContext
): Promise<Error> {
  let body = '';
  try {
    body = await response.clone().text();
  } catch {
    // Preserve the HTTP fallback when the response body cannot be read.
  }
  let data: unknown = body;
  try {
    data = JSON.parse(body);
  } catch {
    /* Preserve the raw body for diagnostics. */
  }
  const bodyDetail =
    ownErrorField(data, 'detail') ??
    ownErrorField(data, 'message') ??
    ownErrorField(data, 'text');
  let detail = `HTTP ${response.status}`;
  let code = ownErrorField(data, 'error_code');
  let userMessage: string | undefined;
  if (typeof bodyDetail === 'string') {
    detail = bodyDetail;
    userMessage = bodyDetail;
  } else if (bodyDetail) {
    detail = JSON.stringify(bodyDetail);
    const detailCode = ownErrorField(bodyDetail, 'code');
    if (typeof detailCode === 'string') code = detailCode;
    const message = ownErrorField(bodyDetail, 'message');
    if (typeof message === 'string') userMessage = message;
  }
  const error = Object.assign(
    new Error(
      response.headers.get('content-type')?.startsWith('text/event-stream')
        ? `Run stream returned ${detail}`
        : `Run admission did not return an event stream: ${detail}`
    ),
    {
      status: response.status,
      code: typeof code === 'string' ? code : undefined,
      userMessage,
    }
  );
  // Freeze the pre-existing SSE classification BEFORE adding response.data.
  // Richer diagnostics may refine copy but must never introduce a usage gate.
  const reason = classifyError(error, context);
  Object.assign(error, {
    response: {
      data,
      body,
      status: response.status,
      headers: response.headers,
      url: response.url,
    },
  });
  const sanitized = sanitizeResponseError(error, reason, true);
  // Continuation clarifications are Brain-authored questions (design 19 §8),
  // shown verbatim for both 409 admission and HTTP 200 transports.
  if (!error.code?.startsWith('continuation_'))
    Object.assign(sanitized, { userMessage: sanitized.message });
  return sanitized;
}
