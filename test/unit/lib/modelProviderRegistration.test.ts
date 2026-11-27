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
  importEarlierModelConfigurations,
  modelProviderMetadata,
  plainEndpoint,
  registerDefaultModelConfiguration,
  registerModelConfiguration,
  resetModelProviderRegistration,
  unregisterModelConfiguration,
} from '@/lib/modelProviderRegistration';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localModelRecord } from '../helpers/localModels';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  link: vi.fn(),
  importRecords: vi.fn(),
  auth: { user_id: 7 as number | null, email: 'person@example.test' },
}));
vi.mock('@/api/http', () => ({
  proxyFetchGet: mocks.get,
  proxyFetchPost: mocks.post,
  proxyFetchPut: mocks.put,
  proxyFetchDelete: mocks.remove,
}));
vi.mock('@/lib/modelConfigurationStore', () => ({
  SAVED_VALUE_MARKER: '[saved on this device]',
  linkLocalModelConfiguration: mocks.link,
  importLocalModelConfigurations: mocks.importRecords,
}));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => mocks.auth }));

const MARKER = '[saved on this device]';
/** A saved model as the app window sees it, with every kind of setting. */
const record = localModelRecord({
  id: 2147483648,
  provider_name: 'aws-bedrock-converse',
  model_type: 'model-test',
  endpoint_url: 'https://models.example.test/v1',
  api_key: 'unit-test-model-key-0001',
  encrypted_config: {
    region_name: 'us-test-1',
    api_version: '2026-01-01',
    azure_deployment_name: 'deployment-test',
    aws_access_key_id: MARKER,
    aws_secret_access_key: MARKER,
    aws_session_token: MARKER,
    default_headers: { Authorization: MARKER },
    model_capability: { anything: true },
    custom_setting: 'kept on the device',
    model_config_dict: {
      temperature: 0.2,
      max_tokens: 512,
      stream: true,
      n: 2,
      stop: ['END'],
      extra_headers: { 'X-Api-Key': MARKER, 'X-Title': 'Eigent' },
      extra_body: { anything: true },
    },
  },
});
const sent = () =>
  JSON.stringify([
    mocks.get.mock.calls,
    mocks.post.mock.calls,
    mocks.put.mock.calls,
    mocks.remove.mock.calls,
  ]);

beforeEach(() => {
  vi.resetAllMocks();
  resetModelProviderRegistration();
  mocks.auth.user_id = 7;
});

describe('what may leave the device for a saved model', () => {
  it('is the name, the plain address and a short list of plain settings', () => {
    expect(modelProviderMetadata(record)).toEqual({
      provider_name: 'aws-bedrock-converse',
      model_type: 'model-test',
      endpoint_url: 'https://models.example.test/v1',
      is_valid: 2,
      config: {
        region_name: 'us-test-1',
        api_version: '2026-01-01',
        azure_deployment_name: 'deployment-test',
        model_config_dict: {
          temperature: 0.2,
          max_tokens: 512,
          stream: true,
          n: 2,
        },
      },
    });
  });

  it('never includes a key, a secret setting, a header or the marker', () => {
    const encoded = JSON.stringify(
      modelProviderMetadata({
        ...record,
        // Even if a caller attached values this window should not hold.
        ...({ api_key: 'unit-test-model-key-0001' } as object),
      })
    );

    expect(encoded).not.toMatch(
      /api_key|unit-test-model-key|aws_|headers|Authorization|X-Api-Key|extra_body|custom_setting|model_capability|saved on this device/
    );
  });

  it('removes the sign-in part, query and fragment of an address', () => {
    expect(
      plainEndpoint(
        'https://user:unit-pass@models.example.test:8443/v1?sig=abc#x'
      )
    ).toBe('https://models.example.test:8443/v1');
    expect(plainEndpoint(' http://localhost:11434/v1 ')).toBe(
      'http://localhost:11434/v1'
    );
    expect(plainEndpoint('ftp://models.example.test')).toBe('');
    expect(plainEndpoint('not an address')).toBe('');
    expect(plainEndpoint(undefined)).toBe('');
    expect(
      modelProviderMetadata({
        ...record,
        endpoint_url: 'https://user:unit-pass@models.example.test/v1?sig=abc',
      })?.endpoint_url
    ).toBe('https://models.example.test/v1');
  });

  it('sends nothing for a model whose name the server could not take', () => {
    expect(
      modelProviderMetadata({ ...record, provider_name: 'has space' })
    ).toBeNull();
    expect(
      modelProviderMetadata({ ...record, model_type: 'x'.repeat(129) })
    ).toBeNull();
    expect(
      modelProviderMetadata({ ...record, model_type: ' padded ' })
    ).toBeNull();
  });
});

describe('telling the server about a saved model', () => {
  it('registers a new model and remembers the server record', async () => {
    mocks.post.mockResolvedValue({ id: 31 });

    expect(await registerModelConfiguration(record)).toBe(31);
    expect(mocks.post).toHaveBeenCalledWith(
      '/api/v1/model-providers',
      modelProviderMetadata(record),
      undefined,
      expect.objectContaining({ expectedAccountKey: expect.any(String) })
    );
    expect(mocks.link).toHaveBeenCalledWith(mocks.auth, record.id, 31);
    expect(sent()).not.toMatch(/unit-test-model-key|saved on this device|aws_/);
  });

  it('updates the record it already has, and registers again if it is gone', async () => {
    const linked = { ...record, server_id: 31 };
    mocks.put.mockResolvedValue({ id: 31 });
    expect(await registerModelConfiguration(linked)).toBe(31);
    expect(mocks.put).toHaveBeenCalledWith(
      '/api/v1/model-providers/31',
      modelProviderMetadata(linked),
      undefined,
      expect.anything()
    );
    expect(mocks.post).not.toHaveBeenCalled();

    mocks.put.mockRejectedValue(
      Object.assign(new Error('gone'), { status: 404 })
    );
    mocks.post.mockResolvedValue({ id: 32 });
    expect(await registerModelConfiguration(linked)).toBe(32);
    expect(mocks.link).toHaveBeenCalledWith(mocks.auth, record.id, 32);
  });

  it.each([
    ['an older server without these routes', { status: 404 }],
    ['a refusal', { status: 422 }],
    ['no connection', {}],
  ])('is not needed for the model to work: %s', async (_name, failure) => {
    mocks.post.mockRejectedValue(Object.assign(new Error('failed'), failure));

    expect(await registerModelConfiguration(record)).toBeNull();
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it('does not link a sign-in error or an identifier outside the server range', async () => {
    mocks.post.mockResolvedValue({ code: 13, text: 'Sign in again' });
    expect(await registerModelConfiguration(record)).toBeNull();
    mocks.post.mockResolvedValue({ id: 2147483648 });
    expect(await registerModelConfiguration(record)).toBeNull();
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it('does not link a record that answers after the account changed', async () => {
    mocks.post.mockImplementation(async () => {
      mocks.auth.user_id = 8;
      return { id: 31 };
    });

    expect(await registerModelConfiguration(record)).toBeNull();
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it('tells the server the default, registering the model first if needed', async () => {
    mocks.post.mockImplementation(async (url: string) =>
      url.endsWith('/prefer') ? { success: true } : { id: 31 }
    );
    await registerDefaultModelConfiguration(record);

    expect(mocks.post.mock.calls.map(([url, body]) => [url, body])).toEqual([
      ['/api/v1/model-providers', modelProviderMetadata(record)],
      ['/api/v1/model-providers/prefer', { provider_id: 31 }],
    ]);

    mocks.post.mockRejectedValue(new Error('offline'));
    await expect(
      registerDefaultModelConfiguration({ ...record, server_id: 31 })
    ).resolves.toBeUndefined();
  });

  it('removes the server record of a model removed here, if there is one', async () => {
    await unregisterModelConfiguration(null);
    expect(mocks.remove).not.toHaveBeenCalled();
    await unregisterModelConfiguration(31);
    expect(mocks.remove).toHaveBeenCalledWith('/api/v1/model-providers/31');
    mocks.remove.mockRejectedValue(new Error('offline'));
    await expect(unregisterModelConfiguration(31)).resolves.toBeUndefined();
  });
});

describe('taking over the earlier model list', () => {
  const row = (id: number, more: Record<string, unknown> = {}) => ({
    id,
    provider_name: 'openai',
    model_type: `model-${id}`,
    endpoint_url: 'https://models.example.test/v1',
    config: { api_version: '2026-01-01' },
    is_valid: 2,
    prefer: false,
    execution_revision: 'a'.repeat(32),
    ...more,
  });

  it('takes names and plain settings only, and marks which models need a key', async () => {
    mocks.get.mockResolvedValue({
      items: [
        row(57, { prefer: true }),
        row(58, { provider_name: 'ollama', endpoint_url: '' }),
        // Whatever an answer holds, nothing secret is carried over.
        row(59, {
          api_key: 'unit-test-stray-key',
          endpoint_url: 'https://user:unit-pass@models.example.test/v1',
          config: { aws_secret_access_key: 'unit-test-stray-secret' },
        }),
        row(2147483648),
        { id: 60 },
      ],
      total: 5,
      page: 1,
      size: 100,
      pages: 1,
    });

    expect(await importEarlierModelConfigurations()).toBe(true);
    expect(mocks.get).toHaveBeenCalledWith(
      '/api/v1/model-providers',
      { page: 1, size: 100 },
      undefined,
      expect.objectContaining({ expectedAccountKey: expect.any(String) })
    );
    const [, records] = mocks.importRecords.mock.calls[0];
    expect(records).toEqual([
      {
        id: 57,
        provider_name: 'openai',
        model_type: 'model-57',
        endpoint_url: 'https://models.example.test/v1',
        config: { api_version: '2026-01-01' },
        prefer: true,
        needs_key: true,
      },
      {
        id: 58,
        provider_name: 'ollama',
        model_type: 'model-58',
        endpoint_url: '',
        config: { api_version: '2026-01-01' },
        prefer: false,
        needs_key: false,
      },
      {
        id: 59,
        provider_name: 'openai',
        model_type: 'model-59',
        endpoint_url: 'https://models.example.test/v1',
        config: {},
        prefer: false,
        needs_key: true,
      },
    ]);
    expect(JSON.stringify(records)).not.toMatch(/unit-test-stray|unit-pass/);
    // The earlier routes that could return a key are never called.
    expect(
      mocks.get.mock.calls.every(([url]) => url === '/api/v1/model-providers')
    ).toBe(true);
  });

  it('reads every page', async () => {
    mocks.get
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, (_, index) => row(index + 1)),
        pages: 2,
      })
      .mockResolvedValueOnce({ items: [row(101)], pages: 2 });

    expect(await importEarlierModelConfigurations()).toBe(true);
    expect(mocks.importRecords.mock.calls[0][1]).toHaveLength(101);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('records an empty earlier list so it is not asked for again', async () => {
    mocks.get.mockResolvedValue({ items: [], total: 0, pages: 0 });

    expect(await importEarlierModelConfigurations()).toBe(true);
    expect(mocks.importRecords).toHaveBeenCalledWith(mocks.auth, []);
  });

  it.each([
    [
      'an older server',
      () =>
        Promise.reject(Object.assign(new Error('Not Found'), { status: 404 })),
    ],
    ['no connection', () => Promise.reject(new Error('offline'))],
    [
      'a sign-in error',
      () => Promise.resolve({ code: 13, text: 'Sign in again' }),
    ],
  ])(
    'takes nothing over from %s and asks once per app start',
    async (_name, answer) => {
      mocks.get.mockImplementation(answer);

      expect(await importEarlierModelConfigurations()).toBe(false);
      expect(await importEarlierModelConfigurations()).toBe(false);
      expect(mocks.importRecords).not.toHaveBeenCalled();
      expect(mocks.get).toHaveBeenCalledTimes(1);
    }
  );

  it('takes nothing over when the account changes while the list loads', async () => {
    mocks.get.mockImplementation(async () => {
      mocks.auth.user_id = 8;
      return { items: [row(57)], pages: 1 };
    });

    expect(await importEarlierModelConfigurations()).toBe(false);
    expect(mocks.importRecords).not.toHaveBeenCalled();
  });
});
