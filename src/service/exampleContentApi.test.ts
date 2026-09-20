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

import {
  CdnExampleContentProvider,
  DEFAULT_EXAMPLE_CONTENT_CATALOG_URL,
  HttpExampleContentProvider,
  createDefaultExampleContentProvider,
  getDefaultExampleContentCatalogUrl,
  isExampleContentExpired,
  parseExampleContentCatalog,
  resolveExampleContentOptions,
  resolveExampleRecommendations,
} from '@/service/exampleContentApi';
import { describe, expect, it, vi } from 'vitest';

const item = (
  id: string,
  roleKeys: string[],
  categoryKeys: string[],
  priority = 0
) => ({
  id,
  enabled: true,
  surfaces: ['workspace'],
  role_keys: roleKeys,
  space_category_keys: categoryKeys,
  priority,
  translations: {
    en: {
      title: id,
      summary: `${id} summary`,
      prompt: `${id} prompt`,
    },
  },
  requirements: { connector_keys: [] },
});

const rawCatalog = () => ({
  schema_version: 1,
  provider_key: 'eigent-default',
  provider_version: 'revision-1',
  enabled: true,
  space_categories: [
    {
      key: 'customer-success',
      enabled: true,
      sort_order: 10,
      translations: {
        en: { label: 'Customer success' },
        'fr-FR': { label: 'Réussite client' },
      },
    },
  ],
  items: [
    item('exact', ['engineering'], ['customer-success']),
    item('category', ['*'], ['customer-success']),
    item('role', ['engineering'], ['*']),
    item('fallback', ['*'], ['*']),
  ],
});

const encodeJson = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

const sha256 = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(bytes).buffer
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

const cdnFixture = async () => {
  const current = 'v1-123456789abc';
  const objects = new Map<string, Uint8Array>();
  for (const locale of ['en', 'fr-FR']) {
    objects.set(
      `catalog.${locale}.json`,
      encodeJson({
        schemaVersion: 1,
        providerKey: 'eigent-default',
        providerVersion: current,
        enabled: true,
        locale,
        items: [
          {
            id: 'fallback',
            enabled: true,
            surfaces: ['workspace', 'automation'],
            roleKeys: ['*'],
            spaceCategoryKeys: ['*'],
            priority: 10,
            title: locale === 'en' ? 'Fallback' : 'Solution de repli',
            summary: locale === 'en' ? 'Fallback summary' : 'Résumé de repli',
            prompt: locale === 'en' ? 'Fallback prompt' : 'Invite de repli',
            automation: {
              triggerType: 'schedule',
              draft: { name: 'Weekly summary', description: '' },
            },
            requiresConnectors: [],
            contextRequirements: { workspace: [], automation: [] },
            learnMoreUrl:
              locale === 'en'
                ? 'https://www.eigent.ai/solutions/fallback'
                : 'https://www.eigent.ai/fr-FR/solutions/fallback',
          },
        ],
      })
    );
    objects.set(
      `categories.${locale}.json`,
      encodeJson({
        schemaVersion: 1,
        providerKey: 'eigent-default',
        locale,
        categories: [
          {
            key: 'customer-success',
            enabled: true,
            sortOrder: 10,
            label: locale === 'en' ? 'Customer success' : 'Réussite client',
          },
        ],
      })
    );
  }
  objects.set(
    'registry.json',
    encodeJson({
      schemaVersion: 1,
      providerKey: 'eigent-default',
      itemIds: ['fallback'],
      categoryKeys: ['customer-success'],
    })
  );
  const descriptors = Object.fromEntries(
    await Promise.all(
      [...objects].map(async ([name, bytes]) => [
        name,
        { bytes: bytes.byteLength, sha256: await sha256(bytes) },
      ])
    )
  );
  const index = encodeJson({
    schemaVersion: 1,
    providerKey: 'eigent-default',
    enabled: true,
    current,
    locales: ['fr-FR', 'en'],
    publishedAt: '2026-09-20T12:00:00Z',
    minimumAdapterSchemaVersion: 1,
    objects: descriptors,
  });
  return { current, index, objects };
};

const fetchCdnFixture = (
  indexUrl: string,
  fixture: Awaited<ReturnType<typeof cdnFixture>>
) =>
  vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    let bytes: Uint8Array | undefined;
    if (url === indexUrl) {
      bytes = fixture.index;
    } else {
      const prefix = new URL(
        `v/${fixture.current}/`,
        new URL('./', indexUrl)
      ).toString();
      if (url.startsWith(prefix)) {
        bytes = fixture.objects.get(url.slice(prefix.length));
      }
    }
    return {
      ok: bytes !== undefined,
      status: bytes === undefined ? 404 : 200,
      arrayBuffer: async () =>
        bytes === undefined ? new ArrayBuffer(0) : new Uint8Array(bytes).buffer,
    } as Response;
  }) as unknown as typeof fetch;

describe('example content S3 catalog', () => {
  it('validates content-defined categories and localizes their labels', () => {
    const catalog = parseExampleContentCatalog(rawCatalog(), 1_000);
    const options = resolveExampleContentOptions(catalog, 'fr-FR');

    expect(options.contentRevision).toBe('eigent-default:revision-1');
    expect(options.spaceCategories[0]).toEqual({
      key: 'customer-success',
      label: 'Réussite client',
      description: null,
      sortOrder: 10,
      resolvedLocale: 'fr-FR',
    });
  });

  it('orders exact, category, role, and wildcard matches', () => {
    const catalog = parseExampleContentCatalog(rawCatalog());
    const result = resolveExampleRecommendations(catalog, {
      surface: 'workspace',
      roleKey: 'engineering',
      spaceCategoryKey: 'customer-success',
      locale: 'en-US',
      limit: 4,
    });

    expect(result.items.map((entry) => entry.title)).toEqual([
      'exact',
      'category',
      'role',
      'fallback',
    ]);
    expect(result.items[0].exampleRef).toBe('example:eigent-default:exact');
  });

  it('uses only wildcard matches when preferences are unset', () => {
    const catalog = parseExampleContentCatalog(rawCatalog());
    const result = resolveExampleRecommendations(catalog, {
      surface: 'workspace',
      locale: 'en',
      limit: 4,
    });

    expect(result.items.map((entry) => entry.title)).toEqual(['fallback']);
  });

  it('treats a successfully disabled catalog as authoritative', () => {
    const catalog = parseExampleContentCatalog({
      ...rawCatalog(),
      enabled: false,
    });

    expect(resolveExampleContentOptions(catalog, 'en')).toMatchObject({
      status: 'disabled',
      spaceCategories: [],
    });
    expect(
      resolveExampleRecommendations(catalog, {
        surface: 'workspace',
        locale: 'en',
      })
    ).toMatchObject({ status: 'disabled', items: [] });
  });

  it('rejects duplicate IDs and references to disabled categories', () => {
    const duplicate = rawCatalog();
    duplicate.items.push(item('exact', ['*'], ['*']));
    expect(() => parseExampleContentCatalog(duplicate)).toThrow('Duplicate');

    const unavailableCategory = rawCatalog();
    unavailableCategory.space_categories[0].enabled = false;
    expect(() => parseExampleContentCatalog(unavailableCategory)).toThrow(
      'unavailable category'
    );
  });

  it('fetches the public catalog without credentials', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => rawCatalog(),
    }) as unknown as typeof fetch;
    const provider = new HttpExampleContentProvider(
      'eigent-default',
      'https://cdn.example.com/example-content/catalog.json',
      fetchImplementation
    );

    await expect(provider.loadCatalog()).resolves.toMatchObject({
      providerKey: 'eigent-default',
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://cdn.example.com/example-content/catalog.json',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('binds the browser fetch implementation to the global receiver', async () => {
    const originalFetch = globalThis.fetch;
    let receiver: unknown;
    globalThis.fetch = async function (this: unknown) {
      receiver = this;
      return {
        ok: true,
        status: 200,
        json: async () => rawCatalog(),
      } as Response;
    } as typeof fetch;
    try {
      const provider = new HttpExampleContentProvider(
        'eigent-default',
        'https://cdn.example.com/example-content/catalog.json'
      );
      await provider.loadCatalog();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(receiver).toBe(globalThis);
  });

  it('loads, verifies, normalizes, and merges the versioned CDN catalog', async () => {
    const indexUrl = 'https://cdn.example.com/catalog/index.json';
    const fixture = await cdnFixture();
    const fetchImplementation = fetchCdnFixture(indexUrl, fixture);
    const provider = new CdnExampleContentProvider(
      'eigent-default',
      indexUrl,
      fetchImplementation
    );

    const catalog = await provider.loadCatalog();

    expect(catalog).toMatchObject({
      providerKey: 'eigent-default',
      providerVersion: fixture.current,
      enabled: true,
    });
    expect(catalog.spaceCategories[0].translations).toEqual({
      en: { label: 'Customer success', description: null },
      'fr-FR': { label: 'Réussite client', description: null },
    });
    expect(catalog.items[0].translations['fr-FR']).toMatchObject({
      title: 'Solution de repli',
      automationName: 'Weekly summary',
      automationDescription: null,
    });
    expect(catalog.items[0].learnMoreUrl).toBe(
      'https://www.eigent.ai/solutions/fallback'
    );
    expect(fetchImplementation).toHaveBeenCalledTimes(6);
    expect(fetchImplementation).toHaveBeenCalledWith(
      `https://cdn.example.com/catalog/v/${fixture.current}/catalog.en.json`,
      expect.objectContaining({
        credentials: 'omit',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('rejects a versioned CDN object when its checksum does not match', async () => {
    const indexUrl = 'https://cdn.example.com/catalog/index.json';
    const fixture = await cdnFixture();
    const index = JSON.parse(new TextDecoder().decode(fixture.index));
    index.objects['catalog.en.json'].sha256 = '0'.repeat(64);
    fixture.index = encodeJson(index);
    const provider = new CdnExampleContentProvider(
      'eigent-default',
      indexUrl,
      fetchCdnFixture(indexUrl, fixture)
    );

    await expect(provider.loadCatalog()).rejects.toThrow('checksum mismatch');
  });

  it('treats a disabled CDN index as authoritative without loading objects', async () => {
    const indexUrl = 'https://cdn.example.com/catalog/index.json';
    const fixture = await cdnFixture();
    const index = JSON.parse(new TextDecoder().decode(fixture.index));
    index.enabled = false;
    fixture.index = encodeJson(index);
    const fetchImplementation = fetchCdnFixture(indexUrl, fixture);
    const provider = new CdnExampleContentProvider(
      'eigent-default',
      indexUrl,
      fetchImplementation
    );

    await expect(provider.loadCatalog()).resolves.toMatchObject({
      enabled: false,
      providerVersion: fixture.current,
      items: [],
      spaceCategories: [],
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('uses the versioned CDN adapter for the default provider', () => {
    expect(
      createDefaultExampleContentProvider(
        'https://cdn.example.com/catalog/index.json'
      )
    ).toBeInstanceOf(CdnExampleContentProvider);
  });

  it('rejects cleartext remote CDN indexes but permits loopback development', () => {
    expect(
      () =>
        new CdnExampleContentProvider(
          'eigent-default',
          'http://cdn.example.com/catalog/index.json'
        )
    ).toThrow('HTTPS');
    expect(
      () =>
        new CdnExampleContentProvider(
          'eigent-default',
          'http://127.0.0.1:4173/catalog/index.json'
        )
    ).not.toThrow();
  });

  it('uses the public catalog by default and permits an environment override', () => {
    expect(getDefaultExampleContentCatalogUrl(undefined)).toBe(
      DEFAULT_EXAMPLE_CONTENT_CATALOG_URL
    );
    expect(getDefaultExampleContentCatalogUrl('')).toBe(
      DEFAULT_EXAMPLE_CONTENT_CATALOG_URL
    );
    expect(
      getDefaultExampleContentCatalogUrl(
        ' https://community.example.com/catalog/index.json '
      )
    ).toBe('https://community.example.com/catalog/index.json');
    expect(getDefaultExampleContentCatalogUrl(false)).toBeNull();
  });

  it('times out a stalled catalog body within the request deadline', async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => new Promise(() => undefined),
    }) as unknown as typeof fetch;
    const provider = new HttpExampleContentProvider(
      'eigent-default',
      'https://cdn.example.com/example-content/catalog.json',
      fetchImplementation,
      1_000
    );

    const result = expect(provider.loadCatalog()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1_000);
    await result;
    vi.useRealTimers();
  });

  it('rejects a catalog that does not belong to the configured provider', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...rawCatalog(), provider_key: 'other-provider' }),
    }) as unknown as typeof fetch;
    const provider = new HttpExampleContentProvider(
      'eigent-default',
      'https://cdn.example.com/example-content/catalog.json',
      fetchImplementation
    );

    await expect(provider.loadCatalog()).rejects.toThrow('provider key');
  });

  it('does not reuse a catalog after its maximum age', () => {
    const catalog = parseExampleContentCatalog(rawCatalog(), 1_000);
    const result = resolveExampleRecommendations(catalog, {
      surface: 'workspace',
      locale: 'en',
    });

    expect(isExampleContentExpired(result, 1_001)).toBe(false);
    expect(isExampleContentExpired(result, 1_000 + 24 * 60 * 60 * 1_000)).toBe(
      true
    );
  });
});
