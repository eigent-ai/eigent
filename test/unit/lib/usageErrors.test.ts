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

import { createSSEAdmissionError } from '@/lib/responseError';
import {
  classifyError,
  errorPresentationReason,
  isLegacyTaskError,
  isUsageReason,
} from '@/lib/usageErrors';
import { describe, expect, it, vi } from 'vitest';
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));

describe('usage error classification', () => {
  it.each([
    { code: 'eigent_low_balance_model_restricted', remaining_credits: 172 },
    {
      response: {
        status: 403,
        data: {
          detail: {
            code: 'eigent_low_balance_model_restricted',
            allowed_models: ['eigent'],
          },
        },
      },
    },
    { error: { code: 'eigent_low_balance_model_restricted' } },
    { code: 403, error: { code: 'eigent_low_balance_model_restricted' } },
    `Error code: 403 - {'error': {'message': "403: {'code': 'eigent_low_balance_model_restricted', 'message': 'Your remaining credits are reserved for Eigent. Switch to the Eigent model to continue.', 'allowed_models': ['eigent'], 'threshold_credits': 200, 'remaining_credits': 172}", 'type': 'None', 'param': 'None', 'code': '403'}}`,
  ])(
    'recognizes the low-balance model restriction without blocking all cloud models',
    (error) => {
      const reason = classifyError(error, { modelType: 'cloud' });
      expect(reason).toBe('model-restricted');
      expect(isUsageReason(reason)).toBe(false);
    }
  );

  it('recognizes the reported Python-style budget response without evaluating it', () => {
    expect(
      classifyError(
        "Error code: 400 - {'error': {'message': 'Budget has been exceeded! Current cost: 7.707045399999998', 'type': 'budget_exceeded', 'param': None, 'code': '400'}}",
        { modelType: 'cloud' }
      )
    ).toBe('credits');
  });
  it('recognizes paid-model access without treating every 403 as billing', () => {
    expect(
      classifyError(
        "Error code: 403 - {'error': {'message': '403: This model requires an Eigent Plus or Pro plan. Please upgrade your plan or choose a free model.', 'type': 'None'}}"
      )
    ).toBe('model-access');
    expect(classifyError({ status: 403, message: 'Forbidden' })).toBe(
      'model-unavailable'
    );
  });
  it.each([20, '20', 22, '22'])('understands gateway code %s', (code) => {
    expect(classifyError({ response: { data: { code } } })).toBe('credits');
  });
  it('distinguishes managed quota, custom-provider quota and unknown ownership', () => {
    const error = {
      error: {
        type: 'insufficient_quota',
        message: 'Aihubmix: insufficient balance',
      },
    };
    expect(classifyError(error, { modelType: 'cloud' })).toBe('service');
    expect(classifyError(error, { modelType: 'custom' })).toBe(
      'provider-credits'
    );
    expect(classifyError(error)).toBe('model-unavailable');
  });
  it('does not treat a rate limit or a bad request as depleted credits', () => {
    expect(classifyError({ status: 429 })).toBe('rate-limit');
    expect(classifyError({ status: 400 })).toBe('request');
  });
  it('explains a thinking effort the model does not support', () => {
    expect(
      classifyError({
        status: 422,
        code: 'unsupported_thinking_effort',
        message:
          'Run admission did not return an event stream: {"code":"unsupported_thinking_effort"}',
      })
    ).toBe('thinking-effort');
  });
  it('gives a rejected thinking effort its own copy at admission', async () => {
    const response = new Response(
      JSON.stringify({
        detail: {
          code: 'unsupported_thinking_effort',
          message:
            "unknown_model: thinking effort capabilities are not registered; cannot honor effort 'medium'.",
        },
      }),
      { status: 422, headers: { 'content-type': 'application/json' } }
    );
    const error = await createSSEAdmissionError(response, {});
    expect(error.message).toBe('chat.notice-thinking-effort');
    expect(error).toMatchObject({
      code: 'unsupported_thinking_effort',
      userMessage: 'chat.notice-thinking-effort',
    });
  });
  it('shows a provider 5xx as an unavailable model, but not a local one', () => {
    const outage = `Error code: 503 - {'error': {'message': 'Service Unavailable'}}`;
    expect(
      classifyError({
        message: outage,
        retryable: true,
        reason: 'model_transport_error',
      })
    ).toBe('model-unavailable');
    expect(errorPresentationReason(`❌ **Error**: ${outage}`)).toBe(
      'model-unavailable'
    );
    expect(classifyError({ status: 500 })).toBe('task');
    expect(errorPresentationReason('HTTP 500: {"detail": "boom"}')).toBe(
      'task'
    );
  });
  it('only recognizes the legacy system-error prefix', () => {
    expect(isLegacyTaskError('Here is an example: Error code: 403')).toBe(
      false
    );
    expect(isLegacyTaskError('❌ **Error**: Error code: 403')).toBe(true);
    expect(isLegacyTaskError('❌ **错误**：Error code: 403')).toBe(true);
    expect(isLegacyTaskError('❌ **Erreur** : Error code: 403')).toBe(true);
    expect(isLegacyTaskError('Errore: Error code: 403')).toBe(true);
    expect(isLegacyTaskError('Errore: here is how the example works')).toBe(
      false
    );
  });
});
