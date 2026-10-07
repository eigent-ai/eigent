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
  classifyError,
  errorCopy,
  errorPresentationReason,
} from '@/lib/usageErrors';
import { describe, expect, it, vi } from 'vitest';

const cases = [
  ['budget_exceeded', 'credits'],
  ['trial_daily_exhausted', 'trial-daily'],
  ['trial_total_exhausted', 'trial-total'],
  ['model_plan_required', 'model-access'],
  ['managed_service_unavailable', 'service'],
  ['eigent_low_balance_model_restricted', 'model-restricted'],
] as const;

describe('error presentation (no incident or admission side effects)', () => {
  it.each(cases)(
    'reads %s from bounded transport envelopes',
    (code, reason) => {
      const shapes = [
        { detail: { reason: code } },
        { detail: { code } },
        { error: { message: { detail: { reason: code } } } },
        JSON.stringify({ detail: { code } }),
        { message: JSON.stringify({ error: { type: code } }) },
        `Error code: 403 - {'error': {'message': "403: {'reason': '${code}'}", 'code': '403'}}`,
        `❌ **Fehler**: Error code: 403 - {'detail': {'reason': '${code}'}}`,
        `Errore: Error code: 403 - {'detail': {'reason': '${code}'}}`,
      ];
      for (const value of shapes) {
        const before = structuredClone(value);
        expect(errorPresentationReason(value, { modelType: 'cloud' })).toBe(
          reason
        );
        expect(value).toEqual(before);
      }
    }
  );
  it.each([402, 403, 429])(
    'prefers a known quota signal over status %s',
    (status) => {
      expect(
        errorPresentationReason({
          status,
          response: { data: { detail: { code: 'trial_daily_exhausted' } } },
          message: errorCopy('rate-limit'),
        })
      ).toBe('trial-daily');
    }
  );
  it.each([
    [402, 'task'],
    [403, 'model-unavailable'],
    [429, 'rate-limit'],
    [503, 'task'],
  ] as const)(
    'does not invent a quota cause for status %s',
    (status, reason) => {
      expect(
        errorPresentationReason({
          status,
          detail: {
            unknown: { reason: 'trial_daily_exhausted' },
            debug: 'budget_exceeded',
            code: 'future_policy',
          },
        })
      ).toBe(reason);
    }
  );
  it.each(['cloud', 'custom', undefined])(
    'preserves provider ownership for %s',
    (modelType) => {
      expect(
        errorPresentationReason(
          { detail: { error: { type: 'insufficient_quota' } } },
          { modelType }
        )
      ).toBe(
        modelType === 'cloud'
          ? 'service'
          : modelType === 'custom'
            ? 'provider-credits'
            : 'model-unavailable'
      );
    }
  );
  it('bounds malformed, huge, cyclic and deeply nested payloads', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.error = cyclic;
    let deep: unknown = { reason: 'trial_daily_exhausted' };
    for (let i = 0; i < 100; i++) deep = { error: deep };
    for (const value of [
      cyclic,
      deep,
      { message: 'x'.repeat(1000000) },
      '[{bad json',
      { code: { toString: 'not callable' } },
      JSON.parse('{"usageReason":"__proto__"}'),
    ]) {
      expect(errorPresentationReason(value)).toBe('task');
      expect(() => classifyError(value)).not.toThrow();
    }
  });
  it('keeps the incident classifier unchanged for display-only refinements', () => {
    const value = { status: 403, detail: { code: 'trial_daily_exhausted' } };
    expect(classifyError(value)).toBe('model-unavailable');
    expect(errorPresentationReason(value)).toBe('trial-daily');
    expect(classifyError(value)).toBe('model-unavailable');
  });
});

describe('reviewed untrusted presentation boundaries', () => {
  it.each([
    "{'unknown': {'reason': 'trial_daily_exhausted'}}",
    "{'__proto__': {'reason': 'trial_daily_exhausted'}}",
    `Error code: 402 - {"unknown":{"reason":"trial_daily_exhausted"}}`,
    `Error code: 402 - {'unknown': {'reason': 'trial_daily_exhausted'}}`,
    `HTTP 402: {'__proto__': {'reason': 'trial_daily_exhausted'}}`,
    `${"{'error': ".repeat(8)}{'reason': 'trial_daily_exhausted'}${'}'.repeat(8)}`,
    `Error code: 402 - ${JSON.stringify({ error: { error: { error: { error: { error: { error: { error: { reason: 'trial_daily_exhausted' } } } } } } } })}`,
  ])('does not find causes outside allowed paths or limits: %s', (payload) => {
    expect(errorPresentationReason(payload)).toBe('task');
  });

  it.each([
    'message',
    'response',
    'data',
    'text',
    'detail',
    'error',
    'reason',
    'type',
    'code',
    'status',
    'cause',
    'usageReason',
  ])('does not execute a %s accessor', (field) => {
    const getter = vi.fn(() => {
      throw new Error('getter executed');
    });
    const value = Object.defineProperty({}, field, { get: getter });
    expect(errorPresentationReason(value)).toBe('task');
    expect(classifyError(value)).toBe('task');
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([
    Object.create({ reason: 'trial_daily_exhausted' }),
    Object.create({ detail: { reason: 'trial_daily_exhausted' } }),
    Object.create({ message: 'Budget has been exceeded!' }),
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('descriptor trap');
        },
      }
    ),
    new Proxy(
      {},
      {
        get() {
          throw new Error('get trap');
        },
      }
    ),
    Proxy.revocable({}, {}),
  ])('rejects inherited fields and hostile descriptors', (input) => {
    let value = input;
    if ('revoke' in input) {
      input.revoke();
      value = input.proxy;
    }
    expect(errorPresentationReason(value)).toBe('task');
    expect(classifyError(value)).toBe('task');
  });

  it.each([
    "{'reason': 'trial_daily_exhausted', 'reason': 'future_policy'}",
    "{'reason': 'trial_daily_exhausted'} trailing text",
    "dict(reason='trial_daily_exhausted')",
    "{'reason': __import__('os').system('trial_daily_exhausted')}",
    JSON.stringify({
      ignored: Array(40).fill(null),
      reason: 'trial_daily_exhausted',
    }),
    JSON.stringify({
      ignored: 'x'.repeat(8192),
      reason: 'trial_daily_exhausted',
    }),
  ])('rejects malformed or over-budget literals as a whole: %s', (value) => {
    expect(errorPresentationReason(value)).toBe('task');
  });

  it('accepts bounded Python literals without evaluating their contents', () => {
    expect(
      errorPresentationReason(
        "{'detail': {'reason': 'trial_daily_exhausted', 'message': 'can\\'t start'}, 'unused': [None, True, False, 2,],}"
      )
    ).toBe('trial-daily');
  });
});
