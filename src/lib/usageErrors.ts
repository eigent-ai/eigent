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

import i18n from 'i18next';

export type UsageReason =
  | 'credits'
  | 'trial-daily'
  | 'trial-total'
  | 'free-credits'
  | 'model-access'
  | 'service';
export type ErrorReason =
  | UsageReason
  | 'provider-credits'
  | 'api-key'
  | 'connection'
  | 'timeout'
  | 'rate-limit'
  | 'context'
  | 'request'
  | 'model-unavailable'
  | 'task';
export interface ErrorContext {
  /** Routing selected for this request, never inferred from provider wording. */
  modelType?: string;
  modelId?: string;
}

const copyKeys: Record<ErrorReason, string> = {
  credits: 'chat.notice-credits',
  'trial-daily': 'chat.notice-trial-daily',
  'trial-total': 'chat.notice-trial-total',
  'free-credits': 'chat.notice-free-credits',
  'model-access': 'chat.notice-model-access',
  service: 'chat.notice-service',
  'provider-credits': 'chat.notice-provider-credits',
  'api-key': 'chat.notice-api-key',
  connection: 'chat.notice-connection',
  timeout: 'chat.notice-timeout',
  'rate-limit': 'chat.notice-rate-limit',
  context: 'chat.notice-context',
  request: 'chat.notice-request',
  'model-unavailable': 'chat.notice-model-unavailable',
  task: 'chat.notice-task',
};

export const errorCopy = (reason: ErrorReason) => i18n.t(copyKeys[reason]);
export const isUsageReason = (reason: ErrorReason): reason is UsageReason =>
  [
    'credits',
    'trial-daily',
    'trial-total',
    'free-credits',
    'model-access',
    'service',
  ].includes(reason);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

/** Read structured envelopes first. Legacy Python repr is only matched, never evaluated. */
export function classifyError(
  value: unknown,
  context: ErrorContext = {}
): ErrorReason {
  const outer = record(value);
  if (typeof outer.usageReason === 'string' && outer.usageReason in copyKeys)
    return outer.usageReason as ErrorReason;
  const response = record(outer.response);
  const body = record(response.data ?? value);
  const detail = record(body.detail);
  const error = record(body.error ?? detail.error);
  const parts = [
    outer.message,
    body.message,
    body.text,
    body.detail,
    error.message,
    detail.message,
  ];
  if (typeof value === 'string') parts.push(value);
  const text = parts
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
  const localized = (Object.keys(copyKeys) as ErrorReason[]).find((reason) =>
    parts.some((part) => typeof part === 'string' && part === errorCopy(reason))
  );
  if (localized) return localized;
  const code = String(body.code ?? detail.code ?? error.code ?? '');
  const reason = String(
    body.reason ?? detail.reason ?? error.type ?? body.type ?? ''
  );
  const cloud = context.modelType === 'cloud';
  const ownProvider = context.modelType === 'custom';
  const status = Number(outer.status ?? response.status ?? body.status ?? code);

  // Gateway entitlement and spend-limit signals are distinct from upstream quota.
  if (reason === 'managed_service_unavailable') return 'service';
  if (code === '20' || code === '22') return 'credits';
  if (
    reason === 'budget_exceeded' ||
    /\bbudget_exceeded\b|budget has been exceeded/.test(text)
  )
    return ownProvider ? 'provider-credits' : 'credits';
  if (
    /this model requires (an )?eigent plus or pro/.test(text) ||
    reason === 'model_plan_required'
  )
    return 'model-access';
  if (reason === 'trial_daily_exhausted') return 'trial-daily';
  if (reason === 'trial_total_exhausted') return 'trial-total';

  const providerQuota =
    /insufficient_quota|insufficient[_ ]balance|余额不足|额度已用尽|quota.*exceed|credit.*(exhaust|insufficient)|run out of credit/.test(
      text + ' ' + reason
    );
  if (providerQuota)
    return cloud
      ? 'service'
      : ownProvider
        ? 'provider-credits'
        : 'model-unavailable';
  if (
    /invalid[_ ]api[_ ]key|incorrect api key|authenticationerror/.test(text) ||
    status === 401
  )
    return ownProvider ? 'api-key' : 'model-unavailable';
  if (/context[_ ]length|context.*(too long|exceed)|maximum context/.test(text))
    return 'context';
  if (/timeout|timed out/.test(text) || status === 408 || status === 504)
    return 'timeout';
  if (/rate[_ ]limit|too many requests/.test(text) || status === 429)
    return 'rate-limit';
  if (
    /failed to fetch|networkerror|connection (error|refused)|could not connect/.test(
      text
    )
  )
    return 'connection';
  if (status === 400 || /error code: 400\b/.test(text)) return 'request';
  if (status === 403 || /error code: 403\b/.test(text))
    return 'model-unavailable';
  return 'task';
}

/** Only a known legacy system-error envelope, never ordinary assistant prose. */
export function isLegacyTaskError(content: string): boolean {
  return (
    /^❌\s*\*\*(?:Error|Fehler|Erreur|Ошибка|错误|錯誤|エラー|오류|خطأ)\*\*\s*[:：]/.test(
      content.trimStart()
    ) || /^Errore:\s*(?:Error code:|HTTP \d{3}|\{)/.test(content.trimStart())
  );
}
