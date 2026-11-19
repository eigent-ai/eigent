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
  appleIntelligenceStatusKey,
  fetchAppleIntelligenceStatus,
  isAppleIntelligenceOffered,
  testAppleIntelligence,
} from '@/lib/appleIntelligence';
import { providerCategory, providerDefinition } from '@/lib/configuredModels';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/api/http', () => ({
  fetchGet: http.get,
  fetchPost: http.post,
  proxyFetchGet: vi.fn(),
  proxyFetchPost: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('platform gating', () => {
  it.each([
    ['darwin', true],
    ['win32', false],
    ['linux', false],
    [null, false],
    [undefined, false],
  ])('platform %s offered: %s', (platform, offered) => {
    expect(isAppleIntelligenceOffered(platform)).toBe(offered);
  });
});

describe('status copy', () => {
  it.each([
    [true, null, 'setting.apple-intelligence.ready'],
    [
      false,
      'apple_intelligence_off',
      'setting.apple-intelligence.apple-intelligence-off',
    ],
    [
      false,
      'not_apple_silicon',
      'setting.apple-intelligence.not-apple-silicon',
    ],
    [false, 'model_not_ready', 'setting.apple-intelligence.model-not-ready'],
    [false, 'something_new', 'setting.apple-intelligence.unavailable'],
    [false, null, 'setting.apple-intelligence.unavailable'],
  ])('available=%s reason=%s', (available, reason, key) => {
    expect(appleIntelligenceStatusKey({ available, reason, models: [] })).toBe(
      key
    );
  });
});

describe('fetchAppleIntelligenceStatus', () => {
  it('parses the backend answer and drops malformed models', async () => {
    http.get.mockResolvedValue({
      available: true,
      reason: null,
      models: [
        {
          id: 'apple-on-device',
          available: true,
          context_size: 4096,
          capabilities: ['text', 3],
        },
        { available: true },
        'nope',
      ],
    });

    await expect(fetchAppleIntelligenceStatus()).resolves.toEqual({
      available: true,
      reason: null,
      models: [
        {
          id: 'apple-on-device',
          available: true,
          reason: null,
          context_size: 4096,
          capabilities: ['text'],
        },
      ],
    });
    expect(http.get).toHaveBeenCalledWith(
      '/model/apple-intelligence/status',
      undefined
    );
  });

  it('asks for a fresh check on refresh', async () => {
    http.get.mockResolvedValue({ available: false, reason: 'x', models: [] });
    await fetchAppleIntelligenceStatus(true);
    expect(http.get).toHaveBeenCalledWith('/model/apple-intelligence/status', {
      refresh: true,
    });
  });

  it.each([
    ['a network error', () => http.get.mockRejectedValue(new Error('down'))],
    [
      'an older backend',
      () => http.get.mockResolvedValue({ detail: 'Not Found' }),
    ],
    ['an empty body', () => http.get.mockResolvedValue(null)],
  ])('returns null on %s', async (_name, arrange) => {
    arrange();
    await expect(fetchAppleIntelligenceStatus()).resolves.toBeNull();
  });
});

describe('testAppleIntelligence', () => {
  it('passes the result through', async () => {
    http.post.mockResolvedValue({
      ok: false,
      elapsed_ms: 10,
      code: 'apple_intelligence_off',
      message: 'Turn it on.',
    });
    await expect(testAppleIntelligence()).resolves.toEqual({
      ok: false,
      elapsed_ms: 10,
      code: 'apple_intelligence_off',
      message: 'Turn it on.',
    });
  });

  it('reports a failure when the request fails', async () => {
    http.post.mockRejectedValue(new Error('down'));
    await expect(testAppleIntelligence()).resolves.toEqual({
      ok: false,
      elapsed_ms: null,
      code: 'bridge_unavailable',
    });
  });
});

describe('provider wiring', () => {
  it('names saved records without offering the provider everywhere', () => {
    expect(providerDefinition('apple-intelligence').name).toBe(
      'Apple Intelligence'
    );
    // Same category as before this change everywhere a record is classified,
    // so default-model selection keeps working (see the PR description).
    expect(providerCategory('apple-intelligence')).toBe('custom');
  });
});
