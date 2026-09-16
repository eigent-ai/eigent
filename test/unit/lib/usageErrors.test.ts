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

import { classifyError, isLegacyTaskError } from '@/lib/usageErrors';
import { describe, expect, it, vi } from 'vitest';
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));

describe('usage error classification', () => {
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
